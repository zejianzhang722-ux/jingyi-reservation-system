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

const valueOf = function(row, lowerName, upperName) {
  if (!row) return undefined;
  if (row[lowerName] !== undefined) return row[lowerName];
  return row[upperName];
};

const checkReservationSchema = async function() {
  if (db.isMock()) {
    return { mode: 'mock', ready: true, missing: [], invalid: [] };
  }

  const [databaseRows] = await db.query('SELECT DATABASE() AS database_name');
  const databaseName = valueOf(databaseRows[0], 'database_name', 'DATABASE_NAME');
  if (!databaseName) throw readinessError('无法确认当前MySQL数据库');

  const [columnRows] = await db.query(
    "SELECT column_name AS reservation_column FROM information_schema.columns " +
    "WHERE table_schema = ? AND table_name = 'reservations' AND column_name IN (?, ?)",
    [databaseName].concat(requiredReservationColumns)
  );
  const presentColumns = columnRows.map(function(row) {
    return valueOf(row, 'reservation_column', 'RESERVATION_COLUMN');
  });

  const [tableRows] = await db.query(
    "SELECT table_name AS reservation_table FROM information_schema.tables " +
    "WHERE table_schema = ? AND table_name = 'reservation_slots'",
    [databaseName]
  );

  const indexNames = Object.keys(requiredIndexDefinitions);
  const [indexRows] = await db.query(
    "SELECT table_name AS indexed_table, index_name AS reservation_index, non_unique AS is_non_unique, " +
    "GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS indexed_columns " +
    "FROM information_schema.statistics WHERE table_schema = ? AND index_name IN (?, ?) " +
    "GROUP BY table_name, index_name, non_unique",
    [databaseName].concat(indexNames)
  );
  const indexMap = {};
  indexRows.forEach(function(row) {
    const indexName = valueOf(row, 'reservation_index', 'RESERVATION_INDEX');
    indexMap[indexName] = {
      table: valueOf(row, 'indexed_table', 'INDEXED_TABLE'),
      columns: valueOf(row, 'indexed_columns', 'INDEXED_COLUMNS'),
      nonUnique: valueOf(row, 'is_non_unique', 'IS_NON_UNIQUE')
    };
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
    if (actual.table !== expected.table) {
      invalid.push('index:' + indexName + ':table=' + actual.table);
    }
    if (actual.columns !== expected.columns) {
      invalid.push('index:' + indexName + ':columns=' + actual.columns);
    }
    if (expected.unique && Number(actual.nonUnique) !== 0) {
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
