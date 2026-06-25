process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'true'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const realtimeEventService = require('../server/src/services/realtimeEventService')

function fakeDb(options) {
  const settings = options || {}
  return {
    query: async function(sql) {
      if (sql.includes('FROM rooms WHERE id')) {
        return [[{
          id: 8,
          name: '研讨室',
          building_id: 2,
          status: settings.roomStatus || 'open',
          capacity: 12
        }]]
      }
      if (sql.includes('FROM checkins')) {
        return [settings.checkedIn === false ? [] : [{
          reservation_id: 31,
          user_id: 9,
          checkin_time: '2026-06-25 10:00:00',
          real_name: '测试用户',
          nickname: '昵称'
        }]]
      }
      if (sql.includes('FROM reservations')) {
        return [settings.reserved === false ? [] : [{
          id: 31,
          user_id: 9,
          start_time: '10:00',
          end_time: '11:00',
          status: 'checked_in'
        }]]
      }
      return [[]]
    }
  }
}

function fakeIo() {
  const emitted = []
  return {
    emitted,
    to: function(room) {
      return {
        emit: function(event, payload) {
          emitted.push({ room, event, payload })
        }
      }
    }
  }
}

async function main() {
  const usingPayload = await realtimeEventService.loadRoomStatus(8, { dbClient: fakeDb() })
  assert.strictEqual(usingPayload.status, 'using', 'active check-in must produce using status')
  assert.strictEqual(usingPayload.currentUser, '测试用户', 'administrator payload may contain the current room user display name')
  assert.strictEqual(usingPayload.buildingId, 2, 'payload must contain building scope')
  assert.strictEqual(usingPayload.userId, undefined, 'payload must not expose a raw user id')
  assert.strictEqual(usingPayload.studentId, undefined, 'payload must not expose student identifiers')
  assert.strictEqual(usingPayload.phone, undefined, 'payload must not expose phone numbers')

  const reservedPayload = await realtimeEventService.loadRoomStatus(8, {
    dbClient: fakeDb({ checkedIn: false })
  })
  assert.strictEqual(reservedPayload.status, 'reserved', 'current approved reservation without check-in must produce reserved status')
  assert.strictEqual(reservedPayload.currentUser, '', 'reserved status must not expose a user name before check-in')

  const closedPayload = await realtimeEventService.loadRoomStatus(8, {
    dbClient: fakeDb({ roomStatus: 'maintenance', checkedIn: false, reserved: false })
  })
  assert.strictEqual(closedPayload.status, 'maintenance', 'room administrative state must override calculated occupancy')

  const io = fakeIo()
  const emitted = realtimeEventService.emitRoomStatus(io, usingPayload)
  assert.strictEqual(emitted.emitted, true, 'room status must be emitted when Socket.IO is configured')
  assert.deepStrictEqual(
    emitted.rooms.sort(),
    ['building:2', 'monitor:all', 'room:8'].sort(),
    'room status must target global, building, and room scopes'
  )
  assert.strictEqual(io.emitted.length, 3, 'one event must be emitted to every authorized scope')
  assert(io.emitted.every(function(item) { return item.event === 'room-status-update' }), 'all broadcasts must use the expected event name')

  realtimeEventService.setIO(io)
  const published = await realtimeEventService.publishRoomStatus(8, { dbClient: fakeDb() })
  assert.strictEqual(published.emitted, true, 'configured publisher must load and emit the latest room state')

  const files = {
    app: fs.readFileSync(path.join(__dirname, '../server/src/app.js'), 'utf8'),
    create: fs.readFileSync(path.join(__dirname, '../server/src/controllers/reservationCreateController.js'), 'utf8'),
    mutation: fs.readFileSync(path.join(__dirname, '../server/src/controllers/reservationMutationController.js'), 'utf8'),
    approval: fs.readFileSync(path.join(__dirname, '../server/src/controllers/reservationApprovalController.js'), 'utf8'),
    checkin: fs.readFileSync(path.join(__dirname, '../server/src/controllers/checkinController.js'), 'utf8'),
    lifecycle: fs.readFileSync(path.join(__dirname, '../server/src/services/reservationLifecycleService.js'), 'utf8')
  }

  assert(/realtimeEventService\.setIO\(io\)/.test(files.app), 'server must register Socket.IO with the realtime publisher')
  assert(/reservation-created/.test(files.create), 'reservation creation must publish after commit')
  assert(/reservation-updated/.test(files.mutation) && /reservation-rebooked/.test(files.mutation), 'reservation mutation paths must publish after successful writes')
  assert(/reservation-approved/.test(files.approval), 'approval must publish after the status update')
  assert(/qrcode-checkin/.test(files.checkin) && /manual-checkin/.test(files.checkin) && /checkout/.test(files.checkin), 'check-in and checkout paths must publish after commit')
  assert(/reservation-lifecycle-committed/.test(files.lifecycle), 'cancellation, rejection, and no-show lifecycle must publish after commit')

  console.log('realtime-event-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
