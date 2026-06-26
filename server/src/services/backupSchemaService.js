const db = require('../config/database');

const REQUIRED = {
  backup_runs: ['id', 'backup_id', 'trigger_type', 'requested_by', 'status', 'file_name', 'size_bytes', 'checksum_sha256', 'secondary_copied', 'error_message', 'started_at', 'finished_at'],
  data_archives: ['id', 'archive_id', 'table_name', 'cutoff_at', 'row_count', 'file_name', 'checksum_sha256', 'status', 'created_at']
};

const check = async function() {
  if (db.isMock()) return { mode: 'mock', ready: true, missing: [] };
  const [databaseRows] = await db.query('SELECT DATABASE() AS database_name');
  const database = databaseRows[0].database_name || databaseRows[0].DATABASE_NAME;
  const missing = [];
  for (const table of Object.keys(REQUIRED)) {
    const [rows] = await db.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=?',
      [database, table]
    );
    const columns = rows.map(function(row) { return row.column_name || row.COLUMN_NAME; });
    if (!columns.length) missing.push('table:' + table);
    REQUIRED[table].forEach(function(column) {
      if (!columns.includes(column)) missing.push(table + '.' + column);
    });
  }
  return { mode: 'mysql', database, ready: missing.length === 0, missing };
};

const assertReady = async function() {
  const state = await check();
  if (!state.ready) {
    const err = new Error('备份恢复数据库迁移尚未完成');
    err.code = 'BACKUP_SCHEMA_NOT_READY';
    err.httpStatus = 503;
    err.details = state;
    throw err;
  }
  return state;
};

module.exports = { REQUIRED, check, assertReady };
