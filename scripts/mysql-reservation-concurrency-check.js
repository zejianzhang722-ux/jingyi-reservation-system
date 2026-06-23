const assert = require('assert')

function formatDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0')
}

async function main() {
  const dbName = process.env.MYSQL_DATABASE || ''
  if (!/(test|ci|local|dev|stage)/i.test(dbName)) {
    console.log('mysql-reservation-concurrency-check skipped: MYSQL_DATABASE is not a safe test database')
    return
  }

  const db = require('../server/src/config/database')
  const reservationCommandService = require('../server/src/services/reservationCommandService')
  const reservationLifecycleService = require('../server/src/services/reservationLifecycleService')
  const reservationService = require('../server/src/services/reservationService')
  const ready = await db.ready()
  assert(ready && ready.mode === 'mysql', 'MySQL must be available for concurrency checks')

  const [slotTables] = await db.query("SHOW TABLES LIKE 'reservation_slots'")
  assert(slotTables.length > 0, 'reservation_slots table is required before running MySQL consistency checks')

  const testUserA = 101
  const testUserB = 102
  const testUserC = 103
  const testUsers = [testUserA, testUserB, testUserC]
  const target = new Date()
  target.setDate(target.getDate() + 2)
  const date = formatDate(target)
  const purposePrefix = 'mysql-concurrency-check:' + Date.now()

  async function cleanup() {
    const placeholders = testUsers.map(function() { return '?' }).join(',')
    await db.query(
      'DELETE FROM reservation_slots WHERE reservation_id IN (SELECT id FROM reservations WHERE user_id IN (' + placeholders + '))',
      testUsers
    )
    await db.query('DELETE FROM reservation_waitlist WHERE user_id IN (' + placeholders + ')', testUsers)
    await db.query('DELETE FROM reservations WHERE user_id IN (' + placeholders + ')', testUsers)
    await db.query('DELETE FROM users WHERE id IN (' + placeholders + ')', testUsers)
  }

  await cleanup()
  await db.query(
    "INSERT INTO users (id, openid, student_id, student_no, card_no, real_name, role, credit_score, status) VALUES " +
    "(?, ?, ?, ?, ?, ?, 'student', 100, 'active'), " +
    "(?, ?, ?, ?, ?, ?, 'student', 100, 'active'), " +
    "(?, ?, ?, ?, ?, ?, 'student', 100, 'active')",
    [
      testUserA, 'ci_openid_' + testUserA, 'CI' + testUserA, 'CI' + testUserA, 'CARD' + testUserA, 'CI用户A',
      testUserB, 'ci_openid_' + testUserB, 'CI' + testUserB, 'CI' + testUserB, 'CARD' + testUserB, 'CI用户B',
      testUserC, 'ci_openid_' + testUserC, 'CI' + testUserC, 'CI' + testUserC, 'CARD' + testUserC, 'CI用户C'
    ]
  )

  try {
    const base = {
      roomId: 8,
      seatId: null,
      date,
      startTime: '19:00',
      endTime: '20:00',
      purpose: purposePrefix + ':race',
      participants: 4
    }

    const attempts = await Promise.allSettled([
      reservationCommandService.createReservation(Object.assign({ userId: testUserA, idempotencyKey: purposePrefix + ':a' }, base)),
      reservationCommandService.createReservation(Object.assign({ userId: testUserB, idempotencyKey: purposePrefix + ':b' }, base))
    ])

    const fulfilled = attempts.filter(function(item) { return item.status === 'fulfilled' })
    const rejected = attempts.filter(function(item) { return item.status === 'rejected' })
    assert.strictEqual(fulfilled.length, 1, 'exactly one concurrent reservation should succeed')
    assert.strictEqual(rejected.length, 1, 'exactly one concurrent reservation should fail')
    assert.strictEqual(rejected[0].reason.httpStatus, 409, 'losing concurrent reservation should return 409')

    const sameKey = purposePrefix + ':same-key'
    const idemInput = Object.assign({}, base, {
      userId: testUserA,
      idempotencyKey: sameKey,
      startTime: '20:00',
      endTime: '21:00',
      purpose: purposePrefix + ':idem'
    })
    const idemAttempts = await Promise.allSettled([
      reservationCommandService.createReservation(idemInput),
      reservationCommandService.createReservation(idemInput)
    ])
    assert(idemAttempts.every(function(item) { return item.status === 'fulfilled' }), 'same idempotency request should not fail under concurrency')
    assert.strictEqual(Number(idemAttempts[0].value.id), Number(idemAttempts[1].value.id), 'same idempotency key should return one reservation')

    let changedPayloadError = null
    try {
      await reservationCommandService.createReservation(Object.assign({}, idemInput, { participants: 5 }))
    } catch (err) {
      changedPayloadError = err
    }
    assert(changedPayloadError && changedPayloadError.httpStatus === 409, 'same key with changed payload should return 409')

    let longKeyError = null
    try {
      await reservationCommandService.createReservation(Object.assign({}, idemInput, {
        idempotencyKey: 'x'.repeat(129),
        startTime: '21:00',
        endTime: '22:00'
      }))
    } catch (err) {
      longKeyError = err
    }
    assert(longKeyError && longKeyError.code === 'IDEMPOTENCY_KEY_TOO_LONG', 'idempotency keys longer than 128 characters must return a validation error')
    assert.strictEqual(longKeyError.httpStatus, 400, 'overlong idempotency keys must return HTTP 400 semantics')

    let durationError = null
    try {
      await reservationCommandService.createReservation({
        userId: testUserB,
        roomId: 8,
        date,
        startTime: '08:00',
        endTime: '11:01',
        purpose: purposePrefix + ':duration-over',
        participants: 4,
        idempotencyKey: purposePrefix + ':duration-over'
      })
    } catch (err) {
      durationError = err
    }
    assert(durationError && durationError.code === 'MAX_DURATION_EXCEEDED', '181 minutes must exceed a 180-minute room limit')

    const exactDuration = await reservationCommandService.createReservation({
      userId: testUserB,
      roomId: 8,
      date,
      startTime: '08:00',
      endTime: '11:00',
      purpose: purposePrefix + ':duration-exact',
      participants: 4,
      idempotencyKey: purposePrefix + ':duration-exact'
    })
    assert(exactDuration && exactDuration.id, 'exactly 180 minutes must be allowed')

    const delegated = await reservationService.createReservation({
      userId: testUserC,
      roomId: 8,
      date,
      startTime: '14:00',
      endTime: '15:00',
      purpose: purposePrefix + ':delegated',
      participants: 4,
      idempotencyKey: purposePrefix + ':delegated'
    })
    const [delegatedSlots] = await db.query('SELECT id FROM reservation_slots WHERE reservation_id = ?', [delegated.id])
    assert.strictEqual(delegatedSlots.length, 60, 'legacy service entry point must delegate to the strict transactional writer')

    const source = await reservationCommandService.createReservation({
      userId: testUserA,
      roomId: 8,
      date,
      startTime: '17:00',
      endTime: '18:00',
      purpose: purposePrefix + ':waitlist-source',
      participants: 4,
      idempotencyKey: purposePrefix + ':waitlist-source'
    })
    const [waitlistInsert] = await db.query(
      "INSERT INTO reservation_waitlist (user_id, room_id, seat_id, date, start_time, end_time, status, created_at) VALUES (?, ?, NULL, ?, ?, ?, 'waiting', NOW())",
      [testUserB, 8, date, '17:00', '18:00']
    )

    const lifecycleResult = await reservationLifecycleService.releaseAndPromote({
      reservationId: source.id,
      nextStatus: 'cancelled',
      actorUserId: testUserA,
      actorRole: 'student',
      allowedCurrentStatuses: ['approved']
    })
    assert(lifecycleResult.promotedReservation && lifecycleResult.promotedReservation.id, 'release must promote the first waitlist entry')

    const [convertedRows] = await db.query('SELECT status FROM reservation_waitlist WHERE id = ?', [waitlistInsert.insertId])
    assert.strictEqual(convertedRows[0].status, 'converted', 'waitlist entry and promoted reservation must commit together')
    const [promotedSlots] = await db.query('SELECT id FROM reservation_slots WHERE reservation_id = ?', [lifecycleResult.promotedReservation.id])
    assert.strictEqual(promotedSlots.length, 60, 'promoted reservation must own all minute slots')
    const [releasedSlots] = await db.query('SELECT id FROM reservation_slots WHERE reservation_id = ?', [source.id])
    assert.strictEqual(releasedSlots.length, 0, 'released reservation must have no slots')

    const repeated = idemAttempts[0].value
    await reservationLifecycleService.releaseAndPromote({
      reservationId: repeated.id,
      nextStatus: 'cancelled',
      actorUserId: testUserA,
      actorRole: 'student',
      allowedCurrentStatuses: ['approved']
    })
    const [remainingSlots] = await db.query('SELECT id FROM reservation_slots WHERE reservation_id = ?', [repeated.id])
    assert.strictEqual(remainingSlots.length, 0, 'released reservation should have no slots')

    console.log('mysql-reservation-concurrency-check passed')
  } finally {
    await cleanup()
  }
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
