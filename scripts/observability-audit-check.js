process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'true'
process.env.ALLOW_MOCK_REDIS = 'true'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'
process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = '1'
process.env.AUDIT_IP_HASH_SALT = 'test-audit-ip-hash-salt-with-more-than-32-characters'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const db = require('../server/src/config/database')
const auditTrailService = require('../server/src/services/auditTrailService')
const auditHash = require('../server/src/utils/auditHash')
const metricsService = require('../server/src/services/metricsService')
const operationalHealthService = require('../server/src/services/operationalHealthService')
const requestContext = require('../server/src/middleware/requestContext')
const opsAuth = require('../server/src/middleware/opsAuth')
const productionConfigGuard = require('../server/src/services/productionConfigGuard')
const config = require('../server/src/config')

async function main() {
  await db.ready()
  assert.strictEqual(db.isMock(), true, 'isolated observability regression must use mock database')
  const tables = require('../server/src/config/mock-db').__tables
  tables.operation_logs = []
  tables.notification_outbox = []
  metricsService.resetForTests()

  const sanitized = auditTrailService.sanitize({
    username: 'admin',
    password: 'plain-text',
    nested: { accessToken: 'secret-token', value: 'visible' }
  })
  assert.strictEqual(sanitized.password, '[redacted]', 'password must be redacted')
  assert.strictEqual(sanitized.nested.accessToken, '[redacted]', 'nested token must be redacted')
  assert.strictEqual(sanitized.nested.value, 'visible', 'non-sensitive metadata must be preserved')

  const first = await auditTrailService.record({
    operatorId: 1,
    requestId: 'audit-request-0001',
    actorRole: 'super_admin',
    action: 'http.post.admin.rooms',
    targetTable: 'rooms',
    targetId: 21,
    description: 'create room',
    method: 'POST',
    path: '/api/v1/admin/rooms',
    statusCode: 200,
    ip: '192.0.2.10',
    userAgent: 'audit-test',
    metadata: { body: { name: '测试房间', password: 'must-not-persist' } }
  })
  const second = await auditTrailService.record({
    operatorId: 1,
    requestId: 'audit-request-0002',
    actorRole: 'super_admin',
    action: 'http.put.admin.rooms_id',
    targetTable: 'rooms',
    targetId: 21,
    description: 'update room',
    method: 'PUT',
    path: '/api/v1/admin/rooms/:id',
    statusCode: 409,
    ip: '192.0.2.10',
    userAgent: 'audit-test',
    metadata: { body: { status: 'closed' } }
  })
  assert.strictEqual(first.prev_hash, null, 'first hashed audit event starts a chain')
  assert.strictEqual(second.prev_hash, first.entry_hash, 'second audit event must link to previous hash')
  assert.notStrictEqual(first.ip_hash, '192.0.2.10', 'raw IP address must not be persisted')
  assert.strictEqual(first.ip_hash, second.ip_hash, 'same IP and salt must produce stable hash')
  assert.strictEqual(first.metadata.body.password, '[redacted]', 'persisted metadata must be redacted')
  assert.strictEqual(first.entry_hash, auditHash.computeEntryHash(first.prev_hash, first), 'entry hash must be deterministic')

  let verification = auditTrailService.verifyRows(tables.operation_logs)
  assert.strictEqual(verification.valid, true, 'untampered audit chain must verify')
  assert.strictEqual(verification.checked, 2, 'both hashed audit rows must be verified')

  tables.operation_logs[1].description = 'tampered'
  verification = auditTrailService.verifyRows(tables.operation_logs)
  assert.strictEqual(verification.valid, false, 'tampered audit row must be detected')
  assert(verification.problems.some(function(problem) { return problem.issue === 'entry_hash_mismatch' }), 'tampering must report an entry hash mismatch')
  tables.operation_logs[1].description = 'update room'
  assert.strictEqual(auditTrailService.verifyRows(tables.operation_logs).valid, true, 'restored audit row must verify again')

  const legacy = {
    id: 3,
    operator_id: 1,
    action: 'legacy_action',
    target_table: 'rooms',
    target_id: 1,
    description: 'legacy unchained row',
    created_at: '2026-06-26 09:00:00'
  }
  tables.operation_logs.push(legacy)
  const third = await auditTrailService.record({
    operatorId: 1,
    requestId: 'audit-request-0003',
    actorRole: 'admin',
    action: 'http.delete.admin.rooms_id',
    targetTable: 'rooms',
    targetId: 21,
    description: 'delete room',
    method: 'DELETE',
    path: '/api/v1/admin/rooms/:id',
    statusCode: 200,
    metadata: {}
  })
  assert.strictEqual(third.prev_hash, second.entry_hash, 'legacy unhashed rows must not break the hash chain')
  verification = auditTrailService.verifyRows(tables.operation_logs)
  assert.strictEqual(verification.valid, true, 'chain verification must remain valid around legacy rows')
  assert.strictEqual(verification.unhashed, 1, 'legacy row count must be reported')

  const acceptedRequest = { headers: { 'x-request-id': 'client-request-1234' } }
  const rejectedRequest = { headers: { 'x-request-id': 'bad id' } }
  assert.strictEqual(requestContext.requestId(acceptedRequest), 'client-request-1234', 'valid client request id must be preserved')
  assert.notStrictEqual(requestContext.requestId(rejectedRequest), 'bad id', 'invalid client request id must be replaced')
  assert.strictEqual(opsAuth.secureEqual('same-token', 'same-token'), true, 'operations token comparison must accept exact match')
  assert.strictEqual(opsAuth.secureEqual('same-token', 'different-token'), false, 'operations token comparison must reject mismatch')

  const complete = metricsService.beginRequest()
  complete({ method: 'GET', path: '/api/v1/room/123' }, 200, 125)
  const errorComplete = metricsService.beginRequest()
  errorComplete({ method: 'POST', path: '/api/v1/admin/rooms/999' }, 503, 750)
  const metrics = metricsService.snapshot()
  assert.strictEqual(metrics.totalRequests, 2, 'HTTP metrics must count requests')
  assert.strictEqual(metrics.errorResponses, 1, 'HTTP metrics must count 5xx responses')
  assert(metrics.routes.some(function(item) { return item.route.includes('/:id') }), 'numeric path segments must be normalized')
  const prometheus = metricsService.toPrometheus({ gauges: [{ name: 'jingyi_test_gauge', value: 1 }] })
  assert(prometheus.includes('jingyi_http_request_duration_seconds_bucket'), 'Prometheus output must contain duration histogram')
  assert(prometheus.includes('jingyi_test_gauge 1'), 'Prometheus output must include external gauges')

  const syntheticSnapshot = {
    readiness: { ready: false },
    outbox: { pending: 150, processing: 0, failed: 0, dead: 1, oldestPendingSeconds: 600 },
    metrics: { totalRequests: 100, errorRate: 0.1, auditWriteFailures: 1 },
    audit: { integrity: { valid: false, problems: [{ issue: 'test' }] } }
  }
  const alerts = operationalHealthService.evaluateAlerts(syntheticSnapshot)
  const codes = alerts.map(function(alert) { return alert.code })
  ;['DEPENDENCY_NOT_READY', 'OUTBOX_DEAD_LETTERS', 'OUTBOX_BACKLOG', 'OUTBOX_OLDEST_PENDING', 'HTTP_5XX_RATE', 'AUDIT_WRITE_FAILURES', 'AUDIT_CHAIN_INVALID'].forEach(function(code) {
    assert(codes.includes(code), 'operational alert must include ' + code)
  })

  const oldEnvironment = process.env.NODE_ENV
  const oldValues = {
    JWT_SECRET: process.env.JWT_SECRET,
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    OPS_MONITOR_TOKEN: process.env.OPS_MONITOR_TOKEN,
    AUDIT_IP_HASH_SALT: process.env.AUDIT_IP_HASH_SALT,
    ALLOW_WECHAT_DISABLED: process.env.ALLOW_WECHAT_DISABLED,
    ALLOW_INSECURE_BASE_URL: process.env.ALLOW_INSECURE_BASE_URL
  }
  process.env.NODE_ENV = 'production'
  process.env.JWT_SECRET = 'j'.repeat(40)
  process.env.MYSQL_PASSWORD = 'mysql-strong-password'
  process.env.REDIS_PASSWORD = 'redis-strong-password'
  delete process.env.OPS_MONITOR_TOKEN
  process.env.AUDIT_IP_HASH_SALT = 's'.repeat(40)
  process.env.ALLOW_WECHAT_DISABLED = 'true'
  process.env.ALLOW_INSECURE_BASE_URL = 'true'
  assert.throws(function() { productionConfigGuard.validate() }, function(err) {
    return err && err.code === 'OPS_MONITOR_TOKEN_REQUIRED'
  }, 'production must require operations monitoring token')
  process.env.OPS_MONITOR_TOKEN = 'o'.repeat(40)
  config.corsOrigins = ['https://admin.example.edu']
  config.baseUrl = 'https://api.example.edu'
  assert.strictEqual(productionConfigGuard.validate().valid, true, 'complete production observability configuration must pass')
  process.env.NODE_ENV = oldEnvironment
  Object.keys(oldValues).forEach(function(key) {
    if (oldValues[key] === undefined) delete process.env[key]
    else process.env[key] = oldValues[key]
  })

  const root = path.join(__dirname, '..')
  const read = function(relative) { return fs.readFileSync(path.join(root, relative), 'utf8') }
  const appSource = read('server/src/app.js')
  const routeSource = read('server/src/routes/ops.js')
  const migrationSource = read('scripts/apply-observability-audit-migration.js')
  const guardSource = read('server/src/services/productionConfigGuard.js')
  assert(/requestContext\.middleware/.test(appSource), 'application must install request correlation middleware')
  assert(/auditTrail\.middleware/.test(appSource), 'application must install audit middleware')
  assert(/operationalMonitorService\.start\(\)/.test(appSource), 'application must start the operational monitor')
  assert(/auditSchemaService\.assertReady\(\)/.test(appSource), 'application must require audit schema readiness')
  assert(/router\.use\(opsAuth\.middleware\)/.test(routeSource), 'detailed operations endpoints must be protected')
  assert(/GET_LOCK/.test(migrationSource) && /ON DELETE SET NULL/.test(migrationSource), 'audit migration must be locked and preserve logs when administrators are deleted')
  assert(/OPS_MONITOR_TOKEN_REQUIRED/.test(guardSource) && /AUDIT_IP_HASH_SALT_REQUIRED/.test(guardSource), 'production guard must require observability secrets')

  console.log('observability-audit-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
