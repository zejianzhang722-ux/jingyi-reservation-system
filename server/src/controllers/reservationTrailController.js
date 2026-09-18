/**
 * 预约审核轨迹（只读）控制器（架构设计 R-02 / 任务 T05，供 R-07 用户端展示）。
 *
 * 出口约定（R-14）：凡是可能返回个人信息的读接口，统一经
 * `services/privacyAuditService.maskRowsForRequest(req, rows, ...)` 脱敏（内部复用 utils/maskPresenter）。
 * 轨迹本身不含学号/手机号，但为与既有出口口径一致、并为未来扩展留口，这里仍走统一脱敏出口。
 */

const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const privacyAuditService = require('../services/privacyAuditService');
const reservationAuditTrailService = require('../services/reservationAuditTrailService');

const toNullNumber = function(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

/**
 * GET /api/v1/reservation/:id/trail
 * 返回该预约的一审 / 二审轨迹（脱敏后）。
 */
const trail = async function(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return response.error(res, '预约ID无效', 400);

    // 载入预约归属与楼栋（供归属校验 + 脱敏数据域判定）。
    const [reservations] = await db.query(
      'SELECT r.id, r.user_id, rm.building_id FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.id = ?',
      [id]
    );
    if (!reservations || !reservations.length) return response.error(res, '预约不存在', 404);
    const reservation = reservations[0];

    // 宿生仅可查看本人预约的轨迹；管理员的数据域由路由层 adminScope 中间件校验。
    if (req.user && req.user.role === 'student' && Number(reservation.user_id) !== Number(req.user.id)) {
      return response.error(res, '无权查看该预约轨迹', 403);
    }

    const rows = await reservationAuditTrailService.listByReservation(id);
    const shaped = rows.map(function(row) {
      const item = reservationAuditTrailService.present(row);
      // 附带归属上下文，供 maskPresenter 按「本人 / 越权」判定（与列表接口口径一致）。
      item.user_id = toNullNumber(reservation.user_id);
      item.building_id = toNullNumber(reservation.building_id);
      return item;
    });

    const safeRows = await privacyAuditService.maskRowsForRequest(req, shaped, {
      targetTable: 'reservation_audit_trail',
      targetId: id,
      description: '预约审核轨迹：管理员查看明文个人信息'
    });
    return response.success(res, safeRows);
  } catch (err) {
    logger.error('获取预约审核轨迹异常:', err);
    return response.error(res, err.message || '获取预约轨迹失败', err.httpStatus || 500);
  }
};

module.exports = { trail };
