var roleModel = require('./role-model')

var CATEGORIES = [
  { key: 'all', name: '全部' },
  { key: 'audit', name: '预约审核', icon: 'shield' },
  { key: 'reminder', name: '使用提醒', icon: 'bell' },
  { key: 'noshow_warning', name: '爽约警告', icon: 'warning' },
  { key: 'credit', name: '信用变动', icon: 'star' },
  { key: 'poster', name: '海报通知', icon: 'megaphone' },
  { key: 'group', name: '组团通知', icon: 'info' },
  { key: 'feedback', name: '反馈回复', icon: 'info' },
  { key: 'waitlist', name: '候补通知', icon: 'bell' },
  { key: 'system', name: '系统公告', icon: 'info' },
  { key: 'violation', name: '违规提醒', icon: 'warning' },
  { key: 'other', name: '其他通知', icon: 'info' }
]
function categoryFor(type) {
  if (type === 'dance_group_reserved' || type === 'dance_group_released') return 'reminder'
  if (type === 'noshow' || type.indexOf('noshow') >= 0) return 'noshow_warning'
  if (type.indexOf('credit') === 0) return 'credit'
  if (type.indexOf('poster') === 0) return 'poster'
  if (type.indexOf('group') === 0) return 'group'
  if (type.indexOf('feedback') === 0) return 'feedback'
  if (type.indexOf('waitlist') >= 0) return 'waitlist'
  if (type.indexOf('violation') >= 0) return 'violation'
  if (type.indexOf('reminder') >= 0 || type === 'reservation_ending') return 'reminder'
  if (type.indexOf('reservation') === 0 || type.indexOf('audit') === 0) return 'audit'
  if (type.indexOf('system') === 0 || type.indexOf('announcement') >= 0) return 'system'
  return 'other'
}
function present(row, role) {
  row = row || {}
  var payload = row.data || {}
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch (err) { payload = {} }
  }
  if (!payload || typeof payload !== 'object') payload = {}
  var type = String(row.type || '')
  var category = row.category && CATEGORIES.some(function (item) { return item.key === row.category && item.key !== 'all' }) ? row.category : categoryFor(type)
  var meta = CATEGORIES.find(function (item) { return item.key === category })
  var reservationId = payload.reservationId || payload.reservation_id || row.relatedId || row.related_id
  var groupId = payload.groupId || payload.group_id
  var targetUrl = ''
  if (category === 'group' && groupId) targetUrl = '/pages/group-reserve/group-reserve?mode=detail&groupId=' + encodeURIComponent(groupId)
  else if (category === 'credit') targetUrl = '/pages/credit-detail/credit-detail'
  else if (reservationId && ['audit', 'reminder', 'noshow_warning', 'waitlist'].indexOf(category) >= 0) {
    if (roleModel.isDormRole(role)) targetUrl = '/pages/dorm-reservations/dorm-reservations?date=' + encodeURIComponent(payload.date || '')
    else if (roleModel.isGuideRole(role)) targetUrl = '/pages/admin-reservation-detail/admin-reservation-detail?id=' + encodeURIComponent(reservationId)
    else targetUrl = '/pages/reservation-detail/reservation-detail?id=' + encodeURIComponent(reservationId)
  }
  return Object.assign({}, row, { data: payload, category: category, categoryLabel: meta.name, typeLabel: meta.name, icon: meta.icon, targetUrl: targetUrl })
}
module.exports = { categories: CATEGORIES, present: present, categoryFor: categoryFor }
