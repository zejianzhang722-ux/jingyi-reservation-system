const mysql = require('../server/node_modules/mysql2/promise')

const LOCK = 'jingyi_notification_outbox_migration'

function safeName(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Unsafe database name')
  return '`' + value + '`'
}

async function has(connection, table, kind, name) {
  const database = process.env.MYSQL_DATABASE || 'jingyi_reservation'
  const source = kind === 'column' ? 'information_schema.columns' : 'information_schema.statistics'
  const field = kind === 'column' ? 'column_name' : 'index_name'
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM ' + source + ' WHERE table_schema=? AND table_name=? AND ' + field + '=?',
    [database, table, name]
  )
  return Number(rows[0].count) > 0
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

    if (!(await has(connection, 'notifications', 'column', 'dedupe_key'))) {
      await connection.query('ALTER TABLE notifications ADD COLUMN dedupe_key VARCHAR(191) DEFAULT NULL AFTER data')
    }
    if (!(await has(connection, 'notifications', 'index', 'uk_notification_user_dedupe'))) {
      await connection.query('ALTER TABLE notifications ADD UNIQUE KEY uk_notification_user_dedupe (user_id,dedupe_key)')
    }

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
      "FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL," +
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    )
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
