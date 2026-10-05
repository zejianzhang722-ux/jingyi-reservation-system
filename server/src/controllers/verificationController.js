const service = require('../services/verificationService');
const repository = require('../services/verificationRepository');
const credentials = require('../services/checkinCredentialService');
const QRCode = require('qrcode');
const response = require('../utils/response');
const policy = require('../services/verificationPolicy');
const overview = require('../services/verificationOverviewService');
const db = require('../config/database');
function handle(fn) { return async (req, res) => { try { return response.success(res, await fn(req)); } catch (err) { return response.error(res, err.httpStatus ? err.message : '核验服务暂不可用，请稍后重试', err.httpStatus || 503); } }; }
const preview = handle(req => service.process(req.adminScope, req.body, 'preview'));
const confirm = handle(req => service.process(req.adminScope, req.body, 'confirm'));
const failure = handle(req => service.failure(req.adminScope, req.body));
const records = handle(async req => {
  for (const field of ['from', 'to']) if (req.query[field] && !/^\d{4}-\d{2}-\d{2}$/.test(req.query[field])) throw policy.error('查询日期格式不正确');
  const result = await repository.list(req.adminScope, req.query);
  result.list = result.list.map(row => ({ id: row.id, adminId: row.admin_id, buildingId: row.building_id, reservationId: row.reservation_id, outcome: row.outcome, reasonCode: row.reason_code, note: row.note, result: service.storedResult(row), createdAt: row.created_at, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by, resolution: row.resolution }));
  return result;
});
const resolve = handle(req => {
  const note = String(req.body.note || '').trim();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0 || note.length < 2 || note.length > 500) throw policy.error('请填写2至500字的处理说明');
  return repository.atomic(runner => repository.resolve(runner, id, req.adminScope, note));
});
const status = handle(req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw policy.error('预约编号无效');
  return service.status(req.user, req.adminScope, id);
});
const credential = handle(async req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw policy.error('预约编号无效');
  const reservation = await service.loadReservation(id);
  if (!reservation) throw policy.error('预约不存在', 404);
  if (Number(reservation.user_id) !== Number(req.user.id)) throw policy.error('无权获取他人的核验码', 403);
  if (reservation.status !== 'approved') throw policy.error(reservation.status === 'checked_in' ? '已签到，无需再次生成签到码' : '当前预约状态不能生成核验码', 409);
  const issued = await credentials.issue(reservation);
  const payload = JSON.stringify({ type: 'jingyi-checkin', version: 1, reservationId: id, credential: issued.credential });
  const state = await service.status(req.user, null, id);
  return { qrcode: await QRCode.toDataURL(payload, { width: 420, margin: 2 }), credential: issued.credential, code: issued.reference, expiresAt: issued.expiresAt, refreshAfter: issued.refreshAfter, expiresIn: issued.expiresIn, ...state };
});
const reservations = handle(req => overview.list(req.adminScope, req.query));
const spaces = handle(req => require('../services/dormSpaceService').list(req.adminScope));
const me = handle(async req => {
  const scope = req.adminScope;
  const [buildings] = scope.isGlobal ? [[]] : await db.query('SELECT id, name FROM buildings WHERE id = ?', [scope.buildingId]);
  if (!scope.isGlobal && !buildings[0]) throw policy.error('负责楼栋不存在，请联系管理员', 403);
  return { role: scope.role, buildingId: scope.buildingId, buildingName: scope.isGlobal ? '全院' : buildings[0].name, isGlobal: scope.isGlobal, canResolve: scope.role !== 'dorm_manager' };
});
module.exports = { preview, confirm, failure, records, resolve, status, credential, reservations, me, spaces };
