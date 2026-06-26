process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'true'
process.env.ALLOW_MOCK_REDIS = 'true'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'
process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = '1'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const metricsService = require('../server/src/services/metricsService')
const operationalHealthService = require('../server/src/services/operationalHealthService')
const config = require('../server/src/config')

function main() {
  metricsService.resetForTests()

  metricsService.recordDatabaseQuery('SELECT', 12, { error: false, slow: false })
  metricsService.recordDatabaseQuery('SELECT', 450, { error: false, slow: true })
  metricsService.recordDatabaseQuery('UPDATE', 35, { error: true, slow: false })
  const snapshot = metricsService.snapshot()

  assert.strictEqual(snapshot.database.total, 3, 'database query count must be recorded')
  assert.strictEqual(snapshot.database.errors, 1, 'database errors must be recorded')
  assert.strictEqual(snapshot.database.slow, 1, 'slow database queries must be recorded')
  assert.strictEqual(snapshot.database.operations.SELECT, 2, 'database operations must be grouped')
  assert.strictEqual(snapshot.database.operations.UPDATE, 1, 'update operations must be grouped')
  assert(snapshot.database.durationSecondsMax >= 0.45, 'database maximum latency must be recorded')

  const prometheus = metricsService.toPrometheus()
  assert(prometheus.includes('jingyi_database_queries_total{operation="SELECT"} 2'))
  assert(prometheus.includes('jingyi_database_query_errors_total 1'))
  assert(prometheus.includes('jingyi_database_slow_queries_total 1'))
  assert(prometheus.includes('jingyi_database_query_duration_seconds_bucket'))

  const synthetic = {
    readiness: { ready: true },
    outbox: { pending: 0, processing: 0, failed: 0, dead: 0, oldestPendingSeconds: 0 },
    metrics: {
      totalRequests: 100,
      errorRate: 0,
      auditWriteFailures: 0,
      database: { total: 100, errors: 3, slow: 20, errorRate: 0.03 }
    },
    databasePool: { queuedRequests: 8 },
    audit: { integrity: { valid: true, problems: [] } },
    backup: { lastSuccessAgeSeconds: 60, failures24Hours: 0, secondaryCopied: true, lastSuccessAt: new Date().toISOString() }
  }
  const codes = operationalHealthService.evaluateAlerts(synthetic).map(function(item) { return item.code })
  assert(codes.includes('DATABASE_ERROR_RATE'), 'database error-rate alert must be emitted')
  assert(codes.includes('DATABASE_SLOW_RATE'), 'slow-query-rate alert must be emitted')
  assert(codes.includes('DATABASE_POOL_QUEUE'), 'connection-pool queue alert must be emitted')

  assert.strictEqual(config.boundedInteger('20', 10, 2, 100), 20)
  assert.strictEqual(config.boundedInteger('1000', 10, 2, 100), 100)
  assert.strictEqual(config.boundedInteger('bad', 10, 2, 100), 10)

  const root = path.join(__dirname, '..')
  const read = function(relative) { return fs.readFileSync(path.join(root, relative), 'utf8') }
  assert(/performanceSchemaService\.assertReady\(\)/.test(read('server/src/app.js')), 'API startup must require performance indexes')
  assert(/performanceSchemaService\.assertReady\(\)/.test(read('server/src/scheduler-worker.js')), 'worker startup must require performance indexes')
  assert(/apply-performance-indexes-migration/.test(read('deploy/scripts/migrate.sh')), 'release gate must apply performance indexes')
  assert(/LEFT JOIN seats s ON r\.seat_id = s\.id/.test(read('server/src/controllers/reservationController.js')), 'reservation detail must avoid the extra seat query')
  assert(/database_slow_query/.test(read('server/src/config/database.js')), 'slow database queries must be logged')

  console.log('performance-observability-check passed')
}

try {
  main()
} catch (err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
}
