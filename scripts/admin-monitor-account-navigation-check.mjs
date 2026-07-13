import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { buildTimelineView, createLatestRequestGate, createTimelineRequestCoordinator } from '../admin/src/utils/roomTimeline.js'

const timelineView = buildTimelineView({
  openStartTime: '08:00',
  openEndTime: '22:30',
  timeline: [
    { time: '08:00', endTime: '08:30', status: 'available' },
    { time: '08:30', endTime: '09:00', status: 'occupied', userName: '张三', purpose: '课题讨论', reservationId: 18 },
    { time: '09:00', endTime: '09:30', status: 'myReservation', reservationId: 19 },
    { time: '09:30', endTime: '10:00', status: 'checked_in', reservationId: 20 },
    { time: '10:00', endTime: '10:30', status: 'unavailable' },
    { time: '10:30', endTime: '11:00', status: 'unexpected' }
  ]
})

assert.deepEqual(timelineView.summary, { total: 6, reservationCount: 3, busySlotCount: 3, reservationCountReliable: true, isAllAvailable: false })
assert.deepEqual(timelineView.slots.map(slot => slot.label), ['空闲', '已预约', '使用中', '使用中', '维护', '状态未知'])
assert.equal(timelineView.slots[1].purpose, '课题讨论')
assert.equal(timelineView.slots[1].userName, '张三')
assert.equal(timelineView.slots[1].reservationId, 18)
assert.equal(timelineView.openStartTime, '08:00')
assert.equal(timelineView.openEndTime, '22:30')
assert.equal(timelineView.message, '')

const allAvailableView = buildTimelineView({
  open_start_time: '07:30',
  open_end_time: '21:00',
  slots: [
    { time: '07:30', endTime: '08:00', status: 'available' },
    { time: '08:00', endTime: '08:30', status: 'available' }
  ]
})
assert.equal(allAvailableView.message, '今日暂无预约，当前时段均可使用')
assert.equal(allAvailableView.slots.length, 2)
assert.equal(allAvailableView.openStartTime, '07:30')
assert.equal(allAvailableView.openEndTime, '21:00')

const monitorSource = readFileSync(new URL('../admin/src/views/Room/Monitor.vue', import.meta.url), 'utf8')
const monitorTemplate = monitorSource.match(/<template>[\s\S]*?<\/template>/)?.[0] || ''
assert.match(monitorSource, /timelineView\.message/)
assert.match(monitorSource, /timelineError/)
assert.match(monitorSource, /retryTimeline/)
assert.match(monitorSource, /\u91cd\u8bd5/)
assert.match(monitorSource, /createTimelineRequestCoordinator/)
assert.match(monitorSource, /timelineRequestCoordinator\.run/)
assert.match(monitorSource, /timelineRequestCoordinator\.invalidate/)
assert.doesNotMatch(monitorTemplate, /WebSocket|Token|\u4ee4\u724c/i)

const accountSource = readFileSync(new URL('../admin/src/views/Account/Index.vue', import.meta.url), 'utf8')
const accountTemplate = accountSource.split('<script setup>')[0] || ''
assert.match(accountSource, /accountType:\s*activeTab\.value === 'manager' \? 'manager' : 'student'/)
assert.doesNotMatch(accountTemplate, /label="\u8d26\u53f7ID"|prop="id"/)
assert.doesNotMatch(accountTemplate, /\u4e0d\u540c\u8d26\u53f7\u5199\u5165\u4e0d\u540c\u6570\u636e\u8868|users \u8868|admins \u8868|\u83dc\u5355\u548c\u64cd\u4f5c\u5df2\u6309\u89d2\u8272\u88c1\u526a/)
assert.match(accountTemplate, /\u6700\u8fd1\u767b\u5f55/)
assert.match(accountSource, /isCurrentAccount/)
assert.match(accountSource, /row\.scopeLabel/)
assert.match(accountTemplate, /activeTab === 'student'[\s\S]{0,300}v-model="form\.buildingId"/)

