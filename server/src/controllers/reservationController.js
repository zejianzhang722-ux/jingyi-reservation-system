const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const reservationService = require('../services/reservationService');

const list = async function(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));
    const offset = (page - 1) * pageSize;
    const status = req.query.status;
    const date = req.query.date;
    const roomId = req.query.roomId;

    const userRole = req.user.role || 'student';
    const isAdmin = ['admin', 'super_admin', 'counselor'].includes(userRole);

    let sql = 'SELECT r.*, rm.name AS room_name, rm.name AS roomName, rm.type AS room_type, ' +
      'u.nickname, u.real_name, u.real_name AS user_name, u.real_name AS userName, ' +
      'u.student_id, u.student_no FROM reservations r ' +
      'JOIN rooms rm ON r.room_id = rm.id JOIN users u ON r.user_id = u.id WHERE 1=1';
    const params = [];

    if (!isAdmin) {
      sql += ' AND r.user_id = ?';
      params.push(req.user.id);
    }
    if (status) {
      sql += ' AND r.status = ?';
      params.push(status);
    }
    if (date) {
      sql += ' AND r.date = ?';
      params.push(date);
    }
    if (roomId) {
      sql += ' AND r.room_id = ?';
      params.push(roomId);
    }

    sql += ' ORDER BY r.date DESC, r.start_time DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
    const [reservations] = await db.query(sql, params);

    let countSql = 'SELECT COUNT(*) AS total FROM reservations r WHERE 1=1';
    const countParams = [];
    if (!isAdmin) {
      countSql += ' AND r.user_id = ?';
      countParams.push(req.user.id);
    }
    if (status) {
      countSql += ' AND r.status = ?';
      countParams.push(status);
    }
    if (date) {
      countSql += ' AND r.date = ?';
      countParams.push(date);
    }
    if (roomId) {
      countSql += ' AND r.room_id = ?';
      countParams.push(roomId);
    }

    const [countResult] = await db.query(countSql, countParams);
    return response.paginate(res, reservations, Number(countResult[0].total) || 0, page, pageSize);
  } catch (err) {
    logger.error('获取预约列表异常:', err);
    return response.error(res, err.message || '获取预约列表失败', err.httpStatus || 500);
  }
};

const detail = async function(req, res) {
  try {
    const [reservations] = await db.query(
      'SELECT r.*, rm.name AS room_name, rm.type AS room_type, rm.location, ' +
      'rm.open_start_time, rm.open_end_time, u.nickname, u.real_name, u.student_id, u.phone ' +
      'FROM reservations r JOIN rooms rm ON r.room_id = rm.id ' +
      'JOIN users u ON r.user_id = u.id WHERE r.id = ?',
      [req.params.id]
    );
    if (!reservations.length) return response.error(res, '预约不存在', 404);

    const reservation = reservations[0];
    if ((req.user.role || 'student') === 'student' && Number(reservation.user_id) !== Number(req.user.id)) {
      return response.error(res, '无权查看此预约', 403);
    }

    if (reservation.seat_id) {
      const [seats] = await db.query('SELECT * FROM seats WHERE id = ?', [reservation.seat_id]);
      reservation.seat_info = seats[0] || null;
      if (reservation.seat_info && reservation.seat_info.seat_number) {
        reservation.seat_name = reservation.seat_info.seat_number;
        reservation.seatName = reservation.seat_info.seat_number;
      }
    }
    delete reservation.room_number;
    delete reservation.roomNumber;
    return response.success(res, reservation);
  } catch (err) {
    logger.error('获取预约详情异常:', err);
    return response.error(res, err.message || '获取预约详情失败', err.httpStatus || 500);
  }
};

const checkConflict = async function(req, res) {
  try {
    const roomId = req.body.roomId;
    const date = req.body.date;
    const startTime = req.body.startTime;
    const endTime = req.body.endTime;
    const seatId = req.body.seatId;
    const conflict = await reservationService.checkConflict(roomId, date, startTime, endTime, seatId);
    return response.success(res, { hasConflict: !!conflict, conflictInfo: conflict });
  } catch (err) {
    logger.error('冲突检查异常:', err);
    return response.error(res, err.message || '冲突检查失败', err.httpStatus || 500);
  }
};

const joinWaitlist = async function(req, res) {
  try {
    const result = await reservationService.joinWaitlist({
      userId: req.user.id,
      roomId: req.body.roomId,
      seatId: req.body.seatId || null,
      date: req.body.date,
      startTime: req.body.startTime,
      endTime: req.body.endTime
    });
    return response.success(res, { id: result.id }, '已加入候补队列');
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || Number(err.errno) === 1062)) {
      return response.error(res, '已在候补队列中', 409);
    }
    logger.error('加入候补异常:', err);
    return response.error(res, err.message || '加入候补失败', err.httpStatus || 500);
  }
};

const leaveWaitlist = async function(req, res) {
  try {
    const [result] = await db.query(
      "UPDATE reservation_waitlist SET status = 'cancelled', updated_at = NOW() WHERE id = ? AND user_id = ? AND status = 'waiting'",
      [req.params.id, req.user.id]
    );
    if (!result || result.affectedRows === 0) {
      return response.error(res, '候补记录不存在或已被处理', 409);
    }
    return response.success(res, null, '已退出候补队列');
  } catch (err) {
    logger.error('退出候补异常:', err);
    return response.error(res, err.message || '退出候补失败', err.httpStatus || 500);
  }
};

module.exports = {
  list,
  detail,
  checkConflict,
  joinWaitlist,
  leaveWaitlist
};
