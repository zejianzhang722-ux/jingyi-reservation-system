const db = require('../config/database');
const config = require('../config');
const helpers = require('../utils/helpers');
const reservationService = require('./reservationService');

const httpError = function(status, message, code) {
  const err = new Error(message);
  err.httpStatus = status;
  if (code) err.code = code;
  return err;
};

const normalizeTime = function(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (!match) throw httpError(400, '候补时间格式无效');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw httpError(400, '候补时间格式无效');
  }
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
};

const normalizeInput = function(input) {
  const roomId = Number(input.roomId);
  const userId = Number(input.userId);
  const seatId = input.seatId === undefined || input.seatId === null || input.seatId === ''
    ? null
    : Number(input.seatId);
  const date = String(input.date || '').slice(0, 10);

  if (!Number.isInteger(userId) || userId <= 0) throw httpError(401, '用户身份无效');
  if (!Number.isInteger(roomId) || roomId <= 0) throw httpError(400, '功能房ID无效');
  if (seatId !== null && (!Number.isInteger(seatId) || seatId <= 0)) {
    throw httpError(400, '座位ID无效');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, '候补日期格式无效');

  const startTime = normalizeTime(input.startTime);
  const endTime = normalizeTime(input.endTime);
  const duration = helpers.calculateDuration(startTime, endTime);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw httpError(400, '候补结束时间必须大于开始时间');
  }

  return { userId, roomId, seatId, date, startTime, endTime, duration };
};

const validateResources = async function(input) {
  const [users] = await db.query('SELECT * FROM users WHERE id = ?', [input.userId]);
  if (!users.length) throw httpError(404, '用户不存在');
  const user = users[0];
  if (user.status === 'banned' || user.status === 'restricted') {
    throw httpError(403, '账号已被限制候补');
  }
  if (Number(user.credit_score) < Number(config.credit.restrictThreshold)) {
    throw httpError(403, '信用分过低，无法加入候补');
  }

  const [rooms] = await db.query('SELECT * FROM rooms WHERE id = ?', [input.roomId]);
  if (!rooms.length) throw httpError(404, '功能房不存在');
  const room = rooms[0];
  if (room.status !== 'open') throw httpError(400, '该功能房当前不可候补');

  if (!helpers.isDateInRange(input.date, config.reservation.advanceDays)) {
    throw httpError(400, '候补日期不在允许范围内');
  }
  if (room.open_start_time && input.startTime < String(room.open_start_time).slice(0, 5)) {
    throw httpError(400, '候补时间早于功能房开放时间');
  }
  if (room.open_end_time && input.endTime > String(room.open_end_time).slice(0, 5)) {
    throw httpError(400, '候补时间晚于功能房关闭时间');
  }
  if (Number(room.max_duration) > 0 && input.duration > Number(room.max_duration)) {
    throw httpError(400, '候补时长不能超过' + room.max_duration + '分钟');
  }

  if (input.seatId !== null) {
    const [seats] = await db.query('SELECT * FROM seats WHERE id = ?', [input.seatId]);
    const seat = seats[0];
    if (!seat || Number(seat.room_id) !== input.roomId || seat.status !== 'available') {
      throw httpError(400, '座位不存在、不可用或不属于该功能房');
    }
  }

  return { user, room };
};

const joinWaitlist = async function(rawInput) {
  const input = normalizeInput(rawInput);
  await validateResources(input);
  return reservationService.joinWaitlist(input);
};

module.exports = {
  normalizeTime,
  normalizeInput,
  validateResources,
  joinWaitlist
};
