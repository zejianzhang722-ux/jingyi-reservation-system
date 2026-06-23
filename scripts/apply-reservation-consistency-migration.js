const mysql = require('../server/node_modules/mysql2/promise')

const ACTIVE_STATUSES = ['approved', 'pending', 'counselor_pending', 'checked_in']
const LOCK_NAME = 'jingyi_reservation_consistency_migration'

function safeIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Unsafe database identifier')
  return '`' + value + '`'
}

function toMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) throw new Error('Invalid reservation time: ' + value)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Invalid reservation time: ' + value)
  }
  return hour * 60 + minute
}

async function columnExists(connection, database, table, column) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
    [database, table, column]
  )
  return Number(rows[0].count) > 0
}

async function tableExists(connection, database, table) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [database, table]
  )
  return Number(rows[0].count) > 0
}

async function indexExists(connection, database, table, index) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
    [database, table, index]
  )
  return Number(rows[0].count) > 0
}

async function assertNoActiveOverlaps(connection) {
  const placeholders = ACTIVE_STATUSES.map(function() { return '?' }).join(',')
  const [rows] = await connection.execute(
    "SELECT a.id AS reservation_a, b.id AS reservation_b FROM reservations a " +
    "JOIN reservations b ON a.id < b.id AND a.room_id = b.room_id AND a.date = b.date " +
    "AND COALESCE(a.seat_id, 0) = COALESCE(b.seat_id, 0) " +
    "AND a.start_time < b.end_time AND a.end_time > b.start_time " +
    "WHERE a.status IN (" + placeholders + ") AND b.status IN (" + placeholders + ") LIMIT 20",
    ACTIVE_STATUSES.concat(ACTIVE_STATUSES)
  )
  if (rows.length) {
    throw new Error('Active reservation overlaps must be resolved before migration: ' + JSON.stringify(rows))
  }
}

async function assertNoIdempotencyDuplicates(connection) {
  const [rows] = await connection.execute(
    "SELECT user_id, idempotency_key, COUNT(*) AS duplicate_count " +
    "FROM reservations WHERE idempotency_key IS NOT NULL AND idempotency_key <> '' " +
    "GROUP BY user_id, idempotency_key HAVING COUNT(*) > 1 LIMIT 20"
  )
  if (rows.length) {
    throw new Error('Duplicate idempotency keys must be resolved before migration: ' + JSON.stringify(rows))
  }
}

async function assertNoSlotDuplicates(connection) {
  const [rows] = await connection.execute(
    "SELECT room_id, seat_scope, date, slot_minute, COUNT(*) AS duplicate_count " +
    "FROM reservation_slots GROUP BY room_id, seat_scope, date, slot_minute HAVING COUNT(*) > 1 LIMIT 20"
  )
  if (rows.length) {
    throw new Error('Duplicate reservation slots must be resolved before adding the unique index: ' + JSON.stringify(rows))
  }
}

async function ensureSchema(connection, database) {
  if (!(await columnExists(connection, database, 'reservations', 'idempotency_key'))) {
    await connection.query('ALTER TABLE reservations ADD COLUMN idempotency_key VARCHAR(128) DEFAULT NULL AFTER reservation_code')
  }
  if (!(await columnExists(connection, database, 'reservations', 'request_hash'))) {
    await connection.query('ALTER TABLE reservations ADD COLUMN request_hash CHAR(64) DEFAULT NULL AFTER idempotency_key')
  }

  await assertNoIdempotencyDuplicates(connection)
  if (!(await indexExists(connection, database, 'reservations', 'uk_reservation_user_idempotency'))) {
    await connection.query('ALTER TABLE reservations ADD UNIQUE KEY uk_reservation_user_idempotency (user_id, idempotency_key)')
  }

  if (!(await tableExists(connection, database, 'reservation_slots'))) {
    await connection.query(
      "CREATE TABLE reservation_slots (" +
      "id BIGINT AUTO_INCREMENT PRIMARY KEY," +
      "reservation_id INT NOT NULL," +
      "room_id INT NOT NULL," +
      "seat_scope INT NOT NULL DEFAULT 0 COMMENT '0表示整间功能房；非0表示具体座位ID'," +
      "date DATE NOT NULL," +
      "slot_minute SMALLINT UNSIGNED NOT NULL," +
      "created_at DATETIME DEFAULT CURRENT_TIMESTAMP," +
      "CONSTRAINT fk_reservation_slots_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE," +
      "CONSTRAINT fk_reservation_slots_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE," +
      "UNIQUE KEY uk_room_seat_date_minute (room_id, seat_scope, date, slot_minute)," +
      "INDEX idx_reservation_slots_reservation (reservation_id)," +
      "INDEX idx_reservation_slots_lookup (room_id, date, seat_scope)" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    )
  } else if (!(await indexExists(connection, database, 'reservation_slots', 'uk_room_seat_date_minute'))) {
    await assertNoSlotDuplicates(connection)
    await connection.query(
      'ALTER TABLE reservation_slots ADD UNIQUE KEY uk_room_seat_date_minute (room_id, seat_scope, date, slot_minute)'
    )
  }
}

async function removeInactiveSlots(connection) {
  const placeholders = ACTIVE_STATUSES.map(function() { return '?' }).join(',')
  const [result] = await connection.execute(
    "DELETE rs FROM reservation_slots rs JOIN reservations r ON r.id = rs.reservation_id " +
    "WHERE r.status NOT IN (" + placeholders + ")",
    ACTIVE_STATUSES
  )
  return Number(result.affectedRows || 0)
}

