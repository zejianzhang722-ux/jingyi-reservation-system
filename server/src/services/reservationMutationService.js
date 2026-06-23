const db = require('../config/database');
const helpers = require('../utils/helpers');

const EDITABLE_STATUSES = ['approved', 'pending', 'counselor_pending'];
const SEAT_REQUIRED_TYPES = ['study_room', 'study'];
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

const seatScope = function(value) {
  return value ? Number(value) : 0;
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

const slotMinutes = function(startTime, endTime) {
  const start = helpers.timeToMinutes(startTime);
  const end = helpers.timeToMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw httpError(400, '结束时间必须大于开始时间');
  }
  const result = [];
  for (let minute = start; minute < end; minute += 1) result.push(minute);
  return result;
};

const authorize = function(reservation, actor) {
  if (!reservation) throw httpError(404, '预约不存在');
  if ((actor.role || 'student') === 'student' && Number(reservation.user_id) !== Number(actor.id)) {
    throw httpError(403, '无权修改此预约');
  }
  if (!EDITABLE_STATUSES.includes(reservation.status)) {
    throw httpError(400, '当前状态无法修改');
  }
};

const validateResource = function(room, seat, input) {
  if (!room) throw httpError(404, '功能房不存在');
  if (room.status !== 'open') throw httpError(400, '该功能房当前不可预约');
  if (SEAT_REQUIRED_TYPES.includes(room.type || '') && !input.seatId) {
    throw httpError(400, '自习室预约必须选择座位', 'SEAT_REQUIRED');
  }
  if (input.seatId && (!seat || Number(seat.room_id) !== Number(room.id) || seat.status !== 'available')) {
    throw httpError(400, '座位不可用或不属于当前功能房');
  }
  if (room.open_start_time && input.startTime < String(room.open_start_time).slice(0, 5)) {
    throw httpError(400, '预约时间早于功能房开放时间');
  }
  if (room.open_end_time && input.endTime > String(room.open_end_time).slice(0, 5)) {
    throw httpError(400, '预约时间晚于功能房关闭时间');
  }

  const duration = helpers.calculateDuration(input.startTime, input.endTime);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw httpError(400, '结束时间必须大于开始时间');
  }
  if (Number(room.max_duration) > 0 && duration > Number(room.max_duration)) {
    throw httpError(400, '单次预约时长不能超过' + room.max_duration + '分钟', 'MAX_DURATION_EXCEEDED');
  }
  if (PURPOSE_REQUIRED_TYPES.includes(room.type || '') && !input.purpose) {
    throw httpError(400, '请填写用途分类');
  }
};

const buildInput = function(options, reservation) {
  return {
    startTime: normalizeTime(options.startTime || reservation.start_time),
    endTime: normalizeTime(options.endTime || reservation.end_time),
    seatId: options.seatId !== undefined ? (options.seatId || null) : (reservation.seat_id || null),
    purpose: options.purpose !== undefined
      ? String(options.purpose || '').trim()
      : String(reservation.purpose || '').trim()
  };
};

const insertSlots = async function(connection, reservationId, roomId, selectedSeatId, date, minutes) {
  const placeholders = minutes.map(function() { return '(?, ?, ?, ?, ?)'; }).join(',');
  const params = [];
  minutes.forEach(function(minute) {
    params.push(reservationId, roomId, seatScope(selectedSeatId), date, minute);
  });
  await connection.execute(
    'INSERT INTO reservation_slots (reservation_id, room_id, seat_scope, date, slot_minute) VALUES ' + placeholders,
    params
  );
};

const updateInMock = async function(options) {
  const tables = require('../config/mock-db').__tables;
  if (!tables.reservation_slots) tables.reservation_slots = [];
  const reservation = tables.reservations.find(function(row) {
    return Number(row.id) === Number(options.reservationId);
  });
  authorize(reservation, options.actor);

  const room = tables.rooms.find(function(row) {
    return Number(row.id) === Number(reservation.room_id);
  });
  const input = buildInput(options, reservation);
  const seat = input.seatId
    ? tables.seats.find(function(row) { return Number(row.id) === Number(input.seatId); })
    : null;
  validateResource(room, seat, input);
  const minutes = slotMinutes(input.startTime, input.endTime);
  const conflict = tables.reservation_slots.some(function(slot) {
    return Number(slot.reservation_id) !== Number(reservation.id) &&
      Number(slot.room_id) === Number(reservation.room_id) &&
      Number(slot.seat_scope) === seatScope(input.seatId) &&
      String(slot.date).slice(0, 10) === String(reservation.date).slice(0, 10) &&
      minutes.includes(Number(slot.slot_minute));
  });
  if (conflict) throw httpError(409, '修改后的时间段存在冲突', 'SLOT_CONFLICT');

  tables.reservation_slots = tables.reservation_slots.filter(function(slot) {
    return Number(slot.reservation_id) !== Number(reservation.id);
  });
  reservation.start_time = input.startTime;
  reservation.end_time = input.endTime;
  reservation.seat_id = input.seatId;
  reservation.purpose = input.purpose;
  reservation.updated_at = helpers.formatDateTime(new Date());
  minutes.forEach(function(minute) {
    tables.reservation_slots.push({
      id: tables.reservation_slots.length + 1,
      reservation_id: reservation.id,
      room_id: reservation.room_id,
      seat_scope: seatScope(input.seatId),
      date: reservation.date,
      slot_minute: minute,
      created_at: reservation.updated_at
    });
  });
  return reservation;
};

const updateInMysql = async function(options) {
  const connection = await db.getConnection();
  db.assertTransactional(connection);
  try {
    await connection.beginTransaction();
    const [reservations] = await connection.execute(
      'SELECT * FROM reservations WHERE id = ? FOR UPDATE',
      [options.reservationId]
    );
    const reservation = reservations[0];
    authorize(reservation, options.actor);

    const [rooms] = await connection.execute(
      'SELECT * FROM rooms WHERE id = ? FOR UPDATE',
      [reservation.room_id]
    );
    const input = buildInput(options, reservation);
    const [seats] = input.seatId
      ? await connection.execute('SELECT * FROM seats WHERE id = ? FOR UPDATE', [input.seatId])
      : [[]];
    validateResource(rooms[0], seats[0] || null, input);
    const minutes = slotMinutes(input.startTime, input.endTime);

    await connection.execute('DELETE FROM reservation_slots WHERE reservation_id = ?', [reservation.id]);
    await insertSlots(connection, reservation.id, reservation.room_id, input.seatId, reservation.date, minutes);
    const [updateResult] = await connection.execute(
      'UPDATE reservations SET start_time = ?, end_time = ?, seat_id = ?, purpose = ?, updated_at = NOW() WHERE id = ?',
      [input.startTime, input.endTime, input.seatId, input.purpose, reservation.id]
    );
    if (!updateResult || updateResult.affectedRows !== 1) {
      throw httpError(409, '预约已被其他操作修改，请刷新后重试');
    }

    await connection.commit();
    return Object.assign({}, reservation, {
      start_time: input.startTime,
      end_time: input.endTime,
      seat_id: input.seatId,
      purpose: input.purpose
    });
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackError) {}
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      throw httpError(409, '修改后的时间段存在冲突', 'SLOT_CONFLICT');
    }
    throw err;
  } finally {
    connection.release();
  }
};

const updateReservation = async function(options) {
  if (db.isMock()) return updateInMock(options);
  return updateInMysql(options);
};

module.exports = {
  updateReservation,
  normalizeTime,
  slotMinutes,
  EDITABLE_STATUSES,
  SEAT_REQUIRED_TYPES
};
