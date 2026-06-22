const config = require('./index');

let useMock = false;
const mockStore = new Map();
const mockExpiry = new Map();

function createMockRedis() {
  var checkExpiry = function(key) {
    if (mockExpiry.has(key)) {
      if (Date.now() > mockExpiry.get(key)) {
        mockStore.delete(key);
        mockExpiry.delete(key);
        return true;
      }
    }
    return false;
  };

  var getExSeconds = function(exArg) {
    if (typeof exArg === 'number') return exArg;
    if (Array.isArray(exArg)) {
      for (var i = 0; i < exArg.length - 1; i++) {
        if (String(exArg[i]).toUpperCase() === 'EX') return Number(exArg[i + 1]);
        if (String(exArg[i]).toUpperCase() === 'PX') return Number(exArg[i + 1]) / 1000;
      }
    }
    return null;
  };

  return {
    get: function(key) {
      checkExpiry(key);
      return Promise.resolve(mockStore.get(key) || null);
    },
    set: function(key, value) {
      var exSeconds = null;
      for (var i = 2; i < arguments.length; i++) {
        var arg = arguments[i];
        if (Array.isArray(arg)) {
          exSeconds = getExSeconds(arg);
          break;
        }
        if (typeof arg === 'string' && arg.toUpperCase() === 'EX' && i + 1 < arguments.length) {
          exSeconds = Number(arguments[i + 1]);
          break;
        }
        if (typeof arg === 'number') {
          exSeconds = arg;
          break;
        }
      }
      mockStore.set(key, value);
      if (exSeconds) {
        mockExpiry.set(key, Date.now() + exSeconds * 1000);
      } else {
        mockExpiry.delete(key);
      }
      return Promise.resolve('OK');
    },
    del: function(key) {
      if (Array.isArray(key)) {
        var count = 0;
        key.forEach(function(k) {
          if (mockStore.delete(k)) count++;
          mockExpiry.delete(k);
        });
        return Promise.resolve(count);
      }
      var existed = mockStore.delete(key);
      mockExpiry.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    },
    expire: function(key, seconds) {
      if (!mockStore.has(key)) return Promise.resolve(0);
      mockExpiry.set(key, Date.now() + seconds * 1000);
      return Promise.resolve(1);
    },
    exists: function(key) {
      checkExpiry(key);
      return Promise.resolve(mockStore.has(key) ? 1 : 0);
    },
    keys: function(pattern) {
      var regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      var result = [];
      mockStore.forEach(function(val, key) {
        if (!checkExpiry(key) && regex.test(key)) {
          result.push(key);
        }
      });
      return Promise.resolve(result);
    },
    scan: function(cursor, matchOpt, pattern, countOpt, count) {
      var allKeys = [];
      mockStore.forEach(function(val, key) {
        if (!checkExpiry(key)) allKeys.push(key);
      });
      var regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      var matched = allKeys.filter(function(k) { return regex.test(k); });
      var countNum = count || 10;
      var start = cursor * countNum;
      var end = start + countNum;
      var resultKeys = matched.slice(start, end);
      var nextCursor = end >= matched.length ? 0 : cursor + 1;
      return Promise.resolve([String(nextCursor), resultKeys]);
    },
    ttl: function(key) {
      if (!mockStore.has(key)) return Promise.resolve(-2);
      if (!mockExpiry.has(key)) return Promise.resolve(-1);
      var remaining = Math.floor((mockExpiry.get(key) - Date.now()) / 1000);
      return Promise.resolve(remaining > 0 ? remaining : -2);
    },
    hset: function(key) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (!mockStore.has(key)) mockStore.set(key, {});
      var hash = mockStore.get(key);
      if (typeof hash !== 'object' || hash === null) {
        hash = {};
        mockStore.set(key, hash);
      }
      for (var i = 0; i < args.length - 1; i += 2) {
        hash[args[i]] = args[i + 1];
      }
      return Promise.resolve(1);
    },
    hget: function(key, field) {
      checkExpiry(key);
      var hash = mockStore.get(key);
      if (!hash || typeof hash !== 'object') return Promise.resolve(null);
      return Promise.resolve(hash[field] !== undefined ? hash[field] : null);
    },
    hdel: function(key, field) {
      var hash = mockStore.get(key);
      if (!hash || typeof hash !== 'object') return Promise.resolve(0);
      var existed = hash[field] !== undefined;
      delete hash[field];
      return Promise.resolve(existed ? 1 : 0);
    },
    sadd: function(key) {
      var members = Array.prototype.slice.call(arguments, 1);
      if (!mockStore.has(key)) mockStore.set(key, []);
      var set = mockStore.get(key);
      if (!Array.isArray(set)) {
        set = [];
        mockStore.set(key, set);
      }
      var added = 0;
      members.forEach(function(m) {
        if (set.indexOf(m) === -1) {
          set.push(m);
          added++;
        }
      });
      return Promise.resolve(added);
    },
    srem: function(key) {
      var members = Array.prototype.slice.call(arguments, 1);
      var set = mockStore.get(key);
      if (!set || !Array.isArray(set)) return Promise.resolve(0);
      var removed = 0;
      members.forEach(function(m) {
        var idx = set.indexOf(m);
        if (idx !== -1) {
          set.splice(idx, 1);
          removed++;
        }
      });
      return Promise.resolve(removed);
    },
    sismember: function(key, member) {
      checkExpiry(key);
      var set = mockStore.get(key);
      if (!set || !Array.isArray(set)) return Promise.resolve(0);
      return Promise.resolve(set.indexOf(member) !== -1 ? 1 : 0);
    },
    scard: function(key) {
      checkExpiry(key);
      var set = mockStore.get(key);
      if (!set || !Array.isArray(set)) return Promise.resolve(0);
      return Promise.resolve(set.length);
    },
    smembers: function(key) {
      checkExpiry(key);
      var set = mockStore.get(key);
      if (!set || !Array.isArray(set)) return Promise.resolve([]);
      return Promise.resolve(set.slice());
    },
    incr: function(key) {
      var val = Number(mockStore.get(key)) || 0;
      val++;
      mockStore.set(key, String(val));
      return Promise.resolve(val);
    },
    decr: function(key) {
      var val = Number(mockStore.get(key)) || 0;
      val--;
      mockStore.set(key, String(val));
      return Promise.resolve(val);
    },
    on: function(event, callback) {},
    disconnect: function() {},
    quit: function() { return Promise.resolve('OK'); },
    ping: function() { return Promise.resolve('PONG'); }
  };
}

var redis;

try {
  var Redis = require('ioredis');
  redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    db: config.redis.db,
    retryStrategy: function(times) {
      var delay = Math.min(times * 50, 2000);
      return delay;
    },
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000
  });

  redis.on('connect', function() {
    console.log('[Redis] 连接成功');
  });

  redis.on('error', function(err) {
    if (!useMock) {
      console.warn('[Redis] 连接错误，切换到模拟模式:', err.message);
      useMock = true;
    }
  });

  redis.ping().catch(function(err) {
    console.warn('[Redis] ping失败，切换到模拟模式:', err.message);
    useMock = true;
  });
} catch (e) {
  console.warn('[Redis] ioredis模块不可用，切换到模拟模式');
  useMock = true;
}

var mockRedis = createMockRedis();

module.exports = new Proxy(mockRedis, {
  get: function(target, prop) {
    if (useMock) {
      return target[prop];
    }
    if (redis && typeof redis[prop] !== 'undefined') {
      return redis[prop];
    }
    return target[prop];
  }
});

module.exports.isMock = function() { return useMock; };
