process.env.PORT = '3294'
process.env.NODE_ENV = 'test'
process.env.ENABLE_SCHEDULER = 'false'
process.env.MYSQL_PORT = '1'
process.env.REDIS_PORT = '1'
process.env.CHECKIN_CREDENTIAL_SECRET = 'isolated-dorm-verification-secret'
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict')
process.env.MOCK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-dorm-check-'))
const db = require('../server/src/config/database')
const redis = require('../server/src/config/redis')
const app = require('../server/src/app')
const credentials = require('../server/src/services/checkinCredentialService')
const helpers = require('../server/src/utils/helpers')
const BASE = 'http://127.0.0.1:3294/api/v1'
async function api(route, token, body) {
  const response = await fetch(BASE + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, ...(await response.json()) }
}
async function login(name) { const r = await api('/auth/login/admin-miniapp', null, { username: name, password: 'admin123' }); assert.equal(r.status, 200, JSON.stringify(r)); return r.data.token }
let sequence = 0
const key = () => 'runtime_request_' + (++sequence)
async function main() {
  await db.ready()
  for (let i = 0; i < 100 && (!db.isMock() || !redis.isMock()); i++) await new Promise(r => setTimeout(r, 100))
  const t = require('../server/src/config/mock-db').__tables
  const now = new Date(), date = helpers.formatDate(now), start = helpers.formatTime(now), end = helpers.minutesToTime(Math.min(1439, helpers.timeToMinutes(start) + 60))
  const base = t.reservations.find(r => r.id === 1)
  Object.assign(base, { date, start_time: start, end_time: end, status: 'approved', user_id: 1 })
  t.rooms.find(r => r.id === base.room_id).status = 'open'
  t.rooms.find(r => r.id === base.room_id).building_id = 1
  t.checkins.splice(0, t.checkins.length)
  const b = await login('dorm_b'), c = await login('dorm_c'), upper = await login('admin')
  assert.equal((await api('/verification/me', b)).data.role, 'dorm_manager')
  assert.equal((await api('/verification/me', b)).data.buildingName, 'B座')
  assert.equal((await api('/verification/me', c)).data.buildingName, 'C座')
  const initialSpaces = await api('/verification/spaces', b)
  assert.equal(initialSpaces.status, 200, 'dorm needs current room usage monitor')
  assert(initialSpaces.data.list.every(room => room.buildingId === 1))
  const overview = await api('/verification/reservations?date=' + date + '&buildingId=2', b)
  assert.equal(overview.status, 200, 'dorm needs a scoped reservation overview')
  assert(overview.data.list.some(r => r.id === 1), 'show own building reservation')
  assert(overview.data.list.every(r => r.buildingId === 1), 'client filters must not override assigned building')
  assert.equal(overview.data.list.find(r => r.id === 1).studentId, '20****01')
  assert.equal(overview.data.list.find(r => r.id === 1).phone, undefined)
  assert(overview.data.summary.total >= 1)
  assert.equal((await api('/verification/reservations?date=bad-date', b)).status, 400)
  assert.equal((await api('/verification/reservations?date=' + date + '&q=no_such_resident_99393', b)).data.total, 0)
  assert.equal((await api('/verification/reservations?date=' + date, c)).data.list.some(r => r.id === 1), false)
  for (const route of ['/reservation', '/admin/accounts', '/stats/dashboard', '/user/profile']) assert.equal((await api(route, b)).status, 403, route)
  const student = await api('/auth/login/student', null, { studentNo: '2024001001', cardNo: '200001' })
  assert.equal(student.status, 200)
  const code = (await credentials.issue(base)).credential
  const cross = await api('/verification/preview', c, { requestId: key(), credential: code })
  assert.equal(cross.data.reasonCode, 'OUT_OF_SCOPE'); assert.equal(cross.data.reservation, undefined)
  assert.equal((await api('/verification/preview', student.data.token, { requestId: key(), credential: code })).status, 403)
  const preview = await api('/verification/preview', b, { requestId: key(), credential: code })
  assert.equal(preview.data.outcome, 'ready', JSON.stringify(preview)); assert.equal(base.status, 'approved')
  assert.equal((await api('/verification/confirm', b, { requestId: key(), credential: code, decision: 'pass' })).status, 400)
  const exception = await api('/verification/confirm', b, { requestId: key(), credential: code, decision: 'exception', note: '身份不符' })
  assert.equal(exception.data.outcome, 'exception'); assert.equal(base.status, 'approved'); assert.equal(t.checkins.length, 0)
  assert.equal((await api('/verification/records/' + exception.data.eventId + '/resolve', b, { note: '已经处理' })).status, 403)
  assert.equal((await api('/verification/records/' + exception.data.eventId + '/resolve', upper, { note: '已联系预约人核对' })).status, 200)
  const body = { requestId: key(), credential: code, decision: 'pass', identityConfirmed: true }
  const results = await Promise.all([api('/verification/confirm', b, body), api('/verification/confirm', b, body)])
  assert(results.every(r => r.data.outcome === 'passed'), JSON.stringify(results)); assert(results.some(r => r.data.replayed))
  assert.equal(base.status, 'checked_in'); assert.equal(t.checkins.length, 1); assert.equal(t.checkins[0].user_id, 1)
  const monitored = await api('/verification/spaces', b)
  const usedRoom = monitored.data.list.find(room => room.id === base.room_id)
  assert.equal(usedRoom.state, 'in_use')
  assert(usedRoom.current.some(r => r.id === base.id && r.participants > 0 && r.buildingName === 'B座'))
  assert.equal(results[0].data.reservation.buildingName, 'B座')
  assert.ok(results[0].data.reservation.location)
  const duplicate = await api('/verification/confirm', b, { ...body, requestId: key() })
  assert.equal(duplicate.data.outcome, 'duplicate'); assert.equal(t.checkins.length, 1)
  const state = await api('/verification/status/1', student.data.token)
  assert.equal(state.data.checkedIn, true); assert.equal(state.data.reservationStatus, 'checked_in')
  const records = await api('/verification/records', b)
  assert(records.data.list.every(r => r.buildingId === 1)); assert.equal(records.data.list.filter(r => r.outcome === 'passed').length, 1)
  const bad = await api('/verification/preview', b, { requestId: key(), credential: 'broken-qr-code' })
  assert.equal(bad.data.outcome, 'rejected')
  const second = { ...base, id: 9901, status: 'approved' }; t.reservations.push(second)
  const fresh = (await credentials.issue(second)).credential
  const original = fs.writeFileSync
  fs.writeFileSync = function (target, ...args) { if (String(target).endsWith('mock-verification-state.json.tmp')) throw new Error('simulated disk error'); return original.call(fs, target, ...args) }
  try {
    const failed = await api('/verification/confirm', b, { ...body, requestId: key(), credential: fresh })
    assert.equal(failed.status, 503); assert.equal(second.status, 'approved'); assert.equal(t.checkins.length, 1)
  } finally { fs.writeFileSync = original }
  t.admins.find(a => a.username === 'dorm_b').status = 'disabled'
  assert.equal((await api('/verification/me', b)).status, 403)
  const durable = JSON.parse(fs.readFileSync(path.join(process.env.MOCK_DATA_DIR, 'mock-verification-state.json'), 'utf8'))
  assert.equal(durable.successes.length, 1); assert.equal(durable.checkins.length, 1)
  console.log('PASS: dorm scan = check-in, identity confirmation, concurrent retry, deduplication, scope isolation, student sync, exception follow-up, disk failure rollback, disabled account, durable records')
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { await app.shutdown('dorm-runtime-check'); process.exit(process.exitCode || 0) })
