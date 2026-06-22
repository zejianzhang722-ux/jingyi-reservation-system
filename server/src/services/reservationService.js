const db = require('../config/database');
const logger = require('../config/logger');
const helpers = require('../utils/helpers');

const checkConflict = async function(roomId, date, startTime, endTime, seatId, excludeId) {
  try {
    let sql = "SELECT * FROM reservations WHERE room_id = ? AND date = ? AND status IN ('approved', 'pending', 'counselor_pending', 'checked_in') AND start_time < ? AND end_time > ?";
    const params = [roomId, date, endTime, startTime];

    if (seatId) {
      sql += ' AND seat_id = ?';
      params.push(seatId);
    } else {
      sql += ' AND (seat_id IS NULL OR seat_id = 0)';
    }

    if (excludeId) {
      sql += ' AND id != ?';
      params.push(excludeId);
    }

    const [conflicts] = await db.query(sql, params);
    return conflicts.length > 0 ? conflicts[0] : null;
  } catch (err) {
    logger.error('冲突检测异常:', err);
    throw err;
  }
};

const checkReservationLimits = async function(userId, roomId, date) {
  try {
    const [todayCount] = await db.query(
      "SELECT COUNT(*) as count FROM reservations WHERE user_id = ? AND date = ? AND status IN ('approved', 'pending', 'counselor_pending', 'checked_in')",
      [userId, date]
    );

    if (todayCount[0].count >= 3) {
      return { allowed: false, message: '每日最多预约3次' };
    }

    const [activeCount] = await db.query(
      "SELECT COUNT(*) as count FROM reservations WHERE user_id = ? AND status IN ('approved', 'pending', 'counselor_pending', 'checked_in') AND date >= CURDATE()",
      [userId]
    );

    if (activeCount[0].count >= 5) {
      return { allowed: false, message: '同时最多5个有效预约' };
    }

    const [rooms] = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (rooms.length === 0) {
      return { allowed: false, message: '功能房不存在' };
    }

    return { allowed: true };
  } catch (err) {
    logger.error('预约限制校验异常:', err);
    throw err;
  }
};

const detectNoshow = async function() {
  try {
    const now = new Date();
    const today = helpers.formatDate(now);
    const currentTime = helpers.formatTime(now);

    const [reservations] = await db.query(
      "SELECT r.* FROM reservations r WHERE r.date = ? AND r.status = 'approved' AND CONCAT(r.date, ' ', r.start_time) < DATE_SUB(NOW(), INTERVAL 15 MINUTE)",
      [today]
    );

    for (const reservation of reservations) {
      const [checkins] = await db.query(
        'SELECT id FROM checkins WHERE reservation_id = ?',
        [reservation.id]
      );

      if (checkins.length === 0) {
        await db.query("UPDATE reservations SET status = 'noshow' WHERE id = ?", [reservation.id]);

        const creditService = require('./creditService');
        const config = require('../config');
        await creditService.addCredit(reservation.user_id, config.credit.noshowPenalty, 'noshow', '超时未签到，自动标记爽约');

        logger.info('爽约检测: 预约ID=' + reservation.id + ', 用户ID=' + reservation.user_id);
      }
    }
  } catch (err) {
    logger.error('爽约检测定时任务异常:', err);
  }
};

const processWaitlist = async function(roomId, date, startTime, endTime, seatId) {
  try {
    let sql = "SELECT * FROM reservation_waitlist WHERE room_id = ? AND date = ? AND start_time = ? AND end_time = ? AND status = 'waiting' ORDER BY created_at ASC LIMIT 1";
    const params = [roomId, date, startTime, endTime];

    if (seatId) {
      sql += ' AND (seat_id IS NULL OR seat_id = ? OR seat_id = 0)';
      params.push(seatId);
    }

    const [waitlist] = await db.query(sql, params);
    if (waitlist.length === 0) return;

    const entry = waitlist[0];

    const conflict = await checkConflict(roomId, date, startTime, endTime, seatId || entry.seat_id);
    if (!conflict) {
      const reservationCode = helpers.generateReservationCode();
      await db.query(
        "INSERT INTO reservations (user_id, room_id, seat_id, date, start_time, end_time, status, reservation_code, created_at) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, NOW())",
        [entry.user_id, roomId, seatId || entry.seat_id, date, startTime, endTime, reservationCode]
      );

      await db.query("UPDATE reservation_waitlist SET status = 'converted' WHERE id = ?", [entry.id]);

      const notificationService = require('./notificationService');
      await notificationService.createNotification(entry.user_id, 'waitlist_converted', '候补成功', '您的候补预约已自动转为正式预约', { roomId: roomId, date: date });

      logger.info('候补转正: 用户ID=' + entry.user_id + ', 功能房ID=' + roomId);
    }
  } catch (err) {
    logger.error('候补转正异常:', err);
  }
};

const sendReservationReminders = async function() {
  try {
    const now = new Date();
    const today = helpers.formatDate(now);
    const currentTime = helpers.formatTime(now);
    const reminderTime = helpers.addMinutes(currentTime, 30);

    const [upcoming] = await db.query(
      "SELECT r.*, u.openid, rm.name as room_name FROM reservations r JOIN users u ON r.user_id = u.id JOIN rooms rm ON r.room_id = rm.id WHERE r.date = ? AND r.start_time = ? AND r.status = 'approved'",
      [today, reminderTime]
    );

    const notificationService = require('./notificationService');

    for (const reservation of upcoming) {
      await notificationService.createNotification(
        reservation.user_id,
        'reservation_reminder',
        '预约提醒',
        '您在' + reservation.room_name + '的预约将在30分钟后开始',
        { reservationId: reservation.id }
      );
    }
  } catch (err) {
    logger.error('预约提醒异常:', err);
  }
};

module.exports = {
  checkConflict,
  checkReservationLimits,
  detectNoshow,
  processWaitlist,
  sendReservationReminders
};
