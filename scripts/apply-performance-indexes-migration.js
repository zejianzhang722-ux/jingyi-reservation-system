const mysql = require('../server/node_modules/mysql2/promise')

const LOCK = 'jingyi_performance_indexes_migration'
const INDEXES = [
  { table: 'rooms', name: 'idx_rooms_status_type_building', columns: 'status,type,building_id' },
  { table: 'seats', name: 'idx_seats_room_status_order', columns: 'room_id,status,row_num,col_num,seat_number' },
  { table: 'reservations', name: 'idx_reservation_status_created', columns: 'status,created_at,id' },
  { table: 'reservations', name: 'idx_reservation_user_status_schedule', columns: 'user_id,status,date,start_time,id' },
  { table: 'reservations', name: 'idx_reservation_room_schedule_status', columns: 'room_id,date,status,seat_id,start_time,end_time' },
  { table: 'checkins', name: 'idx_checkins_room_time', columns: 'room_id,checkin_time' },
  { table: 'notifications', name: 'idx_notifications_user_read_created', columns: 'user_id,is_read,created_at,id' },
  { table: 'reservation_waitlist', name: 'idx_waitlist_status_created', columns: 'status,created_at,id' }
]

function safeName(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Unsafe database identifier')
  return '`' + value + '`'
}

async function indexExists(connection, database, table, index) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?',
    [database, table, index]
  )
  return Number(rows[0].count) > 0
}

async function tableExists(connection, database, table) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=? AND table_name=?',
    [database, table]
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
    if (!locked) throw new Error('Could not acquire performance index migration lock')
    await connection.query('USE ' + safeName(database))
    for (const definition of INDEXES) {
      if (!(await tableExists(connection, database, definition.table))) {
        throw new Error('Required table is missing: ' + definition.table)
      }
      if (!(await indexExists(connection, database, definition.table, definition.name))) {
        const columns = definition.columns.split(',').map(function(column) { return safeName(column) }).join(',')
        await connection.query(
          'ALTER TABLE ' + safeName(definition.table) + ' ADD INDEX ' + safeName(definition.name) + ' (' + columns + ')'
        )
      }
    }
    console.log('performance-indexes migration applied')
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK])
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})

module.exports = { INDEXES, safeName, indexExists, tableExists }
