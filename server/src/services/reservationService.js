const db = require('../config/database');
const logger = require('../config/logger');
const helpers = require('../utils/helpers');
const config = require('../config');
const crypto = require('crypto');

const ACTIVE_STATUSES = ['approved', 'pending', 'counselor_pending', 'checked_in'];

const createHttpError = function(status, message, code) {
  const err = new Error(message);
  err.httpStatus = status;
  if (code) err.code = code;
  return err;
};

const normalizeSeatScope = function(seatId) {
  return seatId ? Number(seatId) : 0;
};

const normalizeTime = function(value) {
  if (!value) return value;
  const parts = String(value).split(':');
  return String(Number(parts[0])).padStart(2, '0') + ':' + String(Number(parts[1] || 0)).padStart(2, '0');
};

const getSlotMinutes = function(startTime, endTime) {
  const start = helpers.timeToMinutes(normalizeTime(startTime));
  const end = helpers.timeToMinutes(normalizeTime(endTime));
  const slots = [];
  for (let minute = start; minute < end; minute++) slots.push(minute);
  return slots;
};

const buildRequestFingerprint = function(input) {
  const normalized = {
    userId: Number(input.userId),
    roomId: Number(input.roomId),
    seatId: input.seatId ? Number(input.seatId) : null,
    date: String(input.date),
    startTime: normalizeTime(input.startTime),
    endTime: normalizeTime(input.endTime),
    purpose: String(input.purpose || ''),
    participants: Number(input.participants || 1)
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
};

const mapReservationRow = function(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    seatId: row.seat_id || null,
    purpose: row.purpose || '',
    participants: Number(row.participants || 1),
    reservationCode: row.reservation_code,
    status: row.status,
    roomName: row.room_name || row.name || ''
  };
};

const getStatusForRoom = function(room) {
  if (room.need_counselor_audit) return 'counselor_pending';
  if (room.need_audit) return 'pending';
  return 'approved';
};

const validateReservationInput = function(input, user, room, seat) {
  if (!user) throw createHttpError(404, '用户不存在');
  if (user.status === 'banned' || user.status === 'restricted') {
    throw createHttpError(403, '账号已被限制预约');
  }
  if (Number(user.credit_score) < config.credit.restrictThreshold) {
    throw createHttpError(403, '信用分过低，无法预约');
  }
  if (!helpers.isDateInRange(input.date, config.reservation.advanceDays)) {
    throw createHttpError(400, '预约日期不在允许范围内（今天至' + config.reservation.advanceDays + '天后）');
  }
  if (!room) throw createHttpError(404, '功能房不存在');
  if (room.status !== 'open') throw createHttpError(400, '该功能房当前不可预约');
  if (input.seatId && (!seat || Number(seat.room_id) !== Number(input.roomId))) {
    throw createHttpError(400, '座位不存在或不属于该功能房');
  }
  if (room.open_start_time && room.open_end_time) {
    if (input.startTime < room.open_start_time || input.endTime > room.open_end_time) {
      throw createHttpError(400, '预约时间不在功能房开放时间内（' + room.open_start_time + '-' + room.open_end_time + '）');
    }
  }
  const duration = helpers.calculateDuration(input.startTime, input.endTime);
  if (duration <= 0) throw createHttpError(400, '结束时间必须大于开始时间');
  if (room.max_duration && duration > Number(room.max_duration) * 60) {
    throw createHttpError(400, '单次预约时长不能超过' + room.max_duration + '分钟');
  }
  const roomType = room.type || '';
  const needsPurposeAndParticipants = [
    'seminar_room', 'shared_space', 'seminar', 'discussion',
    'media_room', 'media', 'competition_room', 'competition',
    'roadshow_space', 'roadshow'
  ].includes(roomType);
  if (needsPurposeAndParticipants) {
    if (!input.purpose) throw createHttpError(400, '请填写用途分类');
    if (!Number.isInteger(Number(input.participants)) || Number(input.participants) <= 0) {
      throw createHttpError(400, '请填写有效参与人数');
    }
    if (room.capacity && Number(input.participants) > Number(room.capacity)) {
      throw createHttpError(400, '参与人数不能超过功能房容量');
    }
  }
};

