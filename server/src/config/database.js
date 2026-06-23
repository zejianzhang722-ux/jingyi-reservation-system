const config = require('./index');

let pool = null;
let useMock = false;
let initializationError = null;
const isProduction = process.env.NODE_ENV === 'production';
const allowMock = !isProduction && process.env.ALLOW_MOCK_DB !== 'false';

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

  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return { mode: 'mysql' };
  } catch (err) {
    switchToMock(err, 'MySQL连接失败');
    return { mode: 'mock' };
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

  try {
    return await pool.execute(sql, params);
  } catch (err) {
    if (isProduction || !allowMock) {
      err.code = err.code || 'DATABASE_QUERY_FAILED';
      throw err;
    }
    switchToMock(err, 'MySQL查询失败');
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
    if (isProduction || !allowMock) {
      err.code = err.code || 'DATABASE_CONNECTION_FAILED';
      throw err;
    }
    switchToMock(err, '获取MySQL连接失败');
    return { isMock: true, release: function() {} };
  }
};

const assertTransactional = function(connection) {
  if (!connection || connection.isMock || typeof connection.beginTransaction !== 'function' || typeof connection.execute !== 'function') {
    const err = new Error('当前数据库模式不支持事务操作');
    err.code = 'TRANSACTION_UNAVAILABLE';
    err.httpStatus = 503;
    throw err;
  }
};

module.exports = {
  query,
  getConnection,
  ready,
  assertTransactional,
  isMock: function() { return useMock; },
  isProduction,
  allowMock
};
