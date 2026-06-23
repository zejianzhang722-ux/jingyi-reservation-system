const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const config = require('../config');
const creditService = require('../services/creditService');
const credentialService = require('../services/checkinCredentialService');
const reservationService = require('../services/reservationService');
const helpers = require('../utils/helpers');

const ensureProductionDatabase = function() {
  if (process.env.NODE_ENV === 'production' && db.isMock()) {
    const err = new Error('动态签到数据库暂不可用');
    err.httpStatus = 503;
    throw err;
  }
};

const checkin = async function(req, res) {
  let connection = null;
  let transactional = false;
  try {
    ensureProductionDatabase();
    const { reservationId } = req.body;
    const credential = req.body.credential || req.body.code;

    const [reservations] = await db.query(
      'SELECT r.*, rm.name AS room_name FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.id = ?',
      [reservationId]
    );
    ensureProductionDatabase();
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (Number(reservation.user_id) !== Number(req.user.id) && req.user.role === 'student') {
      return response.error(res, '无权签到此预约', 403);
    }

    if (reservation.status !== 'approved') {
      if (reservation.status === 'checked_in') {
        return response.error(res, '已签到，请勿重复签到', 409);
      }
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
    ensureProductionDatabase();
    if (existingCheckin.length > 0) {
      return response.error(res, '已签到，请勿重复签到', 409);
    }

    connection = await db.getConnection();
    ensureProductionDatabase();
    transactional = !!(
      connection &&
      typeof connection.beginTransaction === 'function' &&
      typeof connection.execute === 'function'
    );
    if (process.env.NODE_ENV === 'production' && !transactional) {
      const err = new Error('动态签到事务服务暂不可用');
      err.httpStatus = 503;
      throw err;
    }
    if (transactional) await connection.beginTransaction();

    // 凭证只在确认数据库事务可用后消费，避免数据库故障导致有效凭证被提前作废。
    await credentialService.consume(credential, reservation);

    const runQuery = transactional
      ? function(sql, params) { return connection.execute(sql, params); }
      : db.query;

    const [updateResult] = await runQuery(
      "UPDATE reservations SET status = 'checked_in' WHERE id = ? AND status = 'approved'",
      [reservationId]
    );
    if (!updateResult || updateResult.affectedRows === 0) {
      const err = new Error('预约状态已变化，请刷新后重试');
      err.httpStatus = 409;
      throw err;
    }

    await runQuery(
      'INSERT INTO checkins (reservation_id, user_id, room_id, checkin_time, checkin_type, created_at) VALUES (?, ?, ?, NOW(), ?, NOW())',
      [reservationId, reservation.user_id, reservation.room_id, 'qrcode']
    );

    if (transactional) await connection.commit();
    return response.success(res, null, '签到成功');
  } catch (err) {
    if (transactional && connection && typeof connection.rollback === 'function') {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        logger.error('签到事务回滚失败:', rollbackErr);
      }
    }
    logger.error('签到异常:', err);
    return response.error(res, err.message || '签到失败', err.httpStatus || 500);
  } finally {
    if (connection && typeof connection.release === 'function') {
      connection.release();
    }
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
    const { reservationId } = req.body;

    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (reservation.status !== 'approved') {
      return response.error(res, '当前预约状态无法手动签到', 400);
    }

    const [existingCheckin] = await db.query(
      'SELECT id FROM checkins WHERE reservation_id = ?',
      [reservationId]
    );
    if (existingCheckin.length > 0) {
      return response.error(res, '已签到', 409);
    }

    await db.query(
      'INSERT INTO checkins (reservation_id, user_id, room_id, checkin_time, checkin_type, created_at) VALUES (?, ?, ?, NOW(), ?, NOW())',
      [reservationId, reservation.user_id, reservation.room_id, 'admin_manual']
    );

    const [updateResult] = await db.query(
      "UPDATE reservations SET status = 'checked_in' WHERE id = ? AND status = 'approved'",
      [reservationId]
    );
    if (!updateResult || updateResult.affectedRows === 0) {
      return response.error(res, '预约状态已变化，请刷新后重试', 409);
    }

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
      'SELECT c.*, r.date, r.start_time, r.end_time, u.nickname, u.real_name, u.student_id FROM checkins c JOIN reservations r ON c.reservation_id = r.id JOIN users u ON c.user_id = u.id WHERE c.room_id = ? AND c.checkout_time IS NULL ORDER BY c.checkin_time DESC',
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
    const { reservationId, status } = req.body;

    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    if (status === 'absent') {
      await reservationService.releaseReservationAndPromoteWaitlist({
        reservationId: reservationId,
        nextStatus: 'noshow'
      });
      await creditService.addCredit(reservations[0].user_id, config.credit.noshowPenalty, 'noshow', '巡查发现爽约');
    }

    return response.success(res, null, '巡查记录已提交');
  } catch (err) {
    logger.error('巡查异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = {
  ensureProductionDatabase,
  checkin,
  checkout,
  getStatus,
  manualCheckin,
  currentCheckins,
  patrol
};
