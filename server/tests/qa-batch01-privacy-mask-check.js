/**
 * QA 独立验证 · T02 分级隐私脱敏（R-14）
 *
 * 由 QA（严过关）独立编写。重点覆盖工程师未测 / 自述的“兼容陷阱”：
 *   A. 分级矩阵：本人明文 / 他人掩码 / 管理员按 role+scope_type 楼栋域 / 越权降级掩码；
 *   B. 两个 map 调用点（reservationController / scopedQueryController）不再把下标当 viewer；
 *   C. 非对象 viewer（数字下标 / 字符串 / undefined）防御；
 *   D. 不传 viewer 时输出与“改动前”逐字段完全一致（对照 git 历史版本的实现）；
 *   E. 控制器集成：学生看自己明文、超管全局明文并落审计、楼栋越权掩码。
 *
 * 强制 mock 模式（MySQL 端口指向必然连不上的 1），不依赖本机数据库。
 * 运行：node server/tests/qa-batch01-privacy-mask-check.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ALLOW_MOCK_DB = 'true';
process.env.MYSQL_PORT = '1';
process.env.ALLOW_MOCK_REDIS = 'true';

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const mask = require(path.join(SRC, 'utils', 'maskPresenter'));
const presenter = require(path.join(SRC, 'utils', 'reservationPresenter'));
const privacyAuditService = require(path.join(SRC, 'services', 'privacyAuditService'));
const mockDb = require(path.join(SRC, 'config', 'mock-db'));
const db = require(path.join(SRC, 'config', 'database'));

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
const gap = function(name, actual, expected) {
  fail++;
  gaps.push(name + ' | 期望(据任务契约)=' + JSON.stringify(expected) + ' 实际=' + JSON.stringify(actual));
  console.log('GAP   ' + name + ' | 期望=' + JSON.stringify(expected) + ' 实际=' + JSON.stringify(actual));
};

// 样本行（借自 mock 种子：用户 2 李四，学号 2024001002，B 座 building_id=1）
const rowB = {
  id: 2, user_id: 2, building_id: 1,
  student_id: '2024001002', student_no: '2024001002',
  real_name: '李四', nickname: '李四', user_name: '李四',
  phone: '13900000002'
};
const rowC = { id: 7, user_id: 2, building_id: 2, student_id: '2024001002', real_name: '李四' };

// ---------- 1) 脱敏原语（含边界） ----------
eq('maskStudentId 常规', mask.maskStudentId('2021123456'), '2021****56');
eq('maskStudentId 长度=6 边界(仅保留首字)', mask.maskStudentId('123456'), '1*****');
eq('maskStudentId 长度=5', mask.maskStudentId('12345'), '1****');
eq('maskStudentId 单字符(仅保留首字)', mask.maskStudentId('1'), '1');
eq('maskStudentId 空', mask.maskStudentId(''), '');
eq('maskPhone 常规', mask.maskPhone('13800008000'), '138****8000');
eq('maskPhone 长度=4 边界', mask.maskPhone('1234'), '****');
eq('maskPhone 长度=3', mask.maskPhone('123'), '***');
eq('maskPhone 空', mask.maskPhone(''), '');
eq('maskName 两字', mask.maskName('张三'), '张*');
eq('maskName 三字', mask.maskName('欧阳娜'), '欧**');
eq('maskName 单字', mask.maskName('张'), '张');
eq('maskName 空', mask.maskName(''), '');
eq('maskName 前后空格被裁剪', mask.maskName('  张三  '), '张*');

// ---------- 2) resolveVisibility 分级矩阵 ----------
const V = mask.resolveVisibility;
const student = { id: 2, role: 'student' };
const peer = { id: 1, role: 'student' };
eq('学生看自己 -> plaintext/self', JSON.stringify(V(rowB, student)), JSON.stringify({ plaintext: true, scope: 'self', masked: false }));
eq('学生看他人 -> masked/peer', JSON.stringify(V(rowB, peer)), JSON.stringify({ plaintext: false, scope: 'peer', masked: true }));
eq('无 viewer -> plaintext/anonymous', JSON.stringify(V(rowB, null)), JSON.stringify({ plaintext: true, scope: 'anonymous', masked: false }));
eq('超管全局 -> plaintext', V(rowB, { id: 99, role: 'super_admin', scopeType: 'global' }).plaintext, true);
eq('superadmin 别名归一 -> plaintext', V(rowB, { id: 99, role: 'superadmin', scopeType: 'global' }).plaintext, true);
eq('辅导员(global) -> plaintext', V(rowB, { id: 99, role: 'counselor', scopeType: 'global' }).plaintext, true);
eq('楼栋管理员命中域 -> plaintext',
  V(rowB, { id: 98, role: 'admin', adminScope: { isGlobal: false, buildingId: 1 } }).scope, 'admin_building');
eq('楼栋管理员越权 -> masked（不放行）',
  JSON.stringify(V(rowC, { id: 98, role: 'admin', adminScope: { isGlobal: false, buildingId: 1 } })),
  JSON.stringify({ plaintext: false, scope: 'admin_out_of_scope', masked: true }));
eq('未知角色 -> masked（fail-closed）', V(rowB, { id: 5, role: 'teacher' }).masked, true);

// ---------- 3) applyViewerMask 逐字段 ----------
const selfMasked = mask.applyViewerMask(rowB, student);
eq('本人：学号明文', selfMasked.student_id, '2024001002');
eq('本人：手机明文', selfMasked.phone, '13900000002');
eq('本人：姓名明文', selfMasked.real_name, '李四');
const peerMasked = mask.applyViewerMask(rowB, peer);
eq('他人：学号掩码', peerMasked.student_id, '2024****02');
eq('他人：手机掩码', peerMasked.phone, '139****0002');
eq('他人：real_name 掩码', peerMasked.real_name, '李*');
eq('他人：nickname 掩码', peerMasked.nickname, '李*');
eq('他人：user_name 掩码', peerMasked.user_name, '李*');
eq('他人：user_id 保留（非敏感）', peerMasked.user_id, 2);
check('applyViewerMask 不就地修改原行', rowB.student_id === '2024001002');
const outOfScope = mask.applyViewerMask(rowC, { id: 98, role: 'admin', adminScope: { isGlobal: false, buildingId: 1 } });
eq('越权楼栋管理员在控制器层看到的学号被掩码', outOfScope.student_id, '2024****02');

// maskRows：需审计标志与明文计数
const batch = mask.maskRows([rowB, rowC], { id: 99, role: 'super_admin', scopeType: 'global' });
eq('maskRows 全局管理员 requiresAudit', batch.requiresAudit, true);
eq('maskRows 全局管理员 plaintextCount', batch.plaintextCount, 2);
const batchSelf = mask.maskRows([rowB], student);
eq('maskRows 学生看自己不审计', batchSelf.requiresAudit, false);
const batchNoViewer = mask.maskRows([rowB, rowC], null);
check('maskRows 无 viewer 原样返回', batchNoViewer.rows.length === 2 && batchNoViewer.requiresAudit === false);

// ---------- 4) 非对象 viewer 防御（⚠ 任务契约点） ----------
check('viewer=undefined 原样(同引用)', mask.applyViewerMask(rowB, undefined) === rowB);
check('viewer=null 原样(同引用)', mask.applyViewerMask(rowB, null) === rowB);
check('viewer=0 原样(同引用)', mask.applyViewerMask(rowB, 0) === rowB);
check('viewer=false 原样(同引用)', mask.applyViewerMask(rowB, false) === rowB);
// 以下按“任务契约：非对象 viewer 视为无 viewer”判定；若不成立记为 GAP
if (mask.applyViewerMask(rowB, 1) === rowB) pass++; else gap('viewer=1（数组下标 1）应按无 viewer 处理', mask.applyViewerMask(rowB, 1).student_id, '2024001002');
if (mask.applyViewerMask(rowB, 2) === rowB) pass++; else gap('viewer=2（数组下标 2）应按无 viewer 处理', mask.applyViewerMask(rowB, 2).student_id, '2024001002');
if (mask.applyViewerMask(rowB, '1') === rowB) pass++; else gap('viewer="1"（字符串）应按无 viewer 处理', mask.applyViewerMask(rowB, '1').student_id, '2024001002');
if (presenter.formatReservationRow(rowB, 1).studentId === '2024001002') pass++;
else gap('formatReservationRow(row, 1) 第二参为数字下标时应不脱敏', presenter.formatReservationRow(rowB, 1).studentId, '2024001002');

// ---------- 5) map 回调陷阱：F2 修复后“非对象 viewer”已被兜底 ----------
const rows3 = [rowB, rowC, Object.assign({}, rowB, { id: 3 })];
const naiveMap = rows3.map(presenter.formatReservationRow); // 第二参=数组下标（历史上会误脱敏）
eq('裸 map：下标 0 行不脱敏', naiveMap[0].studentId, '2024001002');
eq('裸 map：下标 1 行不脱敏（非对象 viewer 已被视为无 viewer）', naiveMap[1].studentId, '2024001002');
eq('裸 map：下标 2 行不脱敏', naiveMap[2].studentId, '2024001002');
// 正确用法：显式传 viewer=undefined
const safeMap = rows3.map(function(r) { return presenter.formatReservationRow(r); });
check('显式包装后全部不脱敏', safeMap.every(function(r) { return r.studentId === '2024001002'; }));
// 反向确认：传入“真实他人”对象 viewer 仍必须脱敏（证明掩码未被整体禁用）
const realPeerMap = rows3.map(function(r) { return presenter.formatReservationRow(r, { id: 999, role: 'student' }); });
check('传入真实他人 viewer 仍掩码', realPeerMap.every(function(r) { return r.studentId === '2024****02'; }));

// ---------- 6) 不传 viewer 时与“改动前”逐字段一致（对照历史实现） ----------
const valueOf = function(row, keys) {
  for (const key of keys) { if (row && row[key] !== undefined && row[key] !== null) return row[key]; }
  return '';
};
const oldFormatReservationRow = function(row) { // 取自 5dde147:server/src/utils/reservationPresenter.js
  const start = valueOf(row, ['start_time', 'startTime']);
  const end = valueOf(row, ['end_time', 'endTime']);
  return Object.assign({}, row, {
    id: valueOf(row, ['id', 'r.id']),
    userName: valueOf(row, ['userName', 'user_name', 'real_name', 'nickname']),
    studentId: valueOf(row, ['studentId', 'student_id', 'student_no']),
    roomName: valueOf(row, ['roomName', 'room_name', 'name', 'rm.name']),
    date: valueOf(row, ['date', 'r.date']),
    timeSlot: start && end ? start + '-' + end : valueOf(row, ['timeSlot']),
    status: valueOf(row, ['status', 'r.status']),
    purpose: valueOf(row, ['purpose', 'r.purpose']),
    createdAt: valueOf(row, ['createdAt', 'created_at', 'r.created_at']),
    auditedAt: valueOf(row, ['auditedAt', 'audited_at', 'r.audited_at']),
    rejectReason: valueOf(row, ['rejectReason', 'reject_reason', 'r.reject_reason']),
    counselorName: valueOf(row, ['counselorName', 'counselor_name'])
  });
};
const samples = [
  rowB,
  rowC,
  { id: 1, start_time: '09:00', end_time: '12:00', student_id: '2024001001', real_name: '张三', status: 'approved', created_at: '2026-09-18 10:00:00' },
  { id: 9, startTime: '08:00', endTime: '10:00', studentId: 'X1', userName: 'U', roomName: 'R', date: '2026-09-17', timeSlot: '08:00-10:00' },
  { r: { id: 11, date: '2026-09-18', status: 'pending', purpose: 'p', created_at: 'c', audited_at: null, reject_reason: '' } },
  {},
  { id: 0, room_id: 1 }
];
samples.forEach(function(s, i) {
  const oldOut = JSON.stringify(oldFormatReservationRow(s));
  const newOut = JSON.stringify(presenter.formatReservationRow(s));
  eq('样本#' + i + ' 不传 viewer 与历史实现逐字段一致', newOut, oldOut);
});

// ---------- 7) viewerFromRequest ----------
eq('viewerFromRequest 无 req -> null', mask.viewerFromRequest(null), null);
eq('viewerFromRequest 无 user -> null', mask.viewerFromRequest({}), null);
const vfAdmin = mask.viewerFromRequest({ user: { id: 5, role: 'admin' }, adminScope: { isGlobal: true, buildingId: null } });
eq('viewerFromRequest 透传 adminScope', JSON.stringify(vfAdmin.adminScope), JSON.stringify({ isGlobal: true, buildingId: null }));
eq('viewerFromRequest 学生角色', mask.viewerFromRequest({ user: { id: 1, role: 'student' } }).role, 'student');

// ---------- 8) 控制器集成（真实调用链） ----------
const reservationController = require(path.join(SRC, 'controllers', 'reservationController'));

const runList = async function(req) {
  const captured = { status: 0, body: null };
  const res = {
    status: function(s) { captured.status = s; return this; },
    json: function(b) { captured.body = b; return this; }
  };
  await reservationController.list(req, res);
  return captured;
};

const main = async function() {
  await db.ready();
  eq('数据库已回退 mock', db.isMock(), true);

  // 8.1 学生看自己 -> 明文
  const studentReq = { user: { id: 1, role: 'student' }, query: {}, originalUrl: '/api/v1/reservations' };
  const studentRes = await runList(studentReq);
  eq('学生列表 HTTP 200', studentRes.status, 200);
  const sList = studentRes.body.data.list;
  check('学生只看到自己的记录', sList.length > 0 && sList.every(function(r) { return String(r.studentId) === '2024001001'; }));
  check('学生看自己学号明文', sList.every(function(r) { return r.studentId === '2024001001'; }));

  // 8.2 超管全局 -> 明文且落审计
  const auditBefore = (mockDb.__tables.operation_logs || []).length;
  const superReq = {
    user: { id: 100, role: 'super_admin' },
    adminScope: { adminId: 100, role: 'super_admin', isGlobal: true, buildingId: null },
    query: {}, originalUrl: '/api/v1/reservations'
  };
  const superRes = await runList(superReq);
  eq('超管列表 HTTP 200', superRes.status, 200);
  const aList = superRes.body.data.list;
  const hasUser2 = aList.some(function(r) { return String(r.studentId) === '2024001002'; });
  check('超管可见他人明文（李四）', hasUser2);
  const auditAfter = (mockDb.__tables.operation_logs || []).length;
  check('超管查看明文已落审计', auditAfter > auditBefore, 'before=' + auditBefore + ' after=' + auditAfter);

  // 8.3 楼栋管理员越权（presenter 层，模拟 B 座管理员看 C 座行）
  const scoped = presenter.getMockReservationRows({
    adminScope: { isGlobal: true },
    viewer: { id: 98, role: 'admin', adminScope: { isGlobal: false, buildingId: 1, role: 'admin' } }
  });
  const inB = scoped.filter(function(r) { return Number(r.building_id) === 1; });
  const outB = scoped.filter(function(r) { return Number(r.building_id) !== 1; });
  check('B 座管理员对 B 座行可见明文（学号无掩码）',
    inB.length > 0 && inB.every(function(r) { return /^2024001\d{3}$/.test(String(r.studentId)); }), 'sample=' + JSON.stringify(inB.slice(0, 2).map(function(r) { return r.studentId; })));
  check('B 座管理员对非 B 座行降级掩码（学号含 *）',
    outB.length > 0 && outB.every(function(r) { return /\*/.test(String(r.studentId)); }), 'sample=' + JSON.stringify(outB.slice(0, 3).map(function(r) { return r.studentId; })));

  // 8.4 privacyAuditService.maskRowsForRequest 端到端
  const maskedOut = await privacyAuditService.maskRowsForRequest(
    { user: { id: 1, role: 'student' } }, [rowB], { targetTable: 'reservations' });
  eq('maskRowsForRequest 学生看他人 -> 掩码', maskedOut[0].student_id, '2024****02');

  console.log('qa-batch01-privacy-mask-check: PASS=' + pass + ' FAIL=' + fail);
  if (gaps.length) {
    console.log('--- 与任务契约不符的 Gap ---');
    gaps.forEach(function(g) { console.log('  • ' + g); });
  }
  if (fail > 0) process.exit(1);
};

main().catch(function(err) {
  console.error('SMOKE ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
