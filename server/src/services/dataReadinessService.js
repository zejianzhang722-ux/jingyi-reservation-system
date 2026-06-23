const db = require('../config/database');
const redis = require('../config/redis');

const requiredReservationColumns = ['idempotency_key', 'request_hash'];
const requiredIndexDefinitions = {
  uk_reservation_user_idempotency: {
    table: 'reservations',
    columns: 'user_id,idempotency_key',
    unique: true
  },
  uk_room_seat_date_minute: {
    table: 'reservation_slots',
    columns: 'room_id,seat_scope,date,slot_minute',
    unique: true
  }
};

const readinessError = function(message, details) {
  const err = new Error(message);
  err.code = 'DATA_READINESS_FAILED';
  err.httpStatus = 503;
  err.details = details || null;
  return err;
};

const checkReservationSchema = async function() {
  if (db.isMock()) {
    return { mode: 'mock', ready: true, missing: [], invalid: [] };
  }

  const [databaseRows] = await db.query('SELECT DATABASE() AS database_name');
  const databaseName = databaseRows[0] && databaseRows[0].database_name;
  if (!databaseName) throw readinessError('无法确认当前MySQL数据库');

  const [columnRows] = await db.query(
    "SELECT column_name FROM information_schema.columns " +
    "WHERE table_schema = ? AND table_name = 'reservations' AND column_name IN (?, ?)",
    [databaseName].concat(requiredReservationColumns)
  );
  const presentColumns = columnRows.map(function(row) { return row.column_name; });

  const [tableRows] = await db.query(
    "SELECT table_name FROM information_schema.tables " +
    "WHERE table_schema = ? AND table_name = 'reservation_slots'",
    [databaseName]
  );

  const indexNames = Object.keys(requiredIndexDefinitions);
  const [indexRows] = await db.query(
    "SELECT table_name, index_name, non_unique, " +
    "GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS index_columns " +
    "FROM information_schema.statistics WHERE table_schema = ? AND index_name IN (?, ?) " +
    "GROUP BY table_name, index_name, non_unique",
    [databaseName].concat(indexNames)
  );
  const indexMap = {};
  indexRows.forEach(function(row) {
    indexMap[row.index_name] = row;
  });

  const missing = [];
  const invalid = [];
  requiredReservationColumns.forEach(function(column) {
    if (!presentColumns.includes(column)) missing.push('reservations.' + column);
  });
  if (!tableRows.length) missing.push('table:reservation_slots');

  indexNames.forEach(function(indexName) {
    const expected = requiredIndexDefinitions[indexName];
    const actual = indexMap[indexName];
    if (!actual) {
      missing.push('index:' + indexName);
      return;
    }
    if (actual.table_name !== expected.table) {
      invalid.push('index:' + indexName + ':table=' + actual.table_name);
    }
    if (actual.index_columns !== expected.columns) {
      invalid.push('index:' + indexName + ':columns=' + actual.index_columns);
    }
    if (expected.unique && Number(actual.non_unique) !== 0) {
      invalid.push('index:' + indexName + ':not_unique');
    }
  });

  return {
    mode: 'mysql',
    database: databaseName,
    ready: missing.length === 0 && invalid.length === 0,
    missing,
    invalid
  };
};

const checkDataReadiness = async function() {
  const dbState = await db.ready();
  const redisState = await redis.ready();
  const schemaState = await checkReservationSchema();

  if (process.env.NODE_ENV === 'production') {
    if (dbState.mode !== 'mysql') {
      throw readinessError('生产环境必须连接真实MySQL数据库', { dbState });
    }
    if (redisState.mode !== 'redis') {
      throw readinessError('生产环境必须连接真实Redis服务', { redisState });
    }
    if (!schemaState.ready) {
      throw readinessError('预约一致性数据库迁移尚未完成', schemaState);
    }
  }

  return {
    ready: schemaState.ready,
    database: dbState,
    redis: redisState,
    schema: schemaState
  };
};

module.exports = {
  requiredReservationColumns,
  requiredIndexDefinitions,
  checkReservationSchema,
  checkDataReadiness,
  readinessError
};
