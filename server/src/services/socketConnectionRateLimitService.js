const crypto = require('crypto');
const redis = require('../config/redis');

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_ATTEMPTS = 60;

const rateLimitError = function(message) {
  const err = new Error(message || '实时连接尝试过于频繁');
  err.data = { code: 'SOCKET_CONNECTION_RATE_LIMITED' };
  return err;
};

const normalizeAddress = function(socket) {
  const handshake = socket && socket.handshake ? socket.handshake : {};
  const directAddress = String(handshake.address || '').trim();
  const trustProxy = process.env.SOCKET_TRUST_PROXY === 'true';
  const forwarded = handshake.headers && handshake.headers['x-forwarded-for'];
  if (trustProxy && forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return directAddress || 'unknown';
};

const connectionKey = function(address) {
  const digest = crypto.createHash('sha256').update(String(address)).digest('hex');
  return 'runtime:socket:connect:' + digest;
};

const consume = async function(socket, options) {
  const settings = options || {};
  const redisClient = settings.redisClient || redis;
  const windowSeconds = Math.max(10, Number(settings.windowSeconds || DEFAULT_WINDOW_SECONDS));
  const maxAttempts = Math.max(1, Number(settings.maxAttempts || DEFAULT_MAX_ATTEMPTS));
  const address = normalizeAddress(socket);
  const key = connectionKey(address);

  try {
    const created = await redisClient.set(key, '1', 'EX', windowSeconds, 'NX');
    if (created === 'OK') {
      return { allowed: true, count: 1, remaining: maxAttempts - 1, key };
    }

    const count = Number(await redisClient.incr(key));
    const ttl = Number(await redisClient.ttl(key));
    if (ttl < 0) await redisClient.expire(key, windowSeconds);
    if (count > maxAttempts) throw rateLimitError();
    return {
      allowed: true,
      count,
      remaining: Math.max(0, maxAttempts - count),
      key
    };
  } catch (err) {
    if (err && err.data && err.data.code === 'SOCKET_CONNECTION_RATE_LIMITED') throw err;
    const dependencyError = new Error('实时连接限流服务暂不可用');
    dependencyError.data = { code: 'SOCKET_RATE_LIMIT_DEPENDENCY_UNAVAILABLE' };
    throw dependencyError;
  }
};

const configure = function(io, options) {
  io.use(function(socket, next) {
    consume(socket, options).then(function() {
      next();
    }).catch(function(err) {
      next(err);
    });
  });
  return io;
};

module.exports = {
  DEFAULT_WINDOW_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
  rateLimitError,
  normalizeAddress,
  connectionKey,
  consume,
  configure
};
