import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { buildTimelineView } from '../admin/src/utils/roomTimeline.js'

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

assert.deepEqual(timelineView.summary, { total: 6, reservationCount: 3, isAllAvailable: false })
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
assert.doesNotMatch(monitorTemplate, /WebSocket|Token|\u4ee4\u724c/i)

const controllerSource = readFileSync(new URL('../server/src/controllers/roomController.js', import.meta.url), 'utf8')
for (const field of ['reservationId', 'userName', 'purpose']) assert.match(controllerSource, new RegExp(field))

const mockDb = {
  async query(sql) {
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

console.log('admin monitor timeline checks passed')
