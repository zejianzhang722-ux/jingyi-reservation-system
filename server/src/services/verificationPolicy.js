const ROLES = ['dorm_manager', 'admin', 'counselor', 'super_admin'];
const error = (message, status = 400, code = 'INVALID_REQUEST') => Object.assign(new Error(message), { httpStatus: status, reasonCode: code });
function assertScope(scope, buildingId) {
  if (!scope || !ROLES.includes(scope.role)) throw error('没有现场核验权限', 403, 'FORBIDDEN');
  if (scope.role === 'dorm_manager' && (scope.isGlobal || !scope.buildingId)) throw error('宿管必须分配具体楼栋', 403, 'SCOPE_MISSING');
  if (!scope.isGlobal && Number(scope.buildingId) !== Number(buildingId)) throw error('该预约不属于您的负责楼栋', 403, 'OUT_OF_SCOPE');
}
function eligibility(reservation, now = new Date()) {
  if (!['approved', 'checked_in'].includes(reservation.status)) return { eligible: false, reason: '预约未获批准、已取消或已经结束', reasonCode: 'INVALID_STATUS' };
  if (reservation.user_status === 'banned') return { eligible: false, reason: '宿生账号已停用，请联系书院导生会会长团', reasonCode: 'USER_DISABLED' };
  if (reservation.room_status !== 'open') return { eligible: false, reason: '功能房当前未开放，请联系书院导生会会长团', reasonCode: 'ROOM_CLOSED' };
  const window = require('./checkinWindowPolicy').windowStatus(reservation, now);
  if (!window.eligible) return { ...window, reasonCode: 'OUTSIDE_WINDOW' };
  return { eligible: true, reason: '请核对现场人员与预约人身份后确认', reasonCode: 'READY' };
}
function present(reservation) {
  const id = String(reservation.student_id || '');
  return { id: Number(reservation.id), name: reservation.real_name || reservation.nickname || '宿生', studentId: id.length > 4 ? id.slice(0, 2) + '****' + id.slice(-2) : '****', roomName: reservation.room_name, buildingId: Number(reservation.building_id), buildingName: reservation.building_name || '', location: reservation.room_location || '', participants: Number(reservation.participants) || 1, purpose: reservation.purpose || '未填写用途', date: reservation.date instanceof Date ? require('../utils/helpers').formatDate(reservation.date) : String(reservation.date).slice(0, 10), startTime: reservation.start_time, endTime: reservation.end_time, status: reservation.status };
}
module.exports = { ROLES, error, assertScope, eligibility, present };
