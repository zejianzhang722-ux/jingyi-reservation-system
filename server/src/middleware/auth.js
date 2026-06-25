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
  if (decoded.tokenType === 'access' || decoded.typ === 'access') return false;
  if (decoded.tokenType === 'refresh' || decoded.typ === 'refresh') return true;

  // 兼容旧版本未携带 tokenType 的令牌。旧访问令牌与刷新令牌只能通过
  // Redis 中保存的当前刷新令牌区分；如果该状态不存在，则必须拒绝，
  // 不能在 Redis 故障或会话已撤销时把旧刷新令牌误当作访问令牌。
  const redisKey = getRefreshTokenKey(decoded);
  if (!redisKey) throw new Error('无法识别令牌类型');

  const storedRefreshToken = await redis.get(redisKey);
  if (!storedRefreshToken) throw new Error('旧版会话状态不存在');
  return storedRefreshToken === tokenStr;
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
  getRefreshTokenKey,
  isStoredRefreshToken
};
