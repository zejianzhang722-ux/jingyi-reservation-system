const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const config = require('../config');
const helpers = require('../utils/helpers');
const reservationService = require('../services/reservationService');
const creditService = require('../services/creditService');
const notificationService = require('../services/notificationService');
const wechatService = require('../services/wechatService');

const create = async function(req, res) {
  try {
    const { roomId, date, startTime, endTime, startHour, startMin, endHour, endMin, seatId, purpose, purposeCategory, participants, participantCount } = req.body;
    const userId = req.user.id;

    var sH = startHour !== undefined ? Math.floor(Number(startHour)) : null;
    var sM = startMin !== undefined ? Number(startMin) : 0;
    var eH = endHour !== undefined ? Math.floor(Number(endHour)) : null;
    var eM = endMin !== undefined ? Number(endMin) : 0;
    const finalStartTime = startTime || (sH !== null ? String(sH).padStart(2, '0') + ':' + String(sM).padStart(2, '0') : null);
    const finalEndTime = endTime || (eH !== null ? String(eH).padStart(2, '0') + ':' + String(eM).padStart(2, '0') : null);

    if (!finalStartTime || !finalEndTime) {
      return response.error(res, '请提供预约时间段', 400);
    }

    const [users] = await db.query('SELECT credit_score, status FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return response.error(res, '用户不存在', 404);
    }
    const user = users[0];

    if (user.status === 'banned' || user.status === 'restricted') {
      return response.error(res, '账号已被限制预约', 403);
    }
    if (user.credit_score < config.credit.restrictThreshold) {
      return response.error(res, '信用分过低，无法预约', 403);
    }

    if (!helpers.isDateInRange(date, config.reservation.advanceDays)) {
      return response.error(res, '预约日期不在允许范围内（今天至' + config.reservation.advanceDays + '天后）', 400);
    }

    const [rooms] = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (rooms.length === 0) {
      return response.error(res, '功能房不存在', 404);
    }
    const room = rooms[0];

    if (room.status !== 'open') {
      return response.error(res, '该功能房当前不可预约', 400);
    }

    const finalPurpose = (purpose || purposeCategory || '').trim();
    const finalParticipants = Number(participants || participantCount || 0);
    const roomType = room.type || '';
    const needsPurposeAndParticipants = ['seminar_room', 'shared_space', 'seminar', 'discussion', 'media_room', 'media', 'competition_room', 'competition', 'roadshow_space', 'roadshow'].includes(roomType);
    if (needsPurposeAndParticipants) {
      if (!finalPurpose) {
        return response.error(res, '请填写用途分类', 400);
      }
      if (!Number.isInteger(finalParticipants) || finalParticipants <= 0) {
        return response.error(res, '请填写有效参与人数', 400);
      }
      if (room.capacity && finalParticipants > Number(room.capacity)) {
        return response.error(res, '参与人数不能超过功能房容量', 400);
      }
    }

    if (room.open_start_time && room.open_end_time) {
      if (finalStartTime < room.open_start_time || finalEndTime > room.open_end_time) {
        return response.error(res, '预约时间不在功能房开放时间内（' + room.open_start_time + '-' + room.open_end_time + '）', 400);
      }
    }

    const duration = helpers.calculateDuration(finalStartTime, finalEndTime);
    if (duration <= 0) {
      return response.error(res, '结束时间必须大于开始时间', 400);
    }
    if (room.max_duration && duration > room.max_duration * 60) {
      return response.error(res, '单次预约时长不能超过' + room.max_duration + '分钟', 400);
    }

    const conflict = await reservationService.checkConflict(roomId, date, finalStartTime, finalEndTime, seatId);
    if (conflict) {
      return response.error(res, '该时间段已有预约，存在冲突', 409);
    }

    const [todayCount] = await db.query(
      "SELECT COUNT(*) as count FROM reservations WHERE user_id = ? AND date = ? AND status IN ('approved', 'pending', 'counselor_pending', 'checked_in')",
      [userId, date]
    );
    if (todayCount[0].count >= 3) {
      return response.error(res, '每日最多预约3次', 400);
    }

    const reservationCode = helpers.generateReservationCode();

    let status = 'approved';
    if (room.need_audit) {
      status = 'pending';
    }
    if (room.need_counselor_audit) {
      status = 'counselor_pending';
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const [result] = await db.query(
      'INSERT INTO reservations (user_id, room_id, seat_id, date, start_time, end_time, purpose, participants, status, reservation_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, roomId, seatId || null, date, finalStartTime, finalEndTime, finalPurpose, finalParticipants || 1, status, reservationCode, now]
    );

    if (status === 'approved') {
      await notificationService.createNotification(userId, 'reservation_approved', '预约成功', '您在' + room.name + '的预约已通过', { reservationId: result.insertId });
    } else if (status === 'pending') {
      await notificationService.createNotification(userId, 'reservation_pending', '预约待审核', '您在' + room.name + '的预约正在审核中', { reservationId: result.insertId });
    } else if (status === 'counselor_pending') {
      await notificationService.createNotification(userId, 'reservation_pending', '预约待辅导员审批', '您在' + room.name + '的预约需要辅导员审批', { reservationId: result.insertId });
    }

    return response.success(res, {
      id: result.insertId,
      roomId: roomId,
      date: date,
      startTime: finalStartTime,
      endTime: finalEndTime,
      seatId: seatId || null,
      purpose: finalPurpose,
      participants: finalParticipants || 1,
      reservationCode: reservationCode,
      status: status
    }, '预约创建成功');
  } catch (err) {
    logger.error('创建预约异常:', err);
    return response.error(res, err.message);
  }
};

const list = async function(req, res) {
  try {
    const { page = 1, pageSize = 10, status, date, roomId } = req.query;
    const offset = (page - 1) * pageSize;

    const userRole = req.user.role || 'student';
    const isAdmin = ['admin', 'super_admin', 'counselor'].includes(userRole);

    let sql = 'SELECT r.*, rm.name as room_name, rm.name as roomName, rm.type as room_type, u.nickname, u.real_name, u.real_name as user_name, u.real_name as userName, u.student_id, u.student_no FROM reservations r JOIN rooms rm ON r.room_id = rm.id JOIN users u ON r.user_id = u.id WHERE 1=1';
    const params = [];

    if (!isAdmin) {
      sql += ' AND r.user_id = ?';
      params.push(req.user.id);
    }

    if (status) { sql += ' AND r.status = ?'; params.push(status); }
    if (date) { sql += ' AND r.date = ?'; params.push(date); }
    if (roomId) { sql += ' AND r.room_id = ?'; params.push(roomId); }

    sql += ' ORDER BY r.date DESC, r.start_time DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [reservations] = await db.query(sql, params);

    let countSql = 'SELECT COUNT(*) as total FROM reservations r WHERE 1=1';
    const countParams = [];
    if (!isAdmin) {
      countSql += ' AND r.user_id = ?';
      countParams.push(req.user.id);
    }
    if (status) { countSql += ' AND r.status = ?'; countParams.push(status); }
    if (date) { countSql += ' AND r.date = ?'; countParams.push(date); }
    if (roomId) { countSql += ' AND r.room_id = ?'; countParams.push(roomId); }

    const [countResult] = await db.query(countSql, countParams);

    return response.paginate(res, reservations, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取预约列表异常:', err);
    return response.error(res, err.message);
  }
};

const detail = async function(req, res) {
  try {
    const [reservations] = await db.query(
      'SELECT r.*, rm.name as room_name, rm.type as room_type, rm.location, rm.open_start_time, rm.open_end_time, u.nickname, u.real_name, u.student_id, u.phone FROM reservations r JOIN rooms rm ON r.room_id = rm.id JOIN users u ON r.user_id = u.id WHERE r.id = ?',
      [req.params.id]
    );
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (req.user.role === 'student' && Number(reservation.user_id) !== Number(req.user.id)) {
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
    return response.error(res, err.message);
  }
};

const cancel = async function(req, res) {
  try {
    const reservationId = req.params.id;

    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (req.user.role === 'student' && Number(reservation.user_id) !== Number(req.user.id)) {
      return response.error(res, '无权取消此预约', 403);
    }

    if (!['approved', 'pending', 'counselor_pending'].includes(reservation.status)) {
      return response.error(res, '当前状态无法取消', 400);
    }

    const now = new Date();
    const reservationDateTime = new Date(reservation.date + ' ' + reservation.start_time);
    const hoursBefore = (reservationDateTime - now) / (1000 * 60 * 60);
    if (hoursBefore < config.reservation.cancelBeforeHours && req.user.role === 'student') {
      return response.error(res, '预约开始前' + config.reservation.cancelBeforeHours + '小时内不可取消', 400);
    }

    await db.query("UPDATE reservations SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?", [reservationId]);

    await reservationService.processWaitlist(reservation.room_id, reservation.date, reservation.start_time, reservation.end_time, reservation.seat_id);

    await notificationService.createNotification(reservation.user_id, 'reservation_cancelled', '预约已取消', '您在' + reservation.date + '的预约已取消', { reservationId: reservationId });

    return response.success(res, null, '取消成功');
  } catch (err) {
    logger.error('取消预约异常:', err);
    return response.error(res, err.message);
  }
};

const update = async function(req, res) {
  try {
    const reservationId = req.params.id;
    const { startTime, endTime, seatId, purpose } = req.body;

    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (req.user.role === 'student' && Number(reservation.user_id) !== Number(req.user.id)) {
      return response.error(res, '无权修改此预约', 403);
    }

    if (!['approved', 'pending'].includes(reservation.status)) {
      return response.error(res, '当前状态无法修改', 400);
    }

    const newStartTime = startTime || reservation.start_time;
    const newEndTime = endTime || reservation.end_time;
    const newSeatId = seatId !== undefined ? seatId : reservation.seat_id;

    const conflict = await reservationService.checkConflict(reservation.room_id, reservation.date, newStartTime, newEndTime, newSeatId, reservationId);
    if (conflict) {
      return response.error(res, '修改后的时间段存在冲突', 409);
    }

    await db.query(
      'UPDATE reservations SET start_time = ?, end_time = ?, seat_id = ?, purpose = ? WHERE id = ?',
      [newStartTime, newEndTime, newSeatId, purpose || reservation.purpose, reservationId]
    );

    return response.success(res, null, '修改成功');
  } catch (err) {
    logger.error('修改预约异常:', err);
    return response.error(res, err.message);
  }
};

const qrcode = async function(req, res) {
  try {
    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [req.params.id]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    if (req.user.role === 'student' && Number(reservation.user_id) !== Number(req.user.id)) {
      return response.error(res, '无权查看此凭证', 403);
    }

    const QRCode = require('qrcode');
    const qrData = JSON.stringify({
      reservationId: reservation.id,
      code: reservation.reservation_code,
      roomId: reservation.room_id,
      date: reservation.date,
      startTime: reservation.start_time,
      endTime: reservation.end_time
    });

    const qrImage = await QRCode.toDataURL(qrData);

    return response.success(res, { qrcode: qrImage, code: reservation.reservation_code });
  } catch (err) {
    logger.error('获取凭证码异常:', err);
    return response.error(res, err.message);
  }
};

const rebook = async function(req, res) {
  try {
    const reservationId = req.params.id;

    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const old = reservations[0];
    const nextDate = helpers.formatDate(require('dayjs')(old.date).add(1, 'day'));

    if (!helpers.isDateInRange(nextDate, config.reservation.advanceDays)) {
      return response.error(res, '超出可预约日期范围', 400);
    }

    const conflict = await reservationService.checkConflict(old.room_id, nextDate, old.start_time, old.end_time, old.seat_id);
    if (conflict) {
      return response.error(res, '该时间段已有预约', 409);
    }

    const reservationCode = helpers.generateReservationCode();
    const [result] = await db.query(
      'INSERT INTO reservations (user_id, room_id, seat_id, date, start_time, end_time, purpose, participants, status, reservation_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [old.user_id, old.room_id, old.seat_id, nextDate, old.start_time, old.end_time, old.purpose, old.participants, 'approved', reservationCode]
    );

    return response.success(res, { id: result.insertId, reservationCode: reservationCode, date: nextDate }, '再次预约成功');
  } catch (err) {
    logger.error('再次预约异常:', err);
    return response.error(res, err.message);
  }
};

const checkConflict = async function(req, res) {
  try {
    const { roomId, date, startTime, endTime, seatId } = req.body;

    const conflict = await reservationService.checkConflict(roomId, date, startTime, endTime, seatId);

    return response.success(res, { hasConflict: !!conflict, conflictInfo: conflict });
  } catch (err) {
    logger.error('冲突检查异常:', err);
    return response.error(res, err.message);
  }
};

const joinWaitlist = async function(req, res) {
  try {
    const { roomId, date, startTime, endTime } = req.body;
    const userId = req.user.id;

    const [existing] = await db.query(
      'SELECT id FROM reservation_waitlist WHERE user_id = ? AND room_id = ? AND date = ? AND start_time = ? AND end_time = ? AND status = ?',
      [userId, roomId, date, startTime, endTime, 'waiting']
    );
    if (existing.length > 0) {
      return response.error(res, '已在候补队列中', 400);
    }

    const [result] = await db.query(
      'INSERT INTO reservation_waitlist (user_id, room_id, date, start_time, end_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, roomId, date, startTime, endTime, 'waiting']
    );

    return response.success(res, { id: result.insertId }, '已加入候补队列');
  } catch (err) {
    logger.error('加入候补异常:', err);
    return response.error(res, err.message);
  }
};

const leaveWaitlist = async function(req, res) {
  try {
    const reservationId = req.params.id;

    await db.query("UPDATE reservation_waitlist SET status = 'cancelled' WHERE id = ? AND user_id = ?", [reservationId, req.user.id]);

    return response.success(res, null, '已退出候补队列');
  } catch (err) {
    logger.error('退出候补异常:', err);
    return response.error(res, err.message);
  }
};

const pending = async function(req, res) {
  try {
    const [reservations] = await db.query(
      "SELECT r.*, rm.name as roomName, rm.name as room_name, u.real_name as userName, u.real_name as user_name, u.student_id, u.student_no FROM reservations r JOIN rooms rm ON r.room_id = rm.id JOIN users u ON r.user_id = u.id WHERE r.status IN ('pending', 'counselor_pending') ORDER BY r.created_at DESC LIMIT 50"
    );
    return response.success(res, reservations);
  } catch (err) {
    logger.error('获取待审批列表异常:', err);
    return response.error(res, err.message);
  }
};

const pendingCount = async function(req, res) {
  try {
    const [result] = await db.query("SELECT COUNT(*) as count FROM reservations WHERE status IN ('pending', 'counselor_pending')");
    return response.success(res, { count: result[0].count });
  } catch (err) {
    logger.error('获取待审批数量异常:', err);
    return response.error(res, err.message);
  }
};

const approve = async function(req, res) {
  try {
    const id = req.params.id;
    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [id]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }
    await db.query("UPDATE reservations SET status = 'approved', approved_at = NOW() WHERE id = ?", [id]);
    const reservation = reservations[0];
    try {
      await notificationService.createNotification(reservation.user_id, 'reservation_approved', '预约已通过', '您的预约已通过审批', { reservationId: id });
    } catch(e) {}
    try {
      var [approveUsers] = await db.query('SELECT wechat_openid FROM users WHERE id = ?', [reservation.user_id]);
      if (approveUsers.length > 0 && approveUsers[0].wechat_openid) {
        var [approveRooms] = await db.query('SELECT name FROM rooms WHERE id = ?', [reservation.room_id]);
        var approveRoomName = approveRooms.length > 0 ? approveRooms[0].name : '';
        wechatService.sendReservationApproved(approveUsers[0].wechat_openid, approveRoomName, reservation.date || '', reservation.start_time || '', reservation.end_time || '');
      }
    } catch (notifyErr) {
      logger.error('发送审批通过通知失败:', notifyErr);
    }
    return response.success(res, null, '审批通过');
  } catch (err) {
    logger.error('审批异常:', err);
    return response.error(res, err.message);
  }
};

const reject = async function(req, res) {
  try {
    const id = req.params.id;
    const { reason } = req.body;
    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [id]);
    if (reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }
    await db.query("UPDATE reservations SET status = 'rejected', rejected_at = NOW(), reject_reason = ? WHERE id = ?", [reason || '', id]);
    const reservation = reservations[0];
    try {
      await notificationService.createNotification(reservation.user_id, 'reservation_rejected', '预约被拒绝', reason ? '您的预约被拒绝，原因：' + reason : '您的预约被拒绝', { reservationId: id });
    } catch(e) {}
    try {
      var [rejectUsers] = await db.query('SELECT wechat_openid FROM users WHERE id = ?', [reservation.user_id]);
      if (rejectUsers.length > 0 && rejectUsers[0].wechat_openid) {
        var [rejectRooms] = await db.query('SELECT name FROM rooms WHERE id = ?', [reservation.room_id]);
        var rejectRoomName = rejectRooms.length > 0 ? rejectRooms[0].name : '';
        wechatService.sendReservationRejected(rejectUsers[0].wechat_openid, rejectRoomName, reservation.date || '', reason || '');
      }
    } catch (notifyErr) {
      logger.error('发送审批拒绝通知失败:', notifyErr);
    }
    return response.success(res, null, '已拒绝');
  } catch (err) {
    logger.error('拒绝异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { create, list, detail, cancel, update, qrcode, rebook, checkConflict, joinWaitlist, leaveWaitlist, pending, pendingCount, approve, reject };
