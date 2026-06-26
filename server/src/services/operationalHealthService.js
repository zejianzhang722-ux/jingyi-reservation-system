const db = require('../config/database');
const dataReadinessService = require('./dataReadinessService');
const auditSchemaService = require('./auditSchemaService');
const backupSchemaService = require('./backupSchemaService');
const metricsService = require('./metricsService');
const auditTrailService = require('./auditTrailService');
const schedulerService = require('./schedulerService');
const notificationOutboxPumpService = require('./notificationOutboxPumpService');
const backupScheduleService = require('./backupScheduleService');

const threshold = function(name, fallback, minimum) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum || 0, value) : fallback;
};

const alertThresholds = function() {
  return {
    outboxBacklogWarning: threshold('OPS_OUTBOX_BACKLOG_WARNING', 100, 1),
    outboxOldestWarningSeconds: threshold('OPS_OUTBOX_OLDEST_WARNING_SECONDS', 300, 1),
    outboxDeadCritical: threshold('OPS_OUTBOX_DEAD_CRITICAL', 1, 1),
    httpErrorRateWarning: threshold('OPS_HTTP_5XX_RATE_WARNING', 0.05, 0),
    httpMinimumSamples: threshold('OPS_HTTP_ERROR_MINIMUM_SAMPLES', 20, 1),
    auditFailureCritical: threshold('OPS_AUDIT_FAILURE_CRITICAL', 1, 1),
    backupMaxAgeSeconds: threshold('OPS_BACKUP_MAX_AGE_SECONDS', 26 * 60 * 60, 60),
    backupFailureCritical: threshold('OPS_BACKUP_FAILURE_CRITICAL', 1, 1)
  };
};

const mockOutboxStats = function() {
  const tables = require('../config/mock-db').__tables;
  const rows = tables.notification_outbox || [];
  const now = Date.now();
  const stats = { total: rows.length, pending: 0, processing: 0, failed: 0, dead: 0, sent: 0, oldestPendingSeconds: 0 };
  rows.forEach(function(row) {
    if (stats[row.status] !== undefined) stats[row.status] += 1;
    if (['pending', 'processing', 'failed'].includes(row.status)) {
      const created = new Date(row.created_at || row.available_at || now).getTime();
      if (Number.isFinite(created)) stats.oldestPendingSeconds = Math.max(stats.oldestPendingSeconds, Math.floor((now - created) / 1000));
    }
  });
  return stats;
};

const collectOutboxStats = async function() {
  if (db.isMock()) return mockOutboxStats();
  const [rows] = await db.query(
    "SELECT COUNT(*) AS total," +
    "SUM(status='pending') AS pending," +
    "SUM(status='processing') AS processing," +
    "SUM(status='failed') AS failed," +
    "SUM(status='dead') AS dead," +
    "SUM(status='sent') AS sent," +
    "COALESCE(MAX(CASE WHEN status IN ('pending','processing','failed') THEN TIMESTAMPDIFF(SECOND,created_at,NOW()) ELSE 0 END),0) AS oldest_pending_seconds " +
    'FROM notification_outbox'
  );
  const row = rows[0] || {};
  return {
    total: Number(row.total || 0),
    pending: Number(row.pending || 0),
    processing: Number(row.processing || 0),
    failed: Number(row.failed || 0),
    dead: Number(row.dead || 0),
    sent: Number(row.sent || 0),
    oldestPendingSeconds: Math.max(0, Number(row.oldest_pending_seconds || 0))
  };
};

const collectAuditStats = async function() {
  let recent24Hours = 0;
  let serverErrors24Hours = 0;
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    (tables.operation_logs || []).forEach(function(row) {
      const created = new Date(String(row.created_at || '').replace(' ', 'T') + 'Z').getTime();
      if (!Number.isFinite(created) || created < cutoff) return;
      recent24Hours += 1;
      if (row.outcome === 'server_error') serverErrors24Hours += 1;
    });
  } else {
    const [rows] = await db.query(
      "SELECT COUNT(*) AS total,SUM(outcome='server_error') AS server_errors FROM operation_logs WHERE created_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR)"
    );
    recent24Hours = Number((rows[0] && rows[0].total) || 0);
    serverErrors24Hours = Number((rows[0] && rows[0].server_errors) || 0);
  }
  const integrity = await auditTrailService.verifyRecent(200);
  return { recent24Hours, serverErrors24Hours, integrity };
};

