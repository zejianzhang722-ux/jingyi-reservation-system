var TYPE_ALIASES = {
  study: 'study_room', seminar: 'seminar_room', discussion: 'seminar_room', shared_space: 'seminar_room',
  media: 'media_room', competition: 'competition_room', roadshow: 'roadshow_space',
  dance: 'dance_room', multi_purpose: 'multi_purpose_hall'
}
function canonicalType(type) { return TYPE_ALIASES[type] || type }
function hasBookingWindow(room) {
  var rows = room.statusSchedules || []
  if (!rows.length) return false
  if (room.baseStatus === 'open') return true
  return rows.some(function(row) { return row.status === 'open' && new Date(row.endAt.replace(/-/g, '/')).getTime() > Date.now() })
}
function forRoom(room) {
  room = room || {}
  var type = canonicalType(room.type)
  var supplied = room.bookingPolicy || {}
  var counselorOnly = !!(room.booking_channel === 'counselor_only' || type === 'party_room' || (!hasBookingWindow(room) && (supplied.counselorOnly || room.status === 'counselor_only')))
  var groupOnly = !!(supplied.groupOnly || ['seminar_room', 'dance_room', 'multi_purpose_hall'].indexOf(type) >= 0)
  var sharedCapacity = !!(supplied.sharedCapacity || ['innovation_workshop', 'innovation', 'competition_room'].indexOf(type) >= 0)
  return { counselorOnly: counselorOnly, groupOnly: groupOnly, sharedCapacity: sharedCapacity,
    mode: counselorOnly ? 'counselor_only' : sharedCapacity ? 'shared_capacity' : type === 'study_room' ? 'seat' : 'exclusive',
    message: counselorOnly ? '仅通过辅导员预约，不接受系统预约'
      : type === 'dance_room' ? '团队预约独占；无团队预约时个人可直接进入，有团队预约时个人不可进入'
        : groupOnly ? '仅限至少2人的组团预约，同一时段仅一个团队使用'
          : sharedCapacity ? '可个人或组团预约；请按实际参与人数填写，同一时段合计不得超过容量' : '' }
}
function blockReason(room, mode) {
  if (!room) return '正在加载功能房信息，请稍后再试'
  var policy = forRoom(room)
  if (policy.counselorOnly) return policy.message
  if (room.status && ['open', 'active', 'available'].indexOf(room.status) < 0 && !hasBookingWindow(room)) return '当前功能房未开放预约'
  if (mode === 'personal' && policy.groupOnly) return '该功能房仅接受组团预约，请从组团入口预约'
  if (mode === 'group' && policy.mode === 'seat') return '自习室请按座位个人预约'
  return ''
}
function presentRoom(room) {
  var policy = forRoom(room)
  var open = !blockReason(room, policy.groupOnly ? 'group' : 'personal')
  return Object.assign({}, room, { bookingPolicy: policy,
    status: policy.counselorOnly && ['closed', 'maintenance'].indexOf(room.status) < 0 ? 'counselor_only' : room.status,
    statusText: room.status === 'maintenance' ? '维护中' : room.status === 'closed' ? '关闭' : room.status === 'counselor_only' || policy.counselorOnly ? '仅辅导员预约' : '开放',
    canPersonalReserve: open && !policy.groupOnly,
    canGroupReserve: open && policy.mode !== 'seat',
    bookingBlocked: !open })
}
function isBlockedSlot(status) {
  return ['occupied', 'myReservation', 'checked_in', 'unavailable', 'reserved', 'using', 'closed', 'disabled', 'maintenance', 'pending', 'counselor_pending', 'approved'].indexOf(status) >= 0
}
module.exports = { canonicalType: canonicalType, forRoom: forRoom, presentRoom: presentRoom, blockReason: blockReason, isBlockedSlot: isBlockedSlot }
