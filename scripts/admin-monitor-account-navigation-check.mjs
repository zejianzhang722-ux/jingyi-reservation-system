import assert from 'node:assert/strict'

import { buildTimelineView } from '../admin/src/utils/roomTimeline.js'

const occupiedView = buildTimelineView({
  timeline: [
    { time: '08:00', endTime: '08:30', status: 'available' },
    {
      time: '08:30',
      endTime: '09:00',
      status: 'reserved',
      userName: '张三',
      purpose: '课题讨论',
      reservationId: 18
    },
    { time: '09:00', endTime: '09:30', status: 'using', reservationId: 19 },
    { time: '09:30', endTime: '10:00', status: 'maintenance' }
  ]
})

assert.deepEqual(occupiedView.summary, {
  total: 4,
  reservationCount: 2,
  isAllAvailable: false
})
assert.deepEqual(occupiedView.slots.map(slot => slot.label), ['空闲', '已预约', '使用中', '维护'])
assert.equal(occupiedView.slots[1].purpose, '课题讨论')
assert.equal(occupiedView.slots[1].reservationId, 18)
assert.equal(occupiedView.emptyState, null)

const emptyView = buildTimelineView([])
assert.deepEqual(emptyView.slots, [])
assert.deepEqual(emptyView.summary, {
  total: 0,
  reservationCount: 0,
  isAllAvailable: true
})
assert.deepEqual(emptyView.emptyState, {
  title: '今日全天空闲',
  description: '当前没有预约或维护安排'
})

console.log('admin monitor timeline checks passed')
