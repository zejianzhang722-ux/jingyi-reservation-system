process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'false'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const mysql = require('../server/node_modules/mysql2/promise')

const REQUIRED_INDEXES = {
  rooms: ['idx_rooms_status_type_building'],
  seats: ['idx_seats_room_status_order'],
  reservations: [
    'idx_reservation_status_created',
    'idx_reservation_user_status_schedule',
    'idx_reservation_room_schedule_status'
  ],
  checkins: ['idx_checkins_room_time'],
  notifications: ['idx_notifications_user_read_created'],
  reservation_waitlist: ['idx_waitlist_status_created']
}

function percentile(values, ratio) {
  const sorted = values.slice().sort(function(a, b) { return a - b })
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

async function explainContains(connection, sql, params, indexName) {
  const [rows] = await connection.execute('EXPLAIN FORMAT=JSON ' + sql, params || [])
  const raw = rows[0] && (rows[0].EXPLAIN || rows[0]['EXPLAIN'])
  const plan = typeof raw === 'string' ? raw : JSON.stringify(raw || rows[0])
  assert(plan.includes(indexName), 'query plan must reference ' + indexName + ': ' + plan)
  return plan
}

async function measure(connection, sql, params, iterations) {
  const values = []
  for (let index = 0; index < iterations; index += 1) {
    const started = process.hrtime.bigint()
    await connection.execute(sql, params || [])
    values.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  return {
    count: values.length,
    minMs: Math.min.apply(null, values),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: Math.max.apply(null, values)
  }
}

async function main() {
  const database = process.env.MYSQL_DATABASE || 'jingyi_performance_ci'
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database,
    dateStrings: true
  })

  try {
    const [indexRows] = await connection.execute(
      'SELECT table_name,index_name FROM information_schema.statistics WHERE table_schema=?',
      [database]
    )
    const existing = new Set(indexRows.map(function(row) {
      return (row.table_name || row.TABLE_NAME) + '.' + (row.index_name || row.INDEX_NAME)
    }))
    Object.keys(REQUIRED_INDEXES).forEach(function(table) {
      REQUIRED_INDEXES[table].forEach(function(index) {
        assert(existing.has(table + '.' + index), 'missing performance index ' + table + '.' + index)
      })
    })

    await explainContains(
      connection,
      "SELECT id,status,created_at FROM reservations FORCE INDEX (idx_reservation_status_created) WHERE status IN ('pending','counselor_pending') ORDER BY created_at DESC LIMIT 50",
      [],
      'idx_reservation_status_created'
    )
    await explainContains(
      connection,
      "SELECT id,seat_id,start_time,end_time FROM reservations FORCE INDEX (idx_reservation_room_schedule_status) WHERE room_id=? AND date=CURDATE() AND status IN ('approved','checked_in')",
      [1],
      'idx_reservation_room_schedule_status'
    )
    await explainContains(
      connection,
      'SELECT id,title,is_read,created_at FROM notifications FORCE INDEX (idx_notifications_user_read_created) WHERE user_id=? AND is_read=? ORDER BY created_at DESC LIMIT 20',
      [1, 0],
      'idx_notifications_user_read_created'
    )
    await explainContains(
      connection,
      "SELECT id,seat_number FROM seats FORCE INDEX (idx_seats_room_status_order) WHERE room_id=? AND status!='disabled' ORDER BY row_num,col_num,seat_number",
      [1],
      'idx_seats_room_status_order'
    )

    const latency = {
      roomTimeline: await measure(
        connection,
        "SELECT id,seat_id,start_time,end_time FROM reservations WHERE room_id=? AND date=CURDATE() AND status IN ('approved','checked_in')",
        [1],
        60
      ),
      pendingApprovals: await measure(
        connection,
        "SELECT id,status,created_at FROM reservations WHERE status IN ('pending','counselor_pending') ORDER BY created_at DESC LIMIT 50",
        [],
        60
      ),
      notificationList: await measure(
        connection,
        'SELECT id,title,is_read,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20',
        [1],
        60
      )
    }

    const p95Limit = Math.max(50, Number(process.env.PERF_DB_P95_LIMIT_MS || 500))
    Object.keys(latency).forEach(function(name) {
      assert(latency[name].p95Ms <= p95Limit, name + ' database p95 exceeded ' + p95Limit + 'ms: ' + latency[name].p95Ms)
    })

    const report = {
      timestamp: new Date().toISOString(),
      database,
      p95LimitMs: p95Limit,
      indexes: Array.from(existing).filter(function(item) { return item.includes('idx_') }).sort(),
      latency
    }
    const reportFile = process.env.PERF_DB_REPORT_FILE
    if (reportFile) {
      fs.mkdirSync(path.dirname(reportFile), { recursive: true })
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
    }
    console.log(JSON.stringify(report, null, 2))
    console.log('mysql-performance-index-check passed')
  } finally {
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
