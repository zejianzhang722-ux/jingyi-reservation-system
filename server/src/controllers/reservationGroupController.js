const logger = require('../config/logger');
const response = require('../utils/response');
const adminScope = require('../middleware/adminScope');
const reservationGroupService = require('../services/reservationGroupService');

const ADMIN_ROLES = ['super_admin', 'admin', 'counselor'];

const isAdmin = function(user) {
  return !!user && ADMIN_ROLES.indexOf(user.role) !== -1;
};

const parseId = function(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
};

const fail = function(res, err, fallbackMessage) {
  const status = Number(err && err.httpStatus) || 500;
  if (status >= 500) {
    logger.error('团队预约操作异常:', err);
  }
  return response.error(res, (err && err.message) || fallbackMessage, status);
};

/** 管理员只能处理自己楼栋范围内的组团。 */
const ensureGroupInScope = function(req, res, group) {
  if (!req.adminScope) return true;
  if (req.adminScope.isGlobal) return true;
  if (adminScope.assertBuilding(req.adminScope, group.buildingId)) return true;
  response.error(res, '无权访问其他楼栋数据', 403);
  return false;
};

const parsePagination = function(query) {
  const page = Math.max(1, Number(query && query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(query && query.pageSize) || 10));
  return { page, pageSize };
};

// ---------------------------------------------------------------------------
// 学生端
// ---------------------------------------------------------------------------

const create = async function(req, res) {
  try {
    const group = await reservationGroupService.createGroup(req.user.id, req.body || {});
    return response.success(res, group, '创建成功', 201);
  } catch (err) {
    return fail(res, err, '创建组团失败');
  }
};

const detail = async function(req, res) {
  try {
    const groupId = parseId(req.params.id);
    if (!groupId) return response.error(res, '组团ID无效', 400);

    const group = await reservationGroupService.loadGroup(groupId, req.user.id);
    // 非成员且非管理员不能查看他人组团。
    if (!group.isMember && !isAdmin(req.user)) {
      return response.error(res, '无权查看该组团', 403);
    }
    if (isAdmin(req.user) && !ensureGroupInScope(req, res, group)) return;
    return response.success(res, group);
  } catch (err) {
    return fail(res, err, '获取组团详情失败');
  }
};

const join = async function(req, res) {
  try {
    const groupId = parseId(req.params.id);
    if (!groupId) return response.error(res, '组团ID无效', 400);

    const group = await reservationGroupService.joinGroup(groupId, req.user.id);
    return response.success(res, group, '加入成功');
  } catch (err) {
    return fail(res, err, '加入组团失败');
  }
};

const leave = async function(req, res) {
  try {
    const groupId = parseId(req.params.id);
    if (!groupId) return response.error(res, '组团ID无效', 400);

    const group = await reservationGroupService.leaveGroup(groupId, req.user.id);
    return response.success(res, group, '已退出');
  } catch (err) {
    return fail(res, err, '退出组团失败');
  }
};

const dissolve = async function(req, res) {
  try {
    const groupId = parseId(req.params.id);
    if (!groupId) return response.error(res, '组团ID无效', 400);

    const group = await reservationGroupService.dissolveGroup(groupId, req.user.id);
    return response.success(res, group, '组团已解散');
  } catch (err) {
    return fail(res, err, '解散组团失败');
  }
};

const mine = async function(req, res) {
  try {
    const pagination = parsePagination(req.query);
    const result = await reservationGroupService.listMyGroups(req.user.id, pagination);
    return response.paginate(res, result.list, result.total, result.page, result.pageSize);
  } catch (err) {
    return fail(res, err, '获取我的组团失败');
  }
};

// ---------------------------------------------------------------------------
// 管理端
// ---------------------------------------------------------------------------

const pending = async function(req, res) {
  try {
    const statuses = reservationGroupService.allowedApprovalStatusesForRole(req.user.role);
    if (!statuses.length) return response.error(res, '权限不足', 403);

    const pagination = parsePagination(req.query);
    const roomId = Number(req.query && req.query.roomId);
    const result = await reservationGroupService.listPendingGroups({
      statuses,
      buildingId: req.adminScope && !req.adminScope.isGlobal ? req.adminScope.buildingId : null,
      roomId: Number.isInteger(roomId) && roomId > 0 ? roomId : null,
      date: (req.query && req.query.date) ? String(req.query.date).slice(0, 10) : null,
      page: pagination.page,
      pageSize: pagination.pageSize
    });
    return response.paginate(res, result.list, result.total, result.page, result.pageSize);
  } catch (err) {
    return fail(res, err, '获取待审组团失败');
  }
};

const approve = async function(req, res) {
  try {
    const groupId = parseId(req.params.id);
    if (!groupId) return response.error(res, '组团ID无效', 400);

    const preview = await reservationGroupService.loadGroup(groupId, req.user.id);
    if (!ensureGroupInScope(req, res, preview)) return;

    const group = await reservationGroupService.approveGroup(groupId, req.user.id, req.user.role, { requestId: req.requestId });
    return response.success(res, group, '审批通过');
  } catch (err) {
    return fail(res, err, '审批失败');
  }
};

const reject = async function(req, res) {
  try {
    const groupId = parseId(req.params.id);
    if (!groupId) return response.error(res, '组团ID无效', 400);

    const preview = await reservationGroupService.loadGroup(groupId, req.user.id);
    if (!ensureGroupInScope(req, res, preview)) return;

    const group = await reservationGroupService.rejectGroup(
      groupId,
      req.user.id,
      req.user.role,
      (req.body && req.body.reason) || ''
    );
    return response.success(res, group, '已拒绝');
  } catch (err) {
    return fail(res, err, '拒绝失败');
  }
};

module.exports = {
  create,
  detail,
  join,
  leave,
  dissolve,
  mine,
  pending,
  approve,
  reject
};
