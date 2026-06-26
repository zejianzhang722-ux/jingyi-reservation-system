const logger = require('../config/logger');
const metricsService = require('./metricsService');
const operationalHealthService = require('./operationalHealthService');
const distributedLockService = require('./distributedLockService');

let timer = null;
let activeRun = null;
const lastEmitted = new Map();

const intervalMs = function() {
  const value = Number(process.env.OPS_MONITOR_INTERVAL_MS || 60000);
  return Math.max(30000, Number.isFinite(value) ? value : 60000);
};

const alertCooldownMs = function() {
  const value = Number(process.env.OPS_ALERT_COOLDOWN_MS || 300000);
  return Math.max(60000, Number.isFinite(value) ? value : 300000);
};

const shouldEmit = function(alert, now) {
  const previous = lastEmitted.get(alert.code);
  const fingerprint = alert.severity + ':' + String(alert.value === undefined ? '' : alert.value);
  if (!previous || previous.fingerprint !== fingerprint || now - previous.time >= alertCooldownMs()) {
    lastEmitted.set(alert.code, { fingerprint, time: now });
    return true;
  }
  return false;
};

const emitAlerts = function(snapshot) {
  const now = Date.now();
  snapshot.alerts.forEach(function(alert) {
    if (!shouldEmit(alert, now)) return;
    metricsService.recordOperationalAlert(alert.severity);
    const log = alert.severity === 'critical' ? logger.error.bind(logger) : logger.warn.bind(logger);
    log('operational_alert', {
      alertCode: alert.code,
      severity: alert.severity,
      message: alert.message,
      value: alert.value,
      snapshotStatus: snapshot.status,
      timestamp: snapshot.timestamp
    });
  });
  return snapshot.alerts.length;
};

const execute = async function() {
  const lockTtl = Math.max(10000, Math.floor(intervalMs() * 0.9));
  const locked = await distributedLockService.withLock({
    name: 'operational-monitor',
    ttlMs: lockTtl
  }, async function() {
    const snapshot = await operationalHealthService.collectSnapshot();
    emitAlerts(snapshot);
    if (snapshot.status === 'ok') {
      logger.info('operational_health_ok', {
        outboxBacklog: snapshot.outbox.pending + snapshot.outbox.processing + snapshot.outbox.failed,
        auditChainValid: snapshot.audit.integrity.valid
      });
    }
    return snapshot;
  });
  return locked.acquired ? locked.value : { skipped: true, reason: 'another-instance-monitoring' };
};

const runNow = function() {
  if (activeRun) return activeRun;
  activeRun = execute().finally(function() { activeRun = null; });
  return activeRun;
};

const start = function() {
  if (timer) return { started: true, reused: true, intervalMs: intervalMs() };
  const every = intervalMs();
  timer = setInterval(function() {
    runNow().catch(function(err) {
      logger.error('operational_monitor_failed', { error: err && err.message, code: err && err.code });
    });
  }, every);
  if (typeof timer.unref === 'function') timer.unref();
  runNow().catch(function(err) {
    logger.error('operational_monitor_initial_run_failed', { error: err && err.message, code: err && err.code });
  });
  return { started: true, reused: false, intervalMs: every };
};

const stop = async function(options) {
  if (timer) clearInterval(timer);
  timer = null;
  const timeoutMs = Math.max(100, Number((options && options.timeoutMs) || 5000));
  const pending = activeRun;
  if (!pending) return { stopped: true, drained: true };
  const drained = await Promise.race([
    pending.then(function() { return true; }).catch(function() { return true; }),
    new Promise(function(resolve) {
      const timeout = setTimeout(function() { resolve(false); }, timeoutMs);
      if (typeof timeout.unref === 'function') timeout.unref();
    })
  ]);
  return { stopped: true, drained };
};

const state = function() {
  return { started: !!timer, running: !!activeRun, intervalMs: intervalMs() };
};

const resetForTests = function() {
  if (timer) clearInterval(timer);
  timer = null;
  activeRun = null;
  lastEmitted.clear();
};

module.exports = {
  intervalMs,
  alertCooldownMs,
  shouldEmit,
  emitAlerts,
  execute,
  runNow,
  start,
  stop,
  state,
  resetForTests
};
