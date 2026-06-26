const db = require('../config/database');

const REQUIRED_COLUMNS = [
  'id', 'operator_id', 'request_id', 'actor_role', 'action', 'target_table', 'target_id',
  'description', 'method', 'path', 'status_code', 'outcome', 'ip_hash', 'user_agent',
  'metadata', 'prev_hash', 'entry_hash', 'created_at'
];
const REQUIRED_INDEXES = [
  'idx_operator_created',
  'idx_operation_request',
  'idx_operation_outcome_created',
  'idx_operation_action_created',
  'uk_operation_entry_hash'
];
const REQUIRED_FOREIGN_KEYS = ['fk_operation_logs_operator'];

const valueOf = function(row, lower, upper) {
  if (!row) return undefined;
  return row[lower] === undefined ? row[upper] : row[lower];
};

const check = async function() {
  if (db.isMock()) return { mode: 'mock', ready: true, missing: [], invalid: [] };
  const [databaseRows] = await db.query('SELECT DATABASE() AS database_name');
  const database = valueOf(databaseRows[0], 'database_name', 'DATABASE_NAME');
  const [columns] = await db.query(
    "SELECT column_name AS schema_column,data_type AS column_data_type,column_type AS full_column_type " +
    "FROM information_schema.columns WHERE table_schema=? AND table_name='operation_logs'",
    [database]
  );
  const [indexes] = await db.query(
    "SELECT index_name AS schema_index,non_unique AS is_non_unique," +
    "GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS indexed_columns " +
    "FROM information_schema.statistics WHERE table_schema=? AND table_name='operation_logs' " +
    'GROUP BY index_name,non_unique',
    [database]
  );
  const [foreignKeys] = await db.query(
    "SELECT tc.constraint_name AS foreign_key_name,rc.delete_rule AS delete_rule " +
    "FROM information_schema.table_constraints tc JOIN information_schema.referential_constraints rc " +
    "ON rc.constraint_schema=tc.constraint_schema AND rc.constraint_name=tc.constraint_name " +
    "WHERE tc.constraint_schema=? AND tc.table_name='operation_logs' AND tc.constraint_type='FOREIGN KEY'",
    [database]
  );

  const columnMap = {};
  columns.forEach(function(row) { columnMap[valueOf(row, 'schema_column', 'SCHEMA_COLUMN')] = row; });
  const indexMap = {};
  indexes.forEach(function(row) { indexMap[valueOf(row, 'schema_index', 'SCHEMA_INDEX')] = row; });
  const foreignKeyMap = {};
  foreignKeys.forEach(function(row) { foreignKeyMap[valueOf(row, 'foreign_key_name', 'FOREIGN_KEY_NAME')] = row; });

  const missing = [];
  const invalid = [];
  REQUIRED_COLUMNS.forEach(function(column) {
    if (!columnMap[column]) missing.push('operation_logs.' + column);
  });
  REQUIRED_INDEXES.forEach(function(index) {
    if (!indexMap[index]) missing.push('index:' + index);
  });
  REQUIRED_FOREIGN_KEYS.forEach(function(key) {
    if (!foreignKeyMap[key]) missing.push('foreign-key:' + key);
  });

  if (columnMap.metadata && String(valueOf(columnMap.metadata, 'column_data_type', 'COLUMN_DATA_TYPE')).toLowerCase() !== 'json') {
    invalid.push('operation_logs.metadata:not_json');
  }
  if (columnMap.outcome) {
    const type = String(valueOf(columnMap.outcome, 'full_column_type', 'FULL_COLUMN_TYPE') || '').toLowerCase();
    ['success', 'client_error', 'server_error'].forEach(function(outcome) {
      if (!type.includes(outcome)) invalid.push('operation_logs.outcome:missing_' + outcome);
    });
  }
  if (indexMap.uk_operation_entry_hash && Number(valueOf(indexMap.uk_operation_entry_hash, 'is_non_unique', 'IS_NON_UNIQUE')) !== 0) {
    invalid.push('index:uk_operation_entry_hash:not_unique');
  }
  if (foreignKeyMap.fk_operation_logs_operator && String(valueOf(foreignKeyMap.fk_operation_logs_operator, 'delete_rule', 'DELETE_RULE')).toUpperCase() !== 'SET NULL') {
    invalid.push('foreign-key:fk_operation_logs_operator:delete_rule');
  }

  return { mode: 'mysql', database, ready: missing.length === 0 && invalid.length === 0, missing, invalid };
};

const assertReady = async function() {
  const state = await check();
  if (!state.ready) {
    const err = new Error('审计数据库迁移尚未完成');
    err.code = 'AUDIT_SCHEMA_NOT_READY';
    err.httpStatus = 503;
    err.details = state;
    throw err;
  }
  return state;
};

module.exports = {
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
  REQUIRED_FOREIGN_KEYS,
  check,
  assertReady
};
