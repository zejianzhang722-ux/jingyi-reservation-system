const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../config/logger');
const helpers = require('../utils/helpers');
const config = require('../config');

const ACTIVE_STATUSES = ['approved', 'pending', 'counselor_pending', 'checked_in'];
const PURPOSE_REQUIRED_TYPES = [
  'seminar_room', 'shared_space', 'seminar', 'discussion',
  'media_room', 'media', 'competition_room', 'competition',
  'roadshow_space', 'roadshow'
];

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
  const match = String(value || '').match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (!match) throw createHttpError(400, '预约时间格式无效');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw createHttpError(400, '预约时间格式无效');
  }
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
};

const getSlotMinutes = function(startTime, endTime) {
  const start = helpers.timeToMinutes(normalizeTime(startTime));
  const end = helpers.timeToMinutes(normalizeTime(endTime));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw createHttpError(400, '结束时间必须大于开始时间');
  }
  const slots = [];
  for (let minute = start; minute < end; minute += 1) slots.push(minute);
  return slots;
};

const buildRequestFingerprint = function(input) {
  const normalized = {
    userId: Number(input.userId),
    roomId: Number(input.roomId),
    seatId: input.seatId ? Number(input.seatId) : null,
    date: String(input.date).slice(0, 10),
    startTime: normalizeTime(input.startTime),
    endTime: normalizeTime(input.endTime),
    purpose: String(input.purpose || '').trim(),
    participants: Number(input.participants || 1)
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
};

const mapReservationRow = function(row, idempotent) {
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
    roomName: row.room_name || row.name || '',
    idempotent: !!idempotent
  };
};

const getStatusForRoom = function(room) {
  if (room.need_counselor_audit) return 'counselor_pending';
  if (room.need_audit) return 'pending';
  return 'approved';
};

