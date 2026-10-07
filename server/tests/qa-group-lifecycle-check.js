/**
 * QA 独立验证 · 组团生命周期（createGroup / joinGroup / leaveGroup）
 *
 * 目标：补齐组团「创建 / 加入 / 退出」前半段的 mock 回归覆盖（F2 测试只覆盖了审批/拒绝一致性）。
 * 覆盖点：
 *   - createGroup：主预约创建 + 占槽 + 创建者自动入团；状态随房间审核配置派生
 *     （无审核→approved / need_audit→pending / need_counselor_audit→counselor_pending）；
 *     自习室（seat_required 类型）应被拒绝（R：组团不支持按座）。
 *   - joinGroup：成功加入（成员数 +1、声明实际人数保持）、重复加入 409、创建者已在团内 409、
 *     满员 409、已锁定（cancelled/rejected）409。
 *   - leaveGroup：成功退出（成员移除、声明实际人数保持）、创建者不可退出 400、已锁定 409。
 *
 * 强制 mock 模式（MySQL 端口=1、Redis 端口=1），不依赖本机 数据库/Redis。
 * 运行：node server/tests/qa-group-lifecycle-check.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ALLOW_MOCK_DB = 'true';
process.env.ALLOW_MOCK_REDIS = 'true';
process.env.MYSQL_PORT = '1';
process.env.MYSQL_HOST = '127.0.0.1';
process.env.REDIS_PORT = '1';
process.env.REDIS_HOST = '127.0.0.1';

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');

const mockDb = require(path.join(SRC, 'config', 'mock-db'));
const database = require(path.join(SRC, 'config', 'database'));
const groupService = require(path.join(SRC, 'services', 'reservationGroupService'));

let pass = 0;
let fail = 0;
const check = function(name, cond, detail) {
  if (cond) pass++;
  else { fail++; console.log('FAIL  ' + name + (detail ? ('  :: ' + detail) : '')); }
};
const eq = function(name, actual, expected) {
  check(name, actual === expected, 'got=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
};

const tables = mockDb.__tables;
const SEED_TS = '2026-09-19 00:00:00';

// 取「今天 + 2 天」作为预约日期，恒在 reservation.advanceDays(=3) 范围内。
const futureDate = (function() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
})();

const seedRooms = function() {
  tables.rooms = [
    { id: 1, name: '研讨室A', building_id: 1, type: 'seminar_room', capacity: 10, status: 'open', max_duration: 0, need_audit: 0, need_counselor_audit: 0 },
    { id: 2, name: '共享空间B', building_id: 1, type: 'shared_space', capacity: 10, status: 'open', max_duration: 0, need_audit: 1, need_counselor_audit: 0 },
    { id: 3, name: '研讨室C', building_id: 1, type: 'seminar_room', capacity: 10, status: 'open', max_duration: 0, need_audit: 0, need_counselor_audit: 1 },
    { id: 4, name: '自习室D', building_id: 1, type: 'study_room', capacity: 50, status: 'open', max_duration: 0, need_audit: 0, need_counselor_audit: 0 }
  ];
};
const seedUsers = function() {
  tables.users = [
    { id: 1, name: 'u1', real_name: '学生一', student_id: 'S0001', student_no: 'S0001', status: 'active', credit_score: 100 },
    { id: 2, name: 'u2', real_name: '学生二', student_id: 'S0002', student_no: 'S0002', status: 'active', credit_score: 100 },
    { id: 3, name: 'u3', real_name: '学生三', student_id: 'S0003', student_no: 'S0003', status: 'active', credit_score: 100 }
  ];
};

const resetTables = function() {
  tables.reservations = [];
  tables.reservation_groups = [];
  tables.reservation_group_members = [];
  tables.reservation_audit_trail = [];
  tables.operation_logs = [];
  // 必须随预约一起清空占槽表，否则上一场景残留的 reservation_slots 会让本场景复用
  // 同一房间/日期/时段的 createGroup 误判 SLOT_CONFLICT。同时清掉一次性回填守卫，
  // 保证后续 mock 写入可重新按需生成槽位。
  tables.reservation_slots = [];
  tables.__reservationSlotsBackfilled = false;
  seedRooms();
  seedUsers();
};

const findReservationById = function(id) {
  return tables.reservations.filter(function(r) { return Number(r.id) === Number(id); })[0];
};

const expectThrowHttp = async function(name, fn, expectedStatus) {
  try {
    await fn();
    check(name + ' 应抛错', false, '未抛错');
  } catch (err) {
    check(name + ' 抛出 httpStatus=' + expectedStatus, err.httpStatus === expectedStatus, 'got=' + (err.httpStatus || err.message));
  }
};

const run = async function() {
  // 强制进入 mock 模式：本测试以 createGroup 作为首个调用，而 createGroup 在首个查询前
  // 就基于 db.isMock() 分支；若不在调用前激活 mock，会误入事务分支并抛
  // “当前数据库模式不支持事务操作”。ready() 在本机无真实 MySQL（端口=1）时回退 mock。
  await database.ready();

  // ---------- 场景1：createGroup 状态派生 + 自习室拒绝 ----------
  resetTables();
  const g1 = await groupService.createGroup(1, { title: '学习小组', roomId: 1, date: futureDate, startHour: '10:00', endHour: '12:00' });
  check('createGroup(无审核房)：返回 id', g1 && Number(g1.id) > 0);
  eq('createGroup：状态=approved（无审核）', g1 && g1.approvalStatus, 'approved');
  eq('createGroup：创建者自动入团（memberCount=1）', g1 && g1.memberCount, 1);
  const r1 = findReservationById(g1.reservationId);
  check('createGroup：主预约已建', r1 && Number(r1.id) > 0);
  eq('createGroup：主预约状态=approved', r1 && r1.status, 'approved');
  eq('createGroup：主预约保留默认声明实际人数4', r1 && Number(r1.participants), 4);

  const g2 = await groupService.createGroup(2, { title: '需一审', roomId: 2, date: futureDate, startHour: '10:00', endHour: '12:00' });
  eq('createGroup(need_audit)：状态=pending', g2 && g2.approvalStatus, 'pending');

  const g3 = await groupService.createGroup(3, { title: '需二审', roomId: 3, date: futureDate, startHour: '10:00', endHour: '12:00' });
  eq('createGroup(need_counselor_audit)：状态=counselor_pending', g3 && g3.approvalStatus, 'counselor_pending');

  await expectThrowHttp('createGroup(自习室) 应 400 拒绝', function() {
    return groupService.createGroup(1, { title: '自习', roomId: 4, date: futureDate, startHour: '10:00', endHour: '12:00' });
  }, 400);

  // ---------- 场景2：joinGroup ----------
  resetTables();
  const gj = await groupService.createGroup(1, { title: '可加入', roomId: 1, date: futureDate, startHour: '10:00', endHour: '12:00' });
  const joinRes = await groupService.joinGroup(gj.id, 2);
  eq('joinGroup：成员数=2', joinRes && joinRes.memberCount, 2);
  check('joinGroup：新成员 status=confirmed', joinRes && joinRes.members.some(function(m) { return Number(m.userId) === 2 && m.status === 'confirmed'; }));
  const rj = findReservationById(gj.reservationId);
  eq('joinGroup：主预约声明实际人数保持4', rj && Number(rj.participants), 4);

  await expectThrowHttp('joinGroup：重复加入 应 409', function() { return groupService.joinGroup(gj.id, 2); }, 409);
  await expectThrowHttp('joinGroup：创建者已在团内 应 409', function() { return groupService.joinGroup(gj.id, 1); }, 409);

  // 满员：实际人数声明2，发起人加一名登记成员后才满员。
  const gFull = await groupService.createGroup(2, { title: '满员团', roomId: 1, date: futureDate, startHour: '14:00', endHour: '16:00', maxMembers: 2 });
  await groupService.joinGroup(gFull.id, 1);
  await expectThrowHttp('joinGroup：满员 应 409', function() { return groupService.joinGroup(gFull.id, 3); }, 409);

  // 已锁定（cancelled）的团不可加入
  tables.reservation_groups.push({
    id: 900, name: '已锁定', room_id: 1, date: futureDate, start_time: '10:00', end_time: '12:00', purpose: 'x',
    max_members: 4, status: 'cancelled', reservation_id: null, created_by: 1, created_at: SEED_TS, updated_at: SEED_TS, reject_reason: '', audited_by: null, audited_at: null
  });
  await expectThrowHttp('joinGroup：已锁定 应 409', function() { return groupService.joinGroup(900, 3); }, 409);

  // ---------- 场景3：leaveGroup ----------
  resetTables();
  const gl = await groupService.createGroup(1, { title: '可退出', roomId: 1, date: futureDate, startHour: '10:00', endHour: '12:00' });
  await groupService.joinGroup(gl.id, 2);
  const leaveRes = await groupService.leaveGroup(gl.id, 2);
  eq('leaveGroup：退出后成员数=1', leaveRes && leaveRes.memberCount, 1);
  const memAfter = tables.reservation_group_members.filter(function(m) { return Number(m.group_id) === gl.id && Number(m.user_id) === 2; });
  eq('leaveGroup：成员记录已移除', memAfter.length, 0);
  const rl = findReservationById(gl.reservationId);
  eq('leaveGroup：主预约声明实际人数保持4', rl && Number(rl.participants), 4);

  await expectThrowHttp('leaveGroup：创建者不能退出 应 400', function() { return groupService.leaveGroup(gl.id, 1); }, 400);

  // 已锁定（cancelled）的团不可退出
  tables.reservation_groups.push({
    id: 901, name: '已锁定2', room_id: 1, date: futureDate, start_time: '10:00', end_time: '12:00', purpose: 'x',
    max_members: 4, status: 'cancelled', reservation_id: null, created_by: 1, created_at: SEED_TS, updated_at: SEED_TS, reject_reason: '', audited_by: null, audited_at: null
  });
  tables.reservation_group_members.push({ id: 950, group_id: 901, user_id: 3, seat_id: null, status: 'confirmed', created_at: SEED_TS });
  await expectThrowHttp('leaveGroup：已锁定 应 409', function() { return groupService.leaveGroup(901, 3); }, 409);

  // ---------- 场景4：实际人数校验失败不能留下组团、预约或库存 ----------
  const invalidCounts = [
    { value: 1, name: '人数不足' },
    { value: 1.5, name: '不足两人的非整数' },
    { value: 51, name: '超过团队人数限制' },
    { value: 11, name: '超过房间容量' },
    { value: 2, capacity: 1, name: '两人超过小房间容量' }
  ];
  for (const input of invalidCounts) {
    resetTables();
    if (input.capacity) tables.rooms[0].capacity = input.capacity;
    await expectThrowHttp('createGroup：' + input.name + ' 应400', function() {
      return groupService.createGroup(1, { title: '人数校验', roomId: 1, date: futureDate,
        startHour: '10:00', endHour: '12:00', maxMembers: input.value });
    }, 400);
    eq(input.name + '：不留下主预约', tables.reservations.length, 0);
    eq(input.name + '：不留下组团', tables.reservation_groups.length, 0);
    eq(input.name + '：不占用库存', tables.reservation_slots.length, 0);
  }

  // ---------- 场景5：关闭/辅导员专用房/错误时段不能产生预约 ----------
  for (const scenario of [
    { name: '关闭房间', changeRoom: room => { room.status = 'closed'; } },
    { name: '辅导员专用房间', changeRoom: room => { room.type = 'party_room'; } },
    { name: '结束早于开始', startHour: '12:00', endHour: '10:00' }
  ]) {
    resetTables();
    if (scenario.changeRoom) scenario.changeRoom(tables.rooms[0]);
    await expectThrowHttp('createGroup：' + scenario.name + ' 应400', function() {
      return groupService.createGroup(1, { title: '规则校验', roomId: 1, date: futureDate,
        startHour: scenario.startHour || '10:00', endHour: scenario.endHour || '12:00', maxMembers: 4 });
    }, 400);
    eq(scenario.name + '：不留下主预约', tables.reservations.length, 0);
    eq(scenario.name + '：不留下组团', tables.reservation_groups.length, 0);
    eq(scenario.name + '：不占用库存', tables.reservation_slots.length, 0);
  }

  // ---------- 场景6：人数保持与解散后库存释放、重复操作 ----------
  resetTables();
  const gd = await groupService.createGroup(1, { title: '解散校验', roomId: 1, date: futureDate,
    startHour: '10:00', endHour: '12:00', maxMembers: 4 });
  const dissolved = await groupService.dissolveGroup(gd.id, 1);
  eq('dissolveGroup：组团变为已取消', dissolved.approvalStatus, 'cancelled');
  eq('dissolveGroup：主预约变为已取消', findReservationById(gd.reservationId).status, 'cancelled');
  eq('dissolveGroup：声明实际人数保持4', Number(findReservationById(gd.reservationId).participants), 4);
  eq('dissolveGroup：释放全部占用库存', tables.reservation_slots.length, 0);
  const repeated = await groupService.dissolveGroup(gd.id, 1);
  eq('dissolveGroup：重复解散仍为已取消', repeated.approvalStatus, 'cancelled');
};

run().then(function() {
  console.log('\n==== 组团生命周期 QA · createGroup/joinGroup/leaveGroup ====');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
}).catch(function(err) {
  console.error('测试运行异常:', err && err.stack ? err.stack : err);
  process.exit(2);
});
