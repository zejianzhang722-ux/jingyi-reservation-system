const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict')
let definition, posted = [], fail = false
const request = {
  get: async route => route === '/verification/me' ? { role: 'dorm_manager', buildingId: 1, canResolve: false } : { list: [], total: 0 },
  post: async (route, body) => { posted.push({ route, body: JSON.parse(JSON.stringify(body)) }); if (fail) throw new Error('模拟响应丢失'); return route.endsWith('preview') ? { outcome: 'ready', eligible: true, verified: false, reservation: { id: 1 } } : { outcome: 'passed', checkedIn: true, verified: true } }
}
const sandbox = { require: name => name.includes('auth') ? { isLoggedIn: () => true, isAdmin: () => true } : request, Page: value => { definition = value }, wx: { reLaunch: () => {}, showToast: () => {}, getLocation: o => { o.success({ latitude: 22, longitude: 113, accuracy: 10 }); o.complete() } }, setInterval, clearInterval, Promise, Date, Math }
const controller = { exports: {} }; sandbox.module = controller
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniapp/utils/dorm-page.js'), 'utf8'), sandbox)
definition = controller.exports('scan')
const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value) } }
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }
async function main() {
  page.onLoad(); await flush(); assert.equal(page.data.me.role, 'dorm_manager')
  page.data.credential = 'signed-demo-credential'; page.preview(); await flush(); assert.equal(page.data.result.outcome, 'ready')
  page.pass(); await flush(); assert.equal(posted.filter(r => r.route.endsWith('confirm')).length, 0, 'must require identity confirmation')
  page.data.identity = true; fail = true; page.pass(); await flush(); assert.equal(page.data.uncertain, true)
  const previous = JSON.stringify(posted.at(-1).body)
  page.data.note = '修改后的说明'; page.preview(); await flush(); assert.equal(JSON.stringify(posted.at(-1).body), previous, 'uncertain request must not be replaced')
  fail = false; page.retry(); await flush(); assert.equal(JSON.stringify(posted.at(-1).body), previous, 'retry must preserve exact original request')
  assert.equal(page.data.result.checkedIn, true); assert.equal(page.data.uncertain, false)
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniapp/app.json'), 'utf8'))
  assert(app.pages.includes('pages/verification/verification')); assert(app.requiredPrivateInfos.includes('getLocation'))
  const markup = fs.readFileSync(path.join(__dirname, '../miniapp/templates/dorm-layout.wxml'), 'utf8')
  assert(markup.includes('扫码办理签到'), 'first screen must provide scan entry')
  assert(markup.includes('id="scan-panel"'), 'scan results must have a navigation anchor')
  for (const name of ['dorm-reservations', 'dorm-scan', 'dorm-records']) assert(app.pages.includes('pages/' + name + '/' + name))
  console.log('PASS: miniapp entry, identity guard, lost response retry, request preservation, check-in result, location declaration')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
