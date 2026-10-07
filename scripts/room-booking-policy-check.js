process.env.NODE_ENV = 'test';
process.env.ALLOW_MOCK_DB = 'true';
process.env.MYSQL_HOST = '127.0.0.1';
process.env.MYSQL_PORT = '1';
const assert = require('node:assert/strict');
const db = require('../server/src/config/database');
const commands = require('../server/src/services/reservationCommandService');
const groups = require('../server/src/services/reservationGroupService');
const helpers = require('../server/src/utils/helpers');
async function main() {
  await db.ready();
  const tables = require('../server/src/config/mock-db').__tables;
  tables.reservations = [];
  tables.reservation_slots = [];
  tables.reservation_groups = [];
  tables.reservation_group_members = [];
  tables.__reservationSlotsBackfilled = true;
  tables.users = [1, 2, 3, 4].map(id => ({ id, status: 'active', credit_score: 100 }));
  tables.rooms = ['seminar_room', 'innovation_workshop', 'competition_room', 'dance_room', 'multi_purpose_hall', 'party_room']
    .map((type, index) => ({ id: index + 1, type, name: type === 'party_room' ? 'D128党团活动室' : '测试房间',
      status: 'open', capacity: 8, max_duration: 240 }));
  const future = new Date(); future.setDate(future.getDate() + 1);
  const date = helpers.formatDate(future);
  const input = (roomId, participants, userId = 1, startTime = '10:00', endTime = '11:00') => ({
    userId, roomId, date, startTime, endTime, purpose: '实际参与人数测试', participants });
  for (const roomId of [1, 4, 5]) {
    await assert.rejects(() => commands.createReservation(input(roomId, 2)), err => err.code === 'GROUP_REQUIRED');
  }
  console.log('PASS 共享空间/舞蹈室/多功能厅禁止绕过组团入口个人预约');
  await assert.rejects(() => groups.createGroup(1, { roomId: 1, date, startTime: '10:00', endTime: '11:00',
    title: '人数不足', maxMembers: 1 }), err => err.httpStatus === 400);
  for (const roomId of [1, 4, 5]) {
    const group = await groups.createGroup(1, { roomId, date, startTime: '10:00', endTime: '11:00',
      title: '真实三人团队', maxMembers: 3 });
    assert.equal(tables.reservations.find(row => row.id === group.reservationId).participants, 3);
    await assert.rejects(() => groups.createGroup(2, { roomId, date, startTime: '10:00', endTime: '11:00',
      title: '不应重复占用', maxMembers: 2 }), err => err.httpStatus === 409);
    tables.reservations = []; tables.reservation_slots = [];
    tables.reservation_groups = []; tables.reservation_group_members = [];
  }
  console.log('PASS 团队按填写人数预留，剩余容量不允许第二团队占用独占房间');
  for (const roomId of [2, 3]) {
    const group = await groups.createGroup(1, { roomId, date, startTime: '10:00', endTime: '11:00',
      title: '六人团队', maxMembers: 6 });
    await groups.joinGroup(group.id, 2);
    assert.equal(tables.reservations.find(row => row.id === group.reservationId).participants, 6,
      '加入成员不得把预留实际人数缩减');
    await commands.createReservation(input(roomId, 2, 3));
    await assert.rejects(() => commands.createReservation(input(roomId, 1, 4)), err => err.code === 'CAPACITY_EXCEEDED');
    tables.reservations = []; tables.reservation_slots = [];
    tables.reservation_groups = []; tables.reservation_group_members = [];
  }
  console.log('PASS 创新工作坊和备赛间允许多人共享，按真实人数累计且不超容量');
  await assert.rejects(() => commands.createReservation(input(6, 2)), err => err.code === 'COUNSELOR_ONLY');
  await assert.rejects(() => groups.createGroup(1, { roomId: 6, date, startTime: '10:00', endTime: '11:00',
    title: '不允许系统预约', maxMembers: 2 }), err => err.code === 'COUNSELOR_ONLY');
  console.log('PASS D128仅联系辅导员，个人及组团接口均拒绝系统预约');
  const policy = require('../server/src/services/roomBookingPolicy');
  const dance = tables.rooms.find(room => room.type === 'dance_room');
  assert.equal(policy.slotScope(dance, { seatId: 340 }, 1), 0, '独占房间必须占整个房间，不能按座位分开');
  assert.throws(() => policy.validateInput({ participants: 2, groupBooking: true, seatId: 340 }, dance),
    err => err.code === 'SEAT_NOT_ALLOWED');
  tables.reservations = [{ id: 100, user_id: 2, room_id: 4, seat_id: 340, date,
    start_time: '10:00', end_time: '11:00', status: 'approved', participants: 2 }];
  await assert.rejects(() => groups.createGroup(1, { roomId: 4, date, startTime: '10:00', endTime: '11:00',
    title: '旧座位记录也独占', maxMembers: 2 }), err => err.code === 'SLOT_CONFLICT');
  console.log('PASS 新旧独占预约均不能通过座位编号绕过独占');
  tables.reservations = [];
  for (const maxMembers of [0, -1, 2.5, 'abc']) {
    await assert.rejects(() => groups.createGroup(1, { roomId: 2, date, startTime: '10:00', endTime: '11:00',
      title: '必须真实人数', maxMembers }), err => err.httpStatus === 400);
  }
  console.log('PASS 显式实际参与人数必须为至少2人的整数');
}
main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
