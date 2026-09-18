/**
 * QA 独立验证 · T01 业务错误码基座（R-10）
 *
 * 由 QA（严过关）独立编写，不复用工程师的 privacy-mask-check.js。
 * 目标（“证明它能工作，而不是确认它存在”）：
 *   1) 响应里的 `code` 必须仍是 **HTTP 数字语义**（前端按数字分支）；
 *   2) 业务码只能出现在新增字段 `businessCode`，且为 UPPER_SNAKE；
 *   3) 现有 success / error / paginate 的**签名与逐字段输出**不得变化。
 *
 * 纯逻辑，不依赖 DB / Redis。运行：node server/tests/qa-batch01-error-codes-check.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const response = require(path.join(SRC, 'utils', 'response'));
const errorCodes = require(path.join(SRC, 'config', 'errorCodes'));

let pass = 0;
let fail = 0;
const results = [];
const check = function(name, cond, detail) {
  if (cond) { pass++; results.push('PASS  ' + name); }
  else { fail++; results.push('FAIL  ' + name + (detail ? ('  :: ' + detail) : '')); }
};
const eq = function(name, actual, expected) {
  check(name, actual === expected, 'got=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
};

const makeRes = function() {
  const c = { status: 0, body: null };
  return {
    c: c,
    status: function(s) { c.status = s; return this; },
    json: function(b) { c.body = b; return this; }
  };
};

const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

// ---------- 1) 错误码注册表 ----------
Object.keys(errorCodes.ERROR_CODES).forEach(function(key) {
  eq('ERROR_CODES.' + key + ' 值等于键名', errorCodes.ERROR_CODES[key], key);
  check('ERROR_CODES.' + key + ' 为 UPPER_SNAKE', UPPER_SNAKE.test(errorCodes.ERROR_CODES[key]), errorCodes.ERROR_CODES[key]);
  check('ERROR_MESSAGES.' + key + ' 存在非空中文文案',
    typeof errorCodes.ERROR_MESSAGES[key] === 'string' && errorCodes.ERROR_MESSAGES[key].length > 0);
  check('DEFAULT_HTTP_STATUS.' + key + ' 为数字',
    typeof errorCodes.DEFAULT_HTTP_STATUS[key] === 'number');
});
eq('isErrorCode(已知)', errorCodes.isErrorCode('TEMP_AUTH_EXPIRED'), true);
eq('isErrorCode(未知)', errorCodes.isErrorCode('NOT_REGISTERED'), false);
eq('isErrorCode(非字符串)', errorCodes.isErrorCode(123), false);
eq('messageOf(未知, 兜底)', errorCodes.messageOf('NOT_REGISTERED', '兜底'), '兜底');
eq('messageOf(未知, 无兜底)', errorCodes.messageOf('NOT_REGISTERED'), '操作失败');
eq('httpStatusOf(未知, 无兜底)', errorCodes.httpStatusOf('NOT_REGISTERED'), 500);
eq('httpStatusOf(未知, 兜底字符串数字)', errorCodes.httpStatusOf('NOT_REGISTERED', '418'), 418);

// ---------- 2) errorWithCode：code 仍是数字、业务码进 businessCode ----------
const r1 = makeRes();
response.errorWithCode(r1, 403, 'PERMISSION_DENIED');
eq('errorWithCode HTTP 状态', r1.c.status, 403);
check('errorWithCode body.code 是数字', typeof r1.c.body.code === 'number', typeof r1.c.body.code);
eq('errorWithCode body.code === httpStatus', r1.c.body.code, 403);
eq('errorWithCode businessCode', r1.c.body.businessCode, 'PERMISSION_DENIED');
check('errorWithCode businessCode 是 UPPER_SNAKE', UPPER_SNAKE.test(r1.c.body.businessCode));
check('errorWithCode businessCode 不是数字', typeof r1.c.body.businessCode !== 'number');
eq('errorWithCode 默认文案', r1.c.body.message, '权限不足，无法执行该操作');
eq('errorWithCode data=null', r1.c.body.data, null);
check('errorWithCode 无 details 泄漏', r1.c.body.details === undefined);

// 显式 httpStatus 覆盖默认建议值
const r2 = makeRes();
response.errorWithCode(r2, 499, 'PERMISSION_DENIED');
eq('errorWithCode 显式覆盖 httpStatus', r2.c.body.code, 499);

// 不传 httpStatus -> 采用注册表建议值
const r3 = makeRes();
response.errorWithCode(r3, undefined, 'AUDIT_VERSION_CONFLICT');
eq('errorWithCode 缺省 httpStatus 取建议值 409', r3.c.body.code, 409);
eq('errorWithCode 缺省 businessCode 保留', r3.c.body.businessCode, 'AUDIT_VERSION_CONFLICT');

// extraData.message 覆盖 + 其余字段进 data + message 不得混入 data
const r4 = makeRes();
response.errorWithCode(r4, 409, 'HANDOVER_CONFLICT', { message: '自定义文案', handoverId: 7, step: 'accept' });
eq('errorWithCode 覆盖文案', r4.c.body.message, '自定义文案');
eq('errorWithCode 附加数据 handoverId', r4.c.body.data.handoverId, 7);
eq('errorWithCode 附加数据 step', r4.c.body.data.step, 'accept');
check('errorWithCode data 不应包含 message', r4.c.body.data.message === undefined);
eq('errorWithCode 未登记业务码兜底文案', (function() {
  const r = makeRes(); response.errorWithCode(r, 400, 'NOT_REGISTERED'); return r.c.body.message;
})(), '操作失败');
eq('errorWithCode 未登记业务码仍回显 businessCode', (function() {
  const r = makeRes(); response.errorWithCode(r, 400, 'NOT_REGISTERED'); return r.c.body.businessCode;
})(), 'NOT_REGISTERED');

// ---------- 3) 既有 success / error / paginate 行为与签名不得变化 ----------
const s1 = makeRes();
response.success(s1, { a: 1 });
eq('success status', s1.c.status, 200);
eq('success code', s1.c.body.code, 200);
eq('success message', s1.c.body.message, 'success');
eq('success data', JSON.stringify(s1.c.body.data), JSON.stringify({ a: 1 }));
check('success 无 businessCode 字段', s1.c.body.businessCode === undefined);
eq('success 不传 data 时为 null', (function() { const r = makeRes(); response.success(r); return r.c.body.data; })(), null);
eq('success 支持自定义状态码', (function() { const r = makeRes(); response.success(r, null, 'ok', 201); return r.c.body.code; })(), 201);

const e1 = makeRes();
response.error(e1, '出错了', 400);
eq('error status', e1.c.status, 400);
eq('error code 为数字', typeof e1.c.body.code, 'number');
eq('error code', e1.c.body.code, 400);
eq('error message', e1.c.body.message, '出错了');
eq('error data=null', e1.c.body.data, null);
check('error 无 businessCode 字段', e1.c.body.businessCode === undefined);
eq('error 非法 code 回退 500', (function() { const r = makeRes(); response.error(r, 'x', 'abc'); return r.c.body.code; })(), 500);
eq('error 默认文案', (function() { const r = makeRes(); response.error(r); return r.c.body.message; })(), '服务器内部错误');
// 非生产环境 details 透传（沿用既有行为）
eq('error details 非生产透传', (function() { const r = makeRes(); response.error(r, 'x', 400, { f: 1 }); return JSON.stringify(r.c.body.details); })(), JSON.stringify({ f: 1 }));

const p1 = makeRes();
response.paginate(p1, [1, 2], 5, '2', '2');
eq('paginate status 200', p1.c.status, 200);
eq('paginate code 200', p1.c.body.code, 200);
eq('paginate list', JSON.stringify(p1.c.body.data.list), '[1,2]');
eq('paginate total', p1.c.body.data.total, 5);
eq('paginate page 归一为数字', p1.c.body.data.page, 2);
eq('paginate pageSize 归一为数字', p1.c.body.data.pageSize, 2);
eq('paginate totalPages', p1.c.body.data.totalPages, 3);
check('paginate 无 businessCode 字段', p1.c.body.businessCode === undefined);

console.log(results.join('\n'));
console.log('qa-batch01-error-codes-check: PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) process.exit(1);
