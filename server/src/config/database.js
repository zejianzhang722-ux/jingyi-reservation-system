const config = require('./index');
const logger = require('./logger');
const metricsService = require('../services/metricsService');

let pool = null;
let useMock = false;
let initializationError = null;
const isProduction = process.env.NODE_ENV === 'production';
const allowMock = !isProduction && process.env.ALLOW_MOCK_DB !== 'false';
const slowQueryMs = Math.max(10, Number(process.env.DB_SLOW_QUERY_MS || 250));

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_CON_COUNT_ERROR',
  'ER_SERVER_SHUTDOWN'
]);

const isConnectionFailure = function(err) {
  if (!err) return false;
  if (CONNECTION_ERROR_CODES.has(err.code)) return true;
  const fatal = err.fatal === true;
  const syscall = String(err.syscall || '').toLowerCase();
  return fatal && ['connect', 'read', 'write'].includes(syscall);
};

const sqlOperation = function(sql) {
  const match = String(sql || '').trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : 'OTHER';
};

const sqlFingerprint = function(sql) {
  return String(sql || '')
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/"(?:""|[^"])*"/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
};

const recordQuery = function(sql, started, err) {
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const slow = durationMs >= slowQueryMs;
  metricsService.recordDatabaseQuery(sqlOperation(sql), durationMs, { error: !!err, slow });
  if (slow) {
    logger.warn('database_slow_query', {
      operation: sqlOperation(sql),
      fingerprint: sqlFingerprint(sql),
      durationMs: Math.round(durationMs * 100) / 100,
      thresholdMs: slowQueryMs,
      failed: !!err,
      errorCode: err && err.code
    });
  }
  return durationMs;
};

const switchToMock = function(err, context) {
  initializationError = err || initializationError;
  if (!allowMock) {
    const failure = new Error('MySQL不可用，生产环境禁止回退到模拟数据库');
    failure.code = 'DATABASE_UNAVAILABLE';
    failure.cause = err;
    throw failure;
  }
  if (!useMock) {
    console.warn('[数据库] ' + context + '，仅在非生产环境切换到模拟数据:', err ? err.message : '未知错误');
  }
  useMock = true;
  pool = null;
};

try {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool(config.mysql);
} catch (err) {
  switchToMock(err, 'mysql2模块不可用');
}

const ready = async function() {
  if (useMock) return { mode: 'mock' };
  if (!pool) {
    switchToMock(initializationError || new Error('连接池未初始化'), 'MySQL连接池未初始化');
    return { mode: 'mock' };
  }

  let connection = null;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    return { mode: 'mysql' };
  } catch (err) {
    switchToMock(err, 'MySQL连接失败');
    return { mode: 'mock' };
  } finally {
    if (connection && typeof connection.release === 'function') connection.release();
  }
};

const query = async function(sql, params) {
  if (useMock) {
    return require('./mock-db').query(sql, params);
  }
  if (!pool) {
    await ready();
    if (useMock) return require('./mock-db').query(sql, params);
  }

  const started = process.hrtime.bigint();
  try {
    const result = await pool.execute(sql, params);
    recordQuery(sql, started, null);
    return result;
  } catch (err) {
    recordQuery(sql, started, err);
    // 约束、语法和业务 SQL 错误必须原样返回，不能静默切换到另一套数据源。
    if (!isConnectionFailure(err)) throw err;
    if (isProduction || !allowMock) {
      err.code = err.code || 'DATABASE_QUERY_FAILED';
      throw err;
    }
    switchToMock(err, 'MySQL连接在查询期间中断');
    return require('./mock-db').query(sql, params);
  }
};

const getConnection = async function() {
  if (useMock) {
    return {
      isMock: true,
      release: function() {}
    };
  }
  if (!pool) {
    await ready();
    if (useMock) return { isMock: true, release: function() {} };
  }

  try {
    return await pool.getConnection();
  } catch (err) {
    if (isProduction || !allowMock || !isConnectionFailure(err)) {
      err.code = err.code || 'DATABASE_CONNECTION_FAILED';
      throw err;
    }
    switchToMock(err, '获取MySQL连接失败');
    return { isMock: true, release: function() {} };
  }
};

const poolState = function() {
  if (!pool || useMock || !pool.pool) return { mode: useMock ? 'mock' : 'unavailable' };
  const raw = pool.pool;
  return {
    mode: 'mysql',
    connectionLimit: Number(config.mysql.connectionLimit || 0),
    allConnections: raw._allConnections ? raw._allConnections.length : null,
    freeConnections: raw._freeConnections ? raw._freeConnections.length : null,
    queuedRequests: raw._connectionQueue ? raw._connectionQueue.length : null
  };
};

const assertTransactional = function(connection) {
  if (!connection || connection.isMock || typeof connection.beginTransaction !== 'function' || typeof connection.execute !== 'function') {
    const err = new Error('当前数据库模式不支持事务操作');
    err.code = 'TRANSACTION_UNAVAILABLE';
    err.httpStatus = 503;
    throw err;
  }
};

const close = async function() {
  const currentPool = pool;
  pool = null;
  if (!currentPool || typeof currentPool.end !== 'function') return { closed: true, mode: useMock ? 'mock' : 'none' };
  await currentPool.end();
  return { closed: true, mode: 'mysql' };
};

module.exports = {
  query,
  getConnection,
  ready,
  close,
  poolState,
  assertTransactional,
  isConnectionFailure,
  sqlOperation,
  sqlFingerprint,
  recordQuery,
  slowQueryMs,
  isMock: function() { return useMock; },
  isProduction,
  allowMock
};
