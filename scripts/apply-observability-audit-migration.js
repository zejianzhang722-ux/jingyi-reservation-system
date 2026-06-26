const mysql = require('../server/node_modules/mysql2/promise')

const LOCK = 'jingyi_observability_audit_migration'

function safeName(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Unsafe database identifier')
  return '`' + value + '`'
}

async function exists(connection, source, conditions, params) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM ' + source + ' WHERE ' + conditions,
    params
  )
  return Number(rows[0].count) > 0
}

async function tableExists(connection, database, table) {
  return exists(connection, 'information_schema.tables', 'table_schema=? AND table_name=?', [database, table])
}

async function columnExists(connection, database, table, column) {
  return exists(connection, 'information_schema.columns', 'table_schema=? AND table_name=? AND column_name=?', [database, table, column])
}

async function indexExists(connection, database, table, index) {
  return exists(connection, 'information_schema.statistics', 'table_schema=? AND table_name=? AND index_name=?', [database, table, index])
}

async function constraintExists(connection, database, table, constraint) {
  return exists(
    connection,
    'information_schema.table_constraints',
    "constraint_schema=? AND table_name=? AND constraint_name=? AND constraint_type='FOREIGN KEY'",
    [database, table, constraint]
  )
}

async function ensureColumn(connection, database, table, column, definition) {
  if (!(await columnExists(connection, database, table, column))) {
    await connection.query('ALTER TABLE ' + safeName(table) + ' ADD COLUMN ' + safeName(column) + ' ' + definition)
  }
}

async function operatorForeignKeys(connection, database) {
  const [rows] = await connection.execute(
    "SELECT k.constraint_name, r.delete_rule FROM information_schema.key_column_usage k " +
    "JOIN information_schema.referential_constraints r ON r.constraint_schema=k.constraint_schema AND r.constraint_name=k.constraint_name " +
    "WHERE k.table_schema=? AND k.table_name='operation_logs' AND k.column_name='operator_id' AND k.referenced_table_name='admins'",
    [database]
  )
  return rows
}

async function createAuditTable(connection) {
  await connection.query(
    "CREATE TABLE IF NOT EXISTS operation_logs (" +
    "id BIGINT AUTO_INCREMENT PRIMARY KEY," +
    "operator_id INT DEFAULT NULL,request_id VARCHAR(64) DEFAULT NULL,actor_role VARCHAR(32) NOT NULL DEFAULT 'legacy'," +
    "action VARCHAR(100) NOT NULL,target_table VARCHAR(50) DEFAULT '',target_id BIGINT DEFAULT NULL," +
    "description VARCHAR(500) DEFAULT '',method VARCHAR(10) NOT NULL DEFAULT 'INTERNAL',path VARCHAR(255) NOT NULL DEFAULT ''," +
    "status_code SMALLINT UNSIGNED NOT NULL DEFAULT 200,outcome ENUM('success','client_error','server_error') NOT NULL DEFAULT 'success'," +
    "ip_hash CHAR(64) NOT NULL DEFAULT '',user_agent VARCHAR(255) NOT NULL DEFAULT '',metadata JSON DEFAULT NULL," +
    "prev_hash CHAR(64) DEFAULT NULL,entry_hash CHAR(64) DEFAULT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP," +
    "CONSTRAINT fk_operation_logs_operator FOREIGN KEY (operator_id) REFERENCES admins(id) ON DELETE SET NULL," +
    "INDEX idx_operator_created (operator_id,created_at),INDEX idx_operation_request (request_id)," +
    "INDEX idx_operation_outcome_created (outcome,created_at),INDEX idx_operation_action_created (action,created_at)," +
    "UNIQUE KEY uk_operation_entry_hash (entry_hash)" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  )
}