const collectBackupStats = async function() {
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    const rows = tables.backup_runs || [];
    const success = rows.filter(function(row) { return row.status === 'success' || row.status === 'verified' || row.status === 'restored'; }).slice(-1)[0];
    const lastTime = success ? new Date(success.finished_at || success.started_at).getTime() : null;
    return {
      lastSuccessAt: success ? success.finished_at || success.started_at : null,
      lastSuccessAgeSeconds: lastTime ? Math.max(0, Math.floor((Date.now() - lastTime) / 1000)) : null,
      failures24Hours: rows.filter(function(row) {
        return row.status === 'failed' && Date.now() - new Date(row.finished_at || row.started_at).getTime() <= 86400000;
      }).length,
      secondaryCopied: success ? !!success.secondary_copied : false
    };
  }
  const [rows] = await db.query(
    "SELECT MAX(CASE WHEN status IN ('success','verified','restored') THEN finished_at END) AS last_success_at," +
    "SUM(status='failed' AND started_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR)) AS failures_24h," +
    "SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN status IN ('success','verified','restored') THEN secondary_copied END ORDER BY id DESC),',',1) AS secondary_copied " +
    'FROM backup_runs'
  );
  const row = rows[0] || {};
  const last = row.last_success_at ? new Date(row.last_success_at).getTime() : null;
  return {
    lastSuccessAt: row.last_success_at || null,
    lastSuccessAgeSeconds: last ? Math.max(0, Math.floor((Date.now() - last) / 1000)) : null,
    failures24Hours: Number(row.failures_24h || 0),
    secondaryCopied: Number(row.secondary_copied || 0) === 1
  };
};

const readinessSummary = async function() {
  try {
    const values = await Promise.all([
      dataReadinessService.checkDataReadiness(),
      auditSchemaService.check(),
      backupSchemaService.check()
    ]);
    return {
      ready: !!values[0].ready && !!values[1].ready && !!values[2].ready,
      value: { data: values[0], audit: values[1], backup: values[2] },
      error: null
    };
  } catch (err) {
    return {
      ready: false,
      value: null,
      error: { code: err && err.code, message: err && err.message, details: err && err.details }
    };
  }
};

const evaluateAlerts = function(snapshot) {
  const limits = alertThresholds();
  const alerts = [];
  if (!snapshot.readiness.ready) alerts.push({ code: 'DEPENDENCY_NOT_READY', severity: 'critical', message: '数据库、Redis或数据库结构未就绪' });
  const backlog = snapshot.outbox.pending + snapshot.outbox.processing + snapshot.outbox.failed;
  if (snapshot.outbox.dead >= limits.outboxDeadCritical) alerts.push({ code: 'OUTBOX_DEAD_LETTERS', severity: 'critical', message: '通知死信数量达到阈值', value: snapshot.outbox.dead });
  if (backlog >= limits.outboxBacklogWarning) alerts.push({ code: 'OUTBOX_BACKLOG', severity: 'warning', message: '通知Outbox积压达到阈值', value: backlog });
  if (snapshot.outbox.oldestPendingSeconds >= limits.outboxOldestWarningSeconds) alerts.push({ code: 'OUTBOX_OLDEST_PENDING', severity: 'warning', message: '最旧待投递通知等待时间过长', value: snapshot.outbox.oldestPendingSeconds });
  if (snapshot.metrics.totalRequests >= limits.httpMinimumSamples && snapshot.metrics.errorRate >= limits.httpErrorRateWarning) alerts.push({ code: 'HTTP_5XX_RATE', severity: 'warning', message: 'HTTP 5xx错误率达到阈值', value: snapshot.metrics.errorRate });
  if (snapshot.metrics.auditWriteFailures >= limits.auditFailureCritical) alerts.push({ code: 'AUDIT_WRITE_FAILURES', severity: 'critical', message: '审计日志写入失败', value: snapshot.metrics.auditWriteFailures });
  if (!snapshot.audit.integrity.valid) alerts.push({ code: 'AUDIT_CHAIN_INVALID', severity: 'critical', message: '审计日志哈希链校验失败', value: snapshot.audit.integrity.problems.length });

  const backupRequired = process.env.ENABLE_AUTOMATED_BACKUPS === 'true' || process.env.REQUIRE_RECENT_BACKUP === 'true';
  if (backupRequired && snapshot.backup.lastSuccessAgeSeconds === null) alerts.push({ code: 'BACKUP_MISSING', severity: 'critical', message: '尚无成功备份记录' });
  if (backupRequired && snapshot.backup.lastSuccessAgeSeconds !== null && snapshot.backup.lastSuccessAgeSeconds >= limits.backupMaxAgeSeconds) alerts.push({ code: 'BACKUP_STALE', severity: 'critical', message: '最近成功备份已超过允许时长', value: snapshot.backup.lastSuccessAgeSeconds });
  if (snapshot.backup.failures24Hours >= limits.backupFailureCritical) alerts.push({ code: 'BACKUP_FAILURES', severity: 'critical', message: '最近24小时存在备份失败', value: snapshot.backup.failures24Hours });
  if (backupRequired && process.env.ALLOW_SINGLE_COPY_BACKUP !== 'true' && snapshot.backup.lastSuccessAt && !snapshot.backup.secondaryCopied) alerts.push({ code: 'BACKUP_SECONDARY_COPY_MISSING', severity: 'warning', message: '最近成功备份未写入第二副本' });
  return alerts;
};

