const jwt = require('jsonwebtoken');
const config = require('../config');
const redis = require('../config/redis');
const response = require('../utils/response');

const getRefreshTokenKey = function(decoded) {
  if (!decoded || !decoded.id) return null;
  return decoded.role === 'student'
    ? 'token:' + decoded.id
    : 'token:admin:' + decoded.id;
};

const isStoredRefreshToken = async function(decoded, tokenStr) {
  if (!decoded || !tokenStr) return false;
  if (decoded.tokenType === 'refresh' || decoded.typ === 'refresh') return true;

  const redisKey = getRefreshTokenKey(decoded);
  if (!redisKey) return false;
  try {
    const storedRefreshToken = await redis.get(redisKey);
    return !!storedRefreshToken && storedRefreshToken === tokenStr;
  } catch (err) {
    return false;
  }
};

const auth = async function(req, res, next) {
  const token = req.headers.authorization;
  if (!token || !token.startsWith('Bearer ')) {
    return response.error(res, '未提供认证令牌', 401);
  }

  const tokenStr = token.substring(7);
  try {
    const decoded = jwt.verify(tokenStr, config.jwt.secret);
    if (await isStoredRefreshToken(decoded, tokenStr)) {
      return response.error(res, '认证令牌类型无效', 401);
    }
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return response.error(res, '令牌已过期', 401);
    }
    return response.error(res, '无效的认证令牌', 401);
  }
};

const optionalAuth = async function(req, res, next) {
  const token = req.headers.authorization;
  if (token && token.startsWith('Bearer ')) {
    const tokenStr = token.substring(7);
    try {
      const decoded = jwt.verify(tokenStr, config.jwt.secret);
      req.user = await isStoredRefreshToken(decoded, tokenStr) ? null : decoded;
    } catch (err) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
};

const requireRole = function(...roles) {
  return function(req, res, next) {
    if (!req.user) {
      return response.error(res, '未认证', 401);
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return response.error(res, '权限不足', 403);
    }
    next();
  };
};

const requireAdmin = function(req, res, next) {
  if (!req.user) {
    return response.error(res, '未认证', 401);
  }
  const adminRoles = ['super_admin', 'admin', 'counselor'];
  if (!adminRoles.includes(req.user.role)) {
    return response.error(res, '权限不足', 403);
  }
  next();
};

const checkTokenBlacklist = async function(req, res, next) {
  const token = req.headers.authorization;
  if (token && token.startsWith('Bearer ')) {
    const tokenStr = token.substring(7);
    try {
      const isBlacklisted = await redis.get('blacklist:' + tokenStr);
      if (isBlacklisted) {
        return response.error(res, '令牌已失效', 401);
      }
    } catch (err) {
      // Redis 暂时不可用时由健康检查和监控负责告警，避免阻塞所有请求。
    }
  }
  next();
};

module.exports = {
  auth,
  optionalAuth,
  requireRole,
  requireAdmin,
  checkTokenBlacklist,
  getRefreshTokenKey
};