async function migrateAuditTable(connection, database) {
  const columns = [
    ['request_id', 'VARCHAR(64) DEFAULT NULL AFTER operator_id'],
    ['actor_role', "VARCHAR(32) NOT NULL DEFAULT 'legacy' AFTER request_id"],
    ['method', "VARCHAR(10) NOT NULL DEFAULT 'INTERNAL' AFTER description"],
    ['path', "VARCHAR(255) NOT NULL DEFAULT '' AFTER method"],
    ['status_code', 'SMALLINT UNSIGNED NOT NULL DEFAULT 200 AFTER path'],
    ['outcome', "ENUM('success','client_error','server_error') NOT NULL DEFAULT 'success' AFTER status_code"],
    ['ip_hash', "CHAR(64) NOT NULL DEFAULT '' AFTER outcome"],
    ['user_agent', "VARCHAR(255) NOT NULL DEFAULT '' AFTER ip_hash"],
    ['metadata', 'JSON DEFAULT NULL AFTER user_agent'],
    ['prev_hash', 'CHAR(64) DEFAULT NULL AFTER metadata'],
    ['entry_hash', 'CHAR(64) DEFAULT NULL AFTER prev_hash']
  ]
  for (const item of columns) await ensureColumn(connection, database, 'operation_logs', item[0], item[1])

  const foreignKeys = await operatorForeignKeys(connection, database)
  for (const row of foreignKeys) {
    if (row.constraint_name !== 'fk_operation_logs_operator' || String(row.delete_rule).toUpperCase() !== 'SET NULL') {
      await connection.query('ALTER TABLE operation_logs DROP FOREIGN KEY ' + safeName(row.constraint_name))
    }
  }

  await connection.query(
    'UPDATE operation_logs o LEFT JOIN admins a ON a.id=o.operator_id SET o.operator_id=NULL WHERE o.operator_id IS NOT NULL AND a.id IS NULL'
  )
  await connection.query(
    'ALTER TABLE operation_logs MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT,' +
    'MODIFY COLUMN operator_id INT DEFAULT NULL,' +
    'MODIFY COLUMN action VARCHAR(100) NOT NULL,' +
    'MODIFY COLUMN target_id BIGINT DEFAULT NULL,' +
    "MODIFY COLUMN actor_role VARCHAR(32) NOT NULL DEFAULT 'legacy'," +
    "MODIFY COLUMN method VARCHAR(10) NOT NULL DEFAULT 'INTERNAL'," +
    "MODIFY COLUMN path VARCHAR(255) NOT NULL DEFAULT ''," +
    'MODIFY COLUMN status_code SMALLINT UNSIGNED NOT NULL DEFAULT 200,' +
    "MODIFY COLUMN outcome ENUM('success','client_error','server_error') NOT NULL DEFAULT 'success'," +
    "MODIFY COLUMN ip_hash CHAR(64) NOT NULL DEFAULT ''," +
    "MODIFY COLUMN user_agent VARCHAR(255) NOT NULL DEFAULT ''," +
    'MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
  )

  if (!(await constraintExists(connection, database, 'operation_logs', 'fk_operation_logs_operator'))) {
    await connection.query(
      'ALTER TABLE operation_logs ADD CONSTRAINT fk_operation_logs_operator FOREIGN KEY (operator_id) REFERENCES admins(id) ON DELETE SET NULL'
    )
  }
  if (!(await indexExists(connection, database, 'operation_logs', 'idx_operator_created'))) {
    await connection.query('ALTER TABLE operation_logs ADD INDEX idx_operator_created (operator_id,created_at)')
  }
  if (!(await indexExists(connection, database, 'operation_logs', 'idx_operation_request'))) {
    await connection.query('ALTER TABLE operation_logs ADD INDEX idx_operation_request (request_id)')
  }
  if (!(await indexExists(connection, database, 'operation_logs', 'idx_operation_outcome_created'))) {
    await connection.query('ALTER TABLE operation_logs ADD INDEX idx_operation_outcome_created (outcome,created_at)')
  }
  if (!(await indexExists(connection, database, 'operation_logs', 'idx_operation_action_created'))) {
    await connection.query('ALTER TABLE operation_logs ADD INDEX idx_operation_action_created (action,created_at)')
  }
  if (!(await indexExists(connection, database, 'operation_logs', 'uk_operation_entry_hash'))) {
    await connection.query('ALTER TABLE operation_logs ADD UNIQUE KEY uk_operation_entry_hash (entry_hash)')
  }
}

async function main() {
  const database = process.env.MYSQL_DATABASE || 'jingyi_reservation'
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || ''
  })
  let locked = false
  try {
    const [rows] = await connection.execute('SELECT GET_LOCK(?,30) AS acquired', [LOCK])
    locked = Number(rows[0].acquired) === 1
    if (!locked) throw new Error('Could not acquire observability audit migration lock')
    await connection.query('USE ' + safeName(database))
    if (!(await tableExists(connection, database, 'operation_logs'))) await createAuditTable(connection)
    else await migrateAuditTable(connection, database)
    console.log('observability-audit migration applied')
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK])
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
