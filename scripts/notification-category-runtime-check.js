const assert = require('assert/strict')
const mockDb = require('../server/src/config/mock-db')
const dbPath = require.resolve('../server/src/config/database')
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockDb }
const controller = require('../server/src/controllers/notificationController')
mockDb.__tables.notifications = Array.from({ length: 15 }, (_, index) => ({
  id: index + 1, user_id: 7001, type: index < 12 ? 'credit_warning' : 'group_approved',
  title: '通知', content: '通知内容', data: JSON.stringify({ groupId: index + 1 }),
  is_read: 0, created_at: '2026-10-06 10:' + String(index).padStart(2, '0') + ':00'
})).concat([{ id: 90, user_id: 7002, type: 'group_approved', data: '{}' }])
async function list(query) {
  let result
  const res = { status() { return this }, json(value) { result = value; return value } }
  await controller.list({ query, user: { id: 7001, role: 'student' } }, res)
  assert.equal(result.code, 200)
  return result.data
}
;(async function () {
  const groups = await list({ category: 'group', page: 2, pageSize: 2 })
  assert.equal(groups.total, 3)
  assert.equal(groups.list.length, 1)
  assert.equal(groups.list[0].categoryLabel, '组团通知')
  assert.match(groups.list[0].targetUrl, /groupId=/)
  const credit = await list({ type: 'credit_warning', pageSize: 20 })
  assert.equal(credit.total, 12)
  assert.equal(credit.list.length, 12)
  const all = await list({ pageSize: 10 })
  assert.equal(all.total, 15)
  assert.equal(all.list.length, 10)
  assert.equal(all.list.every(row => row.user_id === 7001), true)
  console.log('消息分类筛选、分页总数、跳转与用户隔离检查通过')
})().catch(err => { console.error(err); process.exitCode = 1 })
