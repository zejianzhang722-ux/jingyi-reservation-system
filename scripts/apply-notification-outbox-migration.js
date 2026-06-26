const mysql = require('../server/node_modules/mysql2/promise')

const LOCK = 'jingyi_notification_outbox_migration'

function safeName(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Unsafe database name')
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

async function assertNoDuplicateNotificationKeys(connection) {
  const [rows] = await connection.execute(
    "SELECT user_id,dedupe_key,COUNT(*) AS duplicate_count FROM notifications WHERE dedupe_key IS NOT NULL AND dedupe_key<>'' GROUP BY user_id,dedupe_key HAVING COUNT(*)>1 LIMIT 20"
  )
  if (rows.length) throw new Error('Duplicate notification dedupe keys must be resolved: ' + JSON.stringify(rows))
}

async function assertNoDuplicateOutboxKeys(connection) {
  const [rows] = await connection.execute(
    "SELECT event_key,COUNT(*) AS duplicate_count FROM notification_outbox WHERE event_key IS NOT NULL AND event_key<>'' GROUP BY event_key HAVING COUNT(*)>1 LIMIT 20"
  )
  if (rows.length) throw new Error('Duplicate notification outbox event keys must be resolved: ' + JSON.stringify(rows))
}

async function ensureColumn(connection, database, table, column, definition) {
  if (!(await columnExists(connection, database, table, column))) {
    await connection.query('ALTER TABLE ' + safeName(table) + ' ADD COLUMN ' + safeName(column) + ' ' + definition)
  }
}

async function ensureOutboxTable(connection, database) {
  if (!(await tableExists(connection, database, 'notification_outbox'))) {
    await connection.query(
      "CREATE TABLE IF NOT EXISTS notification_outbox (" +
      "id BIGINT AUTO_INCREMENT PRIMARY KEY,event_key VARCHAR(191) NOT NULL," +
      "notification_id INT DEFAULT NULL,user_id INT DEFAULT NULL," +
      "channel ENUM('websocket','wechat') NOT NULL,event_name VARCHAR(100) DEFAULT NULL," +
      "payload JSON NOT NULL,status ENUM('pending','processing','sent','failed','dead') NOT NULL DEFAULT 'pending'," +
      "attempts INT NOT NULL DEFAULT 0,max_attempts INT NOT NULL DEFAULT 8," +
      "available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,locked_at DATETIME DEFAULT NULL," +
      "locked_by VARCHAR(100) DEFAULT NULL,last_error VARCHAR(1000) DEFAULT NULL,sent_at DATETIME DEFAULT NULL," +
      "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
      "UNIQUE KEY uk_notification_outbox_event (event_key),INDEX idx_notification_outbox_claim (status,available_at,id)," +
      "INDEX idx_notification_outbox_notification (notification_id)," +
      "CONSTRAINT fk_notification_outbox_notification FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL," +
      "CONSTRAINT fk_notification_outbox_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    )
    return
  }

  const columns = [
    ['event_key', 'VARCHAR(191) DEFAULT NULL'],
    ['notification_id', 'INT DEFAULT NULL'],
    ['user_id', 'INT DEFAULT NULL'],
    ['channel', "ENUM('websocket','wechat') DEFAULT NULL"],
    ['event_name', 'VARCHAR(100) DEFAULT NULL'],
    ['payload', 'JSON DEFAULT NULL'],
    ['status', "ENUM('pending','processing','sent','failed','dead') NOT NULL DEFAULT 'pending'"],
    ['attempts', 'INT NOT NULL DEFAULT 0'],
    ['max_attempts', 'INT NOT NULL DEFAULT 8'],
    ['available_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    ['locked_at', 'DATETIME DEFAULT NULL'],
    ['locked_by', 'VARCHAR(100) DEFAULT NULL'],
    ['last_error', 'VARCHAR(1000) DEFAULT NULL'],
    ['sent_at', 'DATETIME DEFAULT NULL'],
    ['created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    ['updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP']
  ]
  for (const item of columns) await ensureColumn(connection, database, 'notification_outbox', item[0], item[1])

  await assertNoDuplicateOutboxKeys(connection)
  if (!(await indexExists(connection, database, 'notification_outbox', 'uk_notification_outbox_event'))) {
    await connection.query('ALTER TABLE notification_outbox ADD UNIQUE KEY uk_notification_outbox_event (event_key)')
  }
  if (!(await indexExists(connection, database, 'notification_outbox', 'idx_notification_outbox_claim'))) {
    await connection.query('ALTER TABLE notification_outbox ADD INDEX idx_notification_outbox_claim (status,available_at,id)')
  }
  if (!(await indexExists(connection, database, 'notification_outbox', 'idx_notification_outbox_notification'))) {
    await connection.query('ALTER TABLE notification_outbox ADD INDEX idx_notification_outbox_notification (notification_id)')
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
    if (!locked) throw new Error('Could not acquire notification migration lock')
    await connection.query('USE ' + safeName(database))

    if (!(await columnExists(connection, database, 'notifications', 'dedupe_key'))) {
      await connection.query('ALTER TABLE notifications ADD COLUMN dedupe_key VARCHAR(191) DEFAULT NULL AFTER data')
    }
    await assertNoDuplicateNotificationKeys(connection)
    if (!(await indexExists(connection, database, 'notifications', 'uk_notification_user_dedupe'))) {
      await connection.query('ALTER TABLE notifications ADD UNIQUE KEY uk_notification_user_dedupe (user_id,dedupe_key)')
    }

    await ensureOutboxTable(connection, database)
    console.log('notification-outbox migration applied')
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK])
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
