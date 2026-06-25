const crypto = require('crypto');
const redis = require('../config/redis');

const mockLocks = new Map();
const MAX_LOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeName = function(name) {
  const value = String(name || '').trim();
  if (!value || !/^[A-Za-z0-9:_-]+$/.test(value)) {
    const err = new Error('分布式锁名称无效');
    err.code = 'INVALID_LOCK_NAME';
    throw err;
  }
  return value;
};

const normalizeTtl = function(ttlMs) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value < 1000 || value > MAX_LOCK_TTL_MS) {
    const err = new Error('分布式锁有效期必须在1秒至7天之间');
    err.code = 'INVALID_LOCK_TTL';
    throw err;
  }
  return Math.floor(value);
};

const lockKey = function(name) {
  return 'runtime:lock:' + normalizeName(name);
};

const cleanupMockLock = function(key) {
  const current = mockLocks.get(key);
  if (current && current.expiresAt <= Date.now()) mockLocks.delete(key);
};

const acquire = async function(name, ttlMs) {
  const key = lockKey(name);
  const ttl = normalizeTtl(ttlMs);
  const token = crypto.randomBytes(24).toString('hex');

  if (redis.isMock()) {
    cleanupMockLock(key);
    if (mockLocks.has(key)) return null;
    mockLocks.set(key, { token, expiresAt: Date.now() + ttl });
    return { key, token, ttlMs: ttl, mock: true };
  }

  const result = await redis.set(key, token, 'PX', ttl, 'NX');
  if (result !== 'OK') return null;
  return { key, token, ttlMs: ttl, mock: false };
};

const release = async function(lock) {
  if (!lock || !lock.key || !lock.token) return false;

  if (lock.mock || redis.isMock()) {
    cleanupMockLock(lock.key);
    const current = mockLocks.get(lock.key);
    if (!current || current.token !== lock.token) return false;
    mockLocks.delete(lock.key);
    return true;
  }

  const script = [
    "if redis.call('get', KEYS[1]) == ARGV[1] then",
    "  return redis.call('del', KEYS[1])",
    'else',
    '  return 0',
    'end'
  ].join('\n');
  const result = await redis.eval(script, 1, lock.key, lock.token);
  return Number(result) === 1;
};

const extend = async function(lock, ttlMs) {
  if (!lock || !lock.key || !lock.token) return false;
  const ttl = normalizeTtl(ttlMs);

  if (lock.mock || redis.isMock()) {
    cleanupMockLock(lock.key);
    const current = mockLocks.get(lock.key);
    if (!current || current.token !== lock.token) return false;
    current.expiresAt = Date.now() + ttl;
    lock.ttlMs = ttl;
    return true;
  }

  const script = [
    "if redis.call('get', KEYS[1]) == ARGV[1] then",
    "  return redis.call('pexpire', KEYS[1], ARGV[2])",
    'else',
    '  return 0',
    'end'
  ].join('\n');
  const result = await redis.eval(script, 1, lock.key, lock.token, String(ttl));
  if (Number(result) === 1) lock.ttlMs = ttl;
  return Number(result) === 1;
};

const runExclusive = async function(name, options, task) {
  const settings = Object.assign({
    ttlMs: 60000,
    retainOnSuccess: false
  }, options || {});
  if (typeof task !== 'function') throw new TypeError('task必须为函数');

  const lock = await acquire(name, settings.ttlMs);
  if (!lock) {
    return { acquired: false, skipped: true, result: null };
  }

  const startedAt = Date.now();
  try {
    const result = await task({ lock, extend: function(ttlMs) { return extend(lock, ttlMs); } });
    if (!settings.retainOnSuccess) await release(lock);
    return {
      acquired: true,
      skipped: false,
      retained: !!settings.retainOnSuccess,
      durationMs: Date.now() - startedAt,
      result
    };
  } catch (err) {
    try { await release(lock); } catch (releaseErr) {}
    throw err;
  }
};

const clearMockLocks = function() {
  mockLocks.clear();
};

module.exports = {
  MAX_LOCK_TTL_MS,
  acquire,
  release,
  extend,
  runExclusive,
  lockKey,
  clearMockLocks
};
