const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const notificationService = require('../services/notificationService');
const wechatPushService = require('../services/wechatPushService');
const reservationApprovalController = require('./reservationApprovalController');

const allowedStatusesForRole = reservationApprovalController.allowedStatusesForRole;

const normalizePagination = function(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 10));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

const getRequestedStatuses = function(req) {
  const roleStatuses = allowedStatusesForRole(req.user && req.user.role);
  const requestedType = req.query && req.query.type;
  if (requestedType === 'counselor') {
    return roleStatuses.filter(function(status) { return status === 'counselor_pending'; });
  }
  if (requestedType === 'admin') {
    return roleStatuses.filter(function(status) { return status === 'pending'; });
  }
  return roleStatuses;
};

const pendingList = async function(req, res) {
  try {
    const statuses = getRequestedStatuses(req);
    if (statuses.length === 0) {
      return response.error(res, '当前角色无权查看该审核队列', 403);
    }

    const pagination = normalizePagination(req.query || {});
    const placeholders = statuses.map(function() { return '?'; }).join(',');
    const params = statuses.slice();
    params.push(pagination.pageSize, pagination.offset);

    const [reservations] = await db.query(
      "SELECT r.*, rm.name AS room_name, rm.type AS room_type, " +
      "u.nickname, u.real_name, u.student_id, u.student_no " +
      "FROM reservations r " +
      "JOIN rooms rm ON r.room_id = rm.id " +
      "JOIN users u ON r.user_id = u.id " +
      "WHERE r.status IN (" + placeholders + ") " +
      "ORDER BY r.created_at ASC LIMIT ? OFFSET ?",
      params
    );

    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM reservations WHERE status IN (' + placeholders + ')',
      statuses
    );

    return response.paginate(
      res,
      reservations,
      Number(countResult[0].total) || 0,
      pagination.page,
      pagination.pageSize
    );
  } catch (err) {
    logger.error('获取待审核列表异常:', err);
    return response.error(res, '获取待审核列表失败', 500);
  }
};

// 单条审核统一复用预约接口控制器，避免 /audit 与 /reservation 两套权限规则漂移。
const approve = reservationApprovalController.approve;
const reject = reservationApprovalController.reject;

const notifyBatchResult = async function(reservation, action, reason) {
  const approved = action === 'approve';
  const title = approved ? '预约已通过' : '预约未通过';
  const content = approved
    ? '您在' + reservation.room_name + '的预约已通过审核'
    : '您在' + reservation.room_name + '的预约未通过，原因：' + reason;

  try {
    await notificationService.createNotification(
      reservation.user_id,
      approved ? 'reservation_approved' : 'reservation_rejected',
      title,
      content,
      { reservationId: reservation.id }
    );
  } catch (err) {
    logger.error('批量审核站内通知创建失败:', err);
  }

  try {
    await Promise.resolve(
      wechatPushService.pushReservationApproval(
        reservation.user_id,
        reservation.id,
        approved ? 'approved' : 'rejected'
      )
    );
  } catch (err) {
    logger.warn('批量审核微信通知发送失败: ' + err.message);
  }
};

const batchAudit = async function(req, res) {
  try {
    const ids = Array.from(new Set((req.body.ids || []).map(Number)));
    const action = req.body.action;
    const reason = String(req.body.reason || '').trim();
    const allowedStatuses = allowedStatusesForRole(req.user && req.user.role);

    if (allowedStatuses.length === 0) {
      return response.error(res, '权限不足', 403);
    }
    if (action === 'reject' && !reason) {
      return response.error(res, '批量拒绝时必须填写原因', 400);
    }

    const reservations = [];
    for (const id of ids) {
      const [rows] = await db.query(
        'SELECT r.*, rm.name AS room_name FROM reservations r ' +
        'JOIN rooms rm ON r.room_id = rm.id WHERE r.id = ?',
        [id]
      );
      if (!rows || rows.length === 0) {
        return response.error(res, '预约不存在：' + id, 404);
      }
      const reservation = rows[0];
      if (!['pending', 'counselor_pending'].includes(reservation.status)) {
        return response.error(res, '预约已被处理：' + id, 409);
      }
      if (!allowedStatuses.includes(reservation.status)) {
        return response.error(res, '当前角色无权处理预约：' + id, 403);
      }
      reservations.push(reservation);
    }

    for (const reservation of reservations) {
      let updateResult;
      if (action === 'approve') {
        [updateResult] = await db.query(
          "UPDATE reservations SET status = 'approved', audited_at = NOW(), audited_by = ? " +
          'WHERE id = ? AND status = ?',
          [req.user.id, reservation.id, reservation.status]
        );
      } else {
        [updateResult] = await db.query(
          "UPDATE reservations SET status = 'rejected', audited_at = NOW(), audited_by = ?, reject_reason = ? " +
          'WHERE id = ? AND status = ?',
          [req.user.id, reason, reservation.id, reservation.status]
        );
      }

      if (!updateResult || updateResult.affectedRows === 0) {
        return response.error(res, '部分预约已被其他管理员处理，请刷新后重试', 409);
      }
      await notifyBatchResult(reservation, action, reason);
    }

    return response.success(res, { processed: reservations.length }, '批量审核完成');
  } catch (err) {
    logger.error('批量审核异常:', err);
    return response.error(res, '批量审核失败', 500);
  }
};

const counselorPending = async function(req, res) {
  if (!['counselor', 'super_admin'].includes(req.user && req.user.role)) {
    return response.error(res, '仅辅导员或超级管理员可查看该队列', 403);
  }
  req.query = Object.assign({}, req.query, { type: 'counselor' });
  return pendingList(req, res);
};

module.exports = { pendingList, approve, reject, batchAudit, counselorPending };
