/**
 * 隐私脱敏 + 业务错误码回归检查（R-14 / R-10）。
 *
 * 纯逻辑检查，不依赖数据库 / Redis，可安全纳入 CI。
 * 运行：node server/tests/privacy-mask-check.js
 * 失败时以非 0 退出码结束。
 */

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const mask = require(path.join(SRC, 'utils', 'maskPresenter'));
const errorCodes = require(path.join(SRC, 'config', 'errorCodes'));
const response = require(path.join(SRC, 'utils', 'response'));

let pass = 0;
let fail = 0;
const assertEqual = function(name, actual, expected) {
  if (actual === expected) { pass++; }
  else { fail++; console.log('FAIL ' + name + ' => got ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected)); }
};

// 1) 脱敏原语
assertEqual('maskStudentId', mask.maskStudentId('2021123456'), '2021****56');
assertEqual('maskStudentId short', mask.maskStudentId('12345'), '1****');
assertEqual('maskStudentId empty', mask.maskStudentId(''), '');
assertEqual('maskPhone', mask.maskPhone('13800008000'), '138****8000');
assertEqual('maskName 2', mask.maskName('张三'), '张*');
assertEqual('maskName compound', mask.maskName('欧阳娜'), '欧**');
assertEqual('maskName single', mask.maskName('张'), '张');
assertEqual('maskName empty', mask.maskName(''), '');

// 2) 兼容性：不传 viewer 时不做任何脱敏（保证既有调用点零影响）
const row = { user_id: 2, building_id: 1, student_id: '2024001002', student_no: '2024001002', real_name: '李四', nickname: '李四', phone: '13900000002' };
const untouched = mask.applyViewerMask(row, null);
assertEqual('no viewer -> same ref', untouched === row, true);
assertEqual('no viewer -> plaintext kept', untouched.student_id, '2024001002');

// 3) 学生看他人 -> 掩码，且不需要审计
const studentViewer = { id: 1, role: 'student' };
const peer = mask.applyViewerMask(row, studentViewer);
assertEqual('peer student_id masked', peer.student_id, '2024****02');
assertEqual('peer real_name masked', peer.real_name, '李*');
assertEqual('peer phone masked', peer.phone, '139****0002');
assertEqual('peer 不需要审计', mask.shouldAuditPlaintext(row, studentViewer), false);

// 4) 学生看自己 -> 明文
const selfViewer = { id: 2, role: 'student' };
assertEqual('self student_id plaintext', mask.applyViewerMask(row, selfViewer).student_id, '2024001002');
assertEqual('self 不需要审计', mask.shouldAuditPlaintext(row, selfViewer), false);

// 5) 超级管理员（全局）-> 明文 + 需审计
const superViewer = { id: 99, role: 'super_admin', scopeType: 'global' };
assertEqual('super plaintext', mask.applyViewerMask(row, superViewer).student_id, '2024001002');
assertEqual('super 需审计', mask.shouldAuditPlaintext(row, superViewer), true);

// 6) 楼栋管理员：命中数据域 -> 明文 + 需审计；未命中 -> 掩码 + 不审计（不放行）
const buildingViewer = { id: 98, role: 'admin', adminScope: { isGlobal: false, buildingId: 1, role: 'admin' } };
assertEqual('building in-scope plaintext', mask.applyViewerMask(row, buildingViewer).student_id, '2024001002');
assertEqual('building in-scope 需审计', mask.shouldAuditPlaintext(row, buildingViewer), true);
const otherBuilding = { id: 97, role: 'admin', adminScope: { isGlobal: false, buildingId: 2, role: 'admin' } };
assertEqual('building out-of-scope masked', mask.applyViewerMask(row, otherBuilding).student_id, '2024****02');
assertEqual('building out-of-scope 不审计', mask.shouldAuditPlaintext(row, otherBuilding), false);

// 7) viewerFromRequest 兼容 req.adminScope
const reqViewer = mask.viewerFromRequest({ user: { id: 5, role: 'admin' }, adminScope: { isGlobal: true, buildingId: null, role: 'admin' } });
assertEqual('viewerFromRequest global plaintext', mask.applyViewerMask(row, reqViewer).student_id, '2024001002');
const scopedReqViewer = mask.viewerFromRequest({ user: { id: 6, role: 'admin' }, adminScope: { isGlobal: false, buildingId: 9, role: 'admin' } });
assertEqual('viewerFromRequest out-of-scope masked', mask.applyViewerMask(row, scopedReqViewer).student_id, '2024****02');

// 8) 业务错误码
assertEqual('errorCode value', errorCodes.ERROR_CODES.TEMP_AUTH_EXPIRED, 'TEMP_AUTH_EXPIRED');
assertEqual('isErrorCode', errorCodes.isErrorCode('HANDOVER_CONFLICT'), true);
assertEqual('isErrorCode false', errorCodes.isErrorCode('NOPE'), false);
assertEqual('messageOf known', errorCodes.messageOf('RESERVATION_CONFLICT'), '该时间段已被占用，请选择其他时间');
assertEqual('messageOf fallback', errorCodes.messageOf('NOPE', '兜底'), '兜底');
assertEqual('httpStatusOf', errorCodes.httpStatusOf('AUDIT_VERSION_CONFLICT'), 409);

// 9) 响应兼容：errorWithCode 保留数字 code 并新增 businessCode；success/error/paginate 行为不变
const makeRes = function() {
  const captured = { status: 0, body: null };
  return {
    captured: captured,
    status: function(s) { captured.status = s; return this; },
    json: function(b) { captured.body = b; return this; }
  };
};
const r1 = makeRes();
response.errorWithCode(r1, 403, 'PERMISSION_DENIED');
assertEqual('errorWithCode http', r1.captured.status, 403);
assertEqual('errorWithCode code numeric', r1.captured.body.code, 403);
assertEqual('errorWithCode businessCode', r1.captured.body.businessCode, 'PERMISSION_DENIED');
assertEqual('errorWithCode message', r1.captured.body.message, '权限不足，无法执行该操作');
assertEqual('errorWithCode data null', r1.captured.body.data, null);
const r2 = makeRes();
response.errorWithCode(r2, 409, 'HANDOVER_CONFLICT', { message: '自定义', handoverId: 7 });
assertEqual('errorWithCode override message', r2.captured.body.message, '自定义');
assertEqual('errorWithCode extra data', r2.captured.body.data.handoverId, 7);
const r3 = makeRes();
response.error(r3, '出错了', 400);
assertEqual('error() unchanged code', r3.captured.body.code, 400);
assertEqual('error() unchanged data', r3.captured.body.data, null);
assertEqual('error() has no businessCode', r3.captured.body.businessCode, undefined);
const r4 = makeRes();
response.success(r4, { a: 1 });
assertEqual('success unchanged code', r4.captured.body.code, 200);
assertEqual('success unchanged message', r4.captured.body.message, 'success');
const r5 = makeRes();
response.paginate(r5, [1], 1, 1, 10);
assertEqual('paginate unchanged totalPages', r5.captured.body.data.totalPages, 1);

console.log('privacy-mask-check: PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) process.exit(1);
