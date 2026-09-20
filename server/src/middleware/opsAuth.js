const crypto = require('crypto');
const response = require('../utils/response');

const secureEqual = function(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
};

const tokenFromRequest = function(req) {
  return String((req.headers && req.headers['x-ops-token']) || '').trim();
};

// 非生产环境匿名放行开关：仅在非生产且显式开启 OPS_ALLOW_ANONYMOUS 时生效。
const anonymousAllowed = function() {
  return process.env.NODE_ENV !== 'production' && process.env.OPS_ALLOW_ANONYMOUS === 'true';
};

// fail-closed：未配置 token 时默认拒绝；仅显式开启匿名开关才放行。
const middleware = function(req, res, next) {
  const configured = String(process.env.OPS_MONITOR_TOKEN || '').trim();
  if (!configured) {
    if (anonymousAllowed()) return next();
    return response.error(res, '运维接口认证失败', 401);
  }
  if (!secureEqual(tokenFromRequest(req), configured)) {
    return response.error(res, '运维接口认证失败', 401);
  }
  next();
};

module.exports = {
  secureEqual,
  tokenFromRequest,
  anonymousAllowed,
  middleware
};
