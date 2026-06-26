const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const reservationService = require('../services/reservationService');
const waitlistService = require('../services/waitlistService');

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

    if (isAdmin && !req.adminScope) return response.error(res, '管理员数据范围未初始化', 500);

    let where = ' WHERE 1=1';
    const params = [];
    if (!isAdmin) {
      where += ' AND r.user_id = ?';
      params.push(req.user.id);
    } else if (!req.adminScope.isGlobal) {
      where += ' AND rm.building_id = ?';
      params.push(req.adminScope.buildingId);
    }
    if (status) {
      where += ' AND r.status = ?';
      params.push(status);
    }
    if (date) {
      where += ' AND r.date = ?';
      params.push(date);
    }
    if (roomId) {
      if (isAdmin && !req.adminScope.isGlobal) {
        const [rooms] = await db.query('SELECT id, building_id FROM rooms WHERE id = ?', [Number(roomId)]);
        if (!rooms.length || Number(rooms[0].building_id) !== Number(req.adminScope.buildingId)) {
          return response.error(res, '无权查看其他楼栋功能房预约', 403);
        }
      }
      where += ' AND r.room_id = ?';
      params.push(roomId);
    }

    const [reservations] = await db.query(
      'SELECT r.*, rm.name AS room_name, rm.name AS roomName, rm.type AS room_type, rm.building_id, ' +
      'u.nickname, u.real_name, u.real_name AS user_name, u.real_name AS userName, ' +
      'u.student_id, u.student_no FROM reservations r ' +
      'JOIN rooms rm ON r.room_id = rm.id JOIN users u ON r.user_id = u.id' + where +
      ' ORDER BY r.date DESC, r.start_time DESC LIMIT ? OFFSET ?',
      params.concat([pageSize, offset])
    );

    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM reservations r JOIN rooms rm ON rm.id = r.room_id' + where,
      params
    );
    return response.paginate(res, reservations, Number(countResult[0].total) || 0, page, pageSize);
  } catch (err) {
    logger.error('获取预约列表异常:', err);
    return response.error(res, err.message || '获取预约列表失败', err.httpStatus || 500);
  }
};

const detail = async function(req, res) {
  try {
    const [reservations] = await db.query(
      'SELECT r.*, rm.name AS room_name, rm.type AS room_type, rm.location, rm.building_id, ' +
      'rm.open_start_time, rm.open_end_time, u.nickname, u.real_name, u.student_id, u.phone, ' +
      's.id AS joined_seat_id, s.seat_number AS joined_seat_number, s.row_num AS joined_seat_row, ' +
      's.col_num AS joined_seat_col, s.status AS joined_seat_status ' +
      'FROM reservations r JOIN rooms rm ON r.room_id = rm.id ' +
      'JOIN users u ON r.user_id = u.id LEFT JOIN seats s ON r.seat_id = s.id WHERE r.id = ?',
      [req.params.id]
    );
    if (!reservations.length) return response.error(res, '预约不存在', 404);

    const reservation = reservations[0];
    const role = req.user.role || 'student';
    if (role === 'student' && Number(reservation.user_id) !== Number(req.user.id)) {
      return response.error(res, '无权查看此预约', 403);
    }
    if (['admin', 'super_admin', 'counselor'].includes(role)) {
      if (!req.adminScope) return response.error(res, '管理员数据范围未初始化', 500);
      if (!req.adminScope.isGlobal && Number(reservation.building_id) !== Number(req.adminScope.buildingId)) {
        return response.error(res, '无权查看其他楼栋预约', 403);
      }
    }

    if (reservation.joined_seat_id) {
      reservation.seat_info = {
        id: reservation.joined_seat_id,
        seat_number: reservation.joined_seat_number,
        row_num: reservation.joined_seat_row,
        col_num: reservation.joined_seat_col,
        status: reservation.joined_seat_status
      };
      reservation.seat_name = reservation.joined_seat_number;
      reservation.seatName = reservation.joined_seat_number;
    } else {
      reservation.seat_info = null;
    }
    delete reservation.joined_seat_id;
    delete reservation.joined_seat_number;
    delete reservation.joined_seat_row;
    delete reservation.joined_seat_col;
    delete reservation.joined_seat_status;
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
    const result = await waitlistService.joinWaitlist({
      userId: req.user.id,
      roomId: req.body.roomId,
      seatId: req.body.seatId === undefined ? null : req.body.seatId,
      date: req.body.date,
      startTime: req.body.startTime,
      endTime: req.body.endTime
    });
    return response.success(res, { id: result.id }, '已加入候补队列');
  } catch (err) {
    const duplicateWaitlist = err && (
      err.code === 'ER_DUP_ENTRY' || Number(err.errno) === 1062 || err.message === '已在候补队列中'
    );
    if (duplicateWaitlist) return response.error(res, '已在候补队列中', 409);
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
    if (!result || result.affectedRows === 0) return response.error(res, '候补记录不存在或已被处理', 409);
    return response.success(res, null, '已退出候补队列');
  } catch (err) {
    logger.error('退出候补异常:', err);
    return response.error(res, err.message || '退出候补失败', err.httpStatus || 500);
  }
};

module.exports = { list, detail, checkConflict, joinWaitlist, leaveWaitlist };