const validateMockReservationInput = function(input, user, room, seat) {
  if (!user) throw createHttpError(404, '用户不存在');
  if (user.status === 'banned' || user.status === 'restricted') {
    throw createHttpError(403, '账号已被限制预约');
  }
  if (Number(user.credit_score) < Number(config.credit.restrictThreshold)) {
    throw createHttpError(403, '信用分过低，无法预约');
  }
  if (!helpers.isDateInRange(input.date, config.reservation.advanceDays)) {
    throw createHttpError(400, '预约日期不在允许范围内（今天至' + config.reservation.advanceDays + '天后）');
  }
  if (!room) throw createHttpError(404, '功能房不存在');
  if (room.status !== 'open') throw createHttpError(400, '该功能房当前不可预约');
  if (input.seatId && (!seat || Number(seat.room_id) !== Number(input.roomId) || seat.status !== 'available')) {
    throw createHttpError(400, '座位不存在、不可用或不属于该功能房');
  }
  if (room.open_start_time && input.startTime < String(room.open_start_time).slice(0, 5)) {
    throw createHttpError(400, '预约时间早于功能房开放时间');
  }
  if (room.open_end_time && input.endTime > String(room.open_end_time).slice(0, 5)) {
    throw createHttpError(400, '预约时间晚于功能房关闭时间');
  }

  const duration = helpers.calculateDuration(input.startTime, input.endTime);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw createHttpError(400, '结束时间必须大于开始时间');
  }
  if (Number(room.max_duration) > 0 && duration > Number(room.max_duration)) {
    throw createHttpError(400, '单次预约时长不能超过' + room.max_duration + '分钟', 'MAX_DURATION_EXCEEDED');
  }

  if (PURPOSE_REQUIRED_TYPES.includes(room.type || '')) {
    if (!input.purpose) throw createHttpError(400, '请填写用途分类');
    if (!Number.isInteger(input.participants) || input.participants <= 0) {
      throw createHttpError(400, '请填写有效参与人数');
    }
    if (room.capacity && input.participants > Number(room.capacity)) {
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

    for (const minute of getSlotMinutes(reservation.start_time, reservation.end_time)) {
      tables.reservation_slots.push({
        id: tables.reservation_slots.length + 1,
        reservation_id: reservation.id,
        room_id: reservation.room_id,
        seat_scope: normalizeSeatScope(reservation.seat_id),
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
  const seat = input.seatId
    ? tables.seats.find(function(row) { return Number(row.id) === Number(input.seatId); })
    : null;

  if (input.idempotencyKey) {
    const existing = tables.reservations.find(function(row) {
      return Number(row.user_id) === Number(input.userId) && row.idempotency_key === input.idempotencyKey;
    });
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw createHttpError(409, '相同幂等键不能用于不同预约参数', 'IDEMPOTENCY_CONFLICT');
      }
      return mapReservationRow(existing, true);
    }
  }

  validateMockReservationInput(input, user, room, seat);
  const dailyCount = tables.reservations.filter(function(row) {
    return Number(row.user_id) === Number(input.userId) &&
      String(row.date).slice(0, 10) === String(input.date).slice(0, 10) &&
      ACTIVE_STATUSES.includes(row.status);
  }).length;
  if (dailyCount >= 3) throw createHttpError(400, '每日最多预约3次');

  const seatScope = normalizeSeatScope(input.seatId);
  const slotMinutes = getSlotMinutes(input.startTime, input.endTime);
  const conflict = tables.reservation_slots.some(function(slot) {
    return Number(slot.room_id) === Number(input.roomId) &&
      Number(slot.seat_scope) === seatScope &&
      String(slot.date).slice(0, 10) === String(input.date).slice(0, 10) &&
      slotMinutes.includes(Number(slot.slot_minute));
  });
  if (conflict) throw createHttpError(409, '该时间段已有预约，存在冲突', 'SLOT_CONFLICT');

  const nextId = Math.max.apply(null, tables.reservations.map(function(row) {
    return Number(row.id) || 0;
  }).concat([0])) + 1;
  const now = helpers.formatDateTime(new Date());
  const reservation = {
    id: nextId,
    user_id: Number(input.userId),
    room_id: Number(input.roomId),
    seat_id: input.seatId || null,
    date: String(input.date).slice(0, 10),
    start_time: normalizeTime(input.startTime),
    end_time: normalizeTime(input.endTime),
    purpose: String(input.purpose || '').trim(),
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
  return mapReservationRow(reservation, false);
};

const createReservation = async function(input) {
  const normalized = Object.assign({}, input, {
    userId: Number(input.userId),
    roomId: Number(input.roomId),
    seatId: input.seatId ? Number(input.seatId) : null,
    date: String(input.date).slice(0, 10),
    startTime: normalizeTime(input.startTime),
    endTime: normalizeTime(input.endTime),
    purpose: String(input.purpose || '').trim(),
    participants: Number(input.participants || 1),
    idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey).trim() : null
  });

  if (db.isMock()) return createReservationInMock(normalized);

  // MySQL 的所有创建入口统一进入严格事务命令服务，禁止保留第二套写入实现。
  return require('./reservationCommandService').createReservation(normalized);
};

const joinWaitlist = async function(input) {
  const normalized = {
    userId: Number(input.userId),
    roomId: Number(input.roomId),
    seatId: input.seatId ? Number(input.seatId) : null,
    date: String(input.date).slice(0, 10),
    startTime: normalizeTime(input.startTime),
    endTime: normalizeTime(input.endTime)
  };
  getSlotMinutes(normalized.startTime, normalized.endTime);

  if (db.isMock()) {
    const tables = getMockTables();
    if (!tables.reservation_waitlist) tables.reservation_waitlist = [];
    const existing = tables.reservation_waitlist.find(function(row) {
      return Number(row.user_id) === normalized.userId &&
        Number(row.room_id) === normalized.roomId &&
        normalizeSeatScope(row.seat_id) === normalizeSeatScope(normalized.seatId) &&
        String(row.date).slice(0, 10) === normalized.date &&
        row.start_time === normalized.startTime &&
        row.end_time === normalized.endTime &&
        row.status === 'waiting';
    });
    if (existing) throw createHttpError(400, '已在候补队列中');

    const nextId = Math.max.apply(null, tables.reservation_waitlist.map(function(row) {
      return Number(row.id) || 0;
    }).concat([0])) + 1;
    const now = helpers.formatDateTime(new Date());
    tables.reservation_waitlist.push({
      id: nextId,
      user_id: normalized.userId,
      room_id: normalized.roomId,
      seat_id: normalized.seatId,
      date: normalized.date,
      start_time: normalized.startTime,
      end_time: normalized.endTime,
      status: 'waiting',
      created_at: now,
      updated_at: now
    });
    return { id: nextId };
  }

  const [existing] = await db.query(
    "SELECT id FROM reservation_waitlist WHERE user_id = ? AND room_id = ? " +
      "AND COALESCE(seat_id, 0) = ? AND date = ? AND start_time = ? AND end_time = ? AND status = 'waiting'",
    [
      normalized.userId,
      normalized.roomId,
      normalizeSeatScope(normalized.seatId),
      normalized.date,
      normalized.startTime,
      normalized.endTime
    ]
  );
  if (existing.length) throw createHttpError(400, '已在候补队列中');

  const [result] = await db.query(
    "INSERT INTO reservation_waitlist " +
      "(user_id, room_id, seat_id, date, start_time, end_time, status, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'waiting', NOW())",
    [
      normalized.userId,
      normalized.roomId,
      normalized.seatId,
      normalized.date,
      normalized.startTime,
      normalized.endTime
    ]
  );
  return { id: result.insertId };
};

const checkConflict = async function(roomId, date, startTime, endTime, seatId, excludeId) {
  const normalizedStart = normalizeTime(startTime);
  const normalizedEnd = normalizeTime(endTime);
  getSlotMinutes(normalizedStart, normalizedEnd);

  let sql = "SELECT * FROM reservations WHERE room_id = ? AND date = ? " +
    "AND status IN ('approved','pending','counselor_pending','checked_in') " +
    'AND start_time < ? AND end_time > ?';
  const params = [Number(roomId), String(date).slice(0, 10), normalizedEnd, normalizedStart];

  if (seatId) {
    sql += ' AND seat_id = ?';
    params.push(Number(seatId));
  } else {
    sql += ' AND (seat_id IS NULL OR seat_id = 0)';
  }
  if (excludeId) {
    sql += ' AND id <> ?';
    params.push(Number(excludeId));
  }

  const [conflicts] = await db.query(sql, params);
  return conflicts.length ? conflicts[0] : null;
};

const sendReservationReminders = async function() {
  try {
    const now = new Date();
    const today = helpers.formatDate(now);
    const reminderTime = helpers.addMinutes(helpers.formatTime(now), 30);
    const [upcoming] = await db.query(
      "SELECT r.*, u.openid, rm.name AS room_name FROM reservations r " +
      "JOIN users u ON r.user_id = u.id JOIN rooms rm ON r.room_id = rm.id " +
      "WHERE r.date = ? AND r.start_time = ? AND r.status = 'approved'",
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
  ACTIVE_STATUSES,
  createReservation,
  createReservationInMock,
  joinWaitlist,
  checkConflict,
  sendReservationReminders
};
