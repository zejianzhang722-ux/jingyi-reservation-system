/**
 * 业务错误码基座（架构设计 R-10）。
 *
 * 设计约束（务必遵守）：
 *  - 业务码使用稳定的 UPPER_SNAKE_CASE 字符串，与中文文案解耦：前端按码分支，文案可单独调整。
 *  - 业务码 **只通过响应体的新增字段 `businessCode` 暴露**；既有 `code` 字段继续承载 HTTP 数字语义，
 *    不得改变（admin 端 `admin/src/utils/request.js` 与小程序均按数字分支）。
 *  - 新增错误码时只允许追加，不得修改既有取值，以保证向后兼容（蓝绿部署 + 多 CI workflow）。
 */

const ERROR_CODES = Object.freeze({
  // 权限与临时授权
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TEMP_AUTH_EXPIRED: 'TEMP_AUTH_EXPIRED',
  // 审核并发
  AUDIT_VERSION_CONFLICT: 'AUDIT_VERSION_CONFLICT',
  SUPPLEMENT_SELF_REVIEW_FORBIDDEN: 'SUPPLEMENT_SELF_REVIEW_FORBIDDEN',
  // 签到
  CHECKIN_GEOFENCE_OUT: 'CHECKIN_GEOFENCE_OUT',
  CHECKIN_CODE_EXPIRED: 'CHECKIN_CODE_EXPIRED',
  // 预约与候补
  RESERVATION_CONFLICT: 'RESERVATION_CONFLICT',
  WAITLIST_CONVERT_FAILED: 'WAITLIST_CONVERT_FAILED',
  // 岗位交接
  HANDOVER_CONFLICT: 'HANDOVER_CONFLICT'
});

/** 业务码 -> 中文默认文案。文案可通过 errorWithCode 的 extraData.message 覆盖。 */
const ERROR_MESSAGES = Object.freeze({
  PERMISSION_DENIED: '权限不足，无法执行该操作',
  TEMP_AUTH_EXPIRED: '临时授权已过期或已被撤销',
  AUDIT_VERSION_CONFLICT: '审核记录已被其他人修改，请刷新后重试',
  SUPPLEMENT_SELF_REVIEW_FORBIDDEN: '不能审核本人补充的材料',
  CHECKIN_GEOFENCE_OUT: '不在签到范围内，请靠近功能房后重试',
  CHECKIN_CODE_EXPIRED: '签到码已过期，请重新获取',
  RESERVATION_CONFLICT: '该时间段已被占用，请选择其他时间',
  WAITLIST_CONVERT_FAILED: '候补转正失败，请稍后重试',
  HANDOVER_CONFLICT: '岗位交接状态冲突，请刷新后重试'
});

/**
 * 业务码 -> 建议 HTTP 状态码。
 * 仅为默认建议值，调用方可在 `errorWithCode(res, httpStatus, ...)` 中显式覆盖。
 * 取值刻意保持与现有系统的既有约定一致（多为 403/409/400），避免引入新数字语义影响前端分支。
 */
const DEFAULT_HTTP_STATUS = Object.freeze({
  PERMISSION_DENIED: 403,
  TEMP_AUTH_EXPIRED: 403,
  AUDIT_VERSION_CONFLICT: 409,
  SUPPLEMENT_SELF_REVIEW_FORBIDDEN: 403,
  CHECKIN_GEOFENCE_OUT: 400,
  CHECKIN_CODE_EXPIRED: 400,
  RESERVATION_CONFLICT: 409,
  WAITLIST_CONVERT_FAILED: 409,
  HANDOVER_CONFLICT: 409
});

const ALL_ERROR_CODES = Object.freeze(Object.keys(ERROR_CODES));

/**
 * 判断给定字符串是否为已登记的业务码。
 * @param {string} code 待校验的业务码
 * @returns {boolean}
 */
const isErrorCode = function(code) {
  return typeof code === 'string' && ALL_ERROR_CODES.indexOf(code) !== -1;
};

/**
 * 取业务码对应的中文文案。
 * @param {string} code 业务码
 * @param {string} [fallback] 未登记时的兜底文案
 * @returns {string}
 */
const messageOf = function(code, fallback) {
  if (isErrorCode(code)) return ERROR_MESSAGES[code];
  return fallback || '操作失败';
};

/**
 * 取业务码建议的 HTTP 状态码。
 * @param {string} code 业务码
 * @param {number} [fallback] 未登记时的兜底状态码
 * @returns {number}
 */
const httpStatusOf = function(code, fallback) {
  if (isErrorCode(code) && DEFAULT_HTTP_STATUS[code]) return DEFAULT_HTTP_STATUS[code];
  return Number(fallback) || 500;
};

module.exports = {
  ERROR_CODES,
  ERROR_MESSAGES,
  DEFAULT_HTTP_STATUS,
  ALL_ERROR_CODES,
  isErrorCode,
  messageOf,
  httpStatusOf
};