const getMockTables = function() {
  return require('../config/mock-db').__tables;
};

const ensureMockSlotsBackfilled = function(tables) {
  if (!tables.reservation_slots) tables.reservation_slots = [];
  if (tables.__reservationSlotsBackfilled) return;
  for (const reservation of tables.reservations || []) {
    if (!ACTIVE_STATUSES.includes(reservation.status)) continue;
    const already = tables.reservation_slots.some(function(slot) {
      return Number(slot.reservation_id) === Number(reservation.id);
    });
    if (already) continue;
    const seatScope = normalizeSeatScope(reservation.seat_id);
    for (const minute of getSlotMinutes(reservation.start_time, reservation.end_time)) {
      tables.reservation_slots.push({
        id: tables.reservation_slots.length + 1,
        reservation_id: reservation.id,
        room_id: reservation.room_id,
        seat_scope: seatScope,
        date: reservation.date,
        slot_minute: minute,
        created_at: reservation.created_at || helpers.formatDateTime(new Date())
      });
    }
  }
  tables.__reservationSlotsBackfilled = true;
};

const createReservationInMock = async function(input) {
  const tables = getMockTables();
  ensureMockSlotsBackfilled(tables);
  const requestHash = buildRequestFingerprint(input);
  const user = tables.users.find(function(row) { return Number(row.id) === Number(input.userId); });
  const room = tables.rooms.find(function(row) { return Number(row.id) === Number(input.roomId); });
  const seat = input.seatId ? tables.seats.find(function(row) { return Number(row.id) === Number(input.seatId); }) : null;

  if (input.idempotencyKey) {
    const existing = tables.reservations.find(function(row) {
      return Number(row.user_id) === Number(input.userId) && row.idempotency_key === input.idempotencyKey;
    });
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw createHttpError(409, '相同幂等键不能用于不同预约参数', 'IDEMPOTENCY_CONFLICT');
      }
      return Object.assign({ idempotent: true }, mapReservationRow(existing));
    }
  }

  validateReservationInput(input, user, room, seat);

  const activeForUserDate = tables.reservations.filter(function(row) {
    return Number(row.user_id) === Number(input.userId) &&
      String(row.date) === String(input.date) &&
      ACTIVE_STATUSES.includes(row.status);
  });
  if (activeForUserDate.length >= 3) throw createHttpError(400, '每日最多预约3次');

  const seatScope = normalizeSeatScope(input.seatId);
  const slotMinutes = getSlotMinutes(input.startTime, input.endTime);
  const conflict = tables.reservation_slots.find(function(slot) {
    return Number(slot.room_id) === Number(input.roomId) &&
      Number(slot.seat_scope) === seatScope &&
      String(slot.date) === String(input.date) &&
      slotMinutes.includes(Number(slot.slot_minute));
  });
  if (conflict) throw createHttpError(409, '该时间段已有预约，存在冲突', 'SLOT_CONFLICT');

  const nextId = Math.max.apply(null, tables.reservations.map(function(row) { return Number(row.id) || 0; }).concat([0])) + 1;
  const now = helpers.formatDateTime(new Date());
  const reservation = {
    id: nextId,
    user_id: Number(input.userId),
    room_id: Number(input.roomId),
    seat_id: input.seatId || null,
    date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    purpose: input.purpose || '',
    participants: Number(input.participants || 1),
    status: getStatusForRoom(room),
    reservation_code: helpers.generateReservationCode(),
    idempotency_key: input.idempotencyKey || null,
    request_hash: input.idempotencyKey ? requestHash : null,
    reject_reason: '',
    audited_by: null,
    audited_at: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now
  };
  tables.reservations.push(reservation);
  for (const minute of slotMinutes) {
    tables.reservation_slots.push({
      id: tables.reservation_slots.length + 1,
      reservation_id: reservation.id,
      room_id: reservation.room_id,
      seat_scope: seatScope,
      date: reservation.date,
      slot_minute: minute,
      created_at: now
    });
  }
  return mapReservationRow(reservation);
};

