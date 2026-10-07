// Quota applies to the reservation date, not the submission date. Membership
// and ownership refer to the same reservation and must never count twice.
const QUOTA_STATUSES = ['pending', 'counselor_pending', 'approved', 'checked_in', 'completed', 'noshow'];
const CONFLICT_STATUSES = ['pending', 'counselor_pending', 'approved', 'checked_in'];
const TYPE_ALIASES = {
  study: 'study_room', seminar: 'seminar_room', discussion: 'seminar_room', shared_space: 'seminar_room',
  media: 'media_room', competition: 'competition_room', roadshow: 'roadshow_space',
  dance: 'dance_room', multi_purpose: 'multi_purpose_hall'
};
const canonicalType = type => TYPE_ALIASES[type] || type;
const dateKey = value => value instanceof Date
  ? require('../utils/helpers').formatDate(value) : String(value).slice(0, 10);
const timeKey = value => String(value).slice(0, 5);
function fail(code, message) {
  const error = new Error(message);
  error.httpStatus = code === 'PERSONAL_SLOT_CONFLICT' ? 409 : 400;
  error.code = code;
  throw error;
}
function validate(input, rows, roomType, excludeReservationId, user) {
  const rule = user ? require('./creditBookingPolicy').validate(input, user) : { dailyLimit: 3 };
  const relevant = [...new Map(rows.filter(row => Number(row.id) !== Number(excludeReservationId || 0)
    && dateKey(row.date) === dateKey(input.date)).map(row => [Number(row.id), row])).values()];
  if (relevant.some(row => CONFLICT_STATUSES.includes(row.status)
    && timeKey(row.start_time) < timeKey(input.endTime)
    && timeKey(row.end_time) > timeKey(input.startTime))) {
    fail('PERSONAL_SLOT_CONFLICT', '该时段你已有预约或参与的组团，请选择不重叠的时间');
  }
  if (relevant.filter(row => QUOTA_STATUSES.includes(row.status)
    && canonicalType(row.room_type) === canonicalType(roomType)).length >= rule.dailyLimit) {
    fail('DAILY_TYPE_LIMIT', '当前信用分在预约所选日期同类功能房最多预约' + rule.dailyLimit + '次；取消或被拒绝后释放次数');
  }
}
function assertMock(input, tables, excludeReservationId) {
  const groupIds = new Set((tables.reservation_group_members || [])
    .filter(member => Number(member.user_id) === Number(input.userId) && member.status !== 'rejected')
    .map(member => Number(member.group_id)));
  const memberReservationIds = new Set((tables.reservation_groups || [])
    .filter(group => groupIds.has(Number(group.id))).map(group => Number(group.reservation_id)));
  const room = tables.rooms.find(row => Number(row.id) === Number(input.roomId));
  const rows = tables.reservations.filter(row => Number(row.user_id) === Number(input.userId)
    || memberReservationIds.has(Number(row.id))).map(row => ({ ...row,
    room_type: (tables.rooms.find(room => Number(room.id) === Number(row.room_id)) || {}).type }));
  validate(input, rows, room && room.type, excludeReservationId, tables.users.find(user => Number(user.id) === Number(input.userId)));
}
async function assertTransaction(connection, input, roomType, excludeReservationId) {
  const [users] = await connection.execute('SELECT id, credit_score, status, restricted_until FROM users WHERE id = ?', [input.userId]);
  // The caller locks the user first, serializing new bookings and group joins.
  // Distinct prevents the creator's member row from consuming a second quota.
  const [rows] = await connection.execute(
    'SELECT DISTINCT r.id, r.date, r.start_time, r.end_time, r.status, rm.type AS room_type ' +
    'FROM reservations r JOIN rooms rm ON rm.id = r.room_id ' +
    'WHERE r.date = ? AND (r.user_id = ? OR EXISTS (' +
    'SELECT 1 FROM reservation_groups g JOIN reservation_group_members m ON m.group_id = g.id ' +
    "WHERE g.reservation_id = r.id AND m.user_id = ? AND m.status <> 'rejected'))",
    [dateKey(input.date), input.userId, input.userId]);
  validate(input, rows, roomType, excludeReservationId, users[0]);
}
module.exports = { QUOTA_STATUSES, CONFLICT_STATUSES, canonicalType, validate, assertMock, assertTransaction };
