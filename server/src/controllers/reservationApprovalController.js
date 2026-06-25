const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const notificationService = require('../services/notificationService');
const wechatService = require('../services/wechatService');
const lifecycleService = require('../services/reservationLifecycleService');
const realtimeEventService = require('../services/realtimeEventService');

const allowedStatusesForRole = function(role) {
  if (role === 'super_admin') return ['pending', 'counselor_pending'];
  if (role === 'counselor') return ['counselor_pending'];
  if (role === 'admin') return ['pending'];
  return [];
};

const ensureApprovalScope = function(req, res, reservation) {
  const allowedStatuses = allowedStatusesForRole(req.user && req.user.role);
  const approvableStatuses = ['pending', 'counselor_pending'];
  if (allowedStatuses.length === 0) {
    response.error(res, '权限不足', 403);
    return false;
  }
  if (!approvableStatuses.includes(reservation.status)) {
    response.error(res, '该预约已被处理，请刷新后重试', 409);
    return false;
  }
  if (!allowedStatuses.includes(reservation.status)) {
    response.error(res, '当前角色无权处理该审核', 403);
    return false;
  }
  return true;
};

const createNotificationSafely = async function(userId, type, title, content, data) {
  try {
    await notificationService.createNotification(userId, type, title, content, data);
  } catch (err) {
    logger.error('创建审批站内通知失败:', err);
  }
};

const pending = async function(req, res) {
  try {
    const allowedStatuses = allowedStatusesForRole(req.user.role);
    if (allowedStatuses.length === 0) {
      return response.error(res, '权限不足', 403);
    }

    const placeholders = allowedStatuses.map(function() { return '?'; }).join(',');
    const [reservations] = await db.query(
      'SELECT r.*, rm.name AS roomName, rm.name AS room_name, ' +
      'u.real_name AS userName, u.real_name AS user_name, u.student_id, u.student_no ' +
      'FROM reservations r ' +
      'JOIN rooms rm ON r.room_id = rm.id ' +
      'JOIN users u ON r.user_id = u.id ' +
      'WHERE r.status IN (' + placeholders + ') ' +
      'ORDER BY r.created_at DESC LIMIT 50',
      allowedStatuses
    );
    return response.success(res, reservations);
  } catch (err) {
    logger.error('获取待审批列表异常:', err);
    return response.error(res, '获取待审批列表失败', 500);
  }
};

const pendingCount = async function(req, res) {
  try {
    const allowedStatuses = allowedStatusesForRole(req.user.role);
    if (allowedStatuses.length === 0) {
      return response.error(res, '权限不足', 403);
    }

    const placeholders = allowedStatuses.map(function() { return '?'; }).join(',');
    const [result] = await db.query(
      'SELECT COUNT(*) AS count FROM reservations WHERE status IN (' + placeholders + ')',
      allowedStatuses
    );
    return response.success(res, { count: Number(result[0].count) || 0 });
  } catch (err) {
    logger.error('获取待审批数量异常:', err);
    return response.error(res, '获取待审批数量失败', 500);
  }
};

const approve = async function(req, res) {
  try {
    const id = Number(req.params.id);
    const [reservations] = await db.query(
      'SELECT r.*, rm.name AS room_name, u.openid FROM reservations r ' +
      'JOIN rooms rm ON r.room_id = rm.id ' +
      'JOIN users u ON r.user_id = u.id WHERE r.id = ?',
      [id]
    );
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (!ensureApprovalScope(req, res, reservation)) return;

    const [updateResult] = await db.query(
      "UPDATE reservations SET status = 'approved', audited_by = ?, audited_at = NOW() " +
      'WHERE id = ? AND status = ?',
      [req.user.id, id, reservation.status]
    );
    if (!updateResult || updateResult.affectedRows === 0) {
      return response.error(res, '该预约已被其他管理员处理，请刷新后重试', 409);
    }

    await createNotificationSafely(
      reservation.user_id,
      'reservation_approved',
      '预约已通过',
      '您在' + reservation.room_name + '的预约已通过审批',
      { reservationId: id }
    );

    if (reservation.openid) {
      wechatService.sendReservationApproved(
        reservation.openid,
        reservation.room_name || '',
        reservation.date || '',
        reservation.start_time || '',
        reservation.end_time || ''
      ).catch(function(err) {
        logger.warn('发送审批通过订阅消息失败: ' + err.message);
      });
    }

    await realtimeEventService.publishRoomStatusSafely(reservation.room_id, 'reservation-approved');
    return response.success(res, null, '审批通过');
  } catch (err) {
    logger.error('审批异常:', err);
    return response.error(res, err.message || '审批失败', err.httpStatus || 500);
  }
};

const reject = async function(req, res) {
  try {
    const id = Number(req.params.id);
    const reason = String((req.body && req.body.reason) || '').trim();
    if (!reason) {
      return response.error(res, '请填写拒绝原因', 400);
    }

    const [reservations] = await db.query(
      'SELECT r.*, rm.name AS room_name, u.openid FROM reservations r ' +
      'JOIN rooms rm ON r.room_id = rm.id ' +
      'JOIN users u ON r.user_id = u.id WHERE r.id = ?',
      [id]
    );
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (!ensureApprovalScope(req, res, reservation)) return;

    await lifecycleService.releaseAndPromote({
      reservationId: id,
      nextStatus: 'rejected',
      reason,
      auditedBy: req.user.id,
      allowedCurrentStatuses: [reservation.status]
    });

    await createNotificationSafely(
      reservation.user_id,
      'reservation_rejected',
      '预约未通过',
      '您在' + reservation.room_name + '的预约未通过，原因：' + reason,
      { reservationId: id }
    );

    if (reservation.openid) {
      wechatService.sendReservationRejected(
        reservation.openid,
        reservation.room_name || '',
        reservation.date || '',
        reason
      ).catch(function(err) {
        logger.warn('发送审批拒绝订阅消息失败: ' + err.message);
      });
    }

    return response.success(res, null, '已拒绝');
  } catch (err) {
    logger.error('拒绝预约异常:', err);
    return response.error(res, err.message || '拒绝预约失败', err.httpStatus || 500);
  }
};

module.exports = {
  allowedStatusesForRole,
  ensureApprovalScope,
  pending,
  pendingCount,
  approve,
  reject
};
