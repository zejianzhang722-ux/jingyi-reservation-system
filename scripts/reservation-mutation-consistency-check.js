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
  assert.strictEqual(db.isConnectionFailure({ code: 'ER_DUP_ENTRY', errno: 1062 }), false, 'constraint errors must not trigger mock fallback')
  assert.strictEqual(db.isConnectionFailure({ code: 'ER_PARSE_ERROR', errno: 1064 }), false, 'SQL syntax errors must not trigger mock fallback')
  assert.strictEqual(db.isConnectionFailure({ code: 'ECONNREFUSED', syscall: 'connect', fatal: true }), true, 'connection refusal should allow non-production fallback')

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

  let invalidTime = null
  try {
    await mutationService.updateReservation({
      reservationId: first.id,
      actor: { id: 1, role: 'student' },
      startTime: '24:00',
      endTime: '25:00'
    })
  } catch (err) {
    invalidTime = err
  }
  assert(invalidTime && invalidTime.httpStatus === 400, 'invalid edited time must return 400')

  let blankPurpose = null
  try {
    await mutationService.updateReservation({
      reservationId: first.id,
      actor: { id: 1, role: 'student' },
      purpose: ''
    })
  } catch (err) {
    blankPurpose = err
  }
  assert(blankPurpose && blankPurpose.httpStatus === 400, 'seminar room purpose must remain required after edits')

  const preservedSlots = slotsFor(first.id)
  assert.strictEqual(preservedSlots.length, 60, 'failed edits must preserve original slots')
  assert.strictEqual(Math.min.apply(null, preservedSlots.map(function(slot) { return Number(slot.slot_minute) })), 19 * 60, 'failed edits must not partially change slot state')

  const studyReservation = await reservationService.createReservation({
    userId: 1,
    roomId: 1,
    seatId: 1,
    date,
    startTime: '15:00',
    endTime: '16:00',
    participants: 1,
    idempotencyKey: prefix + ':study-seat'
  })
  const originalStudySlots = slotsFor(studyReservation.id)
  assert.strictEqual(originalStudySlots.length, 60, 'study-room reservation must own its selected seat slots')

  let removedSeat = null
  try {
    await mutationService.updateReservation({
      reservationId: studyReservation.id,
      actor: { id: 1, role: 'student' },
      seatId: null
    })
  } catch (err) {
    removedSeat = err
  }
  assert(removedSeat && removedSeat.code === 'SEAT_REQUIRED', 'study-room edit must not clear the required seat')
  assert.strictEqual(slotsFor(studyReservation.id).length, 60, 'rejected seat removal must preserve original study-room slots')

  const routeSource = fs.readFileSync(path.join(__dirname, '../server/src/routes/reservation.js'), 'utf8')
  const controllerSource = fs.readFileSync(path.join(__dirname, '../server/src/controllers/reservationController.js'), 'utf8')
  const serviceSource = fs.readFileSync(path.join(__dirname, '../server/src/services/reservationService.js'), 'utf8')
  const commandSource = fs.readFileSync(path.join(__dirname, '../server/src/services/reservationCommandService.js'), 'utf8')
  const schemaSource = fs.readFileSync(path.join(__dirname, '../server/sql/schema.sql'), 'utf8')

  assert(/reservationMutationController\.update/.test(routeSource), 'update route must use slot-safe mutation controller')
  assert(/reservationMutationController\.rebook/.test(routeSource), 'rebook route must use transactional create flow')
  assert(/reservationLifecycleController\.cancel/.test(routeSource), 'cancel route must use atomic lifecycle controller')
  assert(!/INSERT INTO reservations/i.test(controllerSource), 'read controller must not contain direct reservation inserts')
  assert(!/UPDATE reservations SET/i.test(controllerSource), 'read controller must not contain direct reservation mutations')
  assert(!/releaseReservationAndPromoteWaitlist/.test(controllerSource), 'obsolete lifecycle bypass must not return to the read controller')
  assert(/duplicateWaitlist/.test(controllerSource) && /ER_DUP_ENTRY/.test(controllerSource), 'waitlist duplicate races must return a normalized conflict response')
  assert(/affectedRows === 0/.test(controllerSource), 'leaving an already processed waitlist entry must not report false success')
  assert(/require\('\.\/reservationCommandService'\)\.createReservation/.test(serviceSource), 'legacy service entry point must delegate MySQL writes to command service')
  assert(!/const createReservationInMysql/.test(serviceSource), 'reservation service must not keep a second MySQL writer')
  assert(/MAX_IDEMPOTENCY_KEY_LENGTH = 128/.test(commandSource), 'command service must enforce the database idempotency key width')
  assert(/SEAT_REQUIRED_TYPES/.test(commandSource), 'command service must enforce study-room seat selection')
  assert(!/status IN \('approved','pending','counselor_pending','checked_in'\) FOR UPDATE/.test(commandSource), 'daily limit read must not reintroduce reverse reservation-row locking')
  assert(/waiting_seat_scope INT GENERATED ALWAYS AS/.test(schemaSource), 'canonical schema must contain the active-waitlist generated scope')
  assert(/UNIQUE KEY uk_waitlist_user_slot/.test(schemaSource), 'canonical schema must enforce one active waitlist entry per user slot')

  console.log('reservation-mutation-consistency-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
