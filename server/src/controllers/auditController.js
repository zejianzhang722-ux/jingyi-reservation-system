const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const notificationService = require('../services/notificationService');
const wechatPushService = require('../services/wechatPushService');

const pendingList = async function(req, res) {
  try {
    const { page = 1, pageSize = 10, type } = req.query;
    const offset = (page - 1) * pageSize;

    let sql = "SELECT r.*, rm.name as room_name, rm.type as room_type, u.nickname, u.real_name, u.student_id FROM reservations r JOIN rooms rm ON r.room_id = rm.id JOIN users u ON r.user_id = u.id WHERE r.status IN ('pending', 'counselor_pending')";
    const params = [];

    if (type === 'counselor') {
      sql += " AND r.status = 'counselor_pending'";
    } else if (type === 'admin') {
      sql += " AND r.status = 'pending'";
    }

    sql += ' ORDER BY r.created_at ASC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [reservations] = await db.query(sql, params);

    const [countResult] = await db.query("SELECT COUNT(*) as total FROM reservations WHERE status IN ('pending', 'counselor_pending')");

    return response.paginate(res, reservations, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取待审核列表异常:', err);
    return response.error(res, err.message);
  }
};

const approve = async function(req, res) {
  try {
    const auditId = req.params.id;

    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [auditId]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (!['pending', 'counselor_pending'].includes(reservation.status)) {
      return response.error(res, '当前状态无法审核', 400);
    }

    await db.query("UPDATE reservations SET status = 'approved', audited_at = NOW(), audited_by = ? WHERE id = ?", [req.user.id, auditId]);

    const [rooms] = await db.query('SELECT name FROM rooms WHERE id = ?', [reservation.room_id]);
    const roomName = rooms[0] ? rooms[0].name : '';

    await notificationService.createNotification(reservation.user_id, 'reservation_approved', '预约已通过', '您在' + roomName + '的预约已通过审核', { reservationId: auditId });

    wechatPushService.pushReservationApproval(reservation.user_id, auditId, 'approved');

    return response.success(res, null, '审核通过');
  } catch (err) {
    logger.error('审核通过异常:', err);
    return response.error(res, err.message);
  }
};

const reject = async function(req, res) {
  try {
    const auditId = req.params.id;
    const { reason } = req.body;

    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [auditId]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (!['pending', 'counselor_pending'].includes(reservation.status)) {
      return response.error(res, '当前状态无法审核', 400);
    }

    await db.query("UPDATE reservations SET status = 'rejected', audited_at = NOW(), audited_by = ?, reject_reason = ? WHERE id = ?", [req.user.id, reason || '', auditId]);

    const [rooms] = await db.query('SELECT name FROM rooms WHERE id = ?', [reservation.room_id]);
    const roomName = rooms[0] ? rooms[0].name : '';

    await notificationService.createNotification(reservation.user_id, 'reservation_rejected', '预约被驳回', '您在' + roomName + '的预约被驳回' + (reason ? '：' + reason : ''), { reservationId: auditId });

    wechatPushService.pushReservationApproval(reservation.user_id, auditId, 'rejected');

    return response.success(res, null, '已驳回');
  } catch (err) {
    logger.error('审核驳回异常:', err);
    return response.error(res, err.message);
  }
};

const batchAudit = async function(req, res) {
  try {
    const { ids, action, reason } = req.body;

    const placeholders = ids.map(function() { return '?'; }).join(',');

    if (action === 'approve') {
      await db.query("UPDATE reservations SET status = 'approved', audited_at = NOW(), audited_by = ? WHERE id IN (" + placeholders + ") AND status IN ('pending', 'counselor_pending')", [req.user.id, ...ids]);
    } else {
      await db.query("UPDATE reservations SET status = 'rejected', audited_at = NOW(), audited_by = ?, reject_reason = ? WHERE id IN (" + placeholders + ") AND status IN ('pending', 'counselor_pending')", [req.user.id, reason || '', ...ids]);
    }

    for (const id of ids) {
      const [reservations] = await db.query('SELECT user_id, room_id FROM reservations WHERE id = ?', [id]);
      if (reservations.length > 0) {
        const [rooms] = await db.query('SELECT name FROM rooms WHERE id = ?', [reservations[0].room_id]);
        const roomName = rooms[0] ? rooms[0].name : '';
        const title = action === 'approve' ? '预约已通过' : '预约被驳回';
        const content = action === 'approve' ? '您在' + roomName + '的预约已通过审核' : '您在' + roomName + '的预约被驳回' + (reason ? '：' + reason : '');
        await notificationService.createNotification(reservations[0].user_id, action === 'approve' ? 'reservation_approved' : 'reservation_rejected', title, content, { reservationId: id });
        wechatPushService.pushReservationApproval(reservations[0].user_id, id, action === 'approve' ? 'approved' : 'rejected');
      }
    }

    return response.success(res, null, '批量审核完成');
  } catch (err) {
    logger.error('批量审核异常:', err);
    return response.error(res, err.message);
  }
};

const counselorPending = async function(req, res) {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const offset = (page - 1) * pageSize;

    const [reservations] = await db.query(
      "SELECT r.*, rm.name as room_name, rm.type as room_type, u.nickname, u.real_name, u.student_id, u.college FROM reservations r JOIN rooms rm ON r.room_id = rm.id JOIN users u ON r.user_id = u.id WHERE r.status = 'counselor_pending' ORDER BY r.created_at ASC LIMIT ? OFFSET ?",
      [parseInt(pageSize), parseInt(offset)]
    );

    const [countResult] = await db.query("SELECT COUNT(*) as total FROM reservations WHERE status = 'counselor_pending'");

    return response.paginate(res, reservations, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取辅导员待审批异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { pendingList, approve, reject, batchAudit, counselorPending };
