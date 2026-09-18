const errorCodes = require('../config/errorCodes');

const success = function(res, data, message, status) {
  const httpStatus = status || 200;
  return res.status(httpStatus).json({
    code: httpStatus,
    message: message || 'success',
    data: data === undefined ? null : data
  });
};

const error = function(res, message, code, details) {
  const httpStatus = Number(code) || 500;
  const payload = {
    code: httpStatus,
    message: message || '服务器内部错误',
    data: null
  };
  if (details !== undefined && process.env.NODE_ENV !== 'production') {
    payload.details = details;
  }
  return res.status(httpStatus).json(payload);
};

const paginate = function(res, data, total, page, pageSize) {
  const normalizedPage = parseInt(page, 10);
  const normalizedPageSize = parseInt(pageSize, 10);
  return res.status(200).json({
    code: 200,
    message: 'success',
    data: {
      list: data,
      total: total,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalPages: Math.ceil(total / normalizedPageSize)
    }
  });
};

/**
 * 带稳定业务码的错误响应（R-10）。
 *
 * 关键兼容约束：
 *  - 既有 `code` 字段**必须**继续是 HTTP 数字语义（这里等于 httpStatus），因为 admin 端与小程序
 *    都按数字分支；本函数不改动 `code` 的语义。
 *  - 业务码只通过**新增字段 `businessCode`** 输出，老客户端忽略该字段即可，不产生破坏性变更。
 *  - 绝不修改 success / error / paginate 的签名与行为。
 *
 * @param {import('express').Response} res 响应对象
 * @param {number} httpStatus HTTP 状态码
 * @param {string} businessCode 业务码（见 config/errorCodes.js）
 * @param {object} [extraData] 附加数据。可含 `message` 用于覆盖默认中文文案；其余字段作为 `data` 返回。
 * @returns {import('express').Response}
 */
const errorWithCode = function(res, httpStatus, businessCode, extraData) {
  const status = Number(httpStatus) || errorCodes.httpStatusOf(businessCode, 500);
  const extra = extraData && typeof extraData === 'object' ? Object.assign({}, extraData) : null;
  const overrideMessage = extra && typeof extra.message === 'string' && extra.message ? extra.message : null;
  if (extra) delete extra.message;

  const payload = {
    code: status,
    businessCode: businessCode || null,
    message: overrideMessage || errorCodes.messageOf(businessCode, '操作失败'),
    data: extra && Object.keys(extra).length ? extra : null
  };

  return res.status(status).json(payload);
};

module.exports = { success, error, paginate, errorWithCode };
