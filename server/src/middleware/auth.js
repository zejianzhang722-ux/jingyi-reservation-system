const jwt = require('jsonwebtoken');
const config = require('../config');
const redis = require('../config/redis');
const response = require('../utils/response');

const auth = function(req, res, next) {
  const token = req.headers.authorization;
  if (!token || !token.startsWith('Bearer ')) {
    return response.error(res, '未提供认证令牌', 401);
  }
  const tokenStr = token.substring(7);
  try {
    const decoded = jwt.verify(tokenStr, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return response.error(res, '令牌已过期', 401);
    }
    return response.error(res, '无效的认证令牌', 401);
  }
};

const optionalAuth = function(req, res, next) {
  const token = req.headers.authorization;
  if (token && token.startsWith('Bearer ')) {
    const tokenStr = token.substring(7);
    try {
      const decoded = jwt.verify(tokenStr, config.jwt.secret);
      req.user = decoded;
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
      // Redis不可用时跳过黑名单检查
    }
  }
  next();
};

module.exports = { auth, optionalAuth, requireRole, requireAdmin, checkTokenBlacklist };
