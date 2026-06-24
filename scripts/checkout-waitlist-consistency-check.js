process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'true'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'

const assert = require('assert')
const db = require('../server/src/config/database')
const reservationService = require('../server/src/services/reservationService')
const waitlistService = require('../server/src/services/waitlistService')
const checkinController = require('../server/src/controllers/checkinController')

function formatDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0')
}

function responseCapture() {
  return {
    statusCode: null,
    payload: null,
    status: function(code) {
      this.statusCode = code
      return this
    },
    json: function(payload) {
      this.payload = payload
      return payload
    }
  }
}

function slotsFor(tables, reservationId) {
  return (tables.reservation_slots || []).filter(function(slot) {
    return Number(slot.reservation_id) === Number(reservationId)
  })
}

async function main() {
  await db.ready()
  assert.strictEqual(db.isMock(), true, 'checkout regression must use isolated mock data')

  const target = new Date()
  target.setDate(target.getDate() + 3)
  const date = formatDate(target)

  let invalidSeat = null
  try {
    await waitlistService.joinWaitlist({
      userId: 1,
      roomId: 8,
      seatId: 999999,
      date,
      startTime: '10:00',
      endTime: '11:00'
    })
  } catch (err) {
    invalidSeat = err
  }
  assert(invalidSeat && invalidSeat.httpStatus === 400, 'waitlist must reject an invalid seat before insertion')

  const created = await reservationService.createReservation({
    userId: 2,
    roomId: 8,
    date,
    startTime: '11:00',
    endTime: '12:00',
    purpose: 'checkout-slot-release-' + Date.now(),
    participants: 4,
    idempotencyKey: 'checkout-slot-release-' + Date.now()
  })

  const tables = require('../server/src/config/mock-db').__tables
  if (!tables.checkins) tables.checkins = []
  const reservation = tables.reservations.find(function(row) {
    return Number(row.id) === Number(created.id)
  })
  reservation.status = 'checked_in'
  tables.checkins.push({
    id: 900000 + Number(created.id),
    reservation_id: created.id,
    user_id: 2,
    room_id: 8,
    checkin_time: new Date().toISOString(),
    checkout_time: null,
    checkin_type: 'manual',
    created_at: new Date().toISOString()
  })

  assert.strictEqual(slotsFor(tables, created.id).length, 60, 'checked-in reservation should retain its slots before checkout')

  const res = responseCapture()
  await checkinController.checkout({ body: { reservationId: created.id } }, res)

  assert.strictEqual(res.statusCode, 200, 'checkout should succeed')
  assert.strictEqual(reservation.status, 'completed', 'checkout must mark the reservation completed')
  assert.strictEqual(slotsFor(tables, created.id).length, 0, 'completed reservation must release all active slots')
  assert(tables.checkins.find(function(row) {
    return Number(row.reservation_id) === Number(created.id) && row.checkout_time
  }), 'checkout record must be updated together with the reservation')

  console.log('checkout-waitlist-consistency-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
