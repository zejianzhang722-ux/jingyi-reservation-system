process.env.PORT = process.env.CHECKIN_RUNTIME_PORT || '3203'
process.env.NODE_ENV = 'test'
process.env.ENABLE_SCHEDULER = 'false'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'
process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = '1'
process.env.CHECKIN_CREDENTIAL_SECRET = 'test-only-runtime-checkin-key'

const BASE_URL = 'http://127.0.0.1:' + process.env.PORT + '/api/v1'
const db = require('../server/src/config/database')
const redis = require('../server/src/config/redis')
const helpers = require('../server/src/utils/helpers')
const appModule = require('../server/src/app')

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms) })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitForHealth() {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL + '/health')
      const json = await res.json()
      if (res.status === 200 && json.code === 200) return
    } catch (err) {}
    await wait(250)
  }
  throw new Error('test server did not become healthy')
}

async function waitForMocks() {
  const deadline = Date.now() + 7000
  while (Date.now() < deadline) {
    if (db.isMock() && redis.isMock()) return
    await wait(100)
  }
  throw new Error('isolated mock database or Redis was not ready')
}

async function api(path, options) {
  const requestOptions = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {})
  const res = await fetch(BASE_URL + path, requestOptions)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(path + ' returned non-JSON: ' + text.slice(0, 100))
  }
  return { status: res.status, json: json }
}

function expectStatus(result, status, label) {
  assert(result.status === status, label + ' expected HTTP ' + status + ', got ' + result.status)
  assert(Number(result.json.code) === status, label + ' expected body code ' + status + ', got ' + result.json.code)
}

async function loginStudent(studentNo, cardNo) {
  const result = await api('/auth/login/student', {
    method: 'POST',
    body: JSON.stringify({ studentNo: studentNo, cardNo: cardNo })
  })
  expectStatus(result, 200, 'student login')
  return result.json.data
}

async function loginAdmin() {
  const result = await api('/auth/login/admin-miniapp', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })
  expectStatus(result, 200, 'admin login')
  return result.json.data
}

function authHeaders(token) {
  return { Authorization: 'Bearer ' + token }
}

function jsonAuthHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
}

async function main() {
  await db.ready()
  await waitForHealth()
  await waitForMocks()

  const now = new Date()
  const today = helpers.formatDate(now)
  const startTime = helpers.formatTime(now)
  const currentMinutes = helpers.timeToMinutes(startTime)
  const endTime = helpers.minutesToTime(Math.min(23 * 60 + 59, currentMinutes + 60))

  await db.query(
    "UPDATE reservations SET date = ?, start_time = ?, end_time = ?, status = 'approved' WHERE id = ?",
    [today, startTime, endTime, 1]
  )
  await db.query('DELETE FROM checkins WHERE reservation_id = ?', [1])

  const owner = await loginStudent('2024001001', '200001')
  const otherStudent = await loginStudent('2024001002', '200002')
  const admin = await loginAdmin()

  expectStatus(await api('/reservation/1/qrcode', {
    headers: authHeaders(otherStudent.token)
  }), 403, 'other student credential access')

  expectStatus(await api('/reservation/7/qrcode', {
    headers: authHeaders(otherStudent.token)
  }), 400, 'pending reservation credential issue')

  const first = await api('/reservation/1/qrcode', { headers: authHeaders(owner.token) })
  expectStatus(first, 200, 'first credential issue')
  assert(/^data:image\/png;base64,/.test(first.json.data.qrcode), 'QR endpoint must return an image')
  assert(/^JY1\./.test(first.json.data.credential), 'QR endpoint must return a signed JY1 credential')
  assert(first.json.data.expiresIn >= 30 && first.json.data.expiresIn <= 90, 'QR TTL must be short-lived')

  const second = await api('/reservation/1/qrcode', { headers: authHeaders(owner.token) })
  expectStatus(second, 200, 'second credential issue')
  assert(second.json.data.credential !== first.json.data.credential, 'refresh must rotate the credential')

  const validCredential = second.json.data.credential
  expectStatus(await api('/checkin', {
    method: 'POST',
    headers: jsonAuthHeaders(owner.token),
    body: JSON.stringify({ reservationId: 1, credential: validCredential })
  }), 403, 'student cannot self-consume displayed credential')

  expectStatus(await api('/checkin', {
    method: 'POST',
    headers: jsonAuthHeaders(admin.token),
    body: JSON.stringify({ reservationId: 1 })
  }), 400, 'credential-free administrator check-in')

  expectStatus(await api('/checkin', {
    method: 'POST',
    headers: jsonAuthHeaders(admin.token),
    body: JSON.stringify({ reservationId: 1, code: 'JYTEST001' })
  }), 400, 'legacy static reservation code')

  expectStatus(await api('/checkin', {
    method: 'POST',
    headers: jsonAuthHeaders(admin.token),
    body: JSON.stringify({ reservationId: 1, credential: first.json.data.credential })
  }), 409, 'credential invalidated by refresh')

  const tampered = validCredential.slice(0, -1) + (validCredential.endsWith('A') ? 'B' : 'A')
  expectStatus(await api('/checkin', {
    method: 'POST',
    headers: jsonAuthHeaders(admin.token),
    body: JSON.stringify({ reservationId: 1, credential: tampered })
  }), 403, 'tampered credential')

  expectStatus(await api('/checkin', {
    method: 'POST',
    headers: jsonAuthHeaders(admin.token),
    body: JSON.stringify({ reservationId: 1, credential: validCredential })
  }), 200, 'valid administrator scan check-in')

  const current = await api('/checkin/current/1', { headers: authHeaders(admin.token) })
  expectStatus(current, 200, 'current room check-ins')
  const ownerCheckin = (current.json.data || []).find(function(item) {
    return Number(item.reservation_id) === 1
  })
  assert(ownerCheckin && Number(ownerCheckin.user_id) === 1, 'administrator scan must check in the reservation owner')

  expectStatus(await api('/checkin', {
    method: 'POST',
    headers: jsonAuthHeaders(admin.token),
    body: JSON.stringify({ reservationId: 1, credential: validCredential })
  }), 409, 'credential replay after successful check-in')

  expectStatus(await api('/reservation/1/qrcode', {
    headers: authHeaders(owner.token)
  }), 409, 'credential issue after check-in')

  console.log('checkin-credential-runtime-check passed')
}

main().then(function() {
  appModule.server.close(function() { process.exit(0) })
  setTimeout(function() { process.exit(0) }, 1000)
}).catch(function(err) {
  console.error(err.message)
  try { appModule.server.close() } catch (closeErr) {}
  process.exit(1)
})
