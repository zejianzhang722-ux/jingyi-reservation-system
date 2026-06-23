const config = require('./index');
const runtimeMode = require('./runtimeMode');
const state = require('./databaseMode');

let pool = null;
let initPromise = null;

function serviceError(message, cause) {
  const err = new Error(message);
  err.code = 'DATABASE_UNAVAILABLE';
  err.httpStatus = 503;
  if (cause) err.cause = cause;
  return err;
}

async function initialize() {
  if (state.get() === 'mysql' || state.get() === 'mock') return state.get();
  if (state.get() === 'failed') throw serviceError('数据库服务不可用');
  if (initPromise) return initPromise;

  initPromise = (async function() {
    try {
      const mysql = require('mysql2/promise');
      pool = mysql.createPool(config.mysql);
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      state.set('mysql');
      return 'mysql';
    } catch (err) {
      pool = null;
      if (runtimeMode.mockAllowed) {
        state.set('mock');
        console.warn('[数据库] 使用显式Mock模式:', err.message);
        return 'mock';
      }
      state.set('failed');
      throw serviceError('MySQL连接失败，当前环境禁止Mock回退', err);
    }
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

async function query(sql, params) {
  await initialize();
  if (state.get() === 'mock') return require('./mock-db').query(sql, params);
  try {
    return await pool.execute(sql, params);
  } catch (err) {
    throw serviceError('数据库查询失败', err);
  }
}

async function getConnection() {
  await initialize();
  if (state.get() === 'mock') return require('./mock-connection').create();
  try {
    return await pool.getConnection();
  } catch (err) {
    throw serviceError('无法获取数据库事务连接', err);
  }
}

async function close() {
  if (pool && typeof pool.end === 'function') await pool.end();
  pool = null;
  state.set('uninitialized');
}

module.exports = {
  initialize,
  query,
  getConnection,
  close,
  isMock: function() { return state.get() === 'mock'; },
  isReady: function() { return state.get() === 'mysql' || state.get() === 'mock'; },
  getMode: state.get,
  serviceError
};
