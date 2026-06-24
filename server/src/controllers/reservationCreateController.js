const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const reservationCommandService = require('../services/reservationCommandService');
const notificationService = require('../services/notificationService');

const normalizeTime = function(body, prefix) {
  const direct = body[prefix + 'Time'];
  if (direct) return direct;
  const hour = body[prefix + 'Hour'];
  const minute = body[prefix + 'Min'];
  if (hour === undefined || hour === null) return null;
  return String(Math.floor(Number(hour))).padStart(2, '0') + ':' + String(Number(minute || 0)).padStart(2, '0');
};

const participantValue = function(body) {
  if (body.participants !== undefined && body.participants !== null && body.participants !== '') {
    return Number(body.participants);
  }
  if (body.participantCount !== undefined && body.participantCount !== null && body.participantCount !== '') {
    return Number(body.participantCount);
  }
  return 1;
};

const create = async function(req, res) {
  try {
    const startTime = normalizeTime(req.body, 'start');
    const endTime = normalizeTime(req.body, 'end');
    if (!startTime || !endTime) {
      return response.error(res, '请提供预约时间段', 400);
    }

    const idempotencyKey = req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || null;
    const created = await reservationCommandService.createReservation({
      userId: req.user.id,
      roomId: req.body.roomId,
      seatId: req.body.seatId || null,
      date: req.body.date,
      startTime,
      endTime,
      purpose: String(req.body.purpose || req.body.purposeCategory || '').trim(),
      participants: participantValue(req.body),
      idempotencyKey
    });

    if (!created.idempotent) {
      try {
        const [rooms] = await db.query('SELECT name FROM rooms WHERE id = ?', [req.body.roomId]);
        const roomName = rooms.length ? rooms[0].name : (created.roomName || '功能房');
        let type = 'reservation_pending';
        let title = '预约待审核';
        let content = '您在' + roomName + '的预约正在审核中';
        if (created.status === 'approved') {
          type = 'reservation_approved';
          title = '预约成功';
          content = '您在' + roomName + '的预约已通过';
        } else if (created.status === 'counselor_pending') {
          title = '预约待辅导员审批';
          content = '您在' + roomName + '的预约需要辅导员审批';
        }
        await notificationService.createNotification(req.user.id, type, title, content, { reservationId: created.id });
      } catch (notifyErr) {
        logger.error('预约已提交，但通知创建失败:', notifyErr);
      }
    }

    return response.success(res, created, created.idempotent ? '预约已存在' : '预约创建成功');
  } catch (err) {
    logger.error('事务创建预约异常:', err);
    return response.error(res, err.message || '预约创建失败', err.httpStatus || 500);
  }
};

module.exports = { create, participantValue };
