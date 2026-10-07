process.env.NODE_ENV = 'test';
process.env.ALLOW_MOCK_DB = 'true';
process.env.MYSQL_PORT = '1';
process.env.MYSQL_HOST = '127.0.0.1';
const assert = require('node:assert/strict');
const db = require('../server/src/config/database');
const service = require('../server/src/services/reservationCommandService');
const legacy = require('../server/src/services/reservationService');
const groups = require('../server/src/services/reservationGroupService');
const helpers = require('../server/src/utils/helpers');

async function main() {
  await db.ready();
  assert(db.isMock(), '必须使用隔离测试数据');
  const tables = require('../server/src/config/mock-db').__tables;
  tables.reservations = [];
  tables.reservation_slots = [];
  tables.reservation_groups = [];
  tables.reservation_group_members = [];
  tables.__reservationSlotsBackfilled = true;
  tables.users = [1, 2, 3].map(id => ({ id, status: 'active', credit_score: 100 }));
  tables.rooms = [
    { id: 1, type: 'seminar_room' }, { id: 2, type: 'shared_space' },
    { id: 3, type: 'media_room' }, { id: 4, type: 'dance_room' }
  ].map(room => ({ ...room, name: '测试房间', status: 'open', capacity: 20, max_duration: 240 }));
  const future = new Date(); future.setDate(future.getDate() + 1);
  const date = helpers.formatDate(future);
  const input = (roomId, startTime, endTime, extra = {}) => ({ userId: 1, roomId, date,
    startTime, endTime, purpose: '日限额测试', participants: 2, groupBooking: true, ...extra });
  const record = (id, status, roomId = 1, start = '08:00', end = '09:00', userId = 1) => ({
    id, user_id: userId, room_id: roomId, date, start_time: start, end_time: end, status });
  tables.reservations = [record(1, 'completed'), record(2, 'noshow', 2, '09:00', '10:00'),
    record(3, 'approved', 1, '10:00', '11:00')];
  await service.createReservation(input(3, '11:00', '12:00'));
  console.log('PASS 不同房间种类独立计数');
  await assert.rejects(() => service.createReservation(input(2, '12:00', '13:00')),
    err => err.code === 'DAILY_TYPE_LIMIT');
  await assert.rejects(() => legacy.createReservation(input(2, '12:00', '13:00')),
    err => err.code === 'DAILY_TYPE_LIMIT');
  console.log('PASS 同种类及类型别名合并计数，完成和爽约仍计入，两个创建入口一致');
  tables.reservations[0].status = 'cancelled';
  tables.reservations[1].status = 'rejected';
  const created = await service.createReservation(input(2, '12:00', '13:00', { idempotencyKey: 'daily-policy' }));
  console.log('PASS 取消和拒绝释放次数');
  await service.createReservation(input(2, '13:00', '14:00'));
  const repeated = await service.createReservation(input(2, '12:00', '13:00', { idempotencyKey: 'daily-policy' }));
  assert.equal(repeated.id, created.id);
  assert(repeated.idempotent);
  console.log('PASS 达到限额后重复提交仍返回原预约');
  await assert.rejects(() => service.createReservation(input(4, '12:30', '13:30')),
    err => err.code === 'PERSONAL_SLOT_CONFLICT');
  await service.createReservation(input(4, '14:00', '15:00'));
  console.log('PASS 不同种类也不允许时间重叠，相邻时段允许');
  tables.reservations = [record(100, 'approved', 3, '16:00', '17:00', 2)];
  tables.reservation_slots = [];
  tables.reservation_groups = [{ id: 100, room_id: 3, reservation_id: 100, date,
    start_time: '16:00', end_time: '17:00', status: 'approved', created_by: 2, max_members: 10 }];
  tables.reservation_group_members = [{ id: 1, group_id: 100, user_id: 1, status: 'confirmed' }];
  await assert.rejects(() => service.createReservation(input(4, '16:30', '17:30')),
    err => err.code === 'PERSONAL_SLOT_CONFLICT');
  console.log('PASS 加入组团后也不能预约冲突时段');
  tables.reservations.push(record(101, 'approved', 4, '16:30', '17:30', 3));
  await assert.rejects(() => groups.joinGroup(100, 3), err => err.code === 'PERSONAL_SLOT_CONFLICT');
  tables.reservations[1].status = 'cancelled';
  await groups.joinGroup(100, 3);
  console.log('PASS 加入组团检查冲突，取消后允许加入');
  tables.reservations.push(record(102, 'completed', 3, '08:00', '09:00', 1),
    record(103, 'noshow', 3, '09:00', '10:00', 1));
  await assert.rejects(() => service.createReservation(input(3, '18:00', '19:00')),
    err => err.code === 'DAILY_TYPE_LIMIT');
  console.log('PASS 组团成员参与记录计入每日次数，发起人不重复计数');
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 2);
  await service.createReservation(input(3, '18:00', '19:00', { date: helpers.formatDate(nextDate) }));
  console.log('PASS 按使用日期计算，不按提交日期计算');
  tables.reservations.push(record(104, 'pending', 3, '10:00', '11:00', 3),
    record(105, 'counselor_pending', 3, '11:00', '12:00', 3));
  tables.reservation_group_members = tables.reservation_group_members.filter(row => Number(row.user_id) !== 3);
  tables.reservations.push(record(106, 'checked_in', 3, '12:00', '13:00', 3));
  await assert.rejects(() => groups.joinGroup(100, 3), err => err.code === 'DAILY_TYPE_LIMIT');
  assert(!tables.reservation_group_members.some(row => Number(row.user_id) === 3));
  console.log('PASS 待审核、辅导员待审核和使用中均计数；超额加入不写入成员');
  const policy = require('../server/src/services/reservationDailyPolicy');
  const ownAndMember = [record(107, 'approved', 3, '07:00', '08:00')];
  ownAndMember[0].room_type = 'media_room';
  policy.validate(input(3, '20:00', '21:00'), [...ownAndMember, ...ownAndMember], 'media_room');
  const sqlCalls = [];
  await policy.assertTransaction({ execute: async (sql, params) => {
    if (sql.includes('FROM users')) return [[tables.users[0]]];
    sqlCalls.push({ sql, params });
    return [[...ownAndMember]];
  } }, input(3, '20:00', '21:00'), 'media_room');
  assert(sqlCalls[0].sql.includes('EXISTS'));
  assert.deepEqual(sqlCalls[0].params, [date, 1, 1]);
  console.log('PASS 正式数据库查询同时覆盖本人发起及作为组团成员参与的预约');
  console.log('reservation-daily-policy-check passed');
}
main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
