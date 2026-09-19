/**
 * QA 独立验证 · F2 收口：组团审批「版本自增 + 双写审计轨迹」
 *
 * 目标：证明 reservationGroupService.approveGroup 不再绕过常规预约审批的一致性模型：
 *   - R-02 乐观锁：主预约 reservations.version 必须 version = version + 1（之前漏写）。
 *   - R-08 审计：业务批注轨迹（reservation_audit_trail，用户可见）+ 防篡改审计链
 *     （operation_logs 哈希链，合规取证）双写，与 reservationApprovalController.approve 一致。
 *   - 状态兜底：已被处理的团队二次审批必须 409 拒绝。
 *
 * 强制 mock 模式（MySQL 端口=1、Redis 端口=1），不依赖本机 数据库/Redis。
 * 运行：node server/tests/qa-f2-group-approval-consistency.js
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

const SEED_TS = '2026-09-17 00:00:00';

const resetTables = function() {
  tables.rooms = [
    { id: 1, name: '研讨室A', building_id: 1, type: 'seminar_room', capacity: 10 }
  ];
  tables.users = [
    { id: 1, name: 'u1', real_name: '学生一', student_id: 'S0001', student_no: 'S0001', status: 'active', credit_score: 100 }
  ];
  tables.reservations = [
    {
      id: 100, user_id: 1, room_id: 1, seat_id: null, date: '2026-09-20', start_time: '10:00', end_time: '12:00',
      purpose: '组队学习', participants: 2, status: 'pending', reservation_code: 'GRP001', reject_reason: '',
      audited_by: null, audited_at: null, cancelled_at: null, version: 1,
      created_at: SEED_TS, updated_at: SEED_TS
    }
  ];
  tables.reservation_groups = [
    {
      id: 10, name: '学习小组', room_id: 1, date: '2026-09-20', start_time: '10:00', end_time: '12:00', purpose: '学习',
      max_members: 4, status: 'pending', reservation_id: 100, created_by: 1, created_at: SEED_TS, updated_at: SEED_TS,
      reject_reason: '', audited_by: null, audited_at: null
    }
  ];
  tables.reservation_group_members = [
    { id: 1, group_id: 10, user_id: 1, seat_id: null, status: 'confirmed', created_at: SEED_TS }
  ];
  tables.reservation_audit_trail = [];
  tables.operation_logs = [];
};

const findReservation = function() { return tables.reservations.filter(function(r) { return Number(r.id) === 100; })[0]; };
const findGroup = function() { return tables.reservation_groups.filter(function(g) { return Number(g.id) === 10; })[0]; };
const findMember = function() { return tables.reservation_group_members.filter(function(m) { return Number(m.id) === 1; })[0]; };
const parseMeta = function(row) {
  if (!row || !row.metadata) return {};
  return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
};

const run = async function() {
  // ---------- 前置 ----------
  resetTables();
  eq('前置：主预约 version = 1', findReservation().version, 1);
  eq('前置：团队状态 pending', findGroup().status, 'pending');

  // ---------- 执行审批 ----------
  const result = await groupService.approveGroup(10, 2, 'admin');
  check('返回审批通过的组团（id=10）', result && Number(result.id) === 10);

  // ---------- R-02 乐观锁 ----------
  eq('R-02：主预约 version 自增为 2', findReservation().version, 2);
  eq('主预约状态变为 approved', findReservation().status, 'approved');
  eq('主预约 audited_by 写入操作人', Number(findReservation().audited_by), 2);

  // ---------- 团队/成员状态 ----------
  eq('团队状态变为 approved', findGroup().status, 'approved');
  eq('团队 audited_by 写入操作人', Number(findGroup().audited_by), 2);
  eq('成员状态确认 confirmed', findMember().status, 'confirmed');

  // ---------- R-08 业务轨迹（用户可见） ----------
  const trail = tables.reservation_audit_trail.filter(function(t) { return Number(t.reservation_id) === 100; });
  eq('R-08：业务轨迹写入 1 条', trail.length, 1);
  check('业务轨迹 action = approve', trail[0] && trail[0].action === 'approve', trail[0] && trail[0].action);
  check('业务轨迹 stage = first（pending 一审）', trail[0] && trail[0].stage === 'first', trail[0] && trail[0].stage);
  eq('业务轨迹 actor_id = 2', trail[0] && Number(trail[0].actor_id), 2);

  // ---------- R-08 合规审计链（哈希链） ----------
  const logs = tables.operation_logs.filter(function(o) { return Number(o.target_id) === 100; });
  eq('R-08：审计链写入 1 条', logs.length, 1);
  check('审计链 action = reservation.approve', logs[0] && logs[0].action === 'reservation.approve', logs[0] && logs[0].action);
  const meta = parseMeta(logs[0]);
  eq('审计链 metadata.groupId = 10', Number(meta.groupId), 10);
  check('审计链含 prev_hash/entry_hash（链式）', logs[0] && !!logs[0].entry_hash);

  // ---------- 状态兜底：重复审批必须 409 ----------
  try {
    await groupService.approveGroup(10, 2, 'admin');
    check('重复审批应被拒绝（409）', false, '未抛错');
  } catch (err) {
    check('重复审批抛 409（已被处理）', err.httpStatus === 409, 'got=' + (err.httpStatus || err.message));
  }

  // ---------- 拒绝场景：R-08 双写轨迹（与审批对称） ----------
  resetTables();
  const rejResult = await groupService.rejectGroup(10, 2, 'admin', '与课程冲突');
  check('拒绝返回组团（id=10）', rejResult && Number(rejResult.id) === 10);

  const rejRes = findReservation();
  eq('R-02(拒绝)：主预约 version 自增为 2', rejRes.version, 2);
  eq('主预约状态 rejected', rejRes.status, 'rejected');
  eq('主预约 reject_reason 写入', rejRes.reject_reason, '与课程冲突');
  eq('团队状态 rejected', findGroup().status, 'rejected');

  const rejTrail = tables.reservation_audit_trail.filter(function(t) { return Number(t.reservation_id) === 100; });
  eq('R-08(拒绝)：业务轨迹写入 1 条', rejTrail.length, 1);
  check('业务轨迹 action = reject', rejTrail[0] && rejTrail[0].action === 'reject', rejTrail[0] && rejTrail[0].action);
  const rejLogs = tables.operation_logs.filter(function(o) { return Number(o.target_id) === 100; });
  eq('R-08(拒绝)：审计链写入 1 条', rejLogs.length, 1);
  check('审计链 action = reservation.reject', rejLogs[0] && rejLogs[0].action === 'reservation.reject', rejLogs[0] && rejLogs[0].action);
};

run().then(function() {
  console.log('\n==== F2 收口 QA · 组团审批一致性 ====');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
}).catch(function(err) {
  console.error('测试运行异常:', err && err.stack ? err.stack : err);
  process.exit(2);
});
