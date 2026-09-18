/**
 * QA 独立验证 · T05 预约审核「乐观锁 + 批注轨迹」（R-02）
 *
 * 由 QA（严过关）独立编写。覆盖主理人指定的 7 个验证点 + “第三条写路径”排查。
 * 强制 mock 模式。运行：node server/tests/qa-batch2-approval-trail-check.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ALLOW_MOCK_DB = 'true';
process.env.ALLOW_MOCK_REDIS = 'true';
process.env.MYSQL_PORT = '1';
process.env.MYSQL_HOST = '127.0.0.1';
process.env.REDIS_PORT = '1';
process.env.REDIS_HOST = '127.0.0.1';

const path = require('path');
const http = require('http');
const express = require('express');
const SRC = path.join(__dirname, '..', 'src');

const db = require(path.join(SRC, 'config', 'database'));
const mockDb = require(path.join(SRC, 'config', 'mock-db'));
const approvalController = require(path.join(SRC, 'controllers', 'reservationApprovalController'));
const auditController = require(path.join(SRC, 'controllers', 'auditController'));
const trailController = require(path.join(SRC, 'controllers', 'reservationTrailController'));
const trailService = require(path.join(SRC, 'services', 'reservationAuditTrailService'));
const validator = require(path.join(SRC, 'middleware', 'validator'));

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
const trailRows = function(id) { return (tables.reservation_audit_trail || []).filter(function(r) { return Number(r.reservation_id) === Number(id); }); };
const auditCount = function() { return (tables.operation_logs || []).length; };

const resetRes = function(id, patch) {
  const row = findRes(id);
  Object.keys(patch || {}).forEach(function(k) { row[k] = patch[k]; });
  return row;
};

const makeRes = function() {
  const c = { status: 200, body: null };
  return { c: c, status: function(s) { c.status = s; return this; }, json: function(b) { c.body = b; return this; } };
};
const call = async function(handler, req) {
  const res = makeRes();
  await handler(req, res);
  return res.c;
};
const baseReq = function(over) {
  return Object.assign({
    user: { id: 2, role: 'super_admin' },
    params: { id: '7' },
    body: {},
    method: 'PUT',
    baseUrl: '/api/v1',
    route: { path: '/:id/approve' },
    requestId: 'qa-batch2',
    query: {}
  }, over || {});
};

// ---------- A) 路由级 validator：version 边界 ----------
const startValidatorServer = async function() {
  const app = express();
  app.use(express.json());
  app.put('/r/:id/approve', validator.auditRules, function(req, res) { res.json({ ok: true, version: req.body.version }); });
  const server = app.listen(0);
  await new Promise(function(r) { server.once('listening', r); });
  return { server: server, port: server.address().port };
};
const httpJson = function(port, method, p, body) {
  return new Promise(function(resolve, reject) {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: { 'Content-Type': 'application/json', 'Content-Length': data ? data.length : 0 } }, function(res) {
      let buf = '';
      res.on('data', function(c) { buf += c; });
      res.on('end', function() { let json = null; try { json = JSON.parse(buf); } catch (e) {} resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
};

const main = async function() {
  await db.ready();
  eq('数据库已回退 mock', db.isMock(), true);

  const vs = await startValidatorServer();
  const hit = function(body) { return httpJson(vs.port, 'PUT', '/r/7/approve', body); };
  eq('validator：不传 version -> 放行', (await hit({})).status, 200);
  eq('validator：version=1 -> 放行', (await hit({ version: 1 })).status, 200);
  eq('validator：version="1"（字符串整数）-> 放行', (await hit({ version: '1' })).status, 200);
  eq('validator：version=0 -> 400', (await hit({ version: 0 })).status, 400);
  eq('validator：version=-1 -> 400', (await hit({ version: -1 })).status, 400);
  eq('validator：version=1.5 -> 400', (await hit({ version: 1.5 })).status, 400);
  eq('validator：version="abc" -> 400', (await hit({ version: 'abc' })).status, 400);
  const nullVer = await hit({ version: null });
  console.log('NOTE  validator：version=null -> HTTP ' + nullVer.status);
  vs.server.close();

  // ---------- B) approve 乐观锁 ----------
  // 模拟“迁移已应用”：种子行补 version（真库 ALTER 后历史行回填为 1）
  tables.reservation_audit_trail = [];

  // B1: 版本匹配 -> 成功且推进版本、写轨迹
  resetRes(7, { status: 'pending', version: 1 });
  tables.reservation_audit_trail = [];
  const r1 = await call(approvalController.approve, baseReq({ params: { id: '7' }, body: { version: 1 } }));
  eq('approve 版本匹配 -> 200', r1.status, 200);
  eq('approve 后 status=approved', findRes(7).status, 'approved');
  eq('approve 后 version 自增 1->2', Number(findRes(7).version), 2);
  eq('approve 写入 1 条轨迹', trailRows(7).length, 1);
  eq('approve 轨迹 action=approve', (trailRows(7)[0] || {}).action, 'approve');
  eq('approve 轨迹 stage=first', (trailRows(7)[0] || {}).stage, 'first');

  // B2: 版本不匹配 -> 409 + businessCode AUDIT_VERSION_CONFLICT，且不写轨迹
  resetRes(7, { status: 'pending', version: 1 });
  tables.reservation_audit_trail = [];
  const r2 = await call(approvalController.approve, baseReq({ params: { id: '7' }, body: { version: 999 } }));
  eq('approve 版本不匹配 -> 409', r2.status, 409);
  eq('approve 版本不匹配 -> code 仍为数字', typeof r2.body.code, 'number');
  eq('approve 版本不匹配 -> businessCode', r2.body.businessCode, 'AUDIT_VERSION_CONFLICT');
  eq('approve 版本不匹配 -> 状态未变', findRes(7).status, 'pending');
  eq('approve 版本不匹配 -> 版本未变', Number(findRes(7).version), 1);
  eq('approve 版本不匹配 -> 不写轨迹', trailRows(7).length, 0);

  // B3: 不传 version -> 退化 WHERE status，仍 version+1
  resetRes(7, { status: 'pending', version: 1 });
  tables.reservation_audit_trail = [];
  const r3 = await call(approvalController.approve, baseReq({ params: { id: '7' }, body: {} }));
  eq('approve 不传 version -> 200（退化）', r3.status, 200);
  eq('approve 不传 version -> status=approved', findRes(7).status, 'approved');
  eq('approve 不传 version -> version 仍 +1', Number(findRes(7).version), 2);
  eq('approve 不传 version -> 写轨迹', trailRows(7).length, 1);

  // B4: version 边界判别（row.version=5）
  const boundary = async function(versionValue, label) {
    resetRes(7, { status: 'pending', version: 5 });
    tables.reservation_audit_trail = [];
    const r = await call(approvalController.approve, baseReq({ params: { id: '7' }, body: { version: versionValue } }));
    return { status: r.status, businessCode: r.body && r.body.businessCode, resStatus: findRes(7).status };
  };
  const b1 = await boundary(1, '1 vs 5'); // 走 version 路径 -> 冲突
  eq('version=1(row=5) 走版本路径 -> 409 冲突', b1.status, 409);
  eq('version=1(row=5) -> businessCode=冲突', b1.businessCode, 'AUDIT_VERSION_CONFLICT');
  const b5 = await boundary(5, '5 vs 5'); // 走 version 路径 -> 命中
  eq('version=5(row=5) -> 200', b5.status, 200);
  const bZero = await boundary(0, '0'); // 退化 -> 200
  eq('version=0 -> 退化(status 路径) 200', bZero.status, 200);
  const bNeg = await boundary(-3, 'neg'); // 退化 -> 200
  eq('version=-3 -> 退化 200', bNeg.status, 200);
  const bNull = await boundary(null, 'null'); // 退化 -> 200（controller 层）
  eq('version=null -> 退化 200（controller）', bNull.status, 200);
  const bNaN = await boundary('abc', 'abc'); // 退化 -> 200
  eq('version="abc" -> 退化 200（controller）', bNaN.status, 200);
  const bFloat = await boundary(1.5, 'float'); // 非整数 -> 退化 -> 200
  eq('version=1.5 -> 退化 200（controller）', bFloat.status, 200);
  // 退化路径绝不误放行：row 已被他人改成 approved 时
  resetRes(7, { status: 'approved', version: 5 });
  const bStale = await call(approvalController.approve, baseReq({ params: { id: '7' }, body: {} }));
  eq('退化路径对已处理预约 -> 409（不误放行）', bStale.status, 409);

  // ---------- C) reject 乐观锁 + reason ----------
  resetRes(7, { status: 'pending', version: 1 });
  tables.reservation_audit_trail = [];
  const rj0 = await call(approvalController.reject, baseReq({ params: { id: '7' }, body: {} }));
  eq('reject 缺 reason -> 400', rj0.status, 400);
  resetRes(7, { status: 'pending', version: 1 });
  const rj1 = await call(approvalController.reject, baseReq({ params: { id: '7' }, body: { reason: '不符合规则', version: 1 } }));
  eq('reject 版本匹配 -> 200', rj1.status, 200);
  eq('reject 后 status=rejected', findRes(7).status, 'rejected');
  eq('reject 后 version 自增 1->2', Number(findRes(7).version), 2);
  eq('reject 写入 1 条轨迹', trailRows(7).length, 1);
  eq('reject 轨迹 action=reject', (trailRows(7)[0] || {}).action, 'reject');
  eq('reject 轨迹 remark=原因', (trailRows(7)[0] || {}).remark, '不符合规则');
  resetRes(7, { status: 'pending', version: 1 });
  const rj2 = await call(approvalController.reject, baseReq({ params: { id: '7' }, body: { reason: 'x', version: 999 } }));
  eq('reject 版本不匹配 -> 409', rj2.status, 409);
  eq('reject 版本不匹配 -> businessCode', rj2.body.businessCode, 'AUDIT_VERSION_CONFLICT');
  eq('reject 版本不匹配 -> 状态未变', findRes(7).status, 'pending');

  // ---------- D) 二审 counselor 阶段 ----------
  resetRes(5, { status: 'counselor_pending', version: 1 });
  tables.reservation_audit_trail = [];
  const r5 = await call(approvalController.approve, baseReq({ user: { id: 3, role: 'counselor' }, params: { id: '5' }, body: { version: 1 }, route: { path: '/:id/approve' } }));
  eq('counselor 二审 approve -> 200', r5.status, 200);
  eq('counselor 二审 -> 1 条轨迹', trailRows(5).length, 1);
  eq('counselor 二审轨迹 stage=counselor', (trailRows(5)[0] || {}).stage, 'counselor');
  eq('counselor 二审轨迹 actorRole=counselor', (trailRows(5)[0] || {}).actor_role, 'counselor');

  // ---------- E) 重复 approve ----------
  resetRes(7, { status: 'approved', version: 2 });
  const dup = await call(approvalController.approve, baseReq({ params: { id: '7' }, body: {} }));
  eq('重复 approve 已 approved -> 409', dup.status, 409);

  // ---------- F) 轨迹只读接口 + 脱敏/越权 ----------
  tables.reservation_audit_trail = [];
  await trailService.recordApprove(7, 2, 'admin', 'first', '');
  await trailService.recordReject(7, 3, 'counselor', 'counselor', '二审驳回：原因X');
  eq('轨迹服务写入 2 条', trailRows(7).length, 2);
  const present = trailService.present(trailRows(7)[0]);
  check('present 不含明文学号/手机字段', present.student_id === undefined && present.phone === undefined && present.studentId === undefined);

  // F1: 宿生看自己（reservation 7 的 user_id=2）
  const tSelf = await call(trailController.trail, { user: { id: 2, role: 'student' }, params: { id: '7' } });
  eq('宿生看本人轨迹 -> 200', tSelf.status, 200);
  eq('宿生看本人轨迹返回 2 条', (tSelf.body.data || []).length, 2);
  // F2: 宿生看他人
  const tOther = await call(trailController.trail, { user: { id: 1, role: 'student' }, params: { id: '7' } });
  eq('宿生看他人轨迹 -> 403', tOther.status, 403);
  // F3: 超管全局 -> 明文 + 落审计
  const aBefore = auditCount();
  const tAdmin = await call(trailController.trail, {
    user: { id: 100, role: 'super_admin' }, params: { id: '7' },
    adminScope: { adminId: 100, role: 'super_admin', isGlobal: true, buildingId: null }
  });
  eq('超管看轨迹 -> 200', tAdmin.status, 200);
  check('超管看轨迹落审计', auditCount() > aBefore, 'before=' + aBefore + ' after=' + auditCount());
  const trailJson = JSON.stringify(tAdmin.body.data || []);
  check('轨迹响应不含明文手机号', !/\d{11}/.test(trailJson.replace(/"id":\d+/g, '')));
  // F4: 楼栋越权管理员 -> 掩码（不落审计）
  const aBefore2 = auditCount();
  const tOut = await call(trailController.trail, {
    user: { id: 98, role: 'admin' }, params: { id: '7' },
    adminScope: { adminId: 98, role: 'admin', isGlobal: false, buildingId: 99999 }
  });
  eq('越权楼栋管理员看轨迹 -> 200', tOut.status, 200);
  check('越权楼栋管理员不落审计（掩码降级）', auditCount() === aBefore2);

  // ---------- G) batchAudit 是否受影响 / 是否写轨迹 ----------
  resetRes(10, { status: 'pending', version: 1 });
  tables.reservation_audit_trail = (tables.reservation_audit_trail || []).filter(function(r) { return Number(r.reservation_id) !== 10; });
  const g = await call(auditController.batchAudit, {
    user: { id: 2, role: 'super_admin' }, params: {}, body: { ids: [10], action: 'approve' }, method: 'POST', baseUrl: '/api/v1/audit', route: { path: '/batch' }, query: {}
  });
  eq('batchAudit approve -> 200', g.status, 200);
  eq('batchAudit 后 status=approved', findRes(10).status, 'approved');
  // F1 已修复（提交 eb89440）：批量审核每个 UPDATE 现在写 version = version + 1
  eq('batchAudit 推进 version 1->2 (F1 修复后)', Number(findRes(10).version), 2);
  // F1 已修复：批量审核在事务内为每条预约写 1 条 reservation_audit_trail
  eq('batchAudit 写 1 条业务轨迹 (F1 修复后)', trailRows(10).length, 1);

  console.log('qa-batch2-approval-trail-check: PASS=' + pass + ' FAIL=' + fail);
  if (gaps.length) { console.log('--- 缺口/缺口说明 ---'); gaps.forEach(function(x) { console.log('  • ' + x); }); }
  if (fail > 0) process.exit(1);
};

main().catch(function(err) { console.error('SMOKE ERROR:', err && err.stack ? err.stack : err); process.exit(1); });
