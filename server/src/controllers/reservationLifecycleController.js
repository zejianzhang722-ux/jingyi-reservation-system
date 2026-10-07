const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const notificationService = require('../services/notificationService');
const lifecycleService = require('../services/reservationLifecycleService');

const cancel = async function(req, res) {
  try {
    const reservationId = Number(req.params.id);
    const [rows] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (!rows.length) return response.error(res, '预约不存在', 404);

    const reservation = rows[0];
    if ((req.user.role || 'student') === 'student' && Number(reservation.user_id) !== Number(req.user.id)) {
      return response.error(res, '无权取消此预约', 403);
    }
    if (!['approved', 'pending', 'counselor_pending', 'cancelled'].includes(reservation.status)) {
      return response.error(res, '当前状态无法取消', 409);
    }

    const result = await lifecycleService.releaseAndPromote({
      reservationId,
      nextStatus: 'cancelled',
      actorUserId: req.user.id,
      actorRole: req.user.role || 'student',
      allowedCurrentStatuses: ['approved', 'pending', 'counselor_pending']
    });

    try {
      if (!result.idempotent) await notificationService.createNotification(
        reservation.user_id,
        'reservation_cancelled',
        '预约已取消',
        '您在' + String(reservation.date).slice(0, 10) + '的预约已取消',
        { reservationId }
      );
    } catch (notifyErr) {
      logger.error('预约取消已提交，但通知失败:', notifyErr);
    }

    return response.success(res, {
      promotedReservation: result.promotedReservation || null,
      idempotent: !!result.idempotent
    }, '取消成功');
  } catch (err) {
    logger.error('原子取消预约异常:', err);
    return response.error(res, err.message || '取消失败', err.httpStatus || 500);
  }
};

module.exports = { cancel };
