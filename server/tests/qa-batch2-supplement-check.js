/**
 * QA 独立验证 · T04 补签「申请 → 审核 → 留痕」（R-08）
 *
 * 由 QA（严过关）独立编写。覆盖主理人指定 7 个验证点 + 迁移幂等静态复核。
 * 强制 mock 模式。运行：node server/tests/qa-batch2-supplement-check.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ALLOW_MOCK_DB = 'true';
process.env.ALLOW_MOCK_REDIS = 'true';
process.env.MYSQL_PORT = '1';
process.env.MYSQL_HOST = '127.0.0.1';
process.env.REDIS_PORT = '1';
process.env.REDIS_HOST = '127.0.0.1';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(__dirname, '..', 'src');

const db = require(path.join(SRC, 'config', 'database'));
const mockDb = require(path.join(SRC, 'config', 'mock-db'));
const supplementService = require(path.join(SRC, 'services', 'supplementService'));
const supplementController = require(path.join(SRC, 'controllers', 'supplementController'));
const checkinController = require(path.join(SRC, 'controllers', 'checkinController'));

let pass = 0;
let fail = 0;
const gaps = [];
const check = function(name, cond, detail) {
  if (cond) pass++;
  else { fail++; console.log('FAIL  ' + name + (detail ? ('  :: ' + detail) : '')); }
};
const eq = function(name, actual, expected) {
  check(name, actual === expected, 'got=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
};
const gapNote = function(name, detail) { gaps.push(name + ' | ' + detail); console.log('GAP   ' + name + ' | ' + detail); };

const tables = mockDb.__tables;
const findRes = function(id) { return tables.reservations.filter(function(r) { return Number(r.id) === Number(id); })[0]; };
const checkinsOf = function(resId) { return (tables.checkins || []).filter(function(c) { return Number(c.reservation_id) === Number(resId); }); };
const suppRow = function(id) { return (tables.supplement_requests || []).filter(function(r) { return Number(r.id) === Number(id); })[0]; };
const auditCount = function() { return (tables.operation_logs || []).length; };
const makeRes = function() {
  const c = { status: 200, body: null };
  return { c: c, status: function(s) { c.status = s; return this; }, json: function(b) { c.body = b; return this; } };
};
const call = async function(handler, req) { const res = makeRes(); await handler(req, res); return res.c; };

const cloneTables = function() { return JSON.parse(JSON.stringify(tables)); };
const restoreTables = function(snap) {
  Object.keys(tables).forEach(function(k) { if (!(k in snap)) delete tables[k]; });
  Object.keys(snap).forEach(function(k) { tables[k] = snap[k]; });
};

const expectThrow = async function(name, fn, expectedBusinessCode, expectedStatus) {
  try { await fn(); check(name + ' 应抛错', false, '未抛错'); }
  catch (err) {
    const okCode = expectedBusinessCode === undefined ? true : err.businessCode === expectedBusinessCode;
    const okStatus = expectedStatus === undefined ? true : Number(err.httpStatus) === Number(expectedStatus);
    check(name + ' 抛出预期错误', okCode && okStatus, 'businessCode=' + err.businessCode + ' httpStatus=' + err.httpStatus + ' msg=' + err.message);
  }
};

// ---------------- 迁移静态复核 ----------------
const auditSql = fs.readFileSync(path.join(ROOT, 'server', 'sql', 'migrations', '20260919_reservation_audit.sql'), 'utf8');
const suppSql = fs.readFileSync(path.join(ROOT, 'server', 'sql', 'migrations', '20260919_supplement_request.sql'), 'utf8');
const auditScript = fs.readFileSync(path.join(ROOT, 'scripts', 'apply-reservation-audit-migration.js'), 'utf8');
const suppScript = fs.readFileSync(path.join(ROOT, 'scripts', 'apply-supplement-migration.js'), 'utf8');
const stripComments = function(text) { return text.split('\n').filter(function(l) { return !/^\s*--/.test(l); }).join('\n'); };
const createNames = function(text) {
  const out = []; const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi; let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out.sort();
};
eq('审计迁移建表 1 张', createNames(auditSql).length, 1);
eq('审计迁移建表名', JSON.stringify(createNames(auditSql)), JSON.stringify(['reservation_audit_trail']));
check('审计迁移用 information_schema 探测', /information_schema\.columns/.test(auditSql));
check('审计迁移用 PREPARE/EXECUTE 幂等', /PREPARE\s+\w+/.test(auditSql) && /EXECUTE\s+\w+/.test(auditSql));
check('审计迁移空操作分支为 SELECT 1（无 DML）', /'SELECT 1'/.test(auditSql));
// 只扫「可执行 SQL」（去注释行），避免把注释里的字面 `CREATE TABLE` 误判为裸建表。
eq('审计迁移无裸 CREATE TABLE（仅扫可执行 SQL，跳过注释）', (stripComments(auditSql).match(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi) || []).length, 0);
check('审计迁移（去注释）无 INSERT/UPDATE/DELETE 语句', !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(stripComments(auditSql)));

eq('补签迁移建表 1 张', createNames(suppSql).length, 1);
eq('补签迁移建表名', JSON.stringify(createNames(suppSql)), JSON.stringify(['supplement_requests']));
check('补签迁移用 information_schema 探测', /information_schema\.columns/.test(suppSql));
check('补签迁移空操作分支为 SELECT 1（无 DML）', /'SELECT 1'/.test(suppSql));
eq('补签迁移无裸 CREATE TABLE（仅扫可执行 SQL，跳过注释）', (stripComments(suppSql).match(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi) || []).length, 0);
check('补签迁移（去注释）无 INSERT/UPDATE/DELETE 语句', !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(stripComments(suppSql)));

// ---------- review_remark 列落地静态复核（FO-2） ----------
check('补签迁移建表含 review_remark 列', /review_remark\s+VARCHAR\(255\)/i.test(suppSql));
check('补签迁移对 review_remark 幂等加列（探测+SELECT 1 空操作）', /ADD COLUMN review_remark/i.test(stripComments(suppSql)) && /'SELECT 1'/i.test(suppSql));
check('补签脚本预检 review_remark 列后才 ALTER', /REVIEW_COLUMN/.test(suppScript) && /ADD COLUMN review_remark/i.test(suppScript));
check('supplementService.COLUMNS 含 review_remark', /(^|,)\s*review_remark\s*(,|$)/.test(supplementService.COLUMNS));

check('审计脚本：探测列存在才 ALTER', /columnExists/.test(auditScript) && /ADD COLUMN version/.test(auditScript));
check('补签脚本：探测列存在才 ALTER', /columnExists/.test(suppScript) && /ADD COLUMN supplement_request_id/.test(suppScript));
check('两脚本均用 GET_LOCK', /GET_LOCK/.test(auditScript) && /GET_LOCK/.test(suppScript));

const main = async function() {
  await db.ready();
  eq('数据库已回退 mock', db.isMock(), true);

  // 真实 MySQL 尝试（无凭据则如实标注）
  let migrateNote = '';
  for (const s of ['apply-reservation-audit-migration.js', 'apply-supplement-migration.js']) {
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts', s)], { cwd: ROOT, encoding: 'utf8', timeout: 30000, env: Object.assign({}, process.env, { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '3306', MYSQL_USER: 'root', MYSQL_PASSWORD: '', MYSQL_DATABASE: 'jingyi_reservation' }) });
      migrateNote += s + '=成功; ';
    } catch (err) {
      const text = String((err && (err.stdout || err.stderr)) || err.message || err);
      migrateNote += s + '=' + (/ER_ACCESS_DENIED|Access denied/i.test(text) ? '凭据被拒(未复验)' : text.split('\n')[0]) + '; ';
    }
  }
  console.log('NOTE  迁移真实执行：' + migrateNote);

  tables.supplement_requests = [];
  tables.checkins = [];
  tables.reservation_audit_trail = [];

  // ---------------- 1) create：reason 必填 / 校验 ----------------
  await expectThrow('create 缺 reason', function() { return supplementService.create({ reservationId: 3, applicantId: 1, type: 'signin', reason: '   ' }); }, undefined, 400);
  await expectThrow('create type 非法', function() { return supplementService.create({ reservationId: 3, applicantId: 1, type: 'x', reason: 'r' }); }, undefined, 400);
  await expectThrow('create 预约不存在', function() { return supplementService.create({ reservationId: 999999, applicantId: 1, type: 'signin', reason: 'r' }); }, undefined, 404);
  await expectThrow('create reason 超长', function() { return supplementService.create({ reservationId: 3, applicantId: 1, type: 'signin', reason: 'x'.repeat(256) }); }, undefined, 400);

  findRes(3).status = 'approved';
  const created = await supplementService.create({ reservationId: 3, applicantId: 1, type: 'signin', reason: '忘记签到' });
  check('create 返回数字 id', typeof created.id === 'number' && created.id > 0);
  eq('create 初始 status=pending', created.status, 'pending');
  await expectThrow('create 重复 pending（同预约同类型）', function() { return supplementService.create({ reservationId: 3, applicantId: 1, type: 'signin', reason: '再来一次' }); }, undefined, 409);

  // ---------------- 2) 禁止自审 ----------------
  await expectThrow('禁止自审 -> SUPPLEMENT_SELF_REVIEW_FORBIDDEN', function() {
    return supplementService.review({ requestId: created.id, reviewerId: 1, action: 'approve' });
  }, 'SUPPLEMENT_SELF_REVIEW_FORBIDDEN', 403);
  eq('自审被拒后工单仍 pending', tables.supplement_requests.filter(function(r) { return Number(r.id) === Number(created.id); })[0].status, 'pending');

  // ---------------- 3) 审核不存在工单 ----------------
  await expectThrow('审核不存在工单 -> 404', function() { return supplementService.review({ requestId: 88888, reviewerId: 2, action: 'approve' }); }, undefined, 404);

  // ---------------- 4) approve(signin) 事务写入 checkins ----------------
  tables.checkins = [];
  const okApprove = await supplementService.review({ requestId: created.id, reviewerId: 2, reviewerRole: 'super_admin', action: 'approve', adminScope: { isGlobal: true } });
  eq('approve 返回 status=approved', okApprove.status, 'approved');
  eq('approve 后工单 status=approved', tables.supplement_requests.filter(function(r) { return Number(r.id) === Number(created.id); })[0].status, 'approved');
  eq('approve 后预约 status=checked_in', findRes(3).status, 'checked_in');
  eq('approve 写入 1 条 checkin', checkinsOf(3).length, 1);
  eq('checkin type=admin_manual', (checkinsOf(3)[0] || {}).checkin_type, 'admin_manual');
  eq('checkin 回填 supplement_request_id', Number((checkinsOf(3)[0] || {}).supplement_request_id), Number(created.id));
  eq('approve 无意见 -> review_remark 落库为 NULL', suppRow(created.id).review_remark, null);

  // ---------------- 5) 重复审核 -> 409 ----------------
  await expectThrow('重复审核同一工单 -> 409', function() { return supplementService.review({ requestId: created.id, reviewerId: 2, action: 'approve' }); }, undefined, 409);

  // ---------------- 6) reject：reason 必填 + 不写 checkins ----------------
  findRes(3).status = 'approved';
  const c2 = await supplementService.create({ reservationId: 3, applicantId: 1, type: 'signout', reason: '忘记签退' });
  await expectThrow('reject 缺 reason -> 400', function() { return supplementService.review({ requestId: c2.id, reviewerId: 2, action: 'reject' }); }, undefined, 400);
  const rejected = await supplementService.review({ requestId: c2.id, reviewerId: 2, action: 'reject', reason: '材料不足' });
  eq('reject 返回 status=rejected', rejected.status, 'rejected');
  eq('reject 后工单 rejected', tables.supplement_requests.filter(function(r) { return Number(r.id) === Number(c2.id); })[0].status, 'rejected');
  eq('reject 返回 reviewRemark=原因', rejected.reviewRemark, '材料不足');
  eq('reject 审核意见落库 review_remark=原因', suppRow(c2.id).review_remark, '材料不足');

  // ---------------- 7) approve(signout) -> checkout_time ----------------
  findRes(8).status = 'checked_in';
  tables.checkins = [{ id: 9001, reservation_id: 8, user_id: 2, room_id: 5, checkin_time: '2026-09-18 09:00:00', checkin_type: 'admin_manual', checkout_time: null }];
  const c3 = await supplementService.create({ reservationId: 8, applicantId: 1, type: 'signout', reason: '忘记签退' });
  await supplementService.review({ requestId: c3.id, reviewerId: 2, action: 'approve', adminScope: { isGlobal: true } });
  eq('signout approve 后预约 completed', findRes(8).status, 'completed');
  check('signout approve 补写 checkout_time', !!checkinsOf(8)[0].checkout_time, 'checkout_time=' + checkinsOf(8)[0].checkout_time);
  eq('signout checkin 回填 supplement_request_id', Number(checkinsOf(8)[0].supplement_request_id), Number(c3.id));

  // ---------------- 8) 事务整体回滚（中途失败） ----------------
  tables.supplement_requests = [];
  tables.checkins = [];
  findRes(3).status = 'approved';
  const c4 = await supplementService.create({ reservationId: 3, applicantId: 1, type: 'signin', reason: 'rollback 用例' });
  const realGetConnection = db.getConnection;
  let snapshot = null;
  const fakeConn = {
    isMock: false,
    beginTransaction: async function() { snapshot = cloneTables(); },
    execute: async function(sql, params) {
      if (/UPDATE\s+supplement_requests\s+SET\s+status\s*=\s*\?/i.test(sql)) throw new Error('模拟补签工单更新失败');
      return mockDb.query(sql, params);
    },
    commit: async function() { snapshot = null; },
    rollback: async function() { if (snapshot) restoreTables(snapshot); },
    release: function() {}
  };
  db.getConnection = async function() { return fakeConn; };
  let rolled = false;
  try { await supplementService.review({ requestId: c4.id, reviewerId: 2, action: 'approve', adminScope: { isGlobal: true } }); }
  catch (e) { rolled = true; }
  db.getConnection = realGetConnection;
  check('事务中途失败 -> 抛错', rolled);
  eq('回滚后预约 status 还原 approved', findRes(3).status, 'approved');
  eq('回滚后未残留 checkin', checkinsOf(3).length, 0);
  eq('回滚后工单仍 pending', tables.supplement_requests.filter(function(r) { return Number(r.id) === Number(c4.id); })[0].status, 'pending');

  // ---------------- 9) 兼容：manualCheckin 直写路径（SQL 不含新列） ----------------
  findRes(4).status = 'approved';
  tables.checkins = [];
  const captured = [];
  const recordRunner = { transactional: false, query: async function(sql, params) { captured.push(sql); return mockDb.query(sql, params); } };
  await checkinController.applyManualCheckinWithinTransaction(recordRunner, { reservationId: 4, statusMessage: 'x' });
  const legacyInsert = captured.filter(function(s) { return /INSERT\s+INTO\s+checkins/i.test(s); })[0] || '';
  check('旧路径 INSERT 不含 supplement_request_id', !/supplement_request_id/.test(legacyInsert), legacyInsert.slice(0, 90));
  eq('旧路径成功写入 checkin', checkinsOf(4).length, 1);

  findRes(4).status = 'approved';
  tables.checkins = [];
  const captured2 = [];
  const recordRunner2 = { transactional: false, query: async function(sql, params) { captured2.push(sql); return mockDb.query(sql, params); } };
  await checkinController.applyManualCheckinWithinTransaction(recordRunner2, { reservationId: 4, supplementRequestId: 12345, statusMessage: 'x' });
  const newInsert = captured2.filter(function(s) { return /INSERT\s+INTO\s+checkins/i.test(s); })[0] || '';
  check('新路径 INSERT 含 supplement_request_id', /supplement_request_id/.test(newInsert), newInsert.slice(0, 90));

  // ---------------- 10) list 出口脱敏 ----------------
  tables.supplement_requests = [];
  tables.checkins = [];
  findRes(3).status = 'approved';
  await supplementService.create({ reservationId: 3, applicantId: 1, type: 'signin', reason: '脱敏用例' });
  const listReq = function(user, adminScope) { return { user: user, query: {}, adminScope: adminScope }; };
  const aBefore = auditCount();
  const lAdmin = await call(supplementController.list, listReq({ id: 100, role: 'super_admin' }, { adminId: 100, role: 'super_admin', isGlobal: true, buildingId: null }));
  eq('list(超管) -> 200', lAdmin.status, 200);
  const row0 = (lAdmin.body.data || [])[0] || {};
  eq('list(超管全局) 学号明文', String(row0.student_id), '2024001002');
  check('list(超管全局) 落审计', auditCount() > aBefore);
  const lOut = await call(supplementController.list, listReq({ id: 98, role: 'admin' }, { adminId: 98, role: 'admin', isGlobal: false, buildingId: 99999 }));
  const rowOut = (lOut.body.data || [])[0] || {};
  check('list(越权楼栋管理员) 学号掩码', /\*/.test(String(rowOut.student_id)), 'student_id=' + rowOut.student_id);
  const lPeer = await call(supplementController.list, listReq({ id: 1, role: 'student' }, undefined));
  const rowPeer = (lPeer.body.data || [])[0] || {};
  check('list(宿生看他人) 学号掩码', /\*/.test(String(rowPeer.student_id)), 'student_id=' + rowPeer.student_id);

  // ---------------- 11) review_remark：approve 带意见 + list 返回该字段 + 出口脱敏（FO-2） ----------------
  tables.supplement_requests = [];
  tables.checkins = [];
  findRes(3).status = 'approved';
  const c5 = await supplementService.create({ reservationId: 3, applicantId: 1, type: 'signin', reason: '带意见用例' });
  const appr5 = await supplementService.review({ requestId: c5.id, reviewerId: 2, reviewerRole: 'super_admin', action: 'approve', reason: '同意补签', adminScope: { isGlobal: true } });
  eq('approve 返回 reviewRemark', appr5.reviewRemark, '同意补签');
  eq('approve 带意见落库 review_remark', suppRow(c5.id).review_remark, '同意补签');
  // list 能返回该字段（超管全局明文）：review_remark 非 PII，掩码管线不改变它
  const lAdmin2 = await call(supplementController.list, listReq({ id: 100, role: 'super_admin' }, { adminId: 100, role: 'super_admin', isGlobal: true, buildingId: null }));
  const rowAdmin2 = (lAdmin2.body.data || [])[0] || {};
  eq('list(超管) 返回 review_remark 字段', rowAdmin2.review_remark, '同意补签');
  eq('list(超管全局) 学号明文', String(rowAdmin2.student_id), '2024001002');
  // 越权楼栋管理员：学号掩码，但 review_remark 仍原样返回（非个人敏感信息）
  const lOut2 = await call(supplementController.list, listReq({ id: 98, role: 'admin' }, { adminId: 98, role: 'admin', isGlobal: false, buildingId: 99999 }));
  const rowOut2 = (lOut2.body.data || [])[0] || {};
  check('list(越权) 学号掩码', /\*/.test(String(rowOut2.student_id)), 'student_id=' + rowOut2.student_id);
  eq('list(越权) 仍返回 review_remark（非 PII 不掩码）', rowOut2.review_remark, '同意补签');
  eq('list 出口掩码不污染 review_remark 原值', suppRow(c5.id).review_remark, '同意补签');

  console.log('qa-batch2-supplement-check: PASS=' + pass + ' FAIL=' + fail);
  if (gaps.length) { console.log('--- 缺口 ---'); gaps.forEach(function(x) { console.log('  • ' + x); }); }
  if (fail > 0) process.exit(1);
};

main().catch(function(err) { console.error('SMOKE ERROR:', err && err.stack ? err.stack : err); process.exit(1); });
