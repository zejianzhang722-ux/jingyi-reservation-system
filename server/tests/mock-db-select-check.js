/**
 * mock-db SELECT 解析回归检查。
 *
 * 目的：锁定并防止「列名含 min/max/avg 子串被误判为聚合」这一缺陷再次出现。
 * 背景：`config/mock-db.js` 原用 /COUNT|SUM|AVG|MIN|MAX/i（无词边界）判定聚合，
 *       列名 `admin_id` 含子串 `min`，导致该 SELECT 被误判为聚合、返回 [{__count__:n}] 丢失字段。
 *
 * 该检查**强制走 mock 模式**（把 MySQL 端口指向必然连不上的 1），不依赖本机数据库。
 * 运行：node server/tests/mock-db-select-check.js（失败以非 0 退出）
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ALLOW_MOCK_DB = 'true';
process.env.MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
process.env.MYSQL_PORT = '1'; // 强制连接失败，触发 mock 回退

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const db = require(path.join(SRC, 'config', 'database'));

let pass = 0;
let fail = 0;
const check = function(name, cond) {
  if (cond) pass++;
  else { fail++; console.log('FAIL ' + name); }
};

const main = async function() {
  await db.ready();
  check('数据库已回退 mock 模式', db.isMock() === true);

  await db.query(
    'INSERT INTO admin_capability_grants (admin_id, capability, granted_by, valid_from, valid_to, status) VALUES (?, ?, ?, ?, ?, ?)',
    [7, 'audit', 1, '2020-01-01 00:00:00', '2099-01-01 00:00:00', 'active']
  );

  // 关键回归点：SELECT 列表含 admin_id（含子串 min），必须返回真实字段而非 [{__count__}]
  const selectResult = await db.query(
    "SELECT id, admin_id, capability, valid_from, valid_to, status FROM admin_capability_grants WHERE admin_id = ? AND status = 'active'",
    [7]
  );
  const rows = selectResult[0];
  check('按列查询返回 1 行', Array.isArray(rows) && rows.length === 1);
  check('未被误判为聚合（无 __count__）', rows.length === 1 && rows[0].__count__ === undefined);
  check('admin_id 字段存在且值正确', rows.length === 1 && String(rows[0].admin_id) === '7');
  check('capability 字段正确', rows.length === 1 && rows[0].capability === 'audit');
  check('仅返回所选列（created_at 不应出现）', rows.length === 1 && rows[0].created_at === undefined);

  // ORDER BY 场景同样是按列查询
  const ordered = await db.query('SELECT id, admin_id, status FROM admin_capability_grants ORDER BY id DESC', []);
  check('ORDER BY 场景返回真实列', ordered[0].length >= 1 && ordered[0][0].__count__ === undefined);

  // 真聚合必须继续工作：无 GROUP BY 的 COUNT(*)
  const counted = await db.query('SELECT COUNT(*) AS total FROM admin_capability_grants WHERE admin_id = ?', [7]);
  check('COUNT(*) AS total 仍聚合', counted[0].length === 1 && Number(counted[0][0].total) === 1);

  // 真聚合必须继续工作：GROUP BY
  const grouped = await db.query('SELECT capability, COUNT(*) AS c FROM admin_capability_grants GROUP BY capability', []);
  check('GROUP BY 仍聚合', grouped[0].length === 1 && grouped[0][0].capability === 'audit' && Number(grouped[0][0].c) === 1);

  console.log('mock-db-select-check: PASS=' + pass + ' FAIL=' + fail);
  if (fail > 0) process.exit(1);
};

main().catch(function(err) {
  console.error('SMOKE ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
