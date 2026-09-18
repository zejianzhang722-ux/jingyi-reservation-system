/**
 * QA 独立验证 · mock-db 聚合判定回归（修复 /COUNT|SUM|AVG|MIN|MAX/i 无词边界误判）
 *
 * 覆盖工程师 mock-db-select-check.js 之外的列名子串：admin_id / max_score / avg_score / account_no，
 * 并确认真正的 COUNT(*) / SUM() / MIN() 聚合仍被识别（防“修过头”）。
 *
 * 运行：node server/tests/qa-batch01-mock-db-aggregate-check.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ALLOW_MOCK_DB = 'true';
process.env.MYSQL_PORT = '1';
process.env.MYSQL_HOST = '127.0.0.1';

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const db = require(path.join(SRC, 'config', 'database'));

let pass = 0;
let fail = 0;
const check = function(name, cond, detail) {
  if (cond) pass++;
  else { fail++; console.log('FAIL  ' + name + (detail ? ('  :: ' + detail) : '')); }
};

const main = async function() {
  await db.ready();
  check('数据库已回退 mock', db.isMock() === true);

  // 构造一张列名充分“危险”的表：含 min/max/avg/count 子串
  await db.query('INSERT INTO qa_agg (admin_id, max_score, avg_score, account_no, score) VALUES (?, ?, ?, ?, ?)', [7, 10, 20, 'A001', 5]);
  await db.query('INSERT INTO qa_agg (admin_id, max_score, avg_score, account_no, score) VALUES (?, ?, ?, ?, ?)', [7, 30, 40, 'A002', 15]);
  await db.query('INSERT INTO qa_agg (admin_id, max_score, avg_score, account_no, score) VALUES (?, ?, ?, ?, ?)', [8, 50, 60, 'A003', 25]);

  // 1) 列名含 `min`（admin_id）—— 修复前会被判为聚合，返回 [{__count__}] 丢字段
  const r1 = await db.query('SELECT id, admin_id, max_score, avg_score, account_no, score FROM qa_agg WHERE admin_id = ?', [7]);
  const rows1 = r1[0];
  check('含 min 子串列：返回 2 行真实记录', rows1.length === 2, 'len=' + rows1.length);
  check('含 min 子串列：无 __count__ 误判', rows1.every(function(r) { return r.__count__ === undefined; }));
  check('含 min 子串列：admin_id 字段完整', rows1.every(function(r) { return String(r.admin_id) === '7'; }));
  check('含 min 子串列：account_no(含 count 子串) 字段完整', rows1.every(function(r) { return typeof r.account_no === 'string' && r.account_no.length > 0; }));
  check('含 min 子串列：max_score 字段完整', rows1.every(function(r) { return r.max_score !== undefined; }));
  check('含 min 子串列：avg_score 字段完整', rows1.every(function(r) { return r.avg_score !== undefined; }));

  // 2) 仅选 max_score / avg_score 也不应被判为聚合
  const r2 = await db.query('SELECT id, max_score, avg_score FROM qa_agg', []);
  check('仅含 max/avg 子串列：返回 3 行', r2[0].length === 3, 'len=' + r2[0].length);
  check('仅含 max/avg 子串列：无 __count__', r2[0].every(function(r) { return r.__count__ === undefined; }));

  // 3) 真聚合必须仍被识别：COUNT(*)（无 GROUP BY）
  const r3 = await db.query('SELECT COUNT(*) AS total FROM qa_agg', []);
  check('COUNT(*) 仍聚合为 1 行', r3[0].length === 1);
  check('COUNT(*) 值正确=3', Number(r3[0][0].total) === 3, 'total=' + r3[0][0].total);

  // 4) 真聚合必须仍被识别：SUM()
  const r4 = await db.query('SELECT SUM(score) AS s FROM qa_agg', []);
  check('SUM() 仍聚合为 1 行', r4[0].length === 1);
  check('SUM(score) 值正确=45', Number(r4[0][0].s) === 45, 's=' + r4[0][0].s);

  // 5) MIN/MAX/AVG 仍被识别为聚合（mock 不计值，但必须走聚合分支，含 __count__）
  const r5 = await db.query('SELECT MIN(score) AS m FROM qa_agg', []);
  check('MIN() 被识别为聚合（进入聚合分支）', r5[0].length === 1 && r5[0][0].__count__ === 3);
  const r6 = await db.query('SELECT MAX(score) AS m FROM qa_agg', []);
  check('MAX() 被识别为聚合（进入聚合分支）', r6[0].length === 1 && r6[0][0].__count__ === 3);

  // 6) GROUP BY 仍聚合
  const r7 = await db.query('SELECT admin_id, COUNT(*) AS c FROM qa_agg GROUP BY admin_id', []);
  check('GROUP BY 聚合：返回 2 组', r7[0].length === 2, 'len=' + r7[0].length);
  const g7 = r7[0].filter(function(r) { return String(r.admin_id) === '7'; })[0];
  const g8 = r7[0].filter(function(r) { return String(r.admin_id) === '8'; })[0];
  check('GROUP BY 计数正确 (7->2, 8->1)', g7 && Number(g7.c) === 2 && g8 && Number(g8.c) === 1);

  // 7) 与业务真实查询形态一致：admin_capability_grants 的显式列查询
  await db.query('INSERT INTO admin_capability_grants (admin_id, capability, granted_by, valid_from, valid_to, status) VALUES (?, ?, ?, ?, ?, ?)',
    [1, 'audit', 2, '2020-01-01 00:00:00', '2099-01-01 00:00:00', 'active']);
  const r8 = await db.query("SELECT id, admin_id, capability, valid_from, valid_to, status FROM admin_capability_grants WHERE admin_id = ? AND status = 'active'", [1]);
  check('授权表显式列查询：1 行且无 __count__', r8[0].length === 1 && r8[0][0].__count__ === undefined);
  check('授权表显式列查询：admin_id 完整', r8[0].length === 1 && String(r8[0][0].admin_id) === '1');

  console.log('qa-batch01-mock-db-aggregate-check: PASS=' + pass + ' FAIL=' + fail);
  if (fail > 0) process.exit(1);
};

main().catch(function(err) {
  console.error('SMOKE ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
