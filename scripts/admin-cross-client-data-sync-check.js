const config = require('../server/src/config')

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000/api/v1'
const PURPOSE_PREFIX = 'admin-cross-client-data-sync:'
const purpose = PURPOSE_PREFIX + Date.now() + '-' + process.pid
let studentToken = ''
let reservationId = null
let superToken = ''
let temporaryRoomId = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function api(path, options) {
  const response = await fetch(BASE_URL + path, options || {})
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(path + ' did not return JSON: ' + text.slice(0, 120))
  }
  return { status: response.status, json: json }
}

function authHeaders(token, json) {
  return Object.assign(
    { Authorization: 'Bearer ' + token },
    json ? { 'Content-Type': 'application/json' } : {}
  )
}

function localDatePlus(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

function listData(response) {
  const data = response.json && response.json.data
  return (data && data.list) || data || []
}

async function cleanup(token) {
  const response = await api('/reservation?page=1&pageSize=100', {
    headers: authHeaders(token)
  })
  if (response.json.code !== 200) return
  const active = ['approved', 'pending', 'counselor_pending']
  for (const item of listData(response)) {
    if (active.includes(item.status) && String(item.purpose || '').startsWith(PURPOSE_PREFIX)) {
      await api('/reservation/' + item.id, {
        method: 'DELETE',
        headers: authHeaders(token)
      })
    }
  }
}

function candidateSlots(room) {
  const slots = [
    ['08:00', '09:00'], ['09:00', '10:00'], ['10:00', '11:00'],
    ['14:00', '15:00'], ['15:00', '16:00'], ['16:00', '17:00'],
    ['19:00', '20:00'], ['20:00', '21:00']
  ]
  const open = String(room.open_start_time || '08:00').slice(0, 5)
  const close = String(room.open_end_time || '23:00').slice(0, 5)
  return slots.filter(function(slot) { return slot[0] >= open && slot[1] <= close })
}

async function createTemporaryOrdinaryRoom() {
  const existing = await api('/admin/rooms?page=1&pageSize=100', { headers: authHeaders(superToken) })
  const reusable = existing.json.code === 200
    ? listData(existing).find(function(room) { return String(room.name || '').startsWith(PURPOSE_PREFIX) })
    : null
  if (reusable) {
    temporaryRoomId = Number(reusable.id)
  } else {
    const created = await api('/admin/rooms', {
      method: 'POST',
      headers: authHeaders(superToken, true),
      body: JSON.stringify({
        name: purpose,
        type: 'seminar_room',
        buildingId: 1,
        floor: 1,
        location: 'acceptance-test-only',
        capacity: 12,
        openStartTime: '08:00',
        openEndTime: '22:00',
        maxDuration: 120,
        needAudit: true,
        needCounselorAudit: false,
        description: purpose
      })
    })
    assert(created.json.code === 200 && created.json.data && created.json.data.id, 'temporary ordinary approval room creation failed')
    temporaryRoomId = Number(created.json.data.id)
  }
  // The mock SQL adapter preserves inserted zeroes as strings. Normalize the
  // counselor flag through the public update API so ordinary approval stays
  // distinguishable from counselor approval without changing an existing room.
  const normalized = await api('/admin/rooms/' + temporaryRoomId, {
    method: 'PUT',
    headers: authHeaders(superToken, true),
    body: JSON.stringify({
      name: purpose,
      type: 'seminar_room',
      buildingId: 1,
      floor: 1,
      location: 'acceptance-test-only',
      capacity: 12,
      openStartTime: '08:00',
      openEndTime: '22:00',
      maxDuration: 120,
      needAudit: true,
      needCounselorAudit: null,
      description: purpose,
      status: 'open'
    })
  })
  assert(normalized.json.code === 200, 'temporary room counselor flag normalization failed')
}

async function cleanupTemporaryRooms() {
  if (!superToken) return
  const roomsResponse = await api('/admin/rooms?page=1&pageSize=100', {
    headers: authHeaders(superToken)
  })
  if (roomsResponse.json.code !== 200) return
  for (const room of listData(roomsResponse)) {
    if (String(room.name || '').startsWith(PURPOSE_PREFIX) && room.status !== 'closed') {
      await api('/admin/rooms/' + room.id, {
        method: 'DELETE',
        headers: authHeaders(superToken)
      })
    }
  }
}

async function findOrdinaryApprovalSlot(token) {
  const roomsResponse = await api('/room', { headers: authHeaders(token) })
  assert(roomsResponse.json.code === 200 && Array.isArray(roomsResponse.json.data), 'room list is unavailable')
  const rooms = roomsResponse.json.data.filter(function(room) {
    return Number(room.need_audit) === 1 && Number(room.need_counselor_audit) !== 1 && room.status === 'open' && Number(room.max_duration) > 0
  }).sort(function(a, b) {
    return (a.type === 'study_room') - (b.type === 'study_room')
  })
  if (rooms.length === 0) {
    await createTemporaryOrdinaryRoom()
    const temporaryResponse = await api('/room/' + temporaryRoomId, { headers: authHeaders(token) })
    assert(temporaryResponse.json.code === 200, 'temporary ordinary approval room is unavailable')
    rooms.push(temporaryResponse.json.data)
  }

  const maxDays = Math.max(1, Math.min(Number(config.reservation.advanceDays || 3), 7))
  for (const room of rooms) {
    for (let day = 1; day <= maxDays; day++) {
      const date = localDatePlus(day)
      for (const slot of candidateSlots(room)) {
        const conflict = await api('/reservation/check-conflict', {
          method: 'POST',
          headers: authHeaders(token, true),
          body: JSON.stringify({ roomId: room.id, date: date, startTime: slot[0], endTime: slot[1] })
        })
        if (conflict.json.code === 200 && conflict.json.data && !conflict.json.data.hasConflict) {
          return { room: room, date: date, startTime: slot[0], endTime: slot[1] }
        }
      }
    }
  }
  throw new Error('no conflict-free ordinary approval room slot was found')
}

async function main() {
  const readiness = await api('/ready')
  const databaseMode = readiness.json && readiness.json.data && readiness.json.data.details && readiness.json.data.details.data && readiness.json.data.details.data.database && readiness.json.data.details.data.database.mode
  assert(readiness.json.code === 200 && databaseMode === 'mock', 'data sync check is restricted to an explicitly reported mock database')

  const superLogin = await api('/auth/login/admin-miniapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'superadmin', password: 'super123' })
  })
  assert(superLogin.json.code === 200 && superLogin.json.data.token, 'super administrator login failed')
  superToken = superLogin.json.data.token

  const studentLogin = await api('/auth/login/student', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentNo: '2024001002', cardNo: '200002' })
  })
  assert(studentLogin.json.code === 200 && studentLogin.json.data.token, 'student login failed')
  studentToken = studentLogin.json.data.token
  await cleanup(studentToken)
  await cleanupTemporaryRooms()

  const slot = await findOrdinaryApprovalSlot(studentToken)
  const created = await api('/reservation', {
    method: 'POST',
    headers: Object.assign(authHeaders(studentToken, true), { 'Idempotency-Key': purpose }),
    body: JSON.stringify({
      roomId: slot.room.id,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      purpose: purpose,
      participants: 1
    })
  })
  assert(created.json.code === 200 && created.json.data, 'reservation creation failed')
  reservationId = Number(created.json.data.id)
  assert(created.json.data.status === 'pending', 'ordinary approval reservation was not created as pending')

  const guideLogin = await api('/auth/login/admin-miniapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'building_admin', password: 'admin123' })
  })
  assert(guideLogin.json.code === 200 && guideLogin.json.data.token, 'guide administrator login failed')
  const guideToken = guideLogin.json.data.token

  const pendingBefore = await api('/audit/pending?type=admin&page=1&pageSize=100', {
    headers: authHeaders(guideToken)
  })
  assert(pendingBefore.json.code === 200, 'ordinary approval queue is unavailable')
  assert(listData(pendingBefore).some(function(item) { return Number(item.id) === reservationId }), 'created reservation is missing from guide pending queue')

  const countBeforeResponse = await api('/reservation/pending-count?type=admin', {
    headers: authHeaders(guideToken)
  })
  assert(countBeforeResponse.json.code === 200, 'ordinary approval pending count is unavailable')
  const countBefore = Number(countBeforeResponse.json.data.count)

  const approved = await api('/audit/' + reservationId + '/approve', {
    method: 'POST',
    headers: authHeaders(guideToken, true),
    body: JSON.stringify({})
  })
  assert(approved.json.code === 200, 'guide administrator failed to approve the reservation')

  const detail = await api('/reservation/' + reservationId, { headers: authHeaders(studentToken) })
  assert(detail.json.code === 200 && detail.json.data.status === 'approved', 'student detail did not update to approved')

  const pendingAfter = await api('/audit/pending?type=admin&page=1&pageSize=100', {
    headers: authHeaders(guideToken)
  })
  assert(pendingAfter.json.code === 200, 'ordinary approval queue failed after approval')
  assert(!listData(pendingAfter).some(function(item) { return Number(item.id) === reservationId }), 'approved reservation remains in guide pending queue')

  const countAfterResponse = await api('/reservation/pending-count?type=admin', {
    headers: authHeaders(guideToken)
  })
  assert(countAfterResponse.json.code === 200, 'ordinary approval pending count failed after approval')
  const countAfter = Number(countAfterResponse.json.data.count)
  assert(countAfter === countBefore - 1, 'ordinary pending count must decrease by exactly one (before=' + countBefore + ', after=' + countAfter + ')')

  console.log('admin cross-client data sync passed: pending -> approved -> removed from queue; count ' + countBefore + ' -> ' + countAfter)
}

main().catch(function(err) {
  console.error('admin cross-client data sync failed:', err.message)
  process.exitCode = 1
}).finally(async function() {
  if (studentToken) {
    try {
      await cleanup(studentToken)
    } catch (err) {
      console.error('admin cross-client data sync cleanup warning:', err.message)
      process.exitCode = process.exitCode || 1
    }
  }
  if (superToken) {
    try {
      await cleanupTemporaryRooms()
    } catch (err) {
      console.error('temporary room cleanup warning:', err.message)
      process.exitCode = process.exitCode || 1
    }
  }
})
