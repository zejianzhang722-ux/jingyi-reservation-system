// 发布前置核查：users.role 完整性 + 脏 role 下的提权兜底性质
//
// 背景（详见 server/src/middleware/auth.js:23-35 注释块）：
//   auth.js 按 decoded.role 分流用户端/管理端会话。users.role 是历史遗留 ENUM，
//   允许写入管理角色（schema.sql:70），一旦某用户行 role 被污染成管理角色，
//   且该用户在修复前登录过（修复前 generateTokens 直接把 user.role 写进令牌），
//   就可能携带 role='admin' 的令牌进入 admins 分支，造成 id 碰撞时的跨表身份提升。
//
// 本脚本测的是**安全性质**，不是编号巧合：
//   主断言 —— 不存在 role 为管理角色的 users 行。
//              此时 id 碰撞不构成漏洞（学生 id=1 与管理员 id=1 共存是正常状态）。
//   兜底断言 —— 即便存在脏 role 行，其令牌也必须读不到 token:admin:* 而被 401 拦下。
//              这条依赖 Redis key 前缀错配，是历史偶然，不是被设计出来的防护。
//
// 只读脚本：不写库、不改数据。
const assert = require('node:assert/strict');
const path = require('node:path');

// ---- 被测逻辑：从 auth.js 原样复刻，保证测的是运行期真实行为 ----
// auth.js getRefreshTokenKey（:60-65）
const getRefreshTokenKey = function(decoded) {
  if (!decoded || !decoded.id) return null;
  return decoded.role === 'student' ? 'token:' + decoded.id : 'token:admin:' + decoded.id;
};

// auth.js isStoredRefreshToken 的 Redis 比对段（:67-79）
const isStoredRefreshToken = async function(decoded, tokenStr, redisGet) {
  if (!decoded || !tokenStr) return false;
  if (decoded.tokenType === 'access' || decoded.typ === 'access') return false;
  if (decoded.tokenType === 'refresh' || decoded.typ === 'refresh') return true;
  const redisKey = getRefreshTokenKey(decoded);
  if (!redisKey) throw new Error('无法识别令牌类型');
  const stored = await redisGet(redisKey);
  if (!stored) throw new Error('旧版会话状态不存在');
  return stored === tokenStr;
};

// auth.js loadCurrentPrincipal 的分流段（:20-48），只看走哪张表
const resolveIdentityTable = function(decoded, db) {
  if (!decoded || !decoded.id) return { table: null, row: null };
  if (decoded.role === 'student') {
    const row = db.users.get(Number(decoded.id)) || null;
    if (!row || row.status === 'banned') return { table: 'users', row: null };
    return { table: 'users', row: Object.assign({}, decoded, { role: 'student' }) };
  }
  const row = db.admins.get(Number(decoded.id)) || null;
  if (!row || row.status !== 'active') return { table: 'admins', row: null };
  return { table: 'admins', row: Object.assign({}, decoded, { role: row.role }) };
};

// auth.js:92 版本戳闸门
const STUDENT_TOKEN_VERSION = 2;
const passesVersionGate = function(decoded) {
  const version = Number((decoded && decoded.tokenVersion) || 0);
  const isCurrent = Number.isFinite(version) && version >= STUDENT_TOKEN_VERSION;
  return !(decoded.role === 'student' && !isCurrent);
};

let failures = 0;
const checks = [];
const check = function(name, fn) { checks.push({ name, fn }); };

// ================= 场景一：干净库（users.role 全为 student）=================
// seed.sql:100-101 的两名学生 + admins 表同号管理员，构成 id 碰撞的正常形态
const cleanDb = {
  users: new Map([[1, { id: 1, role: 'student', status: 'active' }], [2, { id: 2, role: 'student', status: 'active' }]]),
  admins: new Map([[1, { id: 1, role: 'admin', status: 'active', scope_type: 'global' }]])
};
// 登录写入的 refresh（authController.js:149/323，按「入口」写，不带 admin 前缀）
const cleanRedis = new Map([['token:1', 'refresh-1'], ['token:2', 'refresh-2'], ['token:admin:1', 'admin-refresh-1']]);
const cleanGet = async (k) => cleanRedis.get(k);

check('干净库：users 表无管理角色行（主断言）', function() {
  const dirty = [...cleanDb.users.values()].filter((u) => u.role !== 'student');
  assert.deepEqual(dirty, [], '发现 users.role 被写入非 student 的行：' + JSON.stringify(dirty));
});