const joinWaitlist = async function(input) {
  const normalized = {
    userId: Number(input.userId),
    roomId: Number(input.roomId),
    seatId: input.seatId ? Number(input.seatId) : null,
    date: String(input.date),
    startTime: normalizeTime(input.startTime),
    endTime: normalizeTime(input.endTime)
  };

  if (db.isMock && db.isMock()) {
    const tables = getMockTables();
    const existing = tables.reservation_waitlist.find(function(row) {
      return Number(row.user_id) === normalized.userId &&
        Number(row.room_id) === normalized.roomId &&
        normalizeSeatScope(row.seat_id) === normalizeSeatScope(normalized.seatId) &&
        String(row.date) === normalized.date &&
        row.start_time === normalized.startTime &&
        row.end_time === normalized.endTime &&
        row.status === 'waiting';
    });
    if (existing) throw createHttpError(400, '已在候补队列中');
    const nextId = Math.max.apply(null, tables.reservation_waitlist.map(function(row) { return Number(row.id) || 0; }).concat([0])) + 1;
    const row = {
      id: nextId,
      user_id: normalized.userId,
      room_id: normalized.roomId,
      seat_id: normalized.seatId,
      date: normalized.date,
      start_time: normalized.startTime,
      end_time: normalized.endTime,
      status: 'waiting',
      created_at: helpers.formatDateTime(new Date()),
      updated_at: helpers.formatDateTime(new Date())
    };
    tables.reservation_waitlist.push(row);
    return { id: nextId };
  }

  const [existing] = await db.query(
    'SELECT id FROM reservation_waitlist WHERE user_id = ? AND room_id = ? AND date = ? AND start_time = ? AND end_time = ? AND status = ?',
    [normalized.userId, normalized.roomId, normalized.date, normalized.startTime, normalized.endTime, 'waiting']
  );
  if (existing.length > 0) throw createHttpError(400, '已在候补队列中');
  const [result] = await db.query(
    'INSERT INTO reservation_waitlist (user_id, room_id, seat_id, date, start_time, end_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
    [normalized.userId, normalized.roomId, normalized.seatId, normalized.date, normalized.startTime, normalized.endTime, 'waiting']
  );
  return { id: result.insertId };
};

const createReservationInMysql = async function(input) {
  const requestHash = buildRequestFingerprint(input);
  const slotMinutes = getSlotMinutes(input.startTime, input.endTime);
  const connection = await db.getConnection();
  if (connection && connection.isMock) {
    if (typeof connection.release === 'function') connection.release();
    return createReservationInMock(input);
  }
  db.assertTransactional(connection);

  try {
    await connection.beginTransaction();

    const [users] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [input.userId]);
    const [rooms] = await connection.execute('SELECT * FROM rooms WHERE id = ? FOR UPDATE', [input.roomId]);
    const [seats] = input.seatId
      ? await connection.execute('SELECT * FROM seats WHERE id = ? FOR UPDATE', [input.seatId])
      : [[]];

    if (input.idempotencyKey) {
      const [existingRows] = await connection.execute(
        'SELECT * FROM reservations WHERE user_id = ? AND idempotency_key = ? FOR UPDATE',
        [input.userId, input.idempotencyKey]
      );
      if (existingRows.length > 0) {
        if (existingRows[0].request_hash !== requestHash) {
          throw createHttpError(409, '相同幂等键不能用于不同预约参数', 'IDEMPOTENCY_CONFLICT');
        }
        await connection.commit();
        return Object.assign({ idempotent: true }, mapReservationRow(existingRows[0]));
      }
    }

    const user = users[0];
    const room = rooms[0];
    const seat = seats[0] || null;
    validateReservationInput(input, user, room, seat);

    const [activeRows] = await connection.execute(
      "SELECT id FROM reservations WHERE user_id = ? AND date = ? AND status IN ('approved', 'pending', 'counselor_pending', 'checked_in') FOR UPDATE",
      [input.userId, input.date]
    );
    if (activeRows.length >= 3) throw createHttpError(400, '每日最多预约3次');

    const status = getStatusForRoom(room);
    const reservationCode = helpers.generateReservationCode();
    const [result] = await connection.execute(
      'INSERT INTO reservations (user_id, room_id, seat_id, date, start_time, end_time, purpose, participants, status, reservation_code, idempotency_key, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [
        input.userId, input.roomId, input.seatId || null, input.date, input.startTime, input.endTime,
        input.purpose || '', Number(input.participants || 1), status, reservationCode,
        input.idempotencyKey || null, input.idempotencyKey ? requestHash : null
      ]
    );

    const reservationId = result.insertId;
    const seatScope = normalizeSeatScope(input.seatId);
    for (const minute of slotMinutes) {
      await connection.execute(
        'INSERT INTO reservation_slots (reservation_id, room_id, seat_scope, date, slot_minute) VALUES (?, ?, ?, ?, ?)',
        [reservationId, input.roomId, seatScope, input.date, minute]
      );
    }

    await connection.commit();
    return {
      id: reservationId,
      roomId: input.roomId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      seatId: input.seatId || null,
      purpose: input.purpose || '',
      participants: Number(input.participants || 1),
      reservationCode: reservationCode,
      status: status
    };
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      logger.error('创建预约事务回滚失败:', rollbackErr);
    }
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      throw createHttpError(409, '该时间段已有预约，存在冲突', 'SLOT_CONFLICT');
    }
    throw err;
  } finally {
    connection.release();
  }
};

const createReservation = async function(input) {
  const normalizedInput = Object.assign({}, input, {
    userId: Number(input.userId),
    roomId: Number(input.roomId),
    seatId: input.seatId ? Number(input.seatId) : null,
    startTime: normalizeTime(input.startTime),
    endTime: normalizeTime(input.endTime),
    purpose: String(input.purpose || '').trim(),
    participants: Number(input.participants || 1),
    idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey).trim() : null
  });

  if (db.isMock && db.isMock()) {
    return createReservationInMock(normalizedInput);
  }
  return createReservationInMysql(normalizedInput);
};

const promoteWaitlistInMock = async function(sourceReservation) {
  const tables = getMockTables();
  const waitlist = tables.reservation_waitlist
    .filter(function(row) {
      return Number(row.room_id) === Number(sourceReservation.room_id) &&
        normalizeSeatScope(row.seat_id) === normalizeSeatScope(sourceReservation.seat_id) &&
        String(row.date) === String(sourceReservation.date) &&
        row.start_time === sourceReservation.start_time &&
        row.end_time === sourceReservation.end_time &&
        row.status === 'waiting';
    })
    .sort(function(a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
  if (waitlist.length === 0) return null;

  const entry = waitlist[0];
  const promoted = await createReservationInMock({
    userId: entry.user_id,
    roomId: entry.room_id,
    seatId: entry.seat_id || sourceReservation.seat_id || null,
    date: entry.date,
    startTime: entry.start_time,
    endTime: entry.end_time,
    purpose: sourceReservation.purpose || '候补转正',
    participants: sourceReservation.participants || 1
  });
  entry.status = 'converted';
  entry.updated_at = helpers.formatDateTime(new Date());
  return promoted;
};

const releaseReservationAndPromoteWaitlist = async function(options) {
  const reservationId = Number(options.reservationId);
  const nextStatus = options.nextStatus || 'cancelled';
  const allowedCurrentStatuses = options.allowedCurrentStatuses || ACTIVE_STATUSES;

  if (db.isMock && db.isMock()) {
    const tables = getMockTables();
    if (!tables.reservation_slots) tables.reservation_slots = [];
    const reservation = tables.reservations.find(function(row) { return Number(row.id) === reservationId; });
    if (!reservation) throw createHttpError(404, '预约不存在');
    if (!allowedCurrentStatuses.includes(reservation.status)) {
      throw createHttpError(400, '当前状态无法释放预约');
    }
    if (options.actorRole === 'student' && Number(reservation.user_id) !== Number(options.actorUserId)) {
      throw createHttpError(403, '无权操作此预约');
    }
    reservation.status = nextStatus;
    if (nextStatus === 'cancelled') reservation.cancelled_at = helpers.formatDateTime(new Date());
    if (nextStatus === 'rejected') reservation.reject_reason = options.reason || reservation.reject_reason || '';
    reservation.updated_at = helpers.formatDateTime(new Date());
    tables.reservation_slots = tables.reservation_slots.filter(function(slot) {
      return Number(slot.reservation_id) !== reservationId;
    });
    const promotedReservation = await promoteWaitlistInMock(reservation);
    return { reservation: mapReservationRow(reservation), promotedReservation };
  }

  const connection = await db.getConnection();
  if (connection && connection.isMock) {
    if (typeof connection.release === 'function') connection.release();
    const tables = getMockTables();
    if (!tables.reservation_slots) tables.reservation_slots = [];
    return releaseReservationAndPromoteWaitlist(options);
  }
  db.assertTransactional(connection);
  let reservation;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [reservationId]);
    if (rows.length === 0) throw createHttpError(404, '预约不存在');
    reservation = rows[0];
    if (!allowedCurrentStatuses.includes(reservation.status)) {
      throw createHttpError(400, '当前状态无法释放预约');
    }
    if (options.actorRole === 'student' && Number(reservation.user_id) !== Number(options.actorUserId)) {
      throw createHttpError(403, '无权操作此预约');
    }
    if (nextStatus === 'rejected') {
      await connection.execute(
        "UPDATE reservations SET status = 'rejected', reject_reason = ?, audited_by = ?, audited_at = NOW() WHERE id = ?",
        [options.reason || '', options.auditedBy || null, reservationId]
      );
    } else if (nextStatus === 'noshow') {
      await connection.execute("UPDATE reservations SET status = 'noshow' WHERE id = ?", [reservationId]);
    } else {
      await connection.execute("UPDATE reservations SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?", [reservationId]);
    }
    await connection.execute('DELETE FROM reservation_slots WHERE reservation_id = ?', [reservationId]);
    await connection.commit();
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      logger.error('释放预约事务回滚失败:', rollbackErr);
    }
    throw err;
  } finally {
    connection.release();
  }

  const promotedReservation = await processWaitlist(
    reservation.room_id,
    reservation.date,
    reservation.start_time,
    reservation.end_time,
    reservation.seat_id
  );
  return { reservation: mapReservationRow(Object.assign({}, reservation, { status: nextStatus })), promotedReservation };
};

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
        await releaseReservationAndPromoteWaitlist({
          reservationId: reservation.id,
          nextStatus: 'noshow'
        });

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
    if (db.isMock && db.isMock()) {
      return await promoteWaitlistInMock({
        room_id: roomId,
        seat_id: seatId || null,
        date: date,
        start_time: normalizeTime(startTime),
        end_time: normalizeTime(endTime),
        purpose: '候补转正',
        participants: 1
      });
    }

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
      const promoted = await createReservation({
        userId: entry.user_id,
        roomId: roomId,
        seatId: seatId || entry.seat_id || null,
        date: date,
        startTime: startTime,
        endTime: endTime,
        purpose: '候补转正',
        participants: 1
      });

      await db.query("UPDATE reservation_waitlist SET status = 'converted' WHERE id = ?", [entry.id]);

      const notificationService = require('./notificationService');
      await notificationService.createNotification(entry.user_id, 'waitlist_converted', '候补成功', '您的候补预约已自动转为正式预约', { roomId: roomId, date: date, reservationId: promoted.id });

      logger.info('候补转正: 用户ID=' + entry.user_id + ', 功能房ID=' + roomId);
      return promoted;
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
  createReservation,
  releaseReservationAndPromoteWaitlist,
  joinWaitlist,
  checkConflict,
  checkReservationLimits,
  detectNoshow,
  processWaitlist,
  sendReservationReminders
};
