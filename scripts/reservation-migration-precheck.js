const mysql = require('../server/node_modules/mysql2/promise')

const ACTIVE_STATUSES = ['approved', 'pending', 'counselor_pending', 'checked_in']

function placeholders(items) {
  return items.map(function() { return '?' }).join(',')
}

async function tableExists(connection, database, tableName) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [database, tableName]
  )
  return Number(rows[0].count) > 0
}

async function columnExists(connection, database, tableName, columnName) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
    [database, tableName, columnName]
  )
  return Number(rows[0].count) > 0
}

async function collect(connection, database) {
  const report = {
    database,
    generatedAt: new Date().toISOString(),
    blockers: {},
    warnings: {},
    summary: { blockerCount: 0, warningCount: 0 }
  }
  const activePlaceholders = placeholders(ACTIVE_STATUSES)

  const [invalidTimes] = await connection.execute(
    "SELECT id, room_id, date, start_time, end_time, status FROM reservations " +
    "WHERE status IN (" + activePlaceholders + ") AND (" +
    "start_time NOT REGEXP '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' " +
    "OR end_time NOT REGEXP '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' " +
    "OR TIME_TO_SEC(STR_TO_DATE(end_time, '%H:%i:%s')) <= TIME_TO_SEC(STR_TO_DATE(start_time, '%H:%i:%s')))",
    ACTIVE_STATUSES
  )
  report.blockers.invalidActiveTimes = invalidTimes

  const [overlaps] = await connection.execute(
    "SELECT a.id AS reservation_a, b.id AS reservation_b, a.room_id, COALESCE(a.seat_id, 0) AS seat_scope, " +
    "a.date, a.start_time AS a_start, a.end_time AS a_end, b.start_time AS b_start, b.end_time AS b_end " +
    "FROM reservations a JOIN reservations b ON a.id < b.id " +
    "AND a.room_id = b.room_id AND a.date = b.date " +
    "AND COALESCE(a.seat_id, 0) = COALESCE(b.seat_id, 0) " +
    "AND a.start_time < b.end_time AND a.end_time > b.start_time " +
    "WHERE a.status IN (" + activePlaceholders + ") AND b.status IN (" + activePlaceholders + ") " +
    "ORDER BY a.date, a.room_id, seat_scope, reservation_a, reservation_b",
    ACTIVE_STATUSES.concat(ACTIVE_STATUSES)
  )
  report.blockers.activeOverlaps = overlaps

  const [durationViolations] = await connection.execute(
    "SELECT r.id, r.room_id, r.date, r.start_time, r.end_time, r.status, rm.max_duration, " +
    "TIMESTAMPDIFF(MINUTE, STR_TO_DATE(r.start_time, '%H:%i:%s'), STR_TO_DATE(r.end_time, '%H:%i:%s')) AS duration_minutes " +
    "FROM reservations r JOIN rooms rm ON rm.id = r.room_id " +
    "WHERE r.status IN (" + activePlaceholders + ") AND rm.max_duration > 0 AND " +
    "TIMESTAMPDIFF(MINUTE, STR_TO_DATE(r.start_time, '%H:%i:%s'), STR_TO_DATE(r.end_time, '%H:%i:%s')) > rm.max_duration",
    ACTIVE_STATUSES
  )
  report.blockers.activeDurationViolations = durationViolations

  const [seatViolations] = await connection.execute(
    "SELECT r.id, r.user_id, r.room_id, r.date, r.start_time, r.end_time, r.status, rm.type " +
    "FROM reservations r JOIN rooms rm ON rm.id = r.room_id " +
    "WHERE r.status IN (" + activePlaceholders + ") " +
    "AND rm.type IN ('study_room', 'study') AND r.seat_id IS NULL",
    ACTIVE_STATUSES
  )
  report.blockers.activeStudyReservationsWithoutSeat = seatViolations

  const hasIdempotencyKey = await columnExists(connection, database, 'reservations', 'idempotency_key')
  if (hasIdempotencyKey) {
    const [duplicates] = await connection.execute(
      "SELECT user_id, idempotency_key, COUNT(*) AS duplicate_count, GROUP_CONCAT(id ORDER BY id) AS reservation_ids " +
      "FROM reservations WHERE idempotency_key IS NOT NULL AND idempotency_key <> '' " +
      "GROUP BY user_id, idempotency_key HAVING COUNT(*) > 1"
    )
    report.blockers.duplicateIdempotencyKeys = duplicates
  } else {
    report.blockers.duplicateIdempotencyKeys = []
  }

  const [missingResources] = await connection.execute(
    "SELECT r.id, r.user_id, r.room_id, r.seat_id, " +
    "CASE WHEN u.id IS NULL THEN 'missing_user' WHEN rm.id IS NULL THEN 'missing_room' " +
    "WHEN r.seat_id IS NOT NULL AND s.id IS NULL THEN 'missing_seat' ELSE 'unknown' END AS issue " +
    "FROM reservations r LEFT JOIN users u ON u.id = r.user_id " +
    "LEFT JOIN rooms rm ON rm.id = r.room_id LEFT JOIN seats s ON s.id = r.seat_id " +
    "WHERE u.id IS NULL OR rm.id IS NULL OR (r.seat_id IS NOT NULL AND s.id IS NULL)"
  )
  report.blockers.missingResources = missingResources

  if (await tableExists(connection, database, 'reservation_slots')) {
    const [slotMismatches] = await connection.execute(
      "SELECT r.id, r.room_id, COALESCE(r.seat_id, 0) AS seat_scope, r.date, r.start_time, r.end_time, " +
      "TIMESTAMPDIFF(MINUTE, STR_TO_DATE(r.start_time, '%H:%i:%s'), STR_TO_DATE(r.end_time, '%H:%i:%s')) AS expected_slots, " +
      "COUNT(rs.id) AS actual_slots " +
      "FROM reservations r LEFT JOIN reservation_slots rs ON rs.reservation_id = r.id " +
      "WHERE r.status IN (" + activePlaceholders + ") " +
      "GROUP BY r.id, r.room_id, r.seat_id, r.date, r.start_time, r.end_time " +
      "HAVING actual_slots <> expected_slots",
      ACTIVE_STATUSES
    )
    report.warnings.activeSlotMismatches = slotMismatches

    const [inactiveSlots] = await connection.execute(
      "SELECT rs.reservation_id, COUNT(*) AS slot_count, r.status " +
      "FROM reservation_slots rs JOIN reservations r ON r.id = rs.reservation_id " +
      "WHERE r.status NOT IN (" + activePlaceholders + ") GROUP BY rs.reservation_id, r.status",
      ACTIVE_STATUSES
    )
    report.warnings.inactiveReservationSlots = inactiveSlots
  } else {
    report.warnings.activeSlotMismatches = []
    report.warnings.inactiveReservationSlots = []
  }

  if (process.env.REQUIRE_SLOT_CONSISTENCY === 'true') {
    report.blockers.activeSlotMismatches = report.warnings.activeSlotMismatches
    report.blockers.inactiveReservationSlots = report.warnings.inactiveReservationSlots
    delete report.warnings.activeSlotMismatches
    delete report.warnings.inactiveReservationSlots
  }

  Object.keys(report.blockers).forEach(function(key) {
    report.summary.blockerCount += report.blockers[key].length
  })
  Object.keys(report.warnings).forEach(function(key) {
    report.summary.warningCount += report.warnings[key].length
  })
  return report
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

  try {
    await connection.query('SET SESSION TRANSACTION READ ONLY')
    await connection.beginTransaction()
    const report = await collect(connection, database)
    await connection.rollback()
    console.log(JSON.stringify(report, null, 2))
    if (report.summary.blockerCount > 0) process.exitCode = 2
  } finally {
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
