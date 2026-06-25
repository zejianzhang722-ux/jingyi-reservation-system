const config = require('./index');

let useMock = false;
let redis = null;
let initializationError = null;
const isProduction = process.env.NODE_ENV === 'production';
const allowMock = !isProduction && process.env.ALLOW_MOCK_REDIS !== 'false';
const mockStore = new Map();
const mockExpiry = new Map();

function createMockRedis() {
  const checkExpiry = function(key) {
    if (mockExpiry.has(key) && Date.now() > mockExpiry.get(key)) {
      mockStore.delete(key);
      mockExpiry.delete(key);
      return true;
    }
    return false;
  };

  const parseSetOptions = function(args) {
    const options = { ttlMs: null, nx: false, xx: false };
    const flat = args.flat();
    for (let index = 0; index < flat.length; index++) {
      const current = flat[index];
      if (typeof current !== 'string') continue;
      const option = current.toUpperCase();
      if (option === 'EX') {
        options.ttlMs = Number(flat[index + 1]) * 1000;
        index++;
      } else if (option === 'PX') {
        options.ttlMs = Number(flat[index + 1]);
        index++;
      } else if (option === 'NX') {
        options.nx = true;
      } else if (option === 'XX') {
        options.xx = true;
      }
    }
    return options;
  };

  return {
    get: function(key) {
      checkExpiry(key);
      return Promise.resolve(mockStore.get(key) || null);
    },
    set: function(key, value) {
      checkExpiry(key);
      const options = parseSetOptions(Array.prototype.slice.call(arguments, 2));
      const exists = mockStore.has(key);
      if (options.nx && exists) return Promise.resolve(null);
      if (options.xx && !exists) return Promise.resolve(null);
      mockStore.set(key, value);
      if (Number.isFinite(options.ttlMs) && options.ttlMs > 0) {
        mockExpiry.set(key, Date.now() + options.ttlMs);
      } else {
        mockExpiry.delete(key);
      }
      return Promise.resolve('OK');
    },
    del: function() {
      const keys = Array.prototype.slice.call(arguments).flat();
      let count = 0;
      keys.forEach(function(key) {
        if (mockStore.delete(key)) count++;
        mockExpiry.delete(key);
      });
      return Promise.resolve(count);
    },
    expire: function(key, seconds) {
      checkExpiry(key);
      if (!mockStore.has(key)) return Promise.resolve(0);
      mockExpiry.set(key, Date.now() + Number(seconds) * 1000);
      return Promise.resolve(1);
    },
    pexpire: function(key, milliseconds) {
      checkExpiry(key);
      if (!mockStore.has(key)) return Promise.resolve(0);
      mockExpiry.set(key, Date.now() + Number(milliseconds));
      return Promise.resolve(1);
    },
    exists: function(key) {
      checkExpiry(key);
      return Promise.resolve(mockStore.has(key) ? 1 : 0);
    },
    keys: function(pattern) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      const result = [];
      mockStore.forEach(function(value, key) {
        if (!checkExpiry(key) && regex.test(key)) result.push(key);
      });
      return Promise.resolve(result);
    },
    scan: function(cursor, matchOption, pattern, countOption, count) {
      const allKeys = [];
      mockStore.forEach(function(value, key) {
        if (!checkExpiry(key)) allKeys.push(key);
      });
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      const matched = allKeys.filter(function(key) { return regex.test(key); });
      const countNumber = Number(count) || 10;
      const start = Number(cursor) * countNumber;
      const end = start + countNumber;
      return Promise.resolve([String(end >= matched.length ? 0 : Number(cursor) + 1), matched.slice(start, end)]);
    },
    ttl: function(key) {
      checkExpiry(key);
      if (!mockStore.has(key)) return Promise.resolve(-2);
      if (!mockExpiry.has(key)) return Promise.resolve(-1);
      const remaining = Math.floor((mockExpiry.get(key) - Date.now()) / 1000);
      return Promise.resolve(remaining > 0 ? remaining : -2);
    },
    hset: function(key) {
      const args = Array.prototype.slice.call(arguments, 1);
      let hash = mockStore.get(key);
      if (!hash || typeof hash !== 'object' || Array.isArray(hash)) hash = {};
      for (let index = 0; index < args.length - 1; index += 2) hash[args[index]] = args[index + 1];
      mockStore.set(key, hash);
      return Promise.resolve(1);
    },
    hget: function(key, field) {
      checkExpiry(key);
      const hash = mockStore.get(key);
      if (!hash || typeof hash !== 'object' || Array.isArray(hash)) return Promise.resolve(null);
      return Promise.resolve(hash[field] !== undefined ? hash[field] : null);
    },
    hdel: function(key, field) {
      const hash = mockStore.get(key);
      if (!hash || typeof hash !== 'object' || Array.isArray(hash)) return Promise.resolve(0);
      const existed = hash[field] !== undefined;
      delete hash[field];
      return Promise.resolve(existed ? 1 : 0);
    },
    sadd: function(key) {
      const members = Array.prototype.slice.call(arguments, 1);
      let values = mockStore.get(key);
      if (!Array.isArray(values)) values = [];
      let added = 0;
      members.forEach(function(member) {
        if (!values.includes(member)) {
          values.push(member);
          added++;
        }
      });
      mockStore.set(key, values);
      return Promise.resolve(added);
    },
    srem: function(key) {
      const members = Array.prototype.slice.call(arguments, 1);
      const values = mockStore.get(key);
      if (!Array.isArray(values)) return Promise.resolve(0);
      let removed = 0;
      members.forEach(function(member) {
        const index = values.indexOf(member);
        if (index !== -1) {
          values.splice(index, 1);
          removed++;
        }
      });
      mockStore.set(key, values);
      return Promise.resolve(removed);
    },
    sismember: function(key, member) {
      checkExpiry(key);
      const values = mockStore.get(key);
      return Promise.resolve(Array.isArray(values) && values.includes(member) ? 1 : 0);
    },
    scard: function(key) {
      checkExpiry(key);
      const values = mockStore.get(key);
      return Promise.resolve(Array.isArray(values) ? values.length : 0);
    },
    smembers: function(key) {
      checkExpiry(key);
      const values = mockStore.get(key);
      return Promise.resolve(Array.isArray(values) ? values.slice() : []);
    },
    incr: function(key) {
      const value = (Number(mockStore.get(key)) || 0) + 1;
      mockStore.set(key, String(value));
      return Promise.resolve(value);
    },
    decr: function(key) {
      const value = (Number(mockStore.get(key)) || 0) - 1;
      mockStore.set(key, String(value));
      return Promise.resolve(value);
    },
    eval: function(script, numberOfKeys) {
      const args = Array.prototype.slice.call(arguments, 2);
      const key = args[0];
      const token = args[Number(numberOfKeys)];
      checkExpiry(key);
      if (String(script).includes("redis.call('del'") || String(script).includes('redis.call("del"')) {
        if (mockStore.get(key) !== token) return Promise.resolve(0);
        mockStore.delete(key);
        mockExpiry.delete(key);
        return Promise.resolve(1);
      }
      if (String(script).includes("redis.call('pexpire'") || String(script).includes('redis.call("pexpire"')) {
        const ttlMs = Number(args[Number(numberOfKeys) + 1]);
        if (mockStore.get(key) !== token) return Promise.resolve(0);
        mockExpiry.set(key, Date.now() + ttlMs);
        return Promise.resolve(1);
      }
      return Promise.reject(new Error('Mock Redis only supports lock release and renewal Lua scripts'));
    },
    on: function() {},
    disconnect: function() {},
    quit: function() { return Promise.resolve('OK'); },
    ping: function() { return Promise.resolve('PONG'); }
  };
}

