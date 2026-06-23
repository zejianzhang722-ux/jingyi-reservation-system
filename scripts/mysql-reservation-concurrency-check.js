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
  const reservationService = require('../server/src/services/reservationService')
  const ready = await db.ready()
  assert(ready && ready.mode === 'mysql', 'MySQL must be available for concurrency checks')

  const [slotTables] = await db.query("SHOW TABLES LIKE 'reservation_slots'")
  assert(slotTables.length > 0, 'reservation_slots table is required before running MySQL consistency checks')

  const target = new Date()
  target.setDate(target.getDate() + 2)
  const date = formatDate(target)
  const purposePrefix = 'mysql-concurrency-check:' + Date.now()

  async function cleanup() {
    await db.query("DELETE FROM reservation_slots WHERE reservation_id IN (SELECT id FROM reservations WHERE purpose LIKE ?)", [purposePrefix + '%'])
    await db.query("DELETE FROM reservations WHERE purpose LIKE ?", [purposePrefix + '%'])
  }

  await cleanup()

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
      reservationService.createReservation(Object.assign({ userId: 1, idempotencyKey: purposePrefix + ':a' }, base)),
      reservationService.createReservation(Object.assign({ userId: 2, idempotencyKey: purposePrefix + ':b' }, base))
    ])

    const fulfilled = attempts.filter(function(item) { return item.status === 'fulfilled' })
    const rejected = attempts.filter(function(item) { return item.status === 'rejected' })
    assert.strictEqual(fulfilled.length, 1, 'exactly one concurrent reservation should succeed')
    assert.strictEqual(rejected.length, 1, 'exactly one concurrent reservation should fail')
    assert.strictEqual(rejected[0].reason.httpStatus, 409, 'losing concurrent reservation should return 409')

    const sameKey = purposePrefix + ':same-key'
    const idemInput = Object.assign({}, base, {
      userId: 1,
      idempotencyKey: sameKey,
      startTime: '20:00',
      endTime: '21:00',
      purpose: purposePrefix + ':idem'
    })
    const idemAttempts = await Promise.allSettled([
      reservationService.createReservation(idemInput),
      reservationService.createReservation(idemInput)
    ])
    assert(idemAttempts.every(function(item) { return item.status === 'fulfilled' }), 'same idempotency request should not fail under concurrency')
    assert.strictEqual(Number(idemAttempts[0].value.id), Number(idemAttempts[1].value.id), 'same idempotency key should return one reservation')

    let changedPayloadError = null
    try {
      await reservationService.createReservation(Object.assign({}, idemInput, { participants: 5 }))
    } catch (err) {
      changedPayloadError = err
    }
    assert(changedPayloadError && changedPayloadError.httpStatus === 409, 'same key with changed payload should return 409')

    const repeated = idemAttempts[0].value
    await reservationService.releaseReservationAndPromoteWaitlist({
      reservationId: repeated.id,
      nextStatus: 'cancelled',
      actorUserId: 1,
      actorRole: 'student'
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
