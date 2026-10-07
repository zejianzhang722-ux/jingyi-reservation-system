const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const util = require('../miniapp/utils/util')
assert.equal(util.getStatusText('counselor_pending'), '待辅导员审核')
assert.equal(util.getStatusText('checked_in'), '使用中')
assert.equal(util.getStatusText('rejected'), '已拒绝')
assert.equal(util.getStatusText('future_status'), '状态待确认')
assert.equal(util.getRoomTypeName('study_room'), '自习室')
assert.equal(util.getRoomTypeName('seminar_room'), '共享空间')
assert.equal(util.getRoomTypeName('future_room'), '其他空间')
for (const status of ['pending', 'counselor_pending', 'approved']) {
  assert.equal(util.canCancel({ status, date: '2000-01-01', start_time: '12:00' }), true)
}
assert.equal(util.canCancel({ status: 'checked_in' }), false)
const presenter = require('../miniapp/utils/notification-presenter')
const serverPresenter = require('../server/src/utils/notificationPresenter')
const cases = {
  reservation_pending: 'audit', reservation_approved: 'audit', reservation_rejected: 'audit',
  reservation_reminder: 'reminder', reservation_ending: 'reminder', noshow: 'noshow_warning',
  credit_warning: 'credit', credit_banned: 'credit', poster_approved: 'poster',
  group_member_joined: 'group', group_rejected: 'group', feedback_reply: 'feedback',
  waitlist_available: 'waitlist', system_announcement: 'system', violation: 'violation',
  future_event: 'other', dance_group_reserved: 'reminder', dance_group_released: 'reminder'
}
for (const [type, category] of Object.entries(cases)) {
  const item = presenter.present({ type, data: JSON.stringify({ reservationId: 19, groupId: 20 }) })
  assert.equal(item.category, category, type)
  assert.match(item.categoryLabel, /[\u4e00-\u9fff]/)
  assert.match(item.typeLabel, /[\u4e00-\u9fff]/)
  assert.deepEqual(serverPresenter.present({ type, data: JSON.stringify({ reservationId: 19, groupId: 20 }) }), item)
}
assert.equal(presenter.present({ type: 'group_approved', data: { groupId: 20 } }).targetUrl, '/pages/group-reserve/group-reserve?mode=detail&groupId=20')
assert.equal(presenter.present({ type: 'reservation_approved', data: { reservationId: 19 } }).targetUrl, '/pages/reservation-detail/reservation-detail?id=19')
for (const role of ['admin', 'counselor', 'super_admin']) {
  assert.equal(presenter.present({ type: 'dance_group_reserved', data: { reservationId: 19 } }, role).targetUrl, '/pages/admin-reservation-detail/admin-reservation-detail?id=19')
}
assert.equal(presenter.present({ type: 'dance_group_reserved', data: { reservationId: 19, date: '2026-10-07' } }, 'dorm_manager').targetUrl, '/pages/dorm-reservations/dorm-reservations?date=2026-10-07')
const template = fs.readFileSync(path.join(root, 'miniapp/pages/my-reservations/my-reservations.wxml'), 'utf8')
assert.match(template, /catchtap="onQRCode"/)
assert.match(template, /item\.canViewVoucher/)
// 角色中文名由 miniapp/utils/role-model.js 单一来源提供，页面不得各自硬编码。
// PC 后台 admin/src/utils/adminRolePolicy.js 是另一套展示层，不在此约束范围内。
const roleModelSource = fs.readFileSync(path.join(root, 'miniapp/utils/role-model.js'), 'utf8')
assert.match(roleModelSource, /super_admin:\s*\{\s*label:\s*'导生会会长团'/, 'role-model 应提供 super_admin 展示名')
assert.match(roleModelSource, /dorm_manager:\s*\{\s*label:\s*'宿管'/, 'role-model 应提供 dorm_manager 展示名')
for (const file of ['miniapp/pages/admin-home/admin-home.js', 'miniapp/pages/admin-profile/admin-profile.js']) {
  assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /ROLE_NAMES\s*=\s*\{/, file + ' 不应自行维护 ROLE_NAMES 映射')
}
// 页面必须真的走 role-model，而不是碰巧没有字面量
for (const file of ['miniapp/pages/admin-home/admin-home.js', 'miniapp/pages/admin-profile/admin-profile.js']) {
  assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /require\(['"][^'"]*role-model['"]\)/, file + ' 应引用 role-model 取角色语义')
}
console.log('预约中文状态、取消入口、凭证入口及完整消息分类检查通过')