const mockRedis = createMockRedis();

const switchToMock = function(err, context) {
  initializationError = err || initializationError;
  if (!allowMock) {
    console.error('[Redis] ' + context + '，生产环境禁止回退到内存模拟模式:', err ? err.message : '未知错误');
    return false;
  }
  if (!useMock) console.warn('[Redis] ' + context + '，仅在非生产环境切换到模拟模式:', err ? err.message : '未知错误');
  useMock = true;
  if (redis && typeof redis.disconnect === 'function') redis.disconnect();
  return true;
};

try {
  const Redis = require('ioredis');
  redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    db: config.redis.db,
    retryStrategy: function(times) {
      if (isProduction && times > 3) return null;
      return Math.min(times * 50, 2000);
    },
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000
  });
  redis.on('connect', function() {
    initializationError = null;
    console.log('[Redis] 连接成功');
  });
  redis.on('error', function(err) {
    initializationError = err;
    if (allowMock) switchToMock(err, '连接错误');
    else console.error('[Redis] 连接错误:', err.message);
  });
} catch (err) {
  switchToMock(err, 'ioredis模块不可用');
}

const ready = async function() {
  if (useMock) return { mode: 'mock' };
  if (!redis) {
    if (switchToMock(initializationError || new Error('Redis客户端未初始化'), '客户端未初始化')) return { mode: 'mock' };
    const err = new Error('Redis不可用，生产环境禁止回退到内存模拟模式');
    err.code = 'REDIS_UNAVAILABLE';
    throw err;
  }

  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.ping();
    return { mode: 'redis' };
  } catch (err) {
    if (switchToMock(err, '连接失败')) return { mode: 'mock' };
    const failure = new Error('Redis不可用，生产环境禁止回退到内存模拟模式');
    failure.code = 'REDIS_UNAVAILABLE';
    failure.cause = err;
    throw failure;
  }
};

const exported = new Proxy(mockRedis, {
  get: function(target, property) {
    if (property === 'isMock') return function() { return useMock; };
    if (property === 'ready') return ready;
    if (property === 'allowMock') return allowMock;
    if (property === 'isProduction') return isProduction;
    if (useMock) return target[property];
    if (redis && typeof redis[property] === 'function') return redis[property].bind(redis);
    if (redis && typeof redis[property] !== 'undefined') return redis[property];
    return target[property];
  }
});

module.exports = exported;
