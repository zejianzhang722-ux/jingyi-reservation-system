const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const notificationService = require('../services/notificationService');
const wechatPushService = require('../services/wechatPushService');
const reservationLifecycleService = require('../services/reservationLifecycleService');
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

const notifyPromotion = async function(promotion) {
  if (!promotion || !promotion.entry || !promotion.promoted) return;
  try {
    await notificationService.createNotification(
      promotion.entry.user_id,
      'waitlist_converted',
      '候补已转为预约',
      promotion.promoted.status === 'approved'
        ? '您的候补已自动转为正式预约'
        : '您的候补已转为预约，请留意后续审核状态',
      {
        reservationId: promotion.promoted.id,
        roomId: promotion.promoted.roomId,
        date: promotion.promoted.date
      }
    );
  } catch (err) {
    logger.error('批量拒绝候补转正通知失败:', err);
  }
};

const createHttpError = function(status, message) {
  const err = new Error(message);
  err.httpStatus = status;
  return err;
};

const batchAudit = async function(req, res) {
  // 所有批量事务按预约ID升序加锁，降低并发批次之间形成反向锁序的概率。
  const ids = Array.from(new Set((req.body.ids || []).map(Number))).sort(function(a, b) { return a - b; });
  const action = req.body.action;
  const reason = String(req.body.reason || '').trim();
  const allowedStatuses = allowedStatusesForRole(req.user && req.user.role);
  let connection = null;
  let transactional = false;
  let reservations = [];
  const promotions = [];

  try {
    if (allowedStatuses.length === 0) {
      return response.error(res, '权限不足', 403);
    }
    if (action === 'reject' && !reason) {
      return response.error(res, '批量拒绝时必须填写原因', 400);
    }

    connection = await db.getConnection();
    transactional = !!(
      connection &&
      typeof connection.beginTransaction === 'function' &&
      typeof connection.execute === 'function'
    );
    if (transactional) await connection.beginTransaction();

    const runQuery = transactional
      ? function(sql, params) { return connection.execute(sql, params); }
      : db.query;

    reservations = [];
    for (const id of ids) {
      const lockClause = transactional ? ' FOR UPDATE' : '';
      const [rows] = await runQuery(
        'SELECT r.*, rm.name AS room_name FROM reservations r ' +
        'JOIN rooms rm ON r.room_id = rm.id WHERE r.id = ?' + lockClause,
        [id]
      );
      if (!rows || rows.length === 0) {
        throw createHttpError(404, '预约不存在：' + id);
      }
      const reservation = rows[0];
      if (!['pending', 'counselor_pending'].includes(reservation.status)) {
        throw createHttpError(409, '预约已被处理：' + id);
      }
      if (!allowedStatuses.includes(reservation.status)) {
        throw createHttpError(403, '当前角色无权处理预约：' + id);
      }
      reservations.push(reservation);
    }

    for (const reservation of reservations) {
      let updateResult;
      if (action === 'approve') {
        [updateResult] = await runQuery(
          "UPDATE reservations SET status = 'approved', audited_at = NOW(), audited_by = ? " +
          'WHERE id = ? AND status = ?',
          [req.user.id, reservation.id, reservation.status]
        );
      } else {
        [updateResult] = await runQuery(
          "UPDATE reservations SET status = 'rejected', audited_at = NOW(), audited_by = ?, reject_reason = ? " +
          'WHERE id = ? AND status = ?',
          [req.user.id, reason, reservation.id, reservation.status]
        );
        await runQuery('DELETE FROM reservation_slots WHERE reservation_id = ?', [reservation.id]);
        if (transactional) {
          const promotion = await reservationLifecycleService.promoteWithinTransaction(connection, reservation);
          if (promotion) promotions.push(promotion);
        }
      }

      if (!updateResult || updateResult.affectedRows === 0) {
        throw createHttpError(409, '部分预约已被其他管理员处理，请刷新后重试');
      }
    }

    if (transactional) await connection.commit();
  } catch (err) {
    if (transactional && connection && typeof connection.rollback === 'function') {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        logger.error('批量审核回滚失败:', rollbackErr);
      }
    }
    logger.error('批量审核异常:', err);
    return response.error(res, err.message || '批量审核失败', err.httpStatus || 500);
  } finally {
    if (connection && typeof connection.release === 'function') {
      connection.release();
    }
  }

  if (action === 'reject' && !transactional) {
    for (const reservation of reservations) {
      try {
        await reservationLifecycleService.promoteReleasedReservation(reservation);
      } catch (err) {
        logger.error('批量拒绝后的候补转正失败，预约ID=' + reservation.id + ':', err);
      }
    }
  } else {
    for (const promotion of promotions) {
      await notifyPromotion(promotion);
    }
  }

  for (const reservation of reservations) {
    await notifyBatchResult(reservation, action, reason);
  }

  return response.success(res, {
    processed: reservations.length,
    promoted: promotions.length
  }, '批量审核完成');
};

const counselorPending = async function(req, res) {
  if (!['counselor', 'super_admin'].includes(req.user && req.user.role)) {
    return response.error(res, '仅辅导员或超级管理员可查看该队列', 403);
  }
  req.query = Object.assign({}, req.query, { type: 'counselor' });
  return pendingList(req, res);
};

module.exports = { pendingList, approve, reject, batchAudit, counselorPending };
