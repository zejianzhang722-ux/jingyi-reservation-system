const dailyPolicy = require('./reservationDailyPolicy');
const helpers = require('../utils/helpers');
function forRoom(room) {
  const type = dailyPolicy.canonicalType(room && room.type);
  const counselorOnly = room && (room.booking_channel === 'counselor_only'
    || room.status === 'counselor_only' || type === 'party_room');
  const groupOnly = ['seminar_room', 'dance_room', 'multi_purpose_hall'].includes(type);
  const sharedCapacity = ['innovation_workshop', 'innovation', 'competition_room'].includes(type);
  return { counselorOnly: !!counselorOnly, groupOnly, sharedCapacity,
    mode: counselorOnly ? 'counselor_only' : sharedCapacity ? 'shared_capacity'
      : ['study_room', 'study'].includes(type) ? 'seat' : 'exclusive',
    message: counselorOnly ? '仅通过辅导员预约，不接受系统预约'
      : type === 'dance_room' ? '团队预约独占；无团队预约时个人可直接进入，有团队预约时个人不可进入'
        : groupOnly ? '仅限至少2人的组团预约，同一时段仅一个团队使用'
          : sharedCapacity ? '可个人或组团预约；请按实际参与人数填写，同一时段合计不得超过容量' : '' };
}
function fail(code, message, status = 400) {
  const err = new Error(message); err.code = code; err.httpStatus = status; throw err;
}
function validateInput(input, room) {
  const schedule = require('./roomStatusSchedule');
  const policy = forRoom({ ...room, status: input.date ? schedule.statusAt(room, input.date + ' ' + input.startTime) : room.status });
  if (policy.counselorOnly) fail('COUNSELOR_ONLY', policy.message);
  if (policy.mode !== 'seat' && input.seatId) fail('SEAT_NOT_ALLOWED', '该功能房按房间预约，不能选择单个座位');
  if (policy.groupOnly && !input.groupBooking) fail('GROUP_REQUIRED', '该功能房仅接受组团预约，请从组团入口预约');
  if (!Number.isInteger(input.participants) || input.participants < (input.groupBooking ? 2 : 1)) {
    fail('INVALID_PARTICIPANTS', input.groupBooking ? '请填写至少2人的实际参与人数' : '请填写有效的实际参与人数');
  }
  if (Number(room.capacity) > 0 && input.participants > Number(room.capacity)) fail('CAPACITY_EXCEEDED', '实际参与人数不能超过功能房容量');
  if (policy.sharedCapacity && !(Number(room.capacity) > 0)) fail('CAPACITY_NOT_CONFIGURED', '功能房容量尚未配置，请联系书院导生会会长团');
  if (!schedule.bookingAllowed(room, input)) fail('ROOM_UNAVAILABLE', '所选时段功能房关闭、维护或仅联系辅导员预约');
}
function peakOccupancy(rows, startTime, endTime) {
  const start = helpers.timeToMinutes(startTime), end = helpers.timeToMinutes(endTime);
  let peak = 0;
  for (let minute = start; minute < end; minute++) {
    const count = rows.reduce((sum, row) => sum + (helpers.timeToMinutes(row.start_time) <= minute
      && helpers.timeToMinutes(row.end_time) > minute ? Number(row.participants) || 1 : 0), 0);
    peak = Math.max(peak, count);
  }
  return peak;
}
function assertOccupancy(input, room, reservations) {
  const rows = reservations.filter(row => Number(row.room_id) === Number(input.roomId)
    && String(row.date).slice(0, 10) === String(input.date).slice(0, 10)
    && dailyPolicy.CONFLICT_STATUSES.includes(row.status));
  if (forRoom(room).sharedCapacity && peakOccupancy(rows, input.startTime, input.endTime) + input.participants > Number(room.capacity)) {
    fail('CAPACITY_EXCEEDED', '该时段剩余容量不足，请减少实际参与人数或更换时段', 409);
  }
  if (forRoom(room).mode === 'exclusive' && rows.some(row =>
    helpers.checkTimeConflict(row.start_time, row.end_time, input.startTime, input.endTime))) {
    fail('SLOT_CONFLICT', '该时段已有预约，不能重复占用整间功能房', 409);
  }
}
function slotScope(room, input, reservationId) {
  // Negative reservation-specific scopes retain minute slots without imposing
  // exclusive occupancy on capacity-shared rooms. Capacity is checked with a room lock.
  const policy = forRoom(room);
  return policy.sharedCapacity ? -Number(reservationId) : policy.mode === 'seat' ? input.seatId || 0 : 0;
}
function presentRoom(room) {
  const schedule = require('./roomStatusSchedule');
  room = { ...room, baseStatus: room.status, statusSchedules: schedule.schedules(room), status: schedule.statusAt(room) };
  const bookingPolicy = forRoom(room);
  return { ...room, status: bookingPolicy.counselorOnly && !['closed', 'maintenance'].includes(room.status) ? 'counselor_only' : room.status, bookingPolicy };
}
module.exports = { forRoom, validateInput, peakOccupancy, assertOccupancy, slotScope, presentRoom };
