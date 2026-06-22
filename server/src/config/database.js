const config = require('./index');

let pool;
let useMock = false;

try {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool(config.mysql);

  pool.getConnection()
    .then(function(connection) {
      connection.release();
      useMock = false;
      console.log('[数据库] MySQL连接成功');
    })
    .catch(function(err) {
      console.warn('[数据库] MySQL连接失败，切换到模拟数据模式:', err.message);
      useMock = true;
      pool = null;
    });
} catch (e) {
  console.warn('[数据库] mysql2模块不可用，切换到模拟数据模式');
  useMock = true;
  pool = null;
}

var query = function(sql, params) {
  if (useMock) {
    return require('./mock-db').query(sql, params);
  }
  return pool.execute(sql, params).catch(function(err) {
    console.warn('[数据库] MySQL查询失败，回退到模拟数据:', err.message);
    useMock = true;
    pool = null;
    return require('./mock-db').query(sql, params);
  });
};

var getConnection = function() {
  if (useMock) {
    return Promise.resolve({ release: function() {} });
  }
  return pool.getConnection().catch(function(err) {
    useMock = true;
    pool = null;
    return { release: function() {} };
  });
};

module.exports = {
  query: query,
  getConnection: getConnection,
  isMock: function() { return useMock; }
};
