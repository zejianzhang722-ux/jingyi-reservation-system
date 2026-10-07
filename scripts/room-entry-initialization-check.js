const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const util = require('../miniapp/utils/util')

async function check(name) {
  let page, resolveRoom
  const calls = [], toasts = []
  const request = { get(url, data) {
    calls.push({ url, data })
    if (url === '/room/1') return new Promise(resolve => { resolveRoom = resolve })
    return Promise.resolve({ timeline: [], seats: [] })
  } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniapp/pages', name, name + '.js'), 'utf8'), {
    Page(config) { page = config },
    require(id) {
      if (id.endsWith('/request')) return request
      if (id.endsWith('/util')) return util
      if (id.endsWith('/room-booking-policy')) return require('../miniapp/utils/room-booking-policy')
      if (id.endsWith('/local-data')) return {
        resolveRoomId: value => value,
        getRulesByRoomType: () => '',
        getRoomById: () => null,
        generateLocalTimeline: () => { throw new Error('Early requests must not trigger fallback data') }
      }
      if (id === '../../utils/rules-presenter') return require('../miniapp/utils/rules-presenter')
      throw new Error('Unexpected dependency: ' + id)
    },
    wx: { showToast: options => toasts.push(options.title), setNavigationBarTitle() {}, stopPullDownRefresh() {} },
    setInterval: () => 1, clearInterval() {}
  })
  page.setData = function (next) { Object.assign(this.data, next) }
  page.selectComponent = () => null
  // The child date picker can attach before the page receives route parameters.
  page.onDateChange({ detail: { date: '2026-10-07' } })
  await new Promise(setImmediate)
  assert.equal(calls.length, 0, name + ': initial child event must not send an empty room ID')
  page.onLoad({ roomId: '1' })
  assert.equal(calls.length, 1, name + ': room details load before availability')
  page.onDateChange({ detail: { date: '2026-10-08' } })
  assert.equal(calls.length, 1, name + ': wait for room details')
  resolveRoom({ id: 1, name: 'B228自习室', type: 'study_room', open_start_time: '08:00', open_end_time: '23:00', max_duration: 240 })
  await new Promise(setImmediate)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, '/room/1/timeline')
  assert.equal(calls[1].data.date, '2026-10-08', 'Use the latest date chosen during loading')
  page.onDateChange({ detail: { date: '2026-10-09' } })
  await new Promise(setImmediate)
  assert.equal(calls.length, 3)
  assert.equal(calls[2].data.date, '2026-10-09')
  assert.equal(toasts.length, 0)
  page.onLoad({ roomId: 'invalid' })
  assert.equal(calls.length, 3, 'Invalid room must not reach the backend')
  assert.equal(toasts.length, 1, 'Keep the genuine invalid-room warning')
  page.onUnload()
}
(async () => {
  await check('study-room')
  await check('room-timeline')
  console.log('PASS: early date events, room readiness, latest date, normal reload and invalid-room warning')
})().catch(error => { console.error(error); process.exitCode = 1 })
