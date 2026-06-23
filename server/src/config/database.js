const config = require('./index');
const runtimeMode = require('./runtimeMode');

let pool = null;
let mode = 'uninitialized';
let initializePromise = null;

function serviceError(message, cause) {
  const err = new Error(message);
  err.code = 'DATABASE_UNAVAILABLE';
  err.httpStatus = 503;
  if (cause) err.cause = cause;
  return err;
}

async function initialize() {
  if (mode === 'mysql' || mode === 'mock') return mode;
  if (mode === 'failed') throw serviceError('数据库服务不可用');
  if (initializePromise) return initializePromise;

  initializePromise = (async function() {
    try {
      const mysql = require('mysql2/promise');
      pool = mysql.createPool(Object.assign({}, config.mysql, {
        connectTimeout: Math.max(1000, Number(process.env.MYSQL_CONNECT_TIMEOUT_MS) || 5000)
      }));
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      mode = 'mysql';
      console.log('[数据库] MySQL连接成功');
      return mode;
    } catch (err) {
      if (pool && typeof pool.end === 'function') {
        try { await pool.end(); } catch (closeErr) {}
      }
      pool = null;
      if (runtimeMode.mockAllowed) {
        mode = 'mock';
        console.warn('[数据库] MySQL不可用，进入显式Mock模式:', err.message);
        return mode;
      }
      mode = 'failed';
      throw serviceError('MySQL连接失败，当前环境禁止Mock回退', err);
    }
  })();

  try {
    return await initializePromise;
  } finally {
    initializePromise = null;
  }
}

async function query(sql, params) {
  await initialize();
  if (mode === 'mock') return require('./mock-db').query(sql, params);
  try {
    return await pool.execute(sql, params);
  } catch (err) {
    throw serviceError('数据库查询失败', err);
  }
}

async function getConnection() {
  await initialize();
  if (mode === 'mock') return require('./mock-connection').create();
  try {
    return await pool.getConnection();
  } catch (err) {
    throw serviceError('无法获取数据库事务连接', err);
  }
}

async function close() {
  if (pool && typeof pool.end === 'function') await pool.end();
  pool = null;
  mode = 'uninitialized';
}

module.exports = {
  initialize,
  query,
  getConnection,
  close,
  isMock: function() { return mode === 'mock'; },
  isReady: function() { return mode === 'mysql' || mode === 'mock'; },
  getMode: function() { return mode; },
  serviceError
};
