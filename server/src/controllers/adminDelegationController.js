/**
 * 管理端「临时授权 + 岗位交接」控制器（R-06 · 一步式交接）。
 *
 * 鉴权约定（沿用仓库既有风格）：
 *  - 路由层已保证 auth + requireAdmin（admin / super_admin / counselor）；
 *  - 细粒度授权在控制器内判断：能力授予/撤销仅限 super_admin；
 *    岗位交接改为一步式，仅限 super_admin（会长团）在后台操作。
 */

const response = require('../utils/response');
const logger = require('../config/logger');
const errorCodes = require('../config/errorCodes');
const permissions = require('../config/permissions');
const adminCapabilityService = require('../services/adminCapabilityService');
const adminHandoverService = require('../services/adminHandoverService');

const normalizeRole = function(role) {
  return role === 'superadmin' ? 'super_admin' : role;
};

const isSuperAdmin = function(req) {
  return normalizeRole(req.user && req.user.role) === 'super_admin';
};

const requestContextOf = function(req) {
  return {
    requestId: req.requestId,
    method: req.method,
    path: (req.baseUrl || '') + (req.route && req.route.path ? req.route.path : (req.path || ''))
  };
};

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
  logger.error(fallbackMessage || '管理端授权/交接异常:', err);
  return response.error(res, message, status);
};

/** GET /admin/delegations/me —— 查询当前登录管理员的生效能力。 */
const myCapabilities = async function(req, res) {
  try {
    const adminId = req.adminScope && req.adminScope.adminId ? req.adminScope.adminId : req.user.id;
    const records = await adminCapabilityService.listActive(adminId);
    const capabilities = records.map(function(record) { return record.capability; });
    return response.success(res, {
      adminId: Number(adminId),
      capabilities: capabilities,
      grants: records
    });
  } catch (err) {
    return respondError(res, err, '获取当前授权失败', 500);
  }
};

/** GET /admin/delegations/capabilities?adminId= —— 查询授权记录（默认查自己）。 */
const listCapabilities = async function(req, res) {
  try {
    const requested = req.query && req.query.adminId ? Number(req.query.adminId) : null;
    const targetId = requested && Number.isInteger(requested) && requested > 0
      ? requested
      : Number(req.user.id);
    if (targetId !== Number(req.user.id) && !isSuperAdmin(req)) {
      return response.errorWithCode(res, 403, errorCodes.ERROR_CODES.PERMISSION_DENIED, {
        message: '仅超级管理员可查看他人授权'
      });
    }
    const records = await adminCapabilityService.listByAdmin(targetId);
    return response.success(res, { adminId: targetId, grants: records });
  } catch (err) {
    return respondError(res, err, '获取授权列表失败', 500);
  }
};

/** POST /admin/delegations/capabilities —— 授予临时能力（仅 super_admin）。 */
const grantCapability = async function(req, res) {
  try {
    if (!isSuperAdmin(req)) {
      return response.errorWithCode(res, 403, errorCodes.ERROR_CODES.PERMISSION_DENIED, {
        message: '仅超级管理员可授予临时能力'
      });
    }
    const body = req.body || {};
    const granted = await adminCapabilityService.grant({
      adminId: body.adminId,
      capability: body.capability,
      grantedBy: req.user.id,
      validFrom: body.validFrom,
      validTo: body.validTo
    });
    return response.success(res, granted, '授权成功');
  } catch (err) {
    return respondError(res, err, '授权失败', 400);
  }
};

/** DELETE /admin/delegations/capabilities/:id —— 撤销临时能力（仅 super_admin）。 */
const revokeCapability = async function(req, res) {
  try {
    if (!isSuperAdmin(req)) {
      return response.errorWithCode(res, 403, errorCodes.ERROR_CODES.PERMISSION_DENIED, {
        message: '仅超级管理员可撤销临时能力'
      });
    }
    const revoked = await adminCapabilityService.revoke({ grantId: req.params.id });
    if (!revoked) {
      return response.error(res, '授权记录不存在或已失效', 404);
    }
    return response.success(res, null, '已撤销授权');
  } catch (err) {
    return respondError(res, err, '撤销授权失败', 400);
  }
};

/** GET /admin/delegations/handovers —— 查询交接记录（super_admin 可查全部，其他仅查自己相关）。 */
const listHandovers = async function(req, res) {
  try {
    const status = req.query && req.query.status ? String(req.query.status) : '';
    if (Object.keys(permissions.HANDOVER_STATUSES).every(function(key) {
      return permissions.HANDOVER_STATUSES[key] !== status;
    }) && status) {
      return response.error(res, '交接状态无效', 400);
    }
    if (isSuperAdmin(req)) {
      const adminId = req.query && req.query.adminId ? Number(req.query.adminId) : null;
      const records = await adminHandoverService.list({ status: status || undefined, adminId: adminId });
      return response.success(res, records);
    }
    const records = await adminHandoverService.list({ status: status || undefined, adminId: Number(req.user.id) });
    return response.success(res, records);
  } catch (err) {
    return respondError(res, err, '获取交接列表失败', 500);
  }
};

/** POST /admin/delegations/handovers —— 一步式岗位交接（仅 super_admin / 会长团）。 */
const reassignHandover = async function(req, res) {
  try {
    if (!isSuperAdmin(req)) {
      return response.errorWithCode(res, 403, errorCodes.ERROR_CODES.PERMISSION_DENIED, {
        message: '仅超级管理员（会长团）可操作岗位交接'
      });
    }
    const body = req.body || {};
    const fromAdminId = body.fromAdminId === undefined || body.fromAdminId === null
      ? null
      : Number(body.fromAdminId);
    const toAdminId = body.toAdminId === undefined || body.toAdminId === null
      ? null
      : Number(body.toAdminId);
    const note = body.note === undefined || body.note === null ? undefined : String(body.note);
    const result = await adminHandoverService.reassign({
      operatorId: Number(req.user.id),
      fromAdminId: fromAdminId,
      toAdminId: toAdminId,
      note: note,
      requestContext: requestContextOf(req)
    });
    return response.success(res, result, '岗位交接完成');
  } catch (err) {
    return respondError(res, err, '岗位交接失败', 400);
  }
};

module.exports = {
  myCapabilities,
  listCapabilities,
  grantCapability,
  revokeCapability,
  listHandovers,
  reassignHandover
};
