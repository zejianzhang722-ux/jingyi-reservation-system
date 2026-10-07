// Observe real requests and toasts in DevTools; no response data is fabricated.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const automator = require(process.env.MINIPROGRAM_AUTOMATOR_PATH || 'miniprogram-automator')
async function main() {
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  const exceptions = []
  mini.on('exception', e => exceptions.push(e))
  const pages = []
  const logDir = path.resolve(__dirname, '../server/logs')
  const logs = fs.readdirSync(logDir).filter(name => /^combined.*\.log$/.test(name)).map(name => {
    const file = path.join(logDir, name)
    return { file, offset: fs.statSync(file).size }
  })
  try {
    await mini.evaluate(() => { getApp().__roomEntryProbe = { requests: [], toasts: [] } })
    await mini.mockWxMethod('showToast', function (options) {
      getApp().__roomEntryProbe.toasts.push(options.title)
      return this.origin(options)
    })
    for (const [name, roomId] of [['study-room', 1], ['room-timeline', 1], ['room-timeline', 6], ['room-timeline', 11], ['room-timeline', 12], ['room-timeline', 13]]) {
      const page = await mini.reLaunch('/pages/' + name + '/' + name + '?roomId=' + roomId)
      await page.waitFor(async () => !(await page.data('loading')))
      const data = await page.data()
      assert.equal(data.roomId, roomId)
      assert.equal(Number(data.room.id), roomId)
      assert.ok(data.selectedDate)
      pages.push({ route: name, roomId, roomName: data.room.name })
      console.log('OPENED', name, roomId, data.room.name)
      await page.waitFor(300)
    }
    const probe = await mini.evaluate(() => getApp().__roomEntryProbe)
    // Read new access-log entries without intercepting network responses.
    probe.requests = logs.flatMap(({file, offset}) => fs.readFileSync(file).subarray(offset).toString('utf8').split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch (_) { return {} }
    })).filter(row => row.message === 'http_request_completed' && row.path.startsWith('/api/v1/room/')).map(row => ({path: row.path, status: row.statusCode}))
    assert.equal(probe.toasts.length, 0, 'Unexpected toast: ' + probe.toasts.join('; '))
    assert.ok(probe.requests.length >= pages.length * 2, 'Must observe real room and timeline requests')
    for (const request of probe.requests) {
      assert.doesNotMatch(request.path, /\/room\/\//)
      assert.ok([200, 304].includes(request.status), JSON.stringify(request))
    }
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions))
    const dir = path.resolve(__dirname, '../.artifacts/room-entry')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ ok: true, pages, ...probe, exceptions }, null, 2))
    console.log('PASS: ' + pages.length + ' room entries, ' + probe.requests.length + ' successful real requests, no error toast')
  } finally {
    await mini.restoreWxMethod('showToast').catch(() => {})
    await mini.evaluate(() => { delete getApp().__roomEntryProbe }).catch(() => {})
    mini.disconnect()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
