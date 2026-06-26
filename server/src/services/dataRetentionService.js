const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const db = require('../config/database');
const logger = require('../config/logger');
const backupCrypto = require('../utils/backupCrypto');
const backupService = require('./backupService');

const POLICIES = {
  operation_logs: { dateColumn: 'created_at', daysEnv: 'RETENTION_AUDIT_DAYS', defaultDays: 365 },
  notifications: { dateColumn: 'created_at', daysEnv: 'RETENTION_NOTIFICATION_DAYS', defaultDays: 180 },
  notification_outbox: { dateColumn: 'created_at', daysEnv: 'RETENTION_OUTBOX_DAYS', defaultDays: 90, extraWhere: "status IN ('sent','dead')" }
};

const archiveRoot = function() {
  return backupService.ensureDirectory(process.env.ARCHIVE_DIR || path.join(backupService.backupRoot(), 'archives'));
};

const safePolicy = function(table) {
  const policy = POLICIES[table];
  if (!policy) {
    const err = new Error('不支持归档数据表: ' + table);
    err.code = 'ARCHIVE_TABLE_UNSUPPORTED';
    throw err;
  }
  return policy;
};

const cutoffDate = function(policy, referenceDate) {
  const days = Math.max(1, Number(process.env[policy.daysEnv] || policy.defaultDays));
  const cutoff = new Date((referenceDate || new Date()).getTime() - days * 86400000);
  return { days, value: cutoff.toISOString().slice(0, 19).replace('T', ' ') };
};

const selectRows = async function(table, policy, cutoff, limit) {
  const extra = policy.extraWhere ? ' AND ' + policy.extraWhere : '';
  const sql = 'SELECT * FROM `' + table + '` WHERE `' + policy.dateColumn + '` < ?' + extra + ' ORDER BY `' + policy.dateColumn + '` ASC LIMIT ' + limit;
  const [rows] = await db.query(sql, [cutoff]);
  return rows;
};

const writeNdjsonGzip = async function(rows, filePath) {
  const source = require('stream').Readable.from(rows.map(function(row) { return JSON.stringify(row) + '\n'; }));
  const gzip = zlib.createGzip({ level: 9 });
  const output = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  await pipeline(source, gzip, output);
  return filePath;
};

const insertArchiveRun = async function(record) {
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    if (!tables.data_archives) tables.data_archives = [];
    const row = Object.assign({ id: tables.data_archives.length + 1 }, record);
    tables.data_archives.push(row);
    return row.id;
  }
  const [result] = await db.query(
    'INSERT INTO data_archives (archive_id,table_name,cutoff_at,row_count,file_name,checksum_sha256,status,created_at) VALUES (?,?,?,?,?,?,?,NOW())',
    [record.archive_id, record.table_name, record.cutoff_at, record.row_count, record.file_name, record.checksum_sha256, record.status]
  );
  return result.insertId;
};

const deleteArchivedRows = async function(table, policy, cutoff, maxId) {
  const extra = policy.extraWhere ? ' AND ' + policy.extraWhere : '';
  const idClause = maxId === null ? '' : ' AND id <= ?';
  const params = maxId === null ? [cutoff] : [cutoff, maxId];
  const [result] = await db.query(
    'DELETE FROM `' + table + '` WHERE `' + policy.dateColumn + '` < ?' + extra + idClause,
    params
  );
  return Number(result.affectedRows || 0);
};

const archiveTable = async function(table, options) {
  const settings = options || {};
  const policy = safePolicy(table);
  const cutoff = cutoffDate(policy, settings.referenceDate);
  const limit = Math.min(500000, Math.max(1, Number(settings.limit || process.env.RETENTION_ARCHIVE_MAX_ROWS || 100000)));
  if (db.isMock()) {
    return { table, skipped: true, reason: 'mock-database', cutoff: cutoff.value, days: cutoff.days };
  }
  const rows = await selectRows(table, policy, cutoff.value, limit);
  if (!rows.length) return { table, archived: 0, deleted: 0, cutoff: cutoff.value, days: cutoff.days };

  const archiveId = new Date().toISOString().replace(/[-:.]/g, '') + '-' + table + '-' + crypto.randomBytes(3).toString('hex');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-archive-'));
  const compressed = path.join(workspace, archiveId + '.ndjson.gz');
  const target = path.join(archiveRoot(), archiveId + '.jyarc');
  try {
    await writeNdjsonGzip(rows, compressed);
    await backupCrypto.encryptFile(compressed, target, process.env.BACKUP_ENCRYPTION_KEY);
    const checksum = await backupCrypto.sha256File(target);
    fs.writeFileSync(target + '.sha256', checksum + '  ' + path.basename(target) + '\n', { mode: 0o600 });
    const maxId = rows.every(function(row) { return row.id !== undefined && row.id !== null; })
      ? Math.max.apply(null, rows.map(function(row) { return Number(row.id); }))
      : null;
    const apply = settings.apply === true || process.env.DATA_RETENTION_APPLY === 'true';
    const deleted = apply ? await deleteArchivedRows(table, policy, cutoff.value, maxId) : 0;
    await insertArchiveRun({
      archive_id: archiveId,
      table_name: table,
      cutoff_at: cutoff.value,
      row_count: rows.length,
      file_name: path.basename(target),
      checksum_sha256: checksum,
      status: apply ? 'archived_and_purged' : 'archived_only'
    });
    const result = {
      table,
      archiveId,
      fileName: path.basename(target),
      checksum,
      archived: rows.length,
      deleted,
      apply,
      cutoff: cutoff.value,
      days: cutoff.days,
      capped: rows.length === limit
    };
    logger.info('data_retention_archive_completed', result);
    return result;
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
};

const runRetention = async function(options) {
  const results = [];
  for (const table of Object.keys(POLICIES)) results.push(await archiveTable(table, options));
  return { timestamp: new Date().toISOString(), results };
};

module.exports = {
  POLICIES,
  archiveRoot,
  safePolicy,
  cutoffDate,
  selectRows,
  writeNdjsonGzip,
  deleteArchivedRows,
  archiveTable,
  runRetention
};
