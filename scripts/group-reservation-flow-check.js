process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'true'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const db = require('../server/src/config/database')
const groupController = require('../server/src/controllers/groupController')
const reservationService = require('../server/src/services/reservationService')

function formatDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0')
}

function dateInDays(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return formatDate(d)
}

function makeRes() {
  return {
    statusCode: 200,
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

async function call(handler, options) {
  const res = makeRes()
  await handler({
    user: { id: options.userId, role: 'student' },
    params: options.params || {},
    body: options.body || {},
    query: options.query || {}
  }, res)
  assert(res.payload, 'controller must return a response payload')
  return res.payload
}

function expectSuccess(payload, message) {
  assert.strictEqual(payload.code, 200, message || payload.message)
  return payload.data
}

function expectError(payload, code, messagePattern) {
  assert.strictEqual(payload.code, code, payload.message)
  if (messagePattern) assert(messagePattern.test(payload.message), payload.message)
  return payload
}

async function createGroup(userId, body) {
  return expectSuccess(await call(groupController.create, { userId: userId, body: body }))
}

async function joinGroup(userId, groupId) {
  return expectSuccess(await call(groupController.join, { userId: userId, params: { id: String(groupId) } }))
}

async function submitGroup(userId, groupId) {
  return call(groupController.submitReservation, { userId: userId, params: { id: String(groupId) } })
}

async function leaveGroup(userId, groupId) {
  return call(groupController.leave, { userId: userId, params: { id: String(groupId) } })
}

function reservationCountByIdempotencyKey(key) {
  const tables = require('../server/src/config/mock-db').__tables
  return (tables.reservations || []).filter(function(row) {
    return row.idempotency_key === key
  }).length
}

function ensureExtraUsersUntil(maxId) {
  const tables = require('../server/src/config/mock-db').__tables
  for (let id = 3; id <= maxId; id++) {
    if (tables.users.some(function(user) { return Number(user.id) === id })) continue
    tables.users.push({
      id: id,
      openid: 'test_openid_group_' + id,
      session_key: 'sk_group_' + id,
      nickname: '成员' + id,
      avatar: '',
      phone: '1391000' + String(id).padStart(4, '0'),
      student_id: '202499' + String(id).padStart(4, '0'),
      student_no: '202499' + String(id).padStart(4, '0'),
      real_name: '成员' + id,
      name: '成员' + id,
      gender: '男',
      college: '敬一书院',
      major: '测试专业',
      class_name: '测试班',
      grade: '2024',
      building_id: 1,
      room_number: 'B300',
      card_no: '29' + String(id).padStart(4, '0'),
      role: 'student',
      credit_score: 100,
      status: 'active',
      restricted_until: null,
      noshow_count: 0,
      wechat_openid: null,
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00'
    })
  }
}

async function main() {
  await db.ready()
  assert.strictEqual(db.isMock(), true, 'group reservation flow check must use isolated mock data')

  const tables = require('../server/src/config/mock-db').__tables
  tables.group_members = []
  tables.reservation_groups = []
  assert(Array.isArray(tables.group_members), 'mock database must expose the canonical group_members table')

  const date = dateInDays(3)
  const prefix = 'group-flow-' + Date.now()

  const group = await createGroup(1, {
    roomId: 8,
    title: prefix + '-core',
    date: date,
    startTime: '18:00',
    endTime: '19:00',
    maxMembers: 4,
    description: 'core flow'
  })
  assert.strictEqual(group.currentMembers, 1, 'creator must be inserted as the first group member')
  assert.strictEqual(group.canSubmitReservation, false, 'one-person group must not be submittable')

  expectError(await submitGroup(1, group.id), 400, /至少2名成员|至少2人/)
  await joinGroup(2, group.id)
  expectError(await submitGroup(2, group.id), 403, /只有发起人/)

  const submitted = expectSuccess(await submitGroup(1, group.id))
  assert(submitted.reservationId || submitted.reservation_id, 'submitted group must expose a reservation id')
  assert(submitted.reservation && submitted.reservation.id, 'submit response must include the generated reservation')
  assert.strictEqual(submitted.reservation.participants, 2, 'formal reservation participants must match group member count')
  assert.strictEqual(reservationCountByIdempotencyKey('group-reservation:' + group.id), 1, 'first submit must create one idempotent reservation')

  expectError(await submitGroup(1, group.id), 409, /已提交正式预约/)
  assert.strictEqual(reservationCountByIdempotencyKey('group-reservation:' + group.id), 1, 'repeat submit must not create a second reservation')
  expectError(await leaveGroup(2, group.id), 409, /不能退出组团/)
  expectError(await leaveGroup(1, group.id), 409, /不能取消组团/)

  const earlyGroup = await createGroup(1, {
    roomId: 14,
    title: prefix + '-open-time',
    date: date,
    startTime: '07:00',
    endTime: '08:00',
    maxMembers: 2,
    description: 'open time validation'
  })
  await joinGroup(2, earlyGroup.id)
  expectError(await submitGroup(1, earlyGroup.id), 400, /开放时间|早于/)

  ensureExtraUsersUntil(14)
  const capacityGroup = await createGroup(1, {
    roomId: 6,
    title: prefix + '-capacity',
    date: date,
    startTime: '19:00',
    endTime: '20:00',
    maxMembers: 20,
    description: 'capacity validation'
  })
  for (let userId = 2; userId <= 14; userId++) {
    tables.group_members.push({
      id: 5000 + userId,
      group_id: capacityGroup.id,
      user_id: userId,
      role: 'member',
      joined_at: '2026-01-01 00:00:00'
    })
  }
  expectError(await submitGroup(1, capacityGroup.id), 400, /参与人数不能超过功能房容量/)

  await reservationService.createReservation({
    userId: 2,
    roomId: 11,
    date: date,
    startTime: '08:00',
    endTime: '09:00',
    purpose: prefix + '-daily-1',
    participants: 2,
    idempotencyKey: prefix + ':daily-1'
  })
  await reservationService.createReservation({
    userId: 2,
    roomId: 12,
    date: date,
    startTime: '09:00',
    endTime: '10:00',
    purpose: prefix + '-daily-2',
    participants: 2,
    idempotencyKey: prefix + ':daily-2'
  })
  await reservationService.createReservation({
    userId: 2,
    roomId: 13,
    date: date,
    startTime: '10:00',
    endTime: '11:00',
    purpose: prefix + '-daily-3',
    participants: 2,
    idempotencyKey: prefix + ':daily-3'
  })
  const dailyGroup = await createGroup(2, {
    roomId: 10,
    title: prefix + '-daily-limit',
    date: date,
    startTime: '18:00',
    endTime: '19:00',
    maxMembers: 2,
    description: 'daily limit validation'
  })
  await joinGroup(1, dailyGroup.id)
  expectError(await submitGroup(2, dailyGroup.id), 400, /每日最多预约3次/)

  const routeSource = fs.readFileSync(path.join(__dirname, '../server/src/routes/groups.js'), 'utf8')
  const controllerSource = fs.readFileSync(path.join(__dirname, '../server/src/controllers/groupController.js'), 'utf8')
  const commandSource = fs.readFileSync(path.join(__dirname, '../server/src/services/reservationCommandService.js'), 'utf8')
  const sqlSource = fs.readFileSync(path.join(__dirname, '../server/sql/2026-06-28-group-reservations.sql'), 'utf8')

  assert(/submit-reservation/.test(routeSource), 'group submit route must stay registered')
  assert(/reservationCommandService\.createReservation/.test(controllerSource), 'group submit must delegate to the canonical reservation command service')
  assert(/idempotencyKey:\s*'group-reservation:'\s*\+\s*groupId/.test(controllerSource), 'group submit must use a stable group idempotency key')
  assert(/participants:\s*members\.length/.test(controllerSource), 'formal reservation participants must come from group member count')
  assert(!/INSERT INTO reservations/i.test(controllerSource), 'group controller must not directly insert reservations')
  assert(/room\.open_start_time/.test(commandSource), 'canonical reservation command must enforce room opening start time')
  assert(/room\.capacity/.test(commandSource), 'canonical reservation command must enforce capacity')
  assert(/dailyRows\.length >= 3/.test(commandSource), 'canonical reservation command must enforce daily reservation limit')
  assert(/CREATE TABLE IF NOT EXISTS group_members/.test(sqlSource), 'group migration must create the canonical group_members table')

  console.log('group-reservation-flow-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
