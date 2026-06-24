const mysql = require('../server/node_modules/mysql2/promise')

function safeIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Unsafe database identifier')
  return '`' + value + '`'
}

async function main() {
  const database = process.env.MYSQL_DATABASE || 'jingyi_reservation_ci'
  if (!/(test|ci|local|dev|stage)/i.test(database)) {
    throw new Error('Refusing to seed a database without a safe test name')
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database
  })

  try {
    await connection.query('USE ' + safeIdentifier(database))
    const [tables] = await connection.query("SHOW TABLES LIKE 'reservation_slots'")
    if (tables.length) throw new Error('partial migration seed expects reservation_slots to be absent')

    await connection.query(
      "CREATE TABLE reservation_slots (" +
      "id BIGINT AUTO_INCREMENT PRIMARY KEY," +
      "reservation_id INT NOT NULL," +
      "room_id INT NOT NULL," +
      "seat_scope INT NOT NULL DEFAULT 0," +
      "date DATE NOT NULL," +
      "slot_minute SMALLINT UNSIGNED NOT NULL," +
      "created_at DATETIME DEFAULT CURRENT_TIMESTAMP," +
      "CONSTRAINT fk_reservation_slots_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE," +
      "CONSTRAINT fk_reservation_slots_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE," +
      "INDEX idx_reservation_slots_reservation (reservation_id)," +
      "INDEX idx_reservation_slots_lookup (room_id, date, seat_scope)" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    )

    const [inactiveRows] = await connection.query(
      "SELECT id, room_id, COALESCE(seat_id, 0) AS seat_scope, date, " +
      "TIME_TO_SEC(STR_TO_DATE(start_time, '%H:%i:%s')) / 60 AS slot_minute " +
      "FROM reservations WHERE status NOT IN ('approved','pending','counselor_pending','checked_in') ORDER BY id LIMIT 1"
    )
    if (!inactiveRows.length) throw new Error('seed data must contain an inactive reservation')

    const source = inactiveRows[0]
    const params = [source.id, source.room_id, source.seat_scope, source.date, source.slot_minute]
    await connection.execute(
      'INSERT INTO reservation_slots (reservation_id, room_id, seat_scope, date, slot_minute) VALUES (?, ?, ?, ?, ?)',
      params
    )
    await connection.execute(
      'INSERT INTO reservation_slots (reservation_id, room_id, seat_scope, date, slot_minute) VALUES (?, ?, ?, ?, ?)',
      params
    )

    const [duplicates] = await connection.query(
      'SELECT COUNT(*) AS count FROM reservation_slots WHERE reservation_id = ?',
      [source.id]
    )
    if (Number(duplicates[0].count) !== 2) {
      throw new Error('failed to seed duplicate inactive reservation slots')
    }

    console.log('seed-partial-reservation-slots passed: duplicate inactive slots created without unique index')
  } finally {
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