const collectSnapshot = async function() {
  const results = await Promise.all([
    readinessSummary(),
    collectOutboxStats().catch(function(err) { return { error: err.message, total: 0, pending: 0, processing: 0, failed: 0, dead: 0, sent: 0, oldestPendingSeconds: 0 }; }),
    collectAuditStats().catch(function(err) { return { error: err.message, recent24Hours: 0, serverErrors24Hours: 0, integrity: { valid: false, checked: 0, problems: [{ issue: 'verification_failed' }] } }; }),
    collectBackupStats().catch(function(err) { return { error: err.message, lastSuccessAt: null, lastSuccessAgeSeconds: null, failures24Hours: 1, secondaryCopied: false }; })
  ]);
  const snapshot = {
    timestamp: new Date().toISOString(),
    readiness: results[0],
    outbox: results[1],
    audit: results[2],
    backup: results[3],
    metrics: metricsService.snapshot(),
    scheduler: schedulerService.getSchedulerState(),
    backupSchedule: backupScheduleService.state(),
    outboxPump: notificationOutboxPumpService.state(),
    process: { pid: process.pid, nodeVersion: process.version, environment: process.env.NODE_ENV || 'development' }
  };
  snapshot.alerts = evaluateAlerts(snapshot);
  snapshot.status = snapshot.alerts.some(function(alert) { return alert.severity === 'critical'; }) ? 'critical' : (snapshot.alerts.length ? 'degraded' : 'ok');
  return snapshot;
};

const prometheusGauges = function(snapshot) {
  const backlog = snapshot.outbox.pending + snapshot.outbox.processing + snapshot.outbox.failed;
  return [
    { name: 'jingyi_readiness', help: 'Whether production dependencies and schema are ready.', value: snapshot.readiness.ready ? 1 : 0 },
    { name: 'jingyi_notification_outbox_backlog', help: 'Pending, processing and failed notification events.', value: backlog },
    { name: 'jingyi_notification_outbox_dead', help: 'Dead-letter notification events.', value: snapshot.outbox.dead },
    { name: 'jingyi_notification_outbox_oldest_pending_seconds', help: 'Age of the oldest unfinished notification event.', value: snapshot.outbox.oldestPendingSeconds },
    { name: 'jingyi_audit_chain_valid', help: 'Whether the recent audit hash chain is valid.', value: snapshot.audit.integrity.valid ? 1 : 0 },
    { name: 'jingyi_audit_events_24h', help: 'Audit events written during the last 24 hours.', value: snapshot.audit.recent24Hours },
    { name: 'jingyi_backup_last_success_age_seconds', help: 'Age of the latest successful encrypted backup.', value: snapshot.backup.lastSuccessAgeSeconds || 0 },
    { name: 'jingyi_backup_failures_24h', help: 'Backup failures during the last 24 hours.', value: snapshot.backup.failures24Hours },
    { name: 'jingyi_backup_secondary_copy', help: 'Whether the latest successful backup has a secondary copy.', value: snapshot.backup.secondaryCopied ? 1 : 0 },
    { name: 'jingyi_operational_active_alerts', help: 'Current operational alerts.', value: snapshot.alerts.length }
  ];
};

module.exports = {
  threshold,
  alertThresholds,
  mockOutboxStats,
  collectOutboxStats,
  collectAuditStats,
  collectBackupStats,
  readinessSummary,
  evaluateAlerts,
  collectSnapshot,
  prometheusGauges
};
