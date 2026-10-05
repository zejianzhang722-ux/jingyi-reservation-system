const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'

const db = require('../server/src/config/database')
const tables = require('../server/src/config/mock-db').__tables
const service = require('../server/src/services/reservationGroupService')

async function main() {
  const page = fs.readFileSync(path.join(__dirname, '../admin/src/views/Group/PendingList.vue'), 'utf8')
  assert.match(page, /status:\s*filters\.status/, 'status must be sent to the server')
  assert.match(page, /keyword:\s*filters\.keyword/, 'keyword must be sent to the server')
  assert.doesNotMatch(page, /tableData\.value\.filter\(row => matchFilters\(row\)\)/, 'search cannot filter only the visible page')
  assert.doesNotMatch(page, /label: '已通过'|label: '已拒绝'|label: '已取消'/, 'pending-only endpoint cannot offer completed statuses')
  await db.ready()
  const user = tables.users.find(row => row.id === 1)
  const originalName = user.real_name
  const originalGroups = tables.reservation_groups.splice(0)
  user.real_name = '筛选测试发起人'
  const seed = [
    { id: 90001, name: '合唱排练', status: 'pending', room_id: 6, created_by: 1 },
    { id: 90002, name: '舞蹈彩排', status: 'counselor_pending', room_id: 11, created_by: 1 },
    { id: 90003, name: '已通过活动', status: 'approved', room_id: 6, created_by: 1 }
  ].map(row => ({ ...row, date: '2026-09-21', start_time: '14:00', end_time: '15:00', max_members: 4, created_at: '2026-09-20 12:00:00' }))
  tables.reservation_groups.push(...seed)
  try {
    const status = await service.listPendingGroups({ statuses: ['pending', 'counselor_pending'], status: 'pending', page: 1, pageSize: 1 })
    assert.equal(status.total, 1, 'status filter must apply before pagination and count')
    assert.deepEqual(status.list.map(row => row.id), [90001])
    const byTitle = await service.listPendingGroups({ statuses: ['pending', 'counselor_pending'], keyword: '舞蹈', page: 1, pageSize: 1 })
    assert.equal(byTitle.total, 1, 'title search must apply before pagination and count')
    assert.deepEqual(byTitle.list.map(row => row.id), [90002])
    const byCreator = await service.listPendingGroups({ statuses: ['pending', 'counselor_pending'], keyword: '筛选测试发起人', page: 1, pageSize: 1 })
    assert.equal(byCreator.total, 2, 'creator search must match both pending groups')
    const forbidden = await service.listPendingGroups({ statuses: ['pending'], status: 'approved', page: 1, pageSize: 10 })
    assert.equal(forbidden.total, 0, 'status filter cannot expand the role-scoped pending set')
  } finally {
    tables.reservation_groups.splice(0, tables.reservation_groups.length, ...originalGroups)
    user.real_name = originalName
    await db.close()
  }
  console.log('group-pending-filter-check passed')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
