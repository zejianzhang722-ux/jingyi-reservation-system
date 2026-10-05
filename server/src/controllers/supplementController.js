/**
 * 补签工单控制器（架构设计 R-08 / 任务 T04）。
 *
 * 鉴权：路由层已保证 `auth` + `requireAdmin` + `loadAdminScope`（admin / super_admin / counselor）。
 * 出口脱敏：列表接口经 `privacyAuditService.maskRowsForRequest`（R-14 统一出口）。
 */

const response = require('../utils/response');
const logger = require('../config/logger');
const privacyAuditService = require('../services/privacyAuditService');
const supplementService = require('../services/supplementService');

/**
 * 统一错误响应：带 businessCode 时走 errorWithCode（保留既有 code 数字语义），否则回退 error。
 */
const respondError = function(res, err, fallbackMessage, fallbackStatus) {
  const status = Number(err && err.httpStatus) || Number(fallbackStatus) || 500;
  const businessCode = err && err.businessCode ? err.businessCode : null;
  const message = (err && err.message) || fallbackMessage || '操作失败';
  if (businessCode) {
    return response.errorWithCode(res, status, businessCode, { message: message });
  }
  logger.error(fallbackMessage || '补签异常:', err);
  return response.error(res, message, status);
};

/** POST /checkin/supplement —— 提交补签申请。 */
const create = async function(req, res) {
  try {
    const body = req.body || {};
    const created = await supplementService.create({
      reservationId: body.reservationId,
      applicantId: req.user.id,
      actorRole: req.user.role,
      type: body.type,
      reason: body.reason
    });
    return response.success(res, created, '补签申请已提交');
  } catch (err) {
    return respondError(res, err, '提交补签申请失败', 400);
  }
};

/** GET /checkin/supplement —— 查询补签工单（可按状态 / 预约筛选，出口脱敏）。 */
const list = async function(req, res) {
  try {
    const rows = await supplementService.list({
      status: req.query ? req.query.status : undefined,
      reservationId: req.query ? req.query.reservationId : undefined,
      adminScope: req.adminScope
    });
    const safeRows = await privacyAuditService.maskRowsForRequest(req, rows, {
      targetTable: 'supplement_requests',
      description: '补签工单列表：管理员查看明文个人信息'
    });
    return response.success(res, safeRows);
  } catch (err) {
    return respondError(res, err, '获取补签工单失败', 500);
  }
};

/** POST /checkin/supplement/:id/review —— 审核补签工单（approve / reject）。 */
const review = async function(req, res) {
  try {
    const body = req.body || {};
    const result = await supplementService.review({
      requestId: req.params.id,
      reviewerId: req.user.id,
      reviewerRole: req.user.role,
      action: body.action,
      reason: body.reason,
      adminScope: req.adminScope
    });
    return response.success(res, result, result.action === 'approve' ? '补签已通过' : '补签已驳回');
  } catch (err) {
    return respondError(res, err, '补签审核失败', 400);
  }
};

module.exports = { create, list, review };
