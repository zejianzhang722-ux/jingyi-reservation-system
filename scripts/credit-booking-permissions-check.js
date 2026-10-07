process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
// Keep same-day recruitment tests ahead of their 15:00/16:00 slots at every run time.
const RealDate = Date;
const testClock = new RealDate(); testClock.setHours(10, 0, 0, 0);
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [testClock.getTime()])); }
  static now() { return testClock.getTime(); }
};
const db = require('../server/src/config/database');
const redis = require('../server/src/config/redis');
const helpers = require('../server/src/utils/helpers');
async function invoke(handler, req) {
  let body; await handler(req, { status() { return this; }, json(value) { body = value; return this; } }); return body;
}
async function main() {
  await db.ready(); await redis.ready(); assert(db.isMock());
  const t = require('../server/src/config/mock-db').__tables;
  const user = t.users[0]; user.credit_score = 20; user.status = 'banned';
  user.restricted_until = new Date(Date.now() + 86400000);
  const auth = require('../server/src/controllers/authController');
  const login = await invoke(auth.studentLogin, { body: { studentNo: '2024001001', cardNo: '200001' } });
  assert.equal(login.code, 200, '旧信用封禁不得阻止学生登录');
  assert.equal(Number(login.data.userInfo.credit_score), 20);
  let allowed = false;
  await require('../server/src/middleware/auth').auth({ headers: { authorization: 'Bearer ' + login.data.token }, originalUrl: '/api/v1/user/credit' }, { status() { return this; }, json() {} }, () => { allowed = true; });
  assert(allowed, '低信用学生仍可读取信用和其他登录后页面');
  const credit = require('../server/src/services/creditService');
  user.status = 'active'; user.restricted_until = null;
  await credit.addCredit(user.id, -20, 'violation', '低分用例');
  assert.equal(user.status, 'active', '信用扣分不得改变账号状态');
  assert.equal(user.restricted_until, null);
  const policy = require('../server/src/services/creditBookingPolicy');
  for (const [score, advanceDays, dailyLimit] of [[120,3,3],[80,3,3],[79,2,2],[60,2,2],[59,1,1],[30,1,1],[29,0,1],[0,0,1]]) {
    const rule = policy.forScore(score); assert.equal(rule.advanceDays, advanceDays); assert.equal(rule.dailyLimit, dailyLimit);
  }
  const today = helpers.formatDate(new Date());
  const next = helpers.formatDate(new Date(Date.now() + 86400000));
  const input = { userId: user.id, roomId: 13, date: today, startTime: '15:00', endTime: '15:30', purpose: '信用预约权限检查', participants: 1 };
  policy.validate(input, user);
  policy.validate({ ...input, startTime: '09:00:00', endTime: '17:00:00' }, user);
  assert.throws(() => policy.validate({ ...input, date: next }, user), e => e.code === 'CREDIT_DATE_LIMIT');
  assert.throws(() => policy.validate({ ...input, startTime: '08:30' }, user), e => e.code === 'CREDIT_TIME_LIMIT');
  assert.throws(() => policy.validate({ ...input, endTime: '17:30' }, user), e => e.code === 'CREDIT_TIME_LIMIT');
  const daily = require('../server/src/services/reservationDailyPolicy');
  t.reservations = []; t.reservation_groups = []; t.reservation_group_members = []; t.reservation_slots = [];
  const command = require('../server/src/services/reservationCommandService');
  const created = await command.createReservation(input);
  assert(created.id, '零分仍可在允许范围内预约');
  await assert.rejects(() => command.createReservation({ ...input, startTime: '16:00', endTime: '16:30' }), e => e.code === 'DAILY_TYPE_LIMIT');
  await assert.rejects(() => require('../server/src/services/reservationMutationService').updateReservation({ reservationId: created.id, actor: { id: user.id, role: 'student' }, startTime: '17:00', endTime: '18:00' }), e => e.code === 'CREDIT_TIME_LIMIT');
  // Real database path uses the same rule and quota, with the caller's user lock retained.
  const connection = { execute: async sql => sql.includes('FROM users') ? [[user]] : [[{ id: 900, date: today, room_type: 'roadshow_space', status: 'completed', start_time: '09:00', end_time: '10:00' }]] };
  await assert.rejects(() => daily.assertTransaction(connection, { ...input, startTime: '16:00', endTime: '16:30' }, 'roadshow_space'), e => e.code === 'DAILY_TYPE_LIMIT');
  const groups = require('../server/src/services/reservationGroupService');
  const groupInput = { roomId: 21, date: next, startTime: '16:00', endTime: '16:30', title: '信用组团权限检查', maxMembers: 2 };
  const futureGroup = await groups.createGroup(2, groupInput);
  await assert.rejects(() => groups.joinGroup(futureGroup.id, user.id), e => e.code === 'CREDIT_DATE_LIMIT');
  const todayGroup = await groups.createGroup(2, { ...groupInput, date: today });
  await groups.joinGroup(todayGroup.id, user.id);
  const extraGroup = await groups.createGroup(2, { ...groupInput, date: today, startTime: '16:30', endTime: '17:00' });
  await assert.rejects(() => groups.joinGroup(extraGroup.id, user.id), e => e.code === 'DAILY_TYPE_LIMIT');
  user.status = 'banned'; user.restricted_until = null;
  const disabled = await invoke(auth.studentLogin, { body: { studentNo: '2024001001', cardNo: '200001' } });
  assert.equal(disabled.code, 403, '明确人工停用的账号仍应拒绝登录');
  console.log('PASS: credit never blocks login; legacy credit bans, zero score, tier boundaries, booking date/time/quota, edits and permanent account disable');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await db.close(); await redis.quit(); });
