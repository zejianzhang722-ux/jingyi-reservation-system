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
const db = require('../server/src/config/database')
const notificationService = require('../server/src/services/notificationService')
const repository = require('../server/src/services/notificationOutboxRepository')
const dispatcher = require('../server/src/services/notificationOutboxDispatcher')
const pump = require('../server/src/services/notificationOutboxPumpService')

async function main() {
  await db.ready()
  assert.strictEqual(db.isMock(), true, 'isolated notification regression must use mock database')
  const tables = require('../server/src/config/mock-db').__tables
  tables.notifications = []
  tables.notification_outbox = []

  const first = await notificationService.createNotification(
    1,
    'reservation_approved',
    '预约已通过',
    '测试通知',
    { reservationId: 991 }
  )
  const duplicate = await notificationService.createNotification(
    1,
    'reservation_approved',
    '预约已通过',
    '重复调用内容不会重复插入',
    { reservationId: 991 }
  )
  assert.strictEqual(first.idempotent, false, 'first notification must be inserted')
  assert.strictEqual(duplicate.idempotent, true, 'duplicate notification must return existing row')
  assert.strictEqual(duplicate.id, first.id, 'duplicate notification must preserve the original id')
  assert.strictEqual(tables.notifications.length, 1, 'notification dedupe must leave one database row')
  assert.strictEqual(tables.notification_outbox.length, 1, 'notification dedupe must leave one outbox event')

  await notificationService.createNotification(
    1,
    'reservation_rejected',
    '预约未通过',
    '不同通知类型应独立存在',
    { reservationId: 991 }
  )
  assert.strictEqual(tables.notifications.length, 2, 'different notification type must create a separate row')
  assert.strictEqual(tables.notification_outbox.length, 2, 'different notification type must create a separate outbox row')

  const delivered = []
  const success = await dispatcher.processBatch({
    limit: 20,
    workerId: 'mock-success-worker',
    getIO: function() {
      return {
        to: function(room) {
          return {
            emit: function(event, payload) {
              delivered.push({ room, event, payload })
            }
          }
        }
      }
    }
  })
  assert.strictEqual(success.claimed, 2, 'worker must claim both pending websocket events')
  assert.strictEqual(success.sent, 2, 'worker must mark successful events as sent')
  assert.strictEqual(delivered.length, 2, 'worker must deliver each event once')
  assert(delivered.every(function(item) { return item.room === 'user:1' && item.event === 'notification' }), 'websocket notifications must target the private user room')
  assert(tables.notification_outbox.every(function(row) { return row.status === 'sent' }), 'successful rows must be terminally sent')

  repository.enqueueMock({
    eventKey: 'test:retry:websocket',
    userId: 1,
    channel: 'websocket',
    eventName: 'notification',
    maxAttempts: 2,
    payload: { id: 500, userId: 1 }
  })
  const failedOnce = await dispatcher.processBatch({
    workerId: 'mock-failure-worker',
    getIO: function() { return null },
    publishExternalBroadcast: async function() { throw new Error('temporary redis failure') }
  })
  assert.strictEqual(failedOnce.failed, 1, 'temporary delivery failure must schedule a retry')
  const retryRow = tables.notification_outbox.find(function(row) { return row.event_key === 'test:retry:websocket' })
  assert.strictEqual(retryRow.status, 'failed', 'failed event must remain retryable')
  assert.strictEqual(retryRow.attempts, 1, 'failed event must increment attempts')
  assert(retryRow.last_error.includes('temporary redis failure'), 'failure reason must be retained')

  retryRow.available_at = new Date(Date.now() - 1000).toISOString()
  const deadResult = await dispatcher.processBatch({
    workerId: 'mock-dead-worker',
    getIO: function() { return null },
    publishExternalBroadcast: async function() { throw new Error('permanent redis failure') }
  })
  assert.strictEqual(deadResult.dead, 1, 'event reaching max attempts must enter dead-letter state')
  assert.strictEqual(retryRow.status, 'dead', 'dead-letter event must no longer be claimable')

  repository.enqueueMock({
    eventKey: 'test:wechat:no-openid',
    userId: 1,
    channel: 'wechat',
    eventName: 'template-1',
    payload: { userId: 1, templateId: 'template-1', templateData: {}, page: 'pages/index/index' }
  })
  const wechatResult = await dispatcher.processBatch({
    workerId: 'mock-wechat-worker',
    dbClient: { query: async function() { return [[]] } },
    wechatClient: { sendSubscribeMessage: async function() { throw new Error('must not be called') } }
  })
  assert.strictEqual(wechatResult.sent, 1, 'missing openid is a successful no-op and must not retry forever')
  const wechatRow = tables.notification_outbox.find(function(row) { return row.event_key === 'test:wechat:no-openid' })
  assert.strictEqual(wechatRow.status, 'sent', 'openid-missing row must be finalized')

  repository.enqueueMock({
    eventKey: 'test:wechat:missing-ack',
    userId: 1,
    channel: 'wechat',
    eventName: 'template-2',
    maxAttempts: 2,
    payload: { userId: 1, templateId: 'template-2', templateData: {}, page: 'pages/index/index' }
  })
  const missingAck = await dispatcher.processBatch({
    workerId: 'mock-wechat-missing-ack',
    dbClient: { query: async function() { return [[{ openid: 'test-openid' }]] } },
    wechatClient: { sendSubscribeMessage: async function() { return undefined } }
  })
  assert.strictEqual(missingAck.failed, 1, 'missing WeChat acknowledgement must remain retryable')
  const missingAckRow = tables.notification_outbox.find(function(row) { return row.event_key === 'test:wechat:missing-ack' })
  assert.strictEqual(missingAckRow.status, 'failed', 'missing acknowledgement must not be marked as sent')

  const firstStart = pump.start({ intervalMs: 600000, batchSize: 1, workerId: 'test-pump' })
  const reusedStart = pump.start({ intervalMs: 600000, batchSize: 1, workerId: 'another-worker' })
  assert.strictEqual(firstStart.reused, false, 'first outbox pump start must create a timer')
  assert.strictEqual(reusedStart.reused, true, 'second outbox pump start must reuse existing timer')
  assert.strictEqual(pump.state().started, true, 'outbox pump state must report started')
  const stopped = await pump.stop({ timeoutMs: 2000 })
  assert.strictEqual(stopped.drained, true, 'outbox pump stop must drain an active tick')
  assert.strictEqual(pump.state().started, false, 'outbox pump stop must clear the timer')

  const root = path.join(__dirname, '..')
  const read = function(relative) { return fs.readFileSync(path.join(root, relative), 'utf8') }
  const workerSource = read('server/src/scheduler-worker.js')
  const appSource = read('server/src/app.js')
  const readinessSource = read('server/src/services/dataReadinessService.js')
  const migrationSource = read('scripts/apply-notification-outbox-migration.js')
  const notificationSource = read('server/src/services/notificationService.js')
  const socketAuthSource = read('server/src/services/socketAuthService.js')

  assert(/notificationOutboxPumpService\.start\(\)/.test(workerSource), 'dedicated worker must start the outbox pump')
  assert(/await notificationOutboxPumpService\.stop/.test(workerSource), 'dedicated worker must drain the outbox pump')
  assert(/notificationOutboxPumpService\.start\(\)/.test(appSource), 'in-process scheduler mode must also start the outbox pump')
  assert(/await notificationOutboxPumpService\.stop/.test(appSource), 'application shutdown must drain the outbox pump')
  assert(/notification_outbox/.test(readinessSource) && /uk_notification_user_dedupe/.test(readinessSource), 'production readiness must require outbox schema')
  assert(/GET_LOCK/.test(migrationSource) && /CREATE TABLE IF NOT EXISTS notification_outbox/.test(migrationSource), 'outbox migration must be locked and repeatable')
  assert(!/require\('\.\.\/app'\)/.test(notificationSource), 'notification service must not import the application entrypoint')
  assert(/enqueueTx/.test(notificationSource), 'notification insert and outbox event must share a transaction')
  assert(/socket\.join\('user:' \+ user\.id\)/.test(socketAuthSource), 'student sockets must join their private notification room')

  console.log('notification-outbox-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
