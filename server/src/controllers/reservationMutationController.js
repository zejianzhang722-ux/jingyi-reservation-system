const dayjs = require('dayjs');
const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const config = require('../config');
const helpers = require('../utils/helpers');
const reservationCommandService = require('../services/reservationCommandService');
const mutationService = require('../services/reservationMutationService');
const realtimeEventService = require('../services/realtimeEventService');

const update = async function(req, res) {
  try {
    const updated = await mutationService.updateReservation({
      reservationId: Number(req.params.id),
      actor: { id: req.user.id, role: req.user.role || 'student' },
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      seatId: req.body.seatId,
      purpose: req.body.purpose
    });
    await realtimeEventService.publishRoomStatusSafely(updated.room_id, 'reservation-updated');
    return response.success(res, {
      id: updated.id,
      startTime: updated.start_time,
      endTime: updated.end_time,
      seatId: updated.seat_id || null,
      purpose: updated.purpose || ''
    }, '修改成功');
  } catch (err) {
    logger.error('事务修改预约异常:', err);
    return response.error(res, err.message || '修改预约失败', err.httpStatus || 500);
  }
};

const rebook = async function(req, res) {
  try {
    const reservationId = Number(req.params.id);
    const [rows] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (!rows || rows.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const old = rows[0];
    if ((req.user.role || 'student') === 'student' && Number(old.user_id) !== Number(req.user.id)) {
      return response.error(res, '无权再次预约此记录', 403);
    }

    const nextDate = helpers.formatDate(dayjs(old.date).add(1, 'day'));
    if (!helpers.isDateInRange(nextDate, config.reservation.advanceDays)) {
      return response.error(res, '超出可预约日期范围', 400);
    }

    const headerKey = req.get('Idempotency-Key') || req.get('X-Idempotency-Key');
    const fallbackKey = 'rebook:' + old.id + ':' + nextDate + ':' + req.user.id;
    const created = await reservationCommandService.createReservation({
      userId: old.user_id,
      roomId: old.room_id,
      seatId: old.seat_id || null,
      date: nextDate,
      startTime: old.start_time,
      endTime: old.end_time,
      purpose: old.purpose || '',
      participants: Number(old.participants || 1),
      idempotencyKey: headerKey || fallbackKey
    });

    if (!created.idempotent) {
      await realtimeEventService.publishRoomStatusSafely(created.roomId, 'reservation-rebooked');
    }
    return response.success(res, created, created.idempotent ? '预约已存在' : '再次预约成功');
  } catch (err) {
    logger.error('事务再次预约异常:', err);
    return response.error(res, err.message || '再次预约失败', err.httpStatus || 500);
  }
};

module.exports = { update, rebook };
