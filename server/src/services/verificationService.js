const db = require('../config/database');
const redis = require('../config/redis');
const credentials = require('./checkinCredentialService');
const repository = require('./verificationRepository');
const policy = require('./verificationPolicy');
const realtime = require('./realtimeEventService');
const locationService = require('./checkinLocationService');
async function loadReservation(id, runner) {
  const query = runner ? runner.query : db.query;
  if (!db.isMock()) {
    const [rows] = await query('SELECT r.*, rm.building_id, b.name AS building_name, rm.location AS room_location, rm.name AS room_name, rm.status AS room_status, u.real_name, u.nickname, u.student_id, u.status AS user_status FROM reservations r JOIN rooms rm ON rm.id = r.room_id JOIN users u ON u.id = r.user_id LEFT JOIN buildings b ON b.id = rm.building_id WHERE r.id = ?' + (runner ? ' FOR UPDATE' : ''), [id]);
    return rows[0];
  }
  const [rows] = await query('SELECT * FROM reservations WHERE id = ?', [id]);
  if (!rows[0]) return null;
  const [rooms] = await query('SELECT * FROM rooms WHERE id = ?', [rows[0].room_id]);
  const [users] = await query('SELECT * FROM users WHERE id = ?', [rows[0].user_id]);
  if (!rooms[0] || !users[0]) return null;
  const [buildings] = await query('SELECT id, name FROM buildings WHERE id = ?', [rooms[0].building_id]);
  return { ...rows[0], building_id: rooms[0].building_id, building_name: buildings[0]?.name || '', room_location: rooms[0].location, room_name: rooms[0].name, room_status: rooms[0].status, real_name: users[0].real_name, nickname: users[0].nickname, student_id: users[0].student_id, user_status: users[0].status };
}
async function activeCredential(parsed, reservation) {
  credentials.ensureCredentialStoreAvailable();
  credentials.validatePayload(parsed.payload, reservation);
  const active = await redis.get('checkin:credential:active:' + reservation.id);
  if (!active || active !== parsed.payload.n) throw policy.error('二维码已刷新或失效，请让宿生出示最新动态码', 410, 'STALE_CREDENTIAL');
}
function requestId(input) {
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(String(input.requestId || ''))) throw policy.error('核验请求编号无效');
  return input.requestId;
}
function storedResult(row) {
  const result = typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json;
  return { ...result, eventId: row.id, recordedAt: row.created_at };
}
async function process(scope, input, mode) {
  if (!scope || !policy.ROLES.includes(scope.role)) throw policy.error('没有现场核验权限', 403, 'FORBIDDEN');
  if (scope.role === 'dorm_manager') policy.assertScope(scope, scope.buildingId);
  const key = requestId(input);
  const note = String(input.note || '').trim();
  if (note.length > 500) throw policy.error('说明最多500字');
  if (mode === 'confirm' && !['pass', 'exception'].includes(input.decision)) throw policy.error('请选择通过或异常');
  if (mode === 'confirm' && input.decision === 'pass' && input.identityConfirmed !== true) throw policy.error('请先确认现场身份与预约人一致');
  if (mode === 'confirm' && input.decision === 'exception' && note.length < 2) throw policy.error('请填写异常情况');
  let roomId;
  const result = await repository.atomic(async runner => {
    const previous = await repository.findRequest(runner, scope.adminId, key);
    if (previous) { policy.assertScope(scope, previous.building_id); return { ...storedResult(previous), replayed: true }; }
    let reservation, outcome = 'rejected', reasonCode = 'INVALID_CREDENTIAL', result, writing = false;
    try {
      const parsed = credentials.parseInput(input.credential);
      reservation = await loadReservation(Number(parsed.payload.rid), runner);
      if (!reservation) throw policy.error('预约不存在', 404, 'NOT_FOUND');
      policy.assertScope(scope, reservation.building_id);
      await activeCredential(parsed, reservation);
      const eligibility = policy.eligibility(reservation);
      const existing = await repository.findSuccess(runner, Number(reservation.id));
      result = { ...eligibility, reservation: policy.present(reservation), verified: !!existing || reservation.status === 'checked_in', checkedIn: reservation.status === 'checked_in', verifiedAt: existing && existing.verified_at, firstEventId: existing && existing.event_id };
      if (mode === 'confirm' && input.decision === 'exception') { outcome = 'exception'; reasonCode = 'IDENTITY_EXCEPTION'; result.message = '异常已登记，请联系书院导生会会长团；本次未办理签到'; }
      else if (existing || reservation.status === 'checked_in') { outcome = 'duplicate'; reasonCode = 'ALREADY_CHECKED_IN'; result.message = '该预约已签到，本次未重复办理'; }
      else if (!eligibility.eligible) { outcome = 'rejected'; reasonCode = eligibility.reasonCode; result.message = eligibility.reason; }
      else if (mode === 'preview') { outcome = 'ready'; reasonCode = 'READY'; result.message = eligibility.reason; }
      else {
        const location = locationService.readClientLocation(input);
        const geo = await locationService.verify({ roomId: reservation.room_id, ...location });
        if (geo.mode === locationService.MODES.OUT) throw policy.error('不在签到范围内，请靠近功能房后重试', 409, 'CHECKIN_GEOFENCE_OUT');
        await credentials.consume(input.credential, reservation);
        writing = true;
        await repository.applyCheckin(runner, reservation, locationService.persistColumns({ ...geo, ...location }));
        outcome = 'passed'; reasonCode = 'CHECKED_IN'; result.verified = true; result.checkedIn = true;
        result.reservation.status = 'checked_in'; result.message = '核验通过，签到成功'; Object.assign(result, locationService.responseFlags(geo)); roomId = reservation.room_id;
      }
    } catch (err) {
      if ((err.httpStatus || 500) >= 500 || writing) throw err;
      reasonCode = err.reasonCode || 'INVALID_CREDENTIAL';
      result = { eligible: false, verified: false, message: err.message, reasonCode };
      if (reasonCode === 'OUT_OF_SCOPE') reservation = null;
    }
    const event = await repository.addEvent(runner, { admin_id: scope.adminId, request_id: key, building_id: reservation ? Number(reservation.building_id) : scope.buildingId, reservation_id: reservation ? Number(reservation.id) : null, outcome, reason_code: reasonCode, note, result_json: JSON.stringify({ ...result, outcome, reasonCode }) });
    if (outcome === 'passed') await repository.addSuccess(runner, Number(reservation.id), event.id);
    return storedResult(event);
  });
  if (roomId) await realtime.publishRoomStatusSafely(roomId, 'reservation-verification');
  return result;
}
async function failure(scope, input) {
  policy.assertScope(scope, scope.buildingId);
  const key = requestId(input);
  const reason = ['scan_failed', 'camera_denied'].includes(input.reason) ? input.reason : 'scan_failed';
  return repository.atomic(async runner => {
    const previous = await repository.findRequest(runner, scope.adminId, key);
    if (previous) return storedResult(previous);
    const row = await repository.addEvent(runner, { admin_id: scope.adminId, request_id: key, building_id: scope.buildingId, reservation_id: null, outcome: 'rejected', reason_code: reason, note: '', result_json: JSON.stringify({ outcome: 'rejected', message: '扫码未成功，请重扫宿生最新预约码；仍失败请联系书院导生会会长团' }) });
    return storedResult(row);
  });
}
async function status(user, scope, id) {
  const record = await repository.readSuccess(id);
  const reservation = await loadReservation(id);
  if (!reservation) throw policy.error('预约不存在', 404);
  if (user.role === 'student') { if (Number(user.id) !== Number(reservation.user_id)) throw policy.error('无权查看此预约', 403); }
  else policy.assertScope(scope, reservation.building_id);
  return { reservationId: id, verified: !!record || ['checked_in', 'completed'].includes(reservation.status), checkedIn: ['checked_in', 'completed'].includes(reservation.status), verifiedAt: record ? record.verified_at : null, reservationStatus: reservation.status };
}
module.exports = { process, failure, status, loadReservation, activeCredential, storedResult };