async function backfillSlots(connection) {
  const placeholders = ACTIVE_STATUSES.map(function() { return '?' }).join(',')
  const [reservations] = await connection.execute(
    "SELECT id, room_id, COALESCE(seat_id, 0) AS seat_scope, date, start_time, end_time " +
    "FROM reservations WHERE status IN (" + placeholders + ") ORDER BY id",
    ACTIVE_STATUSES
  )

  let inserted = 0
  for (const reservation of reservations) {
    const start = toMinutes(reservation.start_time)
    const end = toMinutes(reservation.end_time)
    if (end <= start) throw new Error('Reservation has non-positive duration: ' + reservation.id)

    const [invalidOwnership] = await connection.execute(
      "SELECT id, room_id, seat_scope, date, slot_minute FROM reservation_slots " +
      "WHERE reservation_id = ? AND (room_id <> ? OR seat_scope <> ? OR date <> ?)",
      [reservation.id, reservation.room_id, reservation.seat_scope, reservation.date]
    )
    if (invalidOwnership.length) {
      throw new Error('Reservation slots have invalid ownership metadata: ' + JSON.stringify(invalidOwnership.slice(0, 20)))
    }

    const [existingRows] = await connection.execute(
      'SELECT slot_minute FROM reservation_slots WHERE reservation_id = ?',
      [reservation.id]
    )
    const existing = new Set(existingRows.map(function(row) { return Number(row.slot_minute) }))
    const unexpected = Array.from(existing).filter(function(minute) {
      return minute < start || minute >= end
    })
    if (unexpected.length) {
      throw new Error('Reservation has slots outside its time range: ' + reservation.id + ' -> ' + unexpected.slice(0, 20).join(','))
    }

    const missing = []
    for (let minute = start; minute < end; minute += 1) {
      if (!existing.has(minute)) missing.push(minute)
    }

    for (let offset = 0; offset < missing.length; offset += 250) {
      const chunk = missing.slice(offset, offset + 250)
      const values = chunk.map(function() { return '(?, ?, ?, ?, ?)'; }).join(',')
      const params = []
      chunk.forEach(function(minute) {
        params.push(
          reservation.id,
          reservation.room_id,
          reservation.seat_scope,
          reservation.date,
          minute
        )
      })
      await connection.execute(
        'INSERT INTO reservation_slots (reservation_id, room_id, seat_scope, date, slot_minute) VALUES ' + values,
        params
      )
      inserted += chunk.length
    }
  }
  return inserted
}

async function verifyBackfill(connection) {
  const placeholders = ACTIVE_STATUSES.map(function() { return '?' }).join(',')
  const [countRows] = await connection.execute(
    "SELECT r.id, TIMESTAMPDIFF(MINUTE, STR_TO_DATE(r.start_time, '%H:%i:%s'), " +
    "STR_TO_DATE(r.end_time, '%H:%i:%s')) AS expected_slots, COUNT(rs.id) AS actual_slots " +
    "FROM reservations r LEFT JOIN reservation_slots rs ON rs.reservation_id = r.id " +
    "WHERE r.status IN (" + placeholders + ") GROUP BY r.id, r.start_time, r.end_time " +
    "HAVING actual_slots <> expected_slots LIMIT 20",
    ACTIVE_STATUSES
  )
  if (countRows.length) {
    throw new Error('Reservation slot count verification failed: ' + JSON.stringify(countRows))
  }

  const [ownershipRows] = await connection.execute(
    "SELECT rs.id, rs.reservation_id, rs.room_id, rs.seat_scope, rs.date, rs.slot_minute " +
    "FROM reservation_slots rs JOIN reservations r ON r.id = rs.reservation_id " +
    "WHERE r.status IN (" + placeholders + ") AND (" +
    "rs.room_id <> r.room_id OR rs.seat_scope <> COALESCE(r.seat_id, 0) OR rs.date <> r.date OR " +
    "rs.slot_minute < TIME_TO_SEC(STR_TO_DATE(r.start_time, '%H:%i:%s')) / 60 OR " +
    "rs.slot_minute >= TIME_TO_SEC(STR_TO_DATE(r.end_time, '%H:%i:%s')) / 60) LIMIT 20",
    ACTIVE_STATUSES
  )
  if (ownershipRows.length) {
    throw new Error('Reservation slot ownership verification failed: ' + JSON.stringify(ownershipRows))
  }
}

async function main() {
  const database = process.env.MYSQL_DATABASE || 'jingyi_reservation'
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database
  })

  let lockHeld = false
  try {
    await connection.query('USE ' + safeIdentifier(database))
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [LOCK_NAME])
    if (Number(lockRows[0].acquired) !== 1) throw new Error('Could not acquire migration lock')
    lockHeld = true

    await assertNoActiveOverlaps(connection)
    await ensureSchema(connection, database)
    const removedInactiveSlots = await removeInactiveSlots(connection)
    const insertedSlots = await backfillSlots(connection)
    await verifyBackfill(connection)

    console.log(JSON.stringify({
      migration: 'reservation-consistency',
      database,
      insertedSlots,
      removedInactiveSlots,
      status: 'ready'
    }, null, 2))
  } finally {
    if (lockHeld) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK_NAME]) } catch (err) {}
    }
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
