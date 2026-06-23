const crypto = require('crypto');
const db = require('../config/database');
const config = require('../config');
const helpers = require('../utils/helpers');
const legacyReservationService = require('./reservationService');

const ACTIVE_STATUSES = ['approved', 'pending', 'counselor_pending', 'checked_in'];
const PURPOSE_REQUIRED_TYPES = [
  'seminar_room', 'shared_space', 'seminar', 'discussion',
  'media_room', 'media', 'competition_room', 'competition',
  'roadshow_space', 'roadshow'
];

const httpError = function(status, message, code) {
  const err = new Error(message);
  err.httpStatus = status;
  if (code) err.code = code;
  return err;
};

const normalizeTime = function(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (!match) throw httpError(400, '预约时间格式无效');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw httpError(400, '预约时间格式无效');
  }
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
};

const normalizeDate = function(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return helpers.formatDate(value);
  }
  const text = String(value || '').trim();
  const direct = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return helpers.formatDate(parsed);
  throw httpError(400, '预约日期格式无效');
};

const normalizeInput = function(input) {
  return {
    userId: Number(input.userId),
    roomId: Number(input.roomId),
    seatId: input.seatId ? Number(input.seatId) : null,
    date: normalizeDate(input.date),
    startTime: normalizeTime(input.startTime),
    endTime: normalizeTime(input.endTime),
    purpose: String(input.purpose || '').trim(),
    participants: Number(input.participants || 1),
    idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey).trim() : null,
    forcedStatus: input.forcedStatus || null
  };
};

const buildRequestFingerprint = function(input) {
  const payload = {
    userId: input.userId,
    roomId: input.roomId,
    seatId: input.seatId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    purpose: input.purpose,
    participants: input.participants
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

const getSlotMinutes = function(startTime, endTime) {
  const start = helpers.timeToMinutes(startTime);
  const end = helpers.timeToMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw httpError(400, '结束时间必须大于开始时间');
  }
  const result = [];
  for (let minute = start; minute < end; minute += 1) result.push(minute);
  return result;
};

const statusForRoom = function(room, forcedStatus) {
  if (forcedStatus) return forcedStatus;
  if (room.need_counselor_audit) return 'counselor_pending';
  if (room.need_audit) return 'pending';
  return 'approved';
};

const validateReservationInput = function(input, user, room, seat) {
  if (!user) throw httpError(404, '用户不存在');
  if (user.status === 'banned' || user.status === 'restricted') {
    throw httpError(403, '账号已被限制预约');
  }
  if (Number(user.credit_score) < Number(config.credit.restrictThreshold)) {
    throw httpError(403, '信用分过低，无法预约');
  }
  if (!helpers.isDateInRange(input.date, config.reservation.advanceDays)) {
    throw httpError(400, '预约日期不在允许范围内（今天至' + config.reservation.advanceDays + '天后）');
  }
  if (!room) throw httpError(404, '功能房不存在');
  if (room.status !== 'open') throw httpError(400, '该功能房当前不可预约');
  if (input.seatId && (!seat || Number(seat.room_id) !== input.roomId || seat.status !== 'available')) {
    throw httpError(400, '座位不存在、不可用或不属于该功能房');
  }
  if (room.open_start_time && input.startTime < String(room.open_start_time).slice(0, 5)) {
    throw httpError(400, '预约时间早于功能房开放时间');
  }
  if (room.open_end_time && input.endTime > String(room.open_end_time).slice(0, 5)) {
    throw httpError(400, '预约时间晚于功能房关闭时间');
  }

  const durationMinutes = helpers.calculateDuration(input.startTime, input.endTime);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw httpError(400, '结束时间必须大于开始时间');
  }
  if (Number(room.max_duration) > 0 && durationMinutes > Number(room.max_duration)) {
    throw httpError(400, '单次预约时长不能超过' + room.max_duration + '分钟', 'MAX_DURATION_EXCEEDED');
  }

  if (PURPOSE_REQUIRED_TYPES.includes(room.type || '')) {
    if (!input.purpose) throw httpError(400, '请填写用途分类');
    if (!Number.isInteger(input.participants) || input.participants <= 0) {
      throw httpError(400, '请填写有效参与人数');
    }
    if (room.capacity && input.participants > Number(room.capacity)) {
      throw httpError(400, '参与人数不能超过功能房容量');
    }
  }
};

const mapReservation = function(row, idempotent) {
  return {
    id: row.id,
    roomId: row.room_id,
    date: normalizeDate(row.date),
    startTime: row.start_time,
    endTime: row.end_time,
    seatId: row.seat_id || null,
    purpose: row.purpose || '',
    participants: Number(row.participants || 1),
    reservationCode: row.reservation_code,
    status: row.status,
    idempotent: !!idempotent
  };
};

