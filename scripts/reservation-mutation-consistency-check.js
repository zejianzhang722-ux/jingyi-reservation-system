process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'true'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const db = require('../server/src/config/database')
const reservationService = require('../server/src/services/reservationService')
const mutationService = require('../server/src/services/reservationMutationService')

function formatDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0')
}

function slotsFor(reservationId) {
  const tables = require('../server/src/config/mock-db').__tables
  return (tables.reservation_slots || []).filter(function(slot) {
    return Number(slot.reservation_id) === Number(reservationId)
  })
}

async function main() {
  await db.ready()
  assert.strictEqual(db.isMock(), true, 'mutation regression must use isolated mock data')

  const target = new Date()
  target.setDate(target.getDate() + 3)
  const date = formatDate(target)
  const prefix = 'mutation-consistency-' + Date.now()

  const first = await reservationService.createReservation({
    userId: 1,
    roomId: 8,
    date,
    startTime: '18:00',
    endTime: '19:00',
    purpose: prefix + ':first',
    participants: 4,
    idempotencyKey: prefix + ':first'
  })

  await mutationService.updateReservation({
    reservationId: first.id,
    actor: { id: 1, role: 'student' },
    startTime: '19:00',
    endTime: '20:00',
    purpose: prefix + ':updated'
  })

  const updatedSlots = slotsFor(first.id)
  assert.strictEqual(updatedSlots.length, 60, 'edited reservation must keep exactly 60 slots')
  assert.strictEqual(Math.min.apply(null, updatedSlots.map(function(slot) { return Number(slot.slot_minute) })), 19 * 60, 'old slots must be replaced by new slots')

  const second = await reservationService.createReservation({
    userId: 2,
    roomId: 8,
    date,
    startTime: '18:00',
    endTime: '19:00',
    purpose: prefix + ':released-window',
    participants: 4,
    idempotencyKey: prefix + ':second'
  })
  assert(second && second.id, 'time released by edit must be reservable')

  let conflict = null
  try {
    await mutationService.updateReservation({
      reservationId: first.id,
      actor: { id: 1, role: 'student' },
      startTime: '18:30',
      endTime: '19:30'
    })
  } catch (err) {
    conflict = err
  }
  assert(conflict && conflict.httpStatus === 409, 'conflicting edit must return 409')
  const preservedSlots = slotsFor(first.id)
  assert.strictEqual(preservedSlots.length, 60, 'failed edit must preserve original slots')
  assert.strictEqual(Math.min.apply(null, preservedSlots.map(function(slot) { return Number(slot.slot_minute) })), 19 * 60, 'failed edit must not partially change slot state')

  const routeSource = fs.readFileSync(path.join(__dirname, '../server/src/routes/reservation.js'), 'utf8')
  assert(/reservationMutationController\.update/.test(routeSource), 'update route must use slot-safe mutation controller')
  assert(/reservationMutationController\.rebook/.test(routeSource), 'rebook route must use transactional create flow')

  console.log('reservation-mutation-consistency-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
