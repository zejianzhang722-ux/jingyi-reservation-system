const fs = require('fs')
const path = require('path')
const mysql = require('../server/node_modules/mysql2/promise')

function splitStatements(sql) {
  return sql
    .replace(/^\uFEFF/, '')
    .split(';')
    .map(function(statement) { return statement.trim() })
    .filter(Boolean)
}

function statementLabel(statement) {
  const match = statement.match(/^(CREATE TABLE|INSERT INTO|ALTER TABLE|USE|CREATE DATABASE)\s+(?:IF NOT EXISTS\s+)?`?([\w-]+)?/i)
  return match ? match[1].toUpperCase() + ' ' + (match[2] || '') : statement.slice(0, 80)
}

async function executeStatements(connection, sql, allowDeferredForeignKeys) {
  const deferred = []
  const statements = splitStatements(sql)

  for (const statement of statements) {
    try {
      await connection.query(statement)
    } catch (err) {
      const missingParent = err && (err.errno === 1824 || err.code === 'ER_FK_CANNOT_OPEN_PARENT')
      if (allowDeferredForeignKeys && missingParent && /^CREATE TABLE/i.test(statement)) {
        deferred.push(statement)
        continue
      }
      err.message = statementLabel(statement) + ': ' + err.message
      throw err
    }
  }

  for (const statement of deferred) {
    try {
      await connection.query(statement)
    } catch (err) {
      err.message = statementLabel(statement) + ' (deferred): ' + err.message
      throw err
    }
  }
}

function toLegacyReservationSchema(sql) {
  return sql
    .replace(/^\s*idempotency_key VARCHAR\(128\) DEFAULT NULL,\s*$/m, '')
    .replace(/^\s*request_hash CHAR\(64\) DEFAULT NULL,\s*$/m, '')
    .replace(
      /^\s*INDEX idx_room_date \(room_id, date\),\s*\n\s*UNIQUE KEY uk_reservation_user_idempotency \(user_id, idempotency_key\)\s*$/m,
      '  INDEX idx_room_date (room_id, date)'
    )
    .replace(/\nCREATE TABLE reservation_slots \([\s\S]*?\n\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n/m, '\n')
    .replace(
      /\n\s*waiting_seat_scope INT GENERATED ALWAYS AS \(\n\s*CASE WHEN status = 'waiting' THEN COALESCE\(seat_id, 0\) ELSE NULL END\n\s*\) STORED,\n/m,
      '\n'
    )
    .replace(
      /^\s*INDEX idx_room_date_status \(room_id, date, status\),\s*\n\s*UNIQUE KEY uk_waitlist_user_slot \(user_id, room_id, waiting_seat_scope, date, start_time, end_time\)\s*$/m,
      '  INDEX idx_room_date_status (room_id, date, status)'
    )
}

async function main() {
  const database = process.env.MYSQL_DATABASE || 'jingyi_reservation_ci'
  const initializeLegacySchema = process.env.INITIALIZE_LEGACY_RESERVATION_SCHEMA === 'true'
  if (!/(test|ci|local|dev|stage)/i.test(database)) {
    throw new Error('Refusing to initialize a database without a safe test name')
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || ''
  })

  try {
    const schemaPath = path.join(__dirname, '../server/sql/schema.sql')
    const seedPath = path.join(__dirname, '../server/sql/seed.sql')
    const replaceDatabase = function(sql) {
      return sql.replace(/jingyi_reservation/g, database)
    }

    let schemaSql = replaceDatabase(fs.readFileSync(schemaPath, 'utf8'))
    if (initializeLegacySchema) schemaSql = toLegacyReservationSchema(schemaSql)

    await connection.query('DROP DATABASE IF EXISTS `' + database.replace(/`/g, '') + '`')
    await executeStatements(connection, schemaSql, true)
    await executeStatements(connection, replaceDatabase(fs.readFileSync(seedPath, 'utf8')), false)

    const [tables] = await connection.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = ?',
      [database]
    )
    const hasReservationSlots = tables.some(function(row) {
      return row.TABLE_NAME === 'reservation_slots' || row.table_name === 'reservation_slots'
    })
    if (initializeLegacySchema && hasReservationSlots) {
      throw new Error('legacy CI schema must not contain reservation_slots before migration')
    }
    if (!initializeLegacySchema && !hasReservationSlots) {
      throw new Error('reservation_slots table was not created')
    }

    const [reservationColumns] = await connection.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'reservations'",
      [database]
    )
    const columnNames = reservationColumns.map(function(row) {
      return row.COLUMN_NAME || row.column_name
    })
    if (initializeLegacySchema && (columnNames.includes('idempotency_key') || columnNames.includes('request_hash'))) {
      throw new Error('legacy CI schema must not contain consistency columns before migration')
    }

    const [waitlistColumns] = await connection.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'reservation_waitlist'",
      [database]
    )
    const waitlistColumnNames = waitlistColumns.map(function(row) {
      return row.COLUMN_NAME || row.column_name
    })
    const [waitlistIndexes] = await connection.query(
      "SELECT index_name FROM information_schema.statistics WHERE table_schema = ? " +
      "AND table_name = 'reservation_waitlist' AND index_name = 'uk_waitlist_user_slot'",
      [database]
    )
    if (initializeLegacySchema && (waitlistColumnNames.includes('waiting_seat_scope') || waitlistIndexes.length)) {
      throw new Error('legacy CI schema must not contain waitlist consistency objects before migration')
    }
    if (!initializeLegacySchema && (!waitlistColumnNames.includes('waiting_seat_scope') || !waitlistIndexes.length)) {
      throw new Error('current schema must contain waitlist consistency objects')
    }

    const mode = initializeLegacySchema ? 'legacy-reservation-schema' : 'current-schema'
    console.log('initialize-ci-mysql passed: ' + database + ' (' + mode + ')')
  } finally {
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
