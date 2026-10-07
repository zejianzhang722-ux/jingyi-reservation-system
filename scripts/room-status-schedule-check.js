const assert = require('node:assert/strict');
const schedule = require('../server/src/services/roomStatusSchedule');
const policy = require('../server/src/services/roomBookingPolicy');
const room = { status: 'open', type: 'mentor_room', capacity: 10, status_schedules: JSON.stringify(schedule.normalize([
  { status: 'maintenance', startAt: '2026-10-08 10:00', endAt: '2026-10-08 12:00' },
  { status: 'counselor_only', startAt: '2026-10-09 09:00', endAt: '2026-10-09 11:00' }
])) };
assert.equal(schedule.statusAt(room, '2026-10-08 09:59'), 'open');
assert.equal(schedule.statusAt(room, '2026-10-08 10:00'), 'maintenance');
assert.equal(schedule.statusAt(room, '2026-10-08 12:00'), 'open');
assert.equal(schedule.statusAt({ ...room, status: 'closed' }, '2026-10-08 12:00'), 'closed');
const input = (startTime, endTime, date = '2026-10-08') => ({ date, startTime, endTime, participants: 1 });
assert.equal(schedule.bookingAllowed(room, input('09:00', '10:00')), true);
assert.equal(schedule.bookingAllowed(room, input('09:30', '10:30')), false);
assert.equal(schedule.bookingAllowed(room, input('12:00', '13:00')), true);
assert.equal(schedule.bookingAllowed(room, { ...input('10:00', '11:00'), date: new Date(2026, 9, 8) }), false);
assert.throws(() => policy.validateInput(input('10:00', '11:00'), room), /所选时段/);
assert.equal(schedule.bookingAllowed(room, input('09:00', '10:00', '2026-10-09')), false);
const temporaryOpen = { status: 'closed', status_schedules: [{ status: 'open', startAt: '2026-10-08 10:00', endAt: '2026-10-08 12:00' }] };
assert.equal(schedule.bookingAllowed(temporaryOpen, input('10:00', '12:00')), true);
assert.equal(schedule.bookingAllowed(temporaryOpen, input('09:30', '11:00')), false);
assert.equal(schedule.bookingAllowed(temporaryOpen, input('11:00', '12:30')), false);
assert.throws(() => schedule.normalize([{ status: 'open', startAt: '2026-02-30 10:00', endAt: '2026-03-01 10:00' }]), /有效/);
assert.throws(() => schedule.normalize([{ status: 'bad', startAt: '2026-10-08 10:00', endAt: '2026-10-08 11:00' }]), /有效/);
assert.throws(() => schedule.normalize([{ status: 'open', startAt: '2026-10-08 10:00', endAt: '2026-10-08 12:00' }, { status: 'closed', startAt: '2026-10-08 11:00', endAt: '2026-10-08 13:00' }]), /重叠/);
console.log('PASS 定时状态起止边界、自动恢复、长期状态变更、未来预约、临时开放、日期及重叠校验');
const frontend = require('../miniapp/utils/room-booking-policy');
const futureOpen = { type: 'mentor_room', status: 'closed', baseStatus: 'closed', statusSchedules: [{ status: 'open', startAt: '2099-10-08 10:00', endAt: '2099-10-08 12:00' }] };
assert.equal(frontend.presentRoom(futureOpen).bookingBlocked, false);
assert.equal(frontend.presentRoom(futureOpen).statusText, '关闭');
assert.equal(frontend.presentRoom({ ...futureOpen, type: 'party_room' }).bookingBlocked, true);
assert.equal(frontend.presentRoom({ type: 'mentor_room', status: 'maintenance', baseStatus: 'open', statusSchedules: room.status_schedules ? JSON.parse(room.status_schedules) : [] }).bookingBlocked, false);
console.log('PASS 学生可查看未来开放日历，保留当前关闭标识，D128仍不得系统预约');
