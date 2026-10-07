// Execute the actual page methods with a simulated camera and verification API.
const assert = require('assert/strict')
const path = require('path')
const root = path.resolve(__dirname, '../miniapp')
async function run(role) {
  const originalRole = role
  Object.keys(require.cache).filter(p => p.startsWith(root)).forEach(p => delete require.cache[p])
  const navigation = []
  const calls = []
  let fail = false
  global.wx = {
    getStorageSync: k => k === 'token' ? 'token' : { role },
    reLaunch: o => navigation.push(o.url), navigateTo: o => navigation.push(o.url),
    scanCode: o => o.success({ result: 'credential' }), showToast() {},
    getLocation: o => { o.success({ latitude: 1, longitude: 2, accuracy: 5 }); o.complete() }
  }
  const requestPath = require.resolve('../miniapp/utils/request')
  require.cache[requestPath] = { id: requestPath, filename: requestPath, loaded: true, exports: {
    get: async url => url === '/verification/me' ? { canResolve: role !== 'dorm_manager' } : { list: [], total: 0 },
    post: async (url, payload) => {
      calls.push({ url, payload })
      if (fail && url === '/verification/confirm') throw new Error('network')
      return url === '/verification/preview' ? { eligible: true, verified: false } : { checkedIn: true }
    }
  } }
  global.Page = p => { global.__scanPage = p }
  const pageName = role === 'dorm_manager' ? 'dorm-scan' : 'admin-scan'
  require('../miniapp/pages/' + pageName + '/' + pageName)
  const page = global.__scanPage
  page.data = JSON.parse(JSON.stringify(page.data))
  page.setData = patch => Object.assign(page.data, patch)
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
  page.onLoad({}); await settle()
  page.scan(); await settle()
  assert.equal(page.data.result.eligible, true)
  page.data.identity = true
  page.pass(); await settle()
  assert.equal(page.data.result.checkedIn, true)
  assert.equal(page.data.busy, false)
  assert.deepEqual(navigation, [], role + ': check-in must stay on its own scan page')
  fail = true
  page._credential = 'another-credential'
  page.send({ credential: page._credential, requestId: 'retry-key' }); await settle()
  assert.equal(page.data.uncertain, true)
  assert.deepEqual(navigation, [], role + ': failed submission must also stay')
  assert.ok(calls.some(c => c.url === '/verification/confirm' && c.payload.identityConfirmed))
  if (role !== 'dorm_manager') {
    role = 'dorm_manager'
    const count = calls.length
    page.preview(); await settle()
    assert.equal(calls.length, count, 'role change must prevent stale administrator scan requests')
    assert.equal(navigation.at(-1), '/pages/verification/verification')
  }
  console.log('PASS ' + originalRole + ': preview, confirm, error stay on ' + pageName + (originalRole !== 'dorm_manager' ? ', role change blocked' : ''))
}
(async () => {
  for (const role of ['super_admin', 'superadmin', 'admin', 'counselor', 'dorm_manager']) await run(role)
})().catch(e => { console.error(e); process.exitCode = 1 })