const insertSlots = async function(connection, reservationId, input) {
  const minutes = getSlotMinutes(input.startTime, input.endTime);
  const placeholders = minutes.map(function() { return '(?, ?, ?, ?, ?)'; }).join(',');
  const params = [];
  minutes.forEach(function(minute) {
    params.push(reservationId, input.roomId, input.seatId || 0, input.date, minute);
  });
  await connection.execute(
    'INSERT INTO reservation_slots (reservation_id, room_id, seat_scope, date, slot_minute) VALUES ' + placeholders,
    params
  );
};

const createReservationWithinTransaction = async function(connection, rawInput) {
  const input = normalizeInput(rawInput);
  const requestHash = buildRequestFingerprint(input);

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
    if (existingRows.length) {
      if (existingRows[0].request_hash !== requestHash) {
        throw httpError(409, '相同幂等键不能用于不同预约参数', 'IDEMPOTENCY_CONFLICT');
      }
      return mapReservation(existingRows[0], true);
    }
  }

  validateReservationInput(input, users[0], rooms[0], seats[0] || null);

  const [dailyRows] = await connection.execute(
    "SELECT id FROM reservations WHERE user_id = ? AND date = ? AND status IN ('approved','pending','counselor_pending','checked_in') FOR UPDATE",
    [input.userId, input.date]
  );
  if (dailyRows.length >= 3) throw httpError(400, '每日最多预约3次');

  const reservationCode = helpers.generateReservationCode();
  const status = statusForRoom(rooms[0], input.forcedStatus);
  const [result] = await connection.execute(
    'INSERT INTO reservations (user_id, room_id, seat_id, date, start_time, end_time, purpose, participants, status, reservation_code, idempotency_key, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [
      input.userId, input.roomId, input.seatId, input.date, input.startTime, input.endTime,
      input.purpose, input.participants, status, reservationCode,
      input.idempotencyKey, input.idempotencyKey ? requestHash : null
    ]
  );
  await insertSlots(connection, result.insertId, input);

  return {
    id: result.insertId,
    roomId: input.roomId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    seatId: input.seatId,
    purpose: input.purpose,
    participants: input.participants,
    reservationCode,
    status,
    idempotent: false
  };
};

const readExistingIdempotentReservation = async function(input) {
  if (!input.idempotencyKey) return null;
  const requestHash = buildRequestFingerprint(input);
  const [rows] = await db.query(
    'SELECT * FROM reservations WHERE user_id = ? AND idempotency_key = ?',
    [input.userId, input.idempotencyKey]
  );
  if (!rows.length) return null;
  if (rows[0].request_hash !== requestHash) {
    throw httpError(409, '相同幂等键不能用于不同预约参数', 'IDEMPOTENCY_CONFLICT');
  }
  return mapReservation(rows[0], true);
};

const validateMockInput = function(input) {
  const tables = require('../config/mock-db').__tables;
  const user = tables.users.find(function(row) { return Number(row.id) === input.userId; });
  const room = tables.rooms.find(function(row) { return Number(row.id) === input.roomId; });
  const seat = input.seatId
    ? tables.seats.find(function(row) { return Number(row.id) === input.seatId; })
    : null;
  validateReservationInput(input, user, room, seat);

  const dailyCount = tables.reservations.filter(function(row) {
    return Number(row.user_id) === input.userId &&
      normalizeDate(row.date) === input.date &&
      ACTIVE_STATUSES.includes(row.status);
  }).length;
  if (dailyCount >= 3) throw httpError(400, '每日最多预约3次');
};

const createReservation = async function(rawInput) {
  const input = normalizeInput(rawInput);
  if (db.isMock()) {
    validateMockInput(input);
    return legacyReservationService.createReservation(input);
  }

  const connection = await db.getConnection();
  db.assertTransactional(connection);
  try {
    await connection.beginTransaction();
    const created = await createReservationWithinTransaction(connection, input);
    await connection.commit();
    return created;
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      const existing = await readExistingIdempotentReservation(input);
      if (existing) return existing;
      throw httpError(409, '该时间段已有预约，存在冲突', 'SLOT_CONFLICT');
    }
    throw err;
  } finally {
    connection.release();
  }
};

module.exports = {
  ACTIVE_STATUSES,
  normalizeDate,
  normalizeInput,
  getSlotMinutes,
  buildRequestFingerprint,
  validateReservationInput,
  createReservationWithinTransaction,
  createReservation,
  httpError
};
