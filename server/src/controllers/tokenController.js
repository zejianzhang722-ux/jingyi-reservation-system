const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const redis = require('../config/redis');
const logger = require('../config/logger');
const response = require('../utils/response');
const { getRefreshTokenKey } = require('../middleware/auth');

const createJti = function() {
  return crypto.randomBytes(16).toString('hex');
};

const generateRotatedTokens = function(decoded) {
  const commonPayload = {
    id: decoded.id,
    openid: decoded.openid || null,
    role: decoded.role
  };

  const accessToken = jwt.sign(
    Object.assign({}, commonPayload, { tokenType: 'access' }),
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn, jwtid: createJti() }
  );

  const refreshToken = jwt.sign(
    Object.assign({}, commonPayload, { tokenType: 'refresh' }),
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn, jwtid: createJti() }
  );

  return { token: accessToken, refreshToken };
};

const refresh = async function(req, res) {
  const providedRefreshToken = req.body && req.body.refreshToken;
  if (!providedRefreshToken || typeof providedRefreshToken !== 'string') {
    return response.error(res, '请重新登录', 401);
  }

  try {
    const decoded = jwt.verify(providedRefreshToken, config.jwt.secret);
    if (!decoded || !decoded.id || !decoded.role) {
      return response.error(res, '请重新登录', 401);
    }

    // 兼容升级前已签发且未携带 tokenType 的 refresh token；
    // 升级后签发的 token 必须明确标记为 refresh。
    if (decoded.tokenType && decoded.tokenType !== 'refresh') {
      return response.error(res, '令牌类型无效，请重新登录', 401);
    }

    const redisKey = getRefreshTokenKey(decoded);
    if (!redisKey) {
      return response.error(res, '请重新登录', 401);
    }

    const storedRefreshToken = await redis.get(redisKey);
    if (!storedRefreshToken || storedRefreshToken !== providedRefreshToken) {
      return response.error(res, '登录状态已失效，请重新登录', 401);
    }

    const rotatedTokens = generateRotatedTokens(decoded);
    await redis.set(redisKey, rotatedTokens.refreshToken, 'EX', 7 * 24 * 3600);

    return response.success(res, rotatedTokens, '刷新成功');
  } catch (err) {
    logger.warn('Refresh Token 校验失败: ' + err.message);
    return response.error(res, '登录状态已失效，请重新登录', 401);
  }
};

module.exports = { refresh };
