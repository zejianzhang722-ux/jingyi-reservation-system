process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'false'

const assert = require('assert')
const mysql = require('../server/node_modules/mysql2/promise')
const db = require('../server/src/config/database')
const notificationService = require('../server/src/services/notificationService')
const repository = require('../server/src/services/notificationOutboxRepository')
const dispatcher = require('../server/src/services/notificationOutboxDispatcher')

const USER_ID = 9101

async function main() {
  const state = await db.ready()
  assert.strictEqual(state.mode, 'mysql', 'real MySQL is required for notification outbox integration')
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jingyi_reservation'
  })

  try {
    await connection.execute('DELETE FROM notification_outbox WHERE user_id = ?', [USER_ID])
    await connection.execute('DELETE FROM notifications WHERE user_id = ?', [USER_ID])
    await connection.execute('DELETE FROM users WHERE id = ?', [USER_ID])
    await connection.execute(
      "INSERT INTO users (id,student_id,student_no,real_name,nickname,role,status,credit_score,created_at,updated_at) VALUES (?,?,?,?,?,'student','active',100,NOW(),NOW())",
      [USER_ID, 'OUTBOX-9101', 'OUTBOX-9101', 'Outbox Test User', 'Outbox Test']
    )

    const concurrent = await Promise.all([
      notificationService.createNotification(
        USER_ID,
        'reservation_approved',
        '预约已通过',
        '并发幂等测试',
        { reservationId: 91001 }
      ),
      notificationService.createNotification(
        USER_ID,
        'reservation_approved',
        '预约已通过',
        '并发幂等测试重复请求',
        { reservationId: 91001 }
      )
    ])
    assert.strictEqual(concurrent[0].id, concurrent[1].id, 'concurrent duplicate notification must return the same id')
    assert(concurrent.some(function(item) { return item.idempotent === true }), 'one concurrent caller must observe idempotent reuse')

    const [notificationCount] = await connection.execute(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND dedupe_key = ?',
      [USER_ID, 'reservation_approved:reservation:91001']
    )
    assert.strictEqual(Number(notificationCount[0].count), 1, 'database unique constraint must leave one notification')
    const [outboxCount] = await connection.execute(
      "SELECT COUNT(*) AS count FROM notification_outbox WHERE user_id = ? AND channel = 'websocket'",
      [USER_ID]
    )
    assert.strictEqual(Number(outboxCount[0].count), 1, 'notification transaction must leave one websocket outbox event')

    const claims = await Promise.all([
      repository.claim({ limit: 1, workerId: 'mysql-worker-a' }),
      repository.claim({ limit: 1, workerId: 'mysql-worker-b' })
    ])
    assert.strictEqual(claims[0].length + claims[1].length, 1, 'two workers must not claim the same outbox row')
    const claimed = claims[0][0] || claims[1][0]
    await repository.sent(claimed)

    const delivered = []
    await notificationService.createNotification(
      USER_ID,
      'reservation_rejected',
      '预约未通过',
      '真实数据库发送测试',
      { reservationId: 91002 }
    )
    const sentResult = await dispatcher.processBatch({
      limit: 10,
      workerId: 'mysql-dispatch-worker',
      getIO: function() {
        return {
          to: function(room) {
            return { emit: function(event, payload) { delivered.push({ room, event, payload }) } }
          }
        }
      }
    })
    assert.strictEqual(sentResult.sent, 1, 'dispatcher must finalize the pending websocket row')
    assert.strictEqual(delivered.length, 1, 'dispatcher must deliver exactly once')
    assert.strictEqual(delivered[0].room, 'user:' + USER_ID, 'delivery must target the private user room')

    await repository.enqueue({
      eventKey: 'mysql:test:wechat:retry:9101',
      userId: USER_ID,
      channel: 'wechat',
      eventName: 'template-test',
      maxAttempts: 2,
      payload: { userId: USER_ID, templateId: 'template-test', templateData: {}, page: 'pages/index/index' }
    })
    await connection.execute('UPDATE users SET openid = ? WHERE id = ?', ['outbox-openid-9101', USER_ID])
    const failedOnce = await dispatcher.processBatch({
      limit: 10,
      workerId: 'mysql-wechat-failure-1',
      wechatClient: { sendSubscribeMessage: async function() { throw new Error('simulated WeChat outage') } }
    })
    assert.strictEqual(failedOnce.failed, 1, 'first WeChat failure must remain retryable')
    let [retryRows] = await connection.execute(
      'SELECT * FROM notification_outbox WHERE event_key = ?',
      ['mysql:test:wechat:retry:9101']
    )
    assert.strictEqual(retryRows[0].status, 'failed', 'first failure must set failed state')
    assert.strictEqual(Number(retryRows[0].attempts), 1, 'first failure must increment attempts')
    assert(String(retryRows[0].last_error).includes('simulated WeChat outage'), 'last error must be retained')

    await connection.execute(
      'UPDATE notification_outbox SET available_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE event_key = ?',
      ['mysql:test:wechat:retry:9101']
    )
    const deadResult = await dispatcher.processBatch({
      limit: 10,
      workerId: 'mysql-wechat-failure-2',
      wechatClient: { sendSubscribeMessage: async function() { throw new Error('simulated permanent outage') } }
    })
    assert.strictEqual(deadResult.dead, 1, 'event at max attempts must become dead letter')
    ;[retryRows] = await connection.execute(
      'SELECT * FROM notification_outbox WHERE event_key = ?',
      ['mysql:test:wechat:retry:9101']
    )
    assert.strictEqual(retryRows[0].status, 'dead', 'dead-letter state must be persisted')
    assert.strictEqual(Number(retryRows[0].attempts), 2, 'dead-letter event must record final attempt')

    console.log('mysql-notification-outbox-check passed')
  } finally {
    try { await connection.execute('DELETE FROM notification_outbox WHERE user_id = ?', [USER_ID]) } catch (err) {}
    try { await connection.execute('DELETE FROM notifications WHERE user_id = ?', [USER_ID]) } catch (err) {}
    try { await connection.execute('DELETE FROM users WHERE id = ?', [USER_ID]) } catch (err) {}
    await connection.end()
    await db.close()
  }
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
