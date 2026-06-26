const mysql = require('../server/node_modules/mysql2/promise')

const LOCK = 'jingyi_backup_recovery_migration'

function safeName(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Unsafe database identifier')
  return '`' + value + '`'
}

async function exists(connection, source, conditions, params) {
  const [rows] = await connection.execute('SELECT COUNT(*) AS count FROM ' + source + ' WHERE ' + conditions, params)
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

async function ensureColumn(connection, database, table, column, definition) {
  if (!(await columnExists(connection, database, table, column))) {
    await connection.query('ALTER TABLE ' + safeName(table) + ' ADD COLUMN ' + safeName(column) + ' ' + definition)
  }
}

async function createBackupRuns(connection) {
  await connection.query(
    "CREATE TABLE IF NOT EXISTS backup_runs (" +
    "id BIGINT AUTO_INCREMENT PRIMARY KEY," +
    "backup_id VARCHAR(80) NOT NULL," +
    "trigger_type ENUM('manual','scheduled','drill') NOT NULL DEFAULT 'manual'," +
    "requested_by INT DEFAULT NULL," +
    "status ENUM('running','success','failed','verified','restored') NOT NULL DEFAULT 'running'," +
    "file_name VARCHAR(255) DEFAULT NULL," +
    "size_bytes BIGINT DEFAULT NULL," +
    "checksum_sha256 CHAR(64) DEFAULT NULL," +
    "secondary_copied TINYINT(1) NOT NULL DEFAULT 0," +
    "error_message VARCHAR(1000) DEFAULT NULL," +
    "started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP," +
    "finished_at DATETIME DEFAULT NULL," +
    "CONSTRAINT fk_backup_runs_requester FOREIGN KEY (requested_by) REFERENCES admins(id) ON DELETE SET NULL," +
    "UNIQUE KEY uk_backup_runs_backup_id (backup_id)," +
    "INDEX idx_backup_runs_status_started (status,started_at)" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  )
}

async function createDataArchives(connection) {
  await connection.query(
    "CREATE TABLE IF NOT EXISTS data_archives (" +
    "id BIGINT AUTO_INCREMENT PRIMARY KEY," +
    "archive_id VARCHAR(120) NOT NULL," +
    "table_name VARCHAR(64) NOT NULL," +
    "cutoff_at DATETIME NOT NULL," +
    "row_count BIGINT NOT NULL DEFAULT 0," +
    "file_name VARCHAR(255) NOT NULL," +
    "checksum_sha256 CHAR(64) NOT NULL," +
    "status ENUM('archived_only','archived_and_purged','verified','failed') NOT NULL DEFAULT 'archived_only'," +
    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP," +
    "UNIQUE KEY uk_data_archives_archive_id (archive_id)," +
    "INDEX idx_data_archives_table_created (table_name,created_at)" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  )
}

async function migrateBackupRuns(connection, database) {
  const columns = [
    ['secondary_copied', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER checksum_sha256'],
    ['error_message', 'VARCHAR(1000) DEFAULT NULL AFTER secondary_copied'],
    ['finished_at', 'DATETIME DEFAULT NULL AFTER started_at']
  ]
  for (const item of columns) await ensureColumn(connection, database, 'backup_runs', item[0], item[1])
  if (!(await indexExists(connection, database, 'backup_runs', 'idx_backup_runs_status_started'))) {
    await connection.query('ALTER TABLE backup_runs ADD INDEX idx_backup_runs_status_started (status,started_at)')
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
    if (!locked) throw new Error('Could not acquire backup recovery migration lock')
    await connection.query('USE ' + safeName(database))
    if (!(await tableExists(connection, database, 'backup_runs'))) await createBackupRuns(connection)
    else await migrateBackupRuns(connection, database)
    if (!(await tableExists(connection, database, 'data_archives'))) await createDataArchives(connection)
    console.log('backup-recovery migration applied')
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK])
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
