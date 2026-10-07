const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const nav = []
global.wx = {
  getStorageSync(key) { return key === 'token' ? 'student-token' : {} },
  setStorageSync() {}, showToast() {}, setNavigationBarTitle() {},
  navigateTo(options) { nav.push(options.url) }
}
global.getApp = () => ({ globalData: {} })
function load(file) {
  let page
  global.Page = config => { page = config }
  delete require.cache[require.resolve(path.join(root, file))]
  require(path.join(root, file))
  page.data = JSON.parse(JSON.stringify(page.data))
  page.setData = updates => {
    for (const [key, value] of Object.entries(updates)) {
      const parts = key.split('.'); let target = page.data
      for (const part of parts.slice(0, -1)) target = target[part]
      target[parts.at(-1)] = value
    }
  }
  return page
}
const detail = load('miniapp/pages/room-detail/room-detail.js')
assert.equal(detail.normalizeRoom({ id: 20, type: 'party_room', status: 'open' }).canGroupReserve, false)
const policy = require('../miniapp/utils/room-booking-policy')
const serverPolicy = require('../server/src/services/roomBookingPolicy')
for (const type of ['study', 'study_room', 'seminar_room', 'seminar', 'discussion', 'shared_space', 'dance', 'dance_room', 'multi_purpose', 'multi_purpose_hall', 'competition', 'competition_room', 'innovation', 'innovation_workshop', 'party_room']) {
  assert.deepEqual(policy.forRoom({ type }), serverPolicy.forRoom({ type }), type)
}
for (const type of ['seminar_room', 'dance_room', 'multi_purpose_hall']) {
  detail.data.room = detail.normalizeRoom({ id: 20, type, status: 'open' })
  assert.equal(detail.data.room.canPersonalReserve, false)
  nav.length = 0; detail.onReserveTap()
  assert.equal(nav.length, 0)
}
const confirm = load('miniapp/pages/reservation-confirm/reservation-confirm.js')
confirm.setData({ roomId: 20, phone: '13900000001', cardNo: '123456', agreedRules: true })
confirm.applyRoom({ id: 20, type: 'party_room', status: 'open' })
assert.match(confirm.validateForm(), /辅导员/)
confirm.applyRoom({ id: 20, type: 'seminar_room', capacity: 12, status: 'open' })
assert.equal(confirm.data.reservationMode, 'group')
confirm.onReservationModeChange({ currentTarget: { dataset: { mode: 'personal' } } })
assert.equal(confirm.data.reservationMode, 'group')
confirm.applyRoom({ id: 20, type: 'innovation_workshop', capacity: 12, status: 'open' })
confirm.setData({ reservationMode: 'personal', competitionFields: { competitionName: '创新项目', participantCount: '3' } })
assert.equal(confirm.validateForm(), '')
assert.equal(confirm.buildPayload().participants, 3)
assert.equal(confirm.buildPayload().purpose, '创新项目')
confirm.data.competitionFields.participantCount = ''
assert.match(confirm.validateForm(), /人数/)
assert.equal(policy.isBlockedSlot('checked_in'), true)
assert.equal(policy.isBlockedSlot('unavailable'), true)
assert.equal(policy.isBlockedSlot('available'), false)
const timeline = load('miniapp/pages/room-timeline/room-timeline.js')
timeline.setData({ room: { type: 'media_room', status: 'closed' } })
nav.length = 0; timeline.onConfirmTime()
assert.equal(nav.length, 0)
const group = load('miniapp/pages/group-reserve/group-reserve.js')
group.setData({ room: { type: 'party_room', status: 'open' }, roomId: 20 })
assert.match(group.validateGroupForm(), /辅导员/)
for (const file of ['miniapp/pages/reservation-confirm/reservation-confirm.wxml', 'miniapp/pages/group-reserve/group-reserve.wxml', 'miniapp/pages/group-list/group-list.wxml']) {
  assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /实际参与人数/)
}
;(async function () {
  const request = require('../miniapp/utils/request')
  request.get = () => Promise.resolve({ timeline: [
    { time: '13:00', endTime: '13:30', seats: [{ seatId: 1, seatNumber: '1', status: 'checked_in' }] },
    { time: '13:30', endTime: '14:00', seats: [{ seatId: 1, seatNumber: '1', status: 'unavailable' }] }
  ] })
  for (const name of ['room-timeline', 'study-room']) {
    const page = load('miniapp/pages/' + name + '/' + name + '.js')
    page.setData({ roomId: 1, room: { id: 1, type: 'study_room', status: 'open' }, selectedDate: '2026-10-07', selectedSeat: 1, selectedStartHour: 13, selectedEndHour: 14 })
    page.scrollToCurrentTime = () => {}
    page.loadTimeline()
    await new Promise(setImmediate)
    assert.equal(page.data.timeline.length, 2, name + ': 已签到和不可用时段必须保持占用')
    nav.length = 0; page.onConfirmTime()
    assert.equal(nav.length, 0, name + ': 手动扩展到占用时段必须拦截')
  }
  console.log('房间预约方式、直接入口拦截、创新人数、组团人数及禁用时段检查通过')
})().catch(err => { console.error(err); process.exitCode = 1 })
