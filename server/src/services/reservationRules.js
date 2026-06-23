const crypto = require('crypto');
const config = require('../config');
const helpers = require('../utils/helpers');
const runtimeMode = require('../config/runtimeMode');
const slotMath = require('./slotMath');

function fail(status, message) {
  const err = new Error(message);
  err.httpStatus = status;
  throw err;
}

function normalize(body, userId) {
  const startHour = body.startHour !== undefined ? Math.floor(Number(body.startHour)) : null;
  const startMin = body.startMin !== undefined ? Number(body.startMin) : 0;
  const endHour = body.endHour !== undefined ? Math.floor(Number(body.endHour)) : null;
  const endMin = body.endMin !== undefined ? Number(body.endMin) : 0;
  const startTime = body.startTime || (startHour !== null ? String(startHour).padStart(2, '0') + ':' + String(startMin).padStart(2, '0') : null);
  const endTime = body.endTime || (endHour !== null ? String(endHour).padStart(2, '0') + ':' + String(endMin).padStart(2, '0') : null);
  const input = {
    userId: Number(userId),
    roomId: Number(body.roomId),
    date: String(body.date || ''),
    startTime,
    endTime,
    seatId: body.seatId ? Number(body.seatId) : null,
    purpose: String(body.purpose || body.purposeCategory || '').trim(),
    participants: Number(body.participants || body.participantCount || 1)
  };
  validateCommon(input);
  return input;
}

function validateCommon(input) {
  if (!Number.isInteger(input.roomId) || input.roomId < 1) fail(400, '功能房ID无效');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fail(400, '预约日期格式无效');
  if (!input.startTime || !input.endTime) fail(400, '请提供预约时间段');
  if (!helpers.isDateInRange(input.date, config.reservation.advanceDays)) fail(400, '预约日期不在允许范围内');
  try { slotMath.build(input.startTime, input.endTime, runtimeMode.slotMinutes); }
  catch (err) { fail(400, err.message); }
}

function validateRoom(room, input) {
  const openStart = String(room.open_start_time || '').slice(0, 5);
  const openEnd = String(room.open_end_time || '').slice(0, 5);
  if (openStart && openEnd && (input.startTime < openStart || input.endTime > openEnd)) fail(400, '预约时间不在功能房开放时间内');
  const duration = helpers.calculateDuration(input.startTime, input.endTime);
  if (duration <= 0) fail(400, '结束时间必须晚于开始时间');
  if (room.max_duration && duration > Number(room.max_duration)) fail(400, '单次预约时长不能超过' + room.max_duration + '分钟');
  const type = room.type || '';
  const studyRoom = ['study_room', 'study'].includes(type);
  if (studyRoom && !input.seatId) fail(400, '自习室预约必须选择座位');
  if (!studyRoom && input.seatId) fail(400, '该功能房不支持座位预约');
  const needsDetails = ['seminar_room', 'shared_space', 'seminar', 'discussion', 'media_room', 'media', 'competition_room', 'competition', 'roadshow_space', 'roadshow'].includes(type);
  if (needsDetails && !input.purpose) fail(400, '请填写预约用途');
  if (needsDetails && (!Number.isInteger(input.participants) || input.participants <= 0)) fail(400, '请填写有效参与人数');
  if (room.capacity && input.participants > Number(room.capacity)) fail(400, '参与人数不能超过功能房容量');
}

function requestKey(req) {
  const supplied = req.get('Idempotency-Key') || req.body.requestId;
  if (supplied) return String(supplied).trim();
  return 'legacy-' + crypto.randomUUID();
}

module.exports = { fail, normalize, validateCommon, validateRoom, requestKey };