const adminRoutesSource = readFileSync(new URL('../server/src/routes/admin.js', import.meta.url), 'utf8')
assert.match(adminRoutesSource, /router\.delete\('\/managers\/:id',[\s\S]*accountController\.deleteAccount/)

const controllerSource = readFileSync(new URL('../server/src/controllers/roomController.js', import.meta.url), 'utf8')
for (const field of ['reservationId', 'userName', 'purpose']) assert.match(controllerSource, new RegExp(field))

let studyMode = false
const mockDb = {
  async query(sql) {
    if (studyMode && sql.includes('FROM rooms WHERE id')) return [[{ id: 8, name: '自习室', type: 'study_room', capacity: 1, open_start_time: '08:00', open_end_time: '08:30' }]]
    if (studyMode && sql.includes('FROM seats')) return [[{ id: 1, status: 'available', seat_number: 'A1', row_num: 1, col_num: 1 }]]
    if (studyMode && sql.includes('FROM reservations')) return [[{ id: 55, user_id: 5, seat_id: 1, start_time: '08:00', end_time: '08:30', status: 'approved' }]]
    if (sql.includes('FROM rooms WHERE id')) return [[{ id: 7, name: '讨论室', type: 'seminar_room', capacity: 6, open_start_time: '08:00', open_end_time: '09:00' }]]
    if (sql.includes('FROM seats')) return [[]]
    if (sql.includes('FROM reservations')) return [[{
      id: 42,
      user_id: 5,
      start_time: '08:00',
      end_time: '08:30',
      status: 'checked_in',
      real_name: '李四',
      purpose: '小组会议'
    }]]
    throw new Error(`unexpected query: ${sql}`)
  }
}
const require = createRequire(import.meta.url)
const databasePath = require.resolve('../server/src/config/database.js')
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: mockDb, children: [], paths: [] }
const roomController = require('../server/src/controllers/roomController.js')
let responseBody
const response = { status() { return this }, json(body) { responseBody = body; return body } }
await roomController.timeline({ params: { id: '7' }, query: { date: '2026-07-13' }, user: { id: 99, role: 'admin' } }, response)
assert.equal(responseBody.code, 200)
assert.deepEqual(responseBody.data.timeline[0], {
  time: '08:00', endTime: '08:30', status: 'checked_in', availableCount: 5, totalCount: 6,
  reservationId: 42, userName: '李四', purpose: '小组会议'
})
await roomController.timeline({ params: { id: '7' }, query: { date: '2026-07-13' }, user: { id: 99, role: 'student' } }, response)
assert.equal(responseBody.data.timeline[0].reservationId, null)
assert.equal(responseBody.data.timeline[0].userName, '')
assert.equal(responseBody.data.timeline[0].purpose, '')
studyMode = true
await roomController.timeline({ params: { id: '8' }, query: { date: '2026-07-13' }, user: { id: 99, role: 'admin' } }, response)
assert.deepEqual(responseBody.data.timeline[0].reservationIds, [55])

const deduplicatedView = buildTimelineView({
  timeline: [
    { time: '13:00', status: 'occupied', reservationId: 77 },
    { time: '13:30', status: 'occupied', reservationId: 77 },
    { time: '14:00', status: 'checked_in', reservationIds: [77, 88] },
    { time: '14:30', status: 'occupied' }
  ]
})
assert.equal(deduplicatedView.summary.reservationCount, 2)
assert.equal(deduplicatedView.summary.busySlotCount, 4)
assert.equal(deduplicatedView.summary.reservationCountReliable, false)

const gate = createLatestRequestGate()
const firstRequest = gate.begin()
const secondRequest = gate.begin()
assert.equal(gate.isLatest(firstRequest), false)
assert.equal(gate.isLatest(secondRequest), true)
gate.invalidate()
assert.equal(gate.isLatest(secondRequest), false)

const orderingGate = createLatestRequestGate()
let visibleRoom = ''
let finishFirst
let finishSecond
const firstResult = new Promise(resolve => { finishFirst = resolve })
const secondResult = new Promise(resolve => { finishSecond = resolve })
async function applyLatest(resultPromise) {
  const requestId = orderingGate.begin()
  const roomName = await resultPromise
  if (orderingGate.isLatest(requestId)) visibleRoom = roomName
}
const pendingFirst = applyLatest(firstResult)
const pendingSecond = applyLatest(secondResult)
finishSecond('B')
await pendingSecond
finishFirst('A')
await pendingFirst
assert.equal(visibleRoom, 'B')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function coordinatorHarness() {
  const requests = new Map()
  const state = { loading: false, value: '', error: '', writes: 0 }
  const coordinator = createTimelineRequestCoordinator({
    load: key => requests.get(key).promise,
    onStart: () => { state.loading = true; state.error = ''; state.writes += 1 },
    onSuccess: value => { state.value = value; state.writes += 1 },
    onError: error => { state.error = error.message; state.writes += 1 },
    onFinish: () => { state.loading = false; state.writes += 1 }
  })
  return { requests, state, coordinator }
}

const successOrder = coordinatorHarness()
successOrder.requests.set('A', deferred())
successOrder.requests.set('B', deferred())
const slowA = successOrder.coordinator.run('A')
const fastB = successOrder.coordinator.run('B')
successOrder.requests.get('A').resolve('A')
await slowA
assert.equal(successOrder.state.value, '')
assert.equal(successOrder.state.loading, true)
successOrder.requests.get('B').resolve('B')
await fastB
assert.deepEqual(successOrder.state, { loading: false, value: 'B', error: '', writes: 4 })

const staleFailure = coordinatorHarness()
staleFailure.requests.set('A', deferred())
staleFailure.requests.set('B', deferred())
const failingA = staleFailure.coordinator.run('A')
const succeedingB = staleFailure.coordinator.run('B')
staleFailure.requests.get('A').reject(new Error('A failed'))
await failingA
assert.equal(staleFailure.state.error, '')
assert.equal(staleFailure.state.loading, true)
staleFailure.requests.get('B').resolve('B')
await succeedingB
assert.deepEqual(staleFailure.state, { loading: false, value: 'B', error: '', writes: 4 })

for (const outcome of ['success', 'failure']) {
  const invalidated = coordinatorHarness()
  invalidated.requests.set('A', deferred())
  const pending = invalidated.coordinator.run('A')
  invalidated.coordinator.invalidate()
  const writesBeforeSettlement = invalidated.state.writes
  if (outcome === 'success') invalidated.requests.get('A').resolve('A')
  else invalidated.requests.get('A').reject(new Error('stale failure'))
  await pending
  assert.equal(invalidated.state.writes, writesBeforeSettlement)
}

console.log('admin monitor timeline checks passed')
