/**
 * QA 独立验证 · T03 临时授权 + 岗位交接（R-06） + 迁移幂等
 *
 * 由 QA（严过关）独立编写。覆盖任务要求的 6 个验证点：
 *   ① 迁移脚本幂等（静态断言 + 真实 MySQL 尝试，后者本环境无凭据 -> 如实标注未复验）
 *   ② listActive 对“已过期 / 未生效”返回空
 *   ③ revoke 后立即失效
 *   ④ reassign 中途失败整体回滚（用可注入的事务假连接制造第二步失败）
 *   ⑤ reassign 后旧 refresh 令牌被删（token:admin:<id>）
 *   ⑥ capabilities 读取失败不阻断既有接口
 *
 * 强制 mock 模式（MySQL 端口=1、Redis 端口=1），不依赖本机 数据库/Redis。
 * 运行：node server/tests/qa-batch01-admin-delegation-check.js
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
const redis = require(path.join(SRC, 'config', 'redis'));
const mockDb = require(path.join(SRC, 'config', 'mock-db'));
const permissions = require(path.join(SRC, 'config', 'permissions'));
const capabilityService = require(path.join(SRC, 'services', 'adminCapabilityService'));
const handoverService = require(path.join(SRC, 'services', 'adminHandoverService'));
const adminScopeMiddleware = require(path.join(SRC, 'middleware', 'adminScope'));

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
const gap = function(name, detail) { fail++; gaps.push(name + ' | ' + detail); console.log('GAP   ' + name + ' | ' + detail); };

const tables = mockDb.__tables;

const resetTables = function() {
  tables.admin_capability_grants = [];
  tables.admin_handover = [];
  tables.admins = [
    { id: 1, username: 'admin', real_name: '系统管理员', role: 'admin', building_id: null, scope_type: 'global', status: 'active' },
    { id: 2, username: 'superadmin', real_name: '超级管理员', role: 'super_admin', building_id: null, scope_type: 'global', status: 'active' },
    { id: 3, username: 'counselor', real_name: '辅导员', role: 'counselor', building_id: null, scope_type: 'global', status: 'active' },
    { id: 4, username: 'building_admin', real_name: 'B座导生管理员', role: 'admin', building_id: 1, scope_type: 'building', status: 'active' }
  ];
};
const findAdmin = function(id) { return tables.admins.filter(function(a) { return Number(a.id) === Number(id); })[0]; };

const expectThrow = async function(name, fn, expectedCode) {
  try { await fn(); check(name + ' 应抛错', false, '未抛错'); }
  catch (err) {
    check(name + ' 抛出 businessCode=' + expectedCode, err.businessCode === expectedCode, 'got=' + err.businessCode + ' msg=' + err.message);
  }
};

// ---------- ① 迁移脚本幂等（静态） ----------
const sqlPath = path.join(ROOT, 'server', 'sql', 'migrations', '20260918_admin_delegation.sql');
const scriptPath = path.join(ROOT, 'scripts', 'apply-admin-delegation-migration.js');
const sqlText = fs.readFileSync(sqlPath, 'utf8');
const scriptText = fs.readFileSync(scriptPath, 'utf8');

// 仅匹配“带表名”的真实建表语句，避免把注释里出现的字样也算进来
const createTableNames = function(text) {
  const names = [];
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) names.push(m[1]);
  return names;
};
const bareCreate = function(text) { return (text.match(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi) || []).length; };
const sqlNames = createTableNames(sqlText).slice().sort();
const scriptNames = createTableNames(scriptText).slice().sort();
eq('迁移 SQL 建表 2 张', sqlNames.length, 2);
eq('迁移 SQL 表集合', JSON.stringify(sqlNames), JSON.stringify(['admin_capability_grants', 'admin_handover']));
eq('迁移 SQL 无裸 CREATE TABLE（不带 IF NOT EXISTS）', bareCreate(sqlText), 0);
eq('应用脚本建表 2 张', scriptNames.length, 2);
eq('应用脚本表集合', JSON.stringify(scriptNames), JSON.stringify(['admin_capability_grants', 'admin_handover']));
eq('应用脚本无裸 CREATE TABLE', bareCreate(scriptText), 0);
check('应用脚本使用 GET_LOCK 串行化', /GET_LOCK/.test(scriptText));
check('应用脚本预检 admins.status', /admins\.status 缺失|hasStatus/.test(scriptText));
// 幂等：同一定义连续出现两次也不应产生冲突（DDL 语义），此处以“两次 CREATE 均带 IF NOT EXISTS”为静态度量
eq('迁移 SQL 中 admin_capability_grants 定义次数', (sqlText.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+admin_capability_grants/gi) || []).length, 1);
eq('迁移 SQL 中 admin_handover 定义次数', (sqlText.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+admin_handover/gi) || []).length, 1);

// ---------- mock 事务假连接（用于验证 ④ 回滚） ----------
const cloneTables = function() { return JSON.parse(JSON.stringify(tables)); };
const restoreTables = function(snap) {
  Object.keys(tables).forEach(function(k) { if (!(k in snap)) delete tables[k]; });
  Object.keys(snap).forEach(function(k) { tables[k] = snap[k]; });
};

const main = async function() {
  const dbReady = await db.ready();
  eq('数据库已回退 mock', db.isMock(), true);
  const redisReady = await redis.ready();
  eq('Redis 已回退 mock', redisReady.mode, 'mock', JSON.stringify(redisReady));

  resetTables();

  // ---------- 迁移应用脚本：真实 MySQL 尝试（本环境无凭据，如实记录） ----------
  let migrationNote = '';
  try {
    const out = execFileSync(process.execPath, [scriptPath], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
      env: Object.assign({}, process.env, { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '3306', MYSQL_USER: 'root', MYSQL_PASSWORD: '', MYSQL_DATABASE: 'jingyi_reservation' })
    });
    migrationNote = '真实 MySQL 执行成功: ' + out.trim().replace(/\s+/g, ' ');
  } catch (err) {
    const text = String((err && (err.stdout || err.stderr)) || (err && err.message) || err);
    if (/ER_ACCESS_DENIED_ERROR|Access denied/i.test(text)) {
      migrationNote = '真实 MySQL 未复验：凭据被拒（与本仓库无 .env 一致）';
    } else {
      migrationNote = '真实 MySQL 未复验：' + text.split('\n')[0];
    }
  }
  console.log('NOTE  迁移应用脚本真实执行情况：' + migrationNote);

  // ---------- ② / ③ 临时能力授权 ----------
  await expectThrow('grant adminId 非法', function() { return capabilityService.grant({ adminId: 0, capability: 'audit', validFrom: '2020-01-01 00:00:00', validTo: '2099-01-01 00:00:00' }); }, 'PERMISSION_DENIED');
  await expectThrow('grant capability 非法', function() { return capabilityService.grant({ adminId: 1, capability: 'root', validFrom: '2020-01-01 00:00:00', validTo: '2099-01-01 00:00:00' }); }, 'PERMISSION_DENIED');
  await expectThrow('grant validTo<=validFrom', function() { return capabilityService.grant({ adminId: 1, capability: 'audit', validFrom: '2099-01-01 00:00:00', validTo: '2098-01-01 00:00:00' }); }, 'PERMISSION_DENIED');

  const nowMid = new Date('2026-06-01T00:00:00');

  // 管理员 1：两条处于 nowMid 有效窗口内的授权
  const gAudit = await capabilityService.grant({ adminId: 1, capability: 'audit', grantedBy: 2, validFrom: '2020-01-01 00:00:00', validTo: '2099-01-01 00:00:00' });
  check('grant 返回数字 id', typeof gAudit.id === 'number' && gAudit.id > 0);
  eq('grant 返回 adminId', gAudit.adminId, 1);
  const gCheckin = await capabilityService.grant({ adminId: 1, capability: 'checkin', validFrom: '2026-01-01 00:00:00', validTo: '2026-12-31 00:00:00' });

  const activeNow = await capabilityService.listActive(1, nowMid);
  eq('listActive 命中 2 条有效授权', activeNow.length, 2);
  eq('listActiveCapabilities 返回有效能力(去重)', JSON.stringify((await capabilityService.listActiveCapabilities(1, nowMid)).slice().sort()), JSON.stringify(['audit', 'checkin']));

  // 管理员 7：仅“未来生效”的授权 -> 在 nowMid 应为空
  await capabilityService.grant({ adminId: 7, capability: 'data_export', validFrom: '2099-01-01 00:00:00', validTo: '2099-12-31 00:00:00' });
  check('listActive：未生效(未来有效)返回空', (await capabilityService.listActive(7, nowMid)).length === 0);
  check('listActive：进入生效窗口后返回 1 条', (await capabilityService.listActive(7, new Date('2099-06-01T00:00:00'))).length === 1);

  // 管理员 8：仅“已过期”的授权 -> 为空
  await capabilityService.grant({ adminId: 8, capability: 'rule_config', validFrom: '2000-01-01 00:00:00', validTo: '2000-12-31 00:00:00' });
  check('listActive：已过期返回空', (await capabilityService.listActive(8, nowMid)).length === 0);

  eq('hasCapability 命中', await capabilityService.hasCapability(1, 'audit', nowMid), true);
  eq('hasCapability 未命中(未生效)', await capabilityService.hasCapability(7, 'data_export', nowMid), false);
  eq('hasCapability 非法能力恒 false', await capabilityService.hasCapability(1, 'root', nowMid), false);

  // ③ revoke 后立即失效
  eq('revoke 返回 true', await capabilityService.revoke({ grantId: gCheckin.id }), true);
  eq('revoke 后立即失效（listActive 不含）',
    (await capabilityService.listActive(1, nowMid)).filter(function(r) { return r.id === gCheckin.id; }).length, 0);
  eq('revoke 后有效能力只剩 audit', JSON.stringify(await capabilityService.listActiveCapabilities(1, nowMid)), JSON.stringify(['audit']));
  eq('重复 revoke 返回 false', await capabilityService.revoke({ grantId: gCheckin.id }), false);
  eq('revoke 非法 id 抛错', await (async function() { try { await capabilityService.revoke({ grantId: 0 }); return 'no-throw'; } catch (e) { return e.businessCode; } })(), 'PERMISSION_DENIED');
  eq('listByAdmin 返回全部历史记录(含 revoked)', (await capabilityService.listByAdmin(1)).length, 2);

  // ---------- 岗位交接（一步式 reassign）：校验 ----------
  resetTables();
  await expectThrow('reassign 同一账号', function() { return handoverService.reassign({ operatorId: 2, fromAdminId: 4, toAdminId: 4 }); }, 'HANDOVER_CONFLICT');
  await expectThrow('reassign 离任方不存在', function() { return handoverService.reassign({ operatorId: 2, fromAdminId: 999, toAdminId: 1 }); }, 'HANDOVER_CONFLICT');
  await expectThrow('reassign 新任方不存在', function() { return handoverService.reassign({ operatorId: 2, fromAdminId: 4, toAdminId: 999 }); }, 'HANDOVER_CONFLICT');
  // 越权：非 super_admin 操作被拒（operatorId=3 为 counselor）
  await expectThrow('reassign 非超管被拒', function() { return handoverService.reassign({ operatorId: 3, fromAdminId: 4, toAdminId: 1 }); }, 'PERMISSION_DENIED');

  // ---------- ④ reassign 中途失败整体回滚（制造第二步失败：离任方角色非法） ----------
  tables.admins.push({ id: 903, username: 'qa_bad_from', real_name: '异常离任', role: 'weird_role', building_id: 1, scope_type: 'building', status: 'active' });
  tables.admins.push({ id: 904, username: 'qa_to', real_name: '新任职', role: 'admin', building_id: 1, scope_type: 'building', status: 'active' });
  eq('回滚用例：903 初始为 active', findAdmin(903).status, 'active');

  const realGetConnection = db.getConnection;
  let snapshot = null;
  const fakeConn = {
    isMock: false,
    beginTransaction: async function() { snapshot = cloneTables(); },
    execute: function(sql, params) { return mockDb.query(sql, params); },
    commit: async function() { snapshot = null; },
    rollback: async function() { if (snapshot) restoreTables(snapshot); },
    release: function() {}
  };
  db.getConnection = async function() { return fakeConn; };
  await expectThrow('reassign 第二步(角色非法)失败', function() {
    return handoverService.reassign({ operatorId: 2, fromAdminId: 903, toAdminId: 904 });
  }, 'HANDOVER_CONFLICT');
  db.getConnection = realGetConnection;

  eq('回滚后 903 仍为 active（第一步被回滚）', findAdmin(903).status, 'active');
  eq('回滚后 904 未被激活为离任方角色', findAdmin(904).role, 'admin');
  eq('回滚后未产生交接记录',
    (tables.admin_handover.filter(function(h) { return Number(h.from_user) === 903; })).length, 0);

  // ---------- ⑤ reassign 成功路径 + 旧 refresh 令牌被删 ----------
  resetTables();
  tables.admins.push({ id: 901, username: 'qa_from', real_name: '离任', role: 'admin', building_id: 2, scope_type: 'building', status: 'active' });
  tables.admins.push({ id: 902, username: 'qa_new', real_name: '新任', role: 'admin', building_id: 1, scope_type: 'building', status: 'active' });
  await redis.set('token:admin:901', 'REFRESH-901', 'EX', 100);
  await redis.set('token:901', 'STUDENT-TOKEN-901', 'EX', 100);

  const reassignResult = await handoverService.reassign({ operatorId: 2, fromAdminId: 901, toAdminId: 902, note: '换届交接' });
  eq('reassign 返回 sessionRevoked', reassignResult.sessionRevoked, true);
  eq('reassign 返回数字 handoverId', typeof reassignResult.handoverId === 'number' && reassignResult.handoverId > 0, true);
  eq('reassign 继承角色', reassignResult.inheritedRole, 'admin');
  eq('reassign 继承数据域 building', reassignResult.inheritedBuildingId, 2);
  eq('离任方 901 -> disabled', findAdmin(901).status, 'disabled');
  eq('新任方 902 -> active', findAdmin(902).status, 'active');
  eq('新任方 902 接续 role', findAdmin(902).role, 'admin');
  eq('新任方 902 接续 scope_type', findAdmin(902).scope_type, 'building');
  eq('新任方 902 接续 building_id', Number(findAdmin(902).building_id), 2);
  eq('交接记录 -> accepted', (tables.admin_handover.filter(function(h) { return Number(h.id) === Number(reassignResult.handoverId); })[0] || {}).status, 'accepted');
  eq('旧 refresh 令牌 token:admin:901 已删除', await redis.get('token:admin:901'), null);
  // 越界副作用防护：from_user 是“管理员 id”，token:<id> 是“学生端”刷新令牌键位，不得误删
  const studentKeyLeft = await redis.get('token:901');
  if (studentKeyLeft === 'STUDENT-TOKEN-901') pass++;
  else gap('交接删除了学生端刷新令牌键 token:901（与“学生端登录不受影响”的设计语义冲突）', 'token:901 期望保留，实际=' + JSON.stringify(studentKeyLeft));

  // 已禁用账号不可再次交接
  await expectThrow('已禁用账号不可重复交接', function() {
    return handoverService.reassign({ operatorId: 2, fromAdminId: 901, toAdminId: 902 });
  }, 'HANDOVER_CONFLICT');

  // ---------- ⑥ capabilities 读取失败降级为 []，不阻断接口 ----------
  resetTables();
  const originalListActiveCapabilities = capabilityService.listActiveCapabilities;
  capabilityService.listActiveCapabilities = async function() { throw new Error('模拟迁移未应用：表不存在'); };
  let nextCalled = false;
  let nextErr = null;
  const req = { user: { id: 1, role: 'admin' } };
  const res = { status: function() { return this; }, json: function() { return this; } };
  await new Promise(function(resolve) {
    adminScopeMiddleware.loadAdminScope(req, res, function(err) { nextCalled = true; nextErr = err || null; resolve(); });
  });
  capabilityService.listActiveCapabilities = originalListActiveCapabilities;
  check('capabilities 读取失败仍调用 next()', nextCalled);
  check('capabilities 读取失败未抛错', nextErr === null, nextErr && nextErr.message);
  check('capabilities 降级为空数组', Array.isArray(req.adminScope && req.adminScope.capabilities) && req.adminScope.capabilities.length === 0);
  eq('降级时既有字段仍装载(adminId)', req.adminScope && req.adminScope.adminId, 1);

  // 正常读取 capabilities
  await capabilityService.grant({ adminId: 1, capability: 'audit', grantedBy: 2, validFrom: '2020-01-01 00:00:00', validTo: '2099-01-01 00:00:00' });
  const req2 = { user: { id: 1, role: 'admin' } };
  await new Promise(function(resolve) { adminScopeMiddleware.loadAdminScope(req2, res, function() { resolve(); }); });
  eq('正常读取 capabilities', JSON.stringify(req2.adminScope.capabilities), JSON.stringify(['audit']));

  console.log('qa-batch01-admin-delegation-check: PASS=' + pass + ' FAIL=' + fail);
  if (gaps.length) { console.log('--- 与设计语义存疑点 / Gap ---'); gaps.forEach(function(g) { console.log('  • ' + g); }); }
  if (fail > 0) process.exit(1);
};

main().catch(function(err) {
  console.error('SMOKE ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
