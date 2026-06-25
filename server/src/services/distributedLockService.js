const crypto = require('crypto');
const redis = require('../config/redis');

const RELEASE_SCRIPT = [
  "if redis.call('get', KEYS[1]) == ARGV[1] then",
  "  return redis.call('del', KEYS[1])",
  'else',
  '  return 0',
  'end'
].join('\n');

const RENEW_SCRIPT = [
  "if redis.call('get', KEYS[1]) == ARGV[1] then",
  "  return redis.call('pexpire', KEYS[1], ARGV[2])",
  'else',
  '  return 0',
  'end'
].join('\n');

const normalizeLockName = function(name) {
  const normalized = String(name || '').trim().replace(/[^A-Za-z0-9:_-]/g, '_');
  if (!normalized) {
    const err = new Error('分布式锁名称不能为空');
    err.code = 'LOCK_NAME_REQUIRED';
    throw err;
  }
  return normalized;
};

const lockKey = function(name) {
  return 'runtime:lock:' + normalizeLockName(name);
};

const acquire = async function(name, ttlMs) {
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl < 1000) {
    const err = new Error('分布式锁TTL必须不少于1000毫秒');
    err.code = 'LOCK_TTL_INVALID';
    throw err;
  }

  const key = lockKey(name);
  const token = crypto.randomUUID();
  const result = await redis.set(key, token, 'PX', Math.floor(ttl), 'NX');
  if (result !== 'OK') {
    return { acquired: false, key, token: null, ttlMs: ttl };
  }
  return { acquired: true, key, token, ttlMs: ttl };
};

const release = async function(lock) {
  if (!lock || !lock.acquired || !lock.key || !lock.token) return false;
  const result = await redis.eval(RELEASE_SCRIPT, 1, lock.key, lock.token);
  return Number(result) === 1;
};

const renew = async function(lock, ttlMs) {
  if (!lock || !lock.acquired || !lock.key || !lock.token) return false;
  const ttl = Number(ttlMs || lock.ttlMs);
  if (!Number.isFinite(ttl) || ttl < 1000) return false;
  const result = await redis.eval(RENEW_SCRIPT, 1, lock.key, lock.token, Math.floor(ttl));
  if (Number(result) === 1) {
    lock.ttlMs = ttl;
    return true;
  }
  return false;
};

const withLock = async function(options, task) {
  const settings = options || {};
  const lock = await acquire(settings.name, settings.ttlMs);
  if (!lock.acquired) {
    return {
      acquired: false,
      skipped: true,
      value: undefined,
      lockKey: lock.key
    };
  }

  let renewalTimer = null;
  const renewEveryMs = Number(settings.renewEveryMs || 0);
  if (renewEveryMs >= 1000 && renewEveryMs < lock.ttlMs) {
    renewalTimer = setInterval(function() {
      renew(lock).catch(function() {});
    }, renewEveryMs);
    if (typeof renewalTimer.unref === 'function') renewalTimer.unref();
  }

  try {
    const value = await task(lock);
    return {
      acquired: true,
      skipped: false,
      value,
      lockKey: lock.key
    };
  } finally {
    if (renewalTimer) clearInterval(renewalTimer);
    await release(lock);
  }
};

module.exports = {
  RELEASE_SCRIPT,
  RENEW_SCRIPT,
  normalizeLockName,
  lockKey,
  acquire,
  release,
  renew,
  withLock
};
