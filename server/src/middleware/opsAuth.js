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

const middleware = function(req, res, next) {
  const configured = String(process.env.OPS_MONITOR_TOKEN || '').trim();
  if (!configured && process.env.NODE_ENV !== 'production') return next();
  if (!secureEqual(tokenFromRequest(req), configured)) {
    return response.error(res, '运维接口认证失败', 401);
  }
  next();
};

module.exports = {
  secureEqual,
  tokenFromRequest,
  middleware
};
