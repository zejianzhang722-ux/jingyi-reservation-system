const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const config = require('../config');
const creditService = require('../services/creditService');
const notificationService = require('../services/notificationService');
const helpers = require('../utils/helpers');

const checkin = async function(req, res) {
  try {
    const { reservationId, code } = req.body;
    const userId = req.user.id;

    const [reservations] = await db.query(
      "SELECT r.*, rm.name as room_name FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.id = ?",
      [reservationId]
    );
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (Number(reservation.user_id) !== Number(userId) && req.user.role === 'student') {
      return response.error(res, '无权签到此预约', 403);
    }

    if (reservation.status !== 'approved') {
      return response.error(res, '当前预约状态无法签到', 400);
    }

    const now = new Date();
    const today = helpers.formatDate(now);
    if (reservation.date !== today) {
      return response.error(res, '只能在预约当天签到', 400);
    }

    const currentTime = helpers.formatTime(now);
    const startMinutes = helpers.timeToMinutes(reservation.start_time);
    const currentMinutes = helpers.timeToMinutes(currentTime);

    if (currentMinutes < startMinutes - 30) {
      return response.error(res, '未到签到时间，最早可提前30分钟签到', 400);
    }

    if (currentMinutes > startMinutes + config.reservation.lateMinutes) {
      return response.error(res, '已超过签到时间' + config.reservation.lateMinutes + '分钟', 400);
    }

    const [existingCheckin] = await db.query(
      'SELECT id FROM checkins WHERE reservation_id = ?',
      [reservationId]
    );
    if (existingCheckin.length > 0) {
      return response.error(res, '已签到，请勿重复签到', 400);
    }

    await db.query(
      'INSERT INTO checkins (reservation_id, user_id, room_id, checkin_time, checkin_type, created_at) VALUES (?, ?, ?, NOW(), ?, NOW())',
      [reservationId, userId, reservation.room_id, code ? 'qrcode' : 'manual']
    );

    await db.query("UPDATE reservations SET status = 'checked_in' WHERE id = ?", [reservationId]);

    return response.success(res, null, '签到成功');
  } catch (err) {
    logger.error('签到异常:', err);
    return response.error(res, err.message);
  }
};

const checkout = async function(req, res) {
  try {
    const { reservationId } = req.body;

    const [checkins] = await db.query(
      'SELECT * FROM checkins WHERE reservation_id = ? AND checkout_time IS NULL',
      [reservationId]
    );
    if (checkins.length === 0) {
      return response.error(res, '未找到签到记录', 404);
    }

    await db.query('UPDATE checkins SET checkout_time = NOW() WHERE id = ?', [checkins[0].id]);
    await db.query("UPDATE reservations SET status = 'completed' WHERE id = ?", [reservationId]);

    await creditService.addCredit(checkins[0].user_id, config.credit.goodReward, 'good_behavior', '正常使用功能房');

    return response.success(res, null, '签退成功');
  } catch (err) {
    logger.error('签退异常:', err);
    return response.error(res, err.message);
  }
};

const getStatus = async function(req, res) {
  try {
    const reservationId = req.params.reservationId;

    const [checkins] = await db.query(
      'SELECT * FROM checkins WHERE reservation_id = ?',
      [reservationId]
    );

    return response.success(res, {
      checkedIn: checkins.length > 0,
      checkinTime: checkins.length > 0 ? checkins[0].checkin_time : null,
      checkoutTime: checkins.length > 0 ? checkins[0].checkout_time : null
    });
  } catch (err) {
    logger.error('获取签到状态异常:', err);
    return response.error(res, err.message);
  }
};

const manualCheckin = async function(req, res) {
  try {
    const { reservationId, userId } = req.body;

    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const [existingCheckin] = await db.query(
      'SELECT id FROM checkins WHERE reservation_id = ?',
      [reservationId]
    );
    if (existingCheckin.length > 0) {
      return response.error(res, '已签到', 400);
    }

    await db.query(
      'INSERT INTO checkins (reservation_id, user_id, room_id, checkin_time, checkin_type, created_at) VALUES (?, ?, ?, NOW(), ?, NOW())',
      [reservationId, userId || reservations[0].user_id, reservations[0].room_id, 'admin_manual']
    );

    await db.query("UPDATE reservations SET status = 'checked_in' WHERE id = ?", [reservationId]);

    return response.success(res, null, '手动签到成功');
  } catch (err) {
    logger.error('手动签到异常:', err);
    return response.error(res, err.message);
  }
};

const currentCheckins = async function(req, res) {
  try {
    const roomId = req.params.roomId;

    const [checkins] = await db.query(
      "SELECT c.*, r.date, r.start_time, r.end_time, u.nickname, u.real_name, u.student_id FROM checkins c JOIN reservations r ON c.reservation_id = r.id JOIN users u ON c.user_id = u.id WHERE c.room_id = ? AND c.checkout_time IS NULL ORDER BY c.checkin_time DESC",
      [roomId]
    );

    return response.success(res, checkins);
  } catch (err) {
    logger.error('获取当前签到列表异常:', err);
    return response.error(res, err.message);
  }
};

const patrol = async function(req, res) {
  try {
    const { roomId, reservationId, status, note } = req.body;

    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    if (status === 'absent') {
      await db.query("UPDATE reservations SET status = 'noshow' WHERE id = ?", [reservationId]);
      await creditService.addCredit(reservations[0].user_id, config.credit.noshowPenalty, 'noshow', '巡查发现爽约');
    }

    return response.success(res, null, '巡查记录已提交');
  } catch (err) {
    logger.error('巡查异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { checkin, checkout, getStatus, manualCheckin, currentCheckins, patrol };