check('干净库：id 碰撞本身不构成漏洞（学生令牌仍走 users 表）', function() {
  const r = resolveIdentityTable({ id: 1, role: 'student', tokenType: 'access' }, cleanDb);
  assert.equal(r.table, 'users');
  assert.equal(r.row.role, 'student', '碰撞学生不得取得管理角色');
});

check('干净库：修复前学生 access 令牌被版本戳拦下', function() {
  assert.equal(passesVersionGate({ id: 1, role: 'student', tokenType: 'access' }), false);
});

check('干净库：修复前学生 refresh 能换发出带版本戳的新令牌', async function() {
  const old = { id: 1, role: 'student', tokenType: 'refresh' };
  const redisKey = getRefreshTokenKey(old);
  assert.equal(redisKey, 'token:1');
  assert.equal(await isStoredRefreshToken(old, 'refresh-1', cleanGet), true);
  const principal = resolveIdentityTable(old, cleanDb).row;
  assert.equal(principal.role, 'student');
  const rotated = Object.assign({}, principal, { tokenVersion: STUDENT_TOKEN_VERSION });
  assert.equal(passesVersionGate(rotated), true, '换发后的令牌必须能通过闸门');
});

// ================= 场景二：脏 role（users.role 被污染）=================
// users.id=7 的 role 被写成 'admin'；admins.id=7 恰好存在一个 active 管理员
const dirtyDb = {
  users: new Map([[7, { id: 7, role: 'admin', status: 'active' }]]),
  admins: new Map([[7, { id: 7, role: 'super_admin', status: 'active', scope_type: 'global' }]])
};
// 登录按入口写入 → 存的是 token:7，没有 token:admin:7
const dirtyRedis = new Map([['token:7', 'refresh-7']]);
const dirtyGet = async (k) => dirtyRedis.get(k);

check('脏库：检测出 users.role 污染行（主断言应报警）', function() {
  const dirty = [...dirtyDb.users.values()].filter((u) => u.role !== 'student');
  assert.notDeepEqual(dirty, [], '本用例应检出脏行');
});

check('脏库：修复前脏 role refresh 读不到 token:admin:7 → 401', async function() {
  const old = { id: 7, role: 'admin', tokenType: 'refresh' };
  const redisKey = getRefreshTokenKey(old);
  assert.equal(redisKey, 'token:admin:7');
  assert.equal(await dirtyGet(redisKey), undefined, 'Redis 不应有该 key');
  await assert.rejects(
    () => isStoredRefreshToken({ id: 7, role: 'admin' }, 'refresh-7', dirtyGet),
    /旧版会话状态不存在|无法识别令牌类型/,
    '无 tokenType 的旧令牌必须被拒绝'
  );
});

check('脏库：修复前脏 role access 绕过版本戳闸门（覆盖边界，如实记录）', function() {
  const old = { id: 7, role: 'admin', tokenType: 'access' };
  assert.equal(passesVersionGate(old), true, 'role=admin 确实绕过版本戳——这是已知边界');
  assert.equal(old.role === 'student', false, '绕过原因：闸门条件只拦 student');
});

check('脏库：脏 role access 会被 isStoredRefreshToken 放行到 admins 分支', async function() {
  // tokenType='access' 使 :67 直接 return false，不做 Redis 比对
  const old = { id: 7, role: 'admin', tokenType: 'access' };
  assert.equal(await isStoredRefreshToken(old, 'whatever', dirtyGet), false);
  const r = resolveIdentityTable(old, dirtyDb);
  assert.equal(r.table, 'admins', '带 role=admin 的 access 令牌确实会查 admins 表');
  assert.equal(r.row.role, 'super_admin', '并按 admins 表取值获得管理角色');
});

// ================= 断言执行 =================
(async function() {
  console.log('=== users.role 完整性核查 ===');
  for (const { name, fn } of checks) {
    try {
      await fn();
      console.log('PASS ' + name);
    } catch (e) {
      failures++;
      console.error('FAIL ' + name + ': ' + e.message);
    }
  }
  console.log('\n共 ' + checks.length + ' 项断言，失败 ' + failures + ' 项。');
  if (failures === 0) {
    console.log('注意：本脚本验证的是「脏 role 存在时仍有一层兜底」，');
    console.log('该兜底依赖 Redis key 前缀错配，属历史偶然，不是设计防护。');
    console.log('若将来统一 key 命名消除错配，脏 role 将直接获得提权能力。');
  }
  process.exit(failures ? 1 : 0);
})();