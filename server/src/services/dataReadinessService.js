const db = require('../config/database');
const redis = require('../config/redis');

const requiredReservationColumns = ['idempotency_key', 'request_hash'];
const requiredWaitlistColumns = ['waiting_seat_scope'];
const requiredNotificationColumns = ['dedupe_key'];
const requiredOutboxColumns = [
  'id', 'event_key', 'notification_id', 'user_id', 'channel', 'event_name', 'payload',
  'status', 'attempts', 'max_attempts', 'available_at', 'locked_at', 'locked_by',
  'last_error', 'sent_at', 'created_at', 'updated_at'
];
const requiredTables = ['reservation_slots', 'reservation_waitlist', 'notification_outbox'];
const requiredForeignKeys = [
  'fk_notification_outbox_notification',
  'fk_notification_outbox_user'
];
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
  },
  uk_waitlist_user_slot: {
    table: 'reservation_waitlist',
    columns: 'user_id,room_id,waiting_seat_scope,date,start_time,end_time',
    unique: true
  },
  uk_notification_user_dedupe: {
    table: 'notifications',
    columns: 'user_id,dedupe_key',
    unique: true
  },
  uk_notification_outbox_event: {
    table: 'notification_outbox',
    columns: 'event_key',
    unique: true
  },
  idx_notification_outbox_claim: {
    table: 'notification_outbox',
    columns: 'status,available_at,id',
    unique: false
  },
  idx_notification_outbox_notification: {
    table: 'notification_outbox',
    columns: 'notification_id',
    unique: false
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

const placeholders = function(items) {
  return items.map(function() { return '?'; }).join(',');
};

const readColumns = async function(databaseName, table, columns, extraFields) {
  const select = ['column_name AS schema_column'].concat(extraFields || []).join(', ');
  const [rows] = await db.query(
    'SELECT ' + select + ' FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name IN (' + placeholders(columns) + ')',
    [databaseName, table].concat(columns)
  );
  return rows;
};

const checkReservationSchema = async function() {
  if (db.isMock()) return { mode: 'mock', ready: true, missing: [], invalid: [] };

  const [databaseRows] = await db.query('SELECT DATABASE() AS database_name');
  const databaseName = valueOf(databaseRows[0], 'database_name', 'DATABASE_NAME');
  if (!databaseName) throw readinessError('无法确认当前MySQL数据库');

  const reservationColumnRows = await readColumns(databaseName, 'reservations', requiredReservationColumns);
  const waitlistColumnRows = await readColumns(databaseName, 'reservation_waitlist', requiredWaitlistColumns, [
    'extra AS column_extra',
    'generation_expression AS generated_expression'
  ]);
  const notificationColumnRows = await readColumns(databaseName, 'notifications', requiredNotificationColumns);
  const outboxColumnRows = await readColumns(databaseName, 'notification_outbox', requiredOutboxColumns, [
    'is_nullable AS column_nullable',
    'data_type AS column_data_type',
    'column_type AS full_column_type'
  ]);

  const presentReservationColumns = reservationColumnRows.map(function(row) {
    return valueOf(row, 'schema_column', 'SCHEMA_COLUMN');
  });
  const presentWaitlistColumns = waitlistColumnRows.map(function(row) {
    return valueOf(row, 'schema_column', 'SCHEMA_COLUMN');
  });
  const presentNotificationColumns = notificationColumnRows.map(function(row) {
    return valueOf(row, 'schema_column', 'SCHEMA_COLUMN');
  });
  const presentOutboxColumns = outboxColumnRows.map(function(row) {
    return valueOf(row, 'schema_column', 'SCHEMA_COLUMN');
  });

  const [tableRows] = await db.query(
    'SELECT table_name AS reservation_table FROM information_schema.tables WHERE table_schema = ? AND table_name IN (' + placeholders(requiredTables) + ')',
    [databaseName].concat(requiredTables)
  );
  const presentTables = tableRows.map(function(row) {
    return valueOf(row, 'reservation_table', 'RESERVATION_TABLE');
  });

  const indexNames = Object.keys(requiredIndexDefinitions);
  const [indexRows] = await db.query(
    "SELECT table_name AS indexed_table, index_name AS reservation_index, non_unique AS is_non_unique, " +
    "GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS indexed_columns " +
    'FROM information_schema.statistics WHERE table_schema = ? AND index_name IN (' +
    placeholders(indexNames) + ') GROUP BY table_name, index_name, non_unique',
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

  const [foreignKeyRows] = await db.query(
    "SELECT constraint_name AS foreign_key_name FROM information_schema.table_constraints " +
    "WHERE constraint_schema = ? AND table_name = 'notification_outbox' AND constraint_type = 'FOREIGN KEY'",
    [databaseName]
  );
  const presentForeignKeys = foreignKeyRows.map(function(row) {
    return valueOf(row, 'foreign_key_name', 'FOREIGN_KEY_NAME');
  });

  const missing = [];
  const invalid = [];
  requiredReservationColumns.forEach(function(column) {
    if (!presentReservationColumns.includes(column)) missing.push('reservations.' + column);
  });
  requiredWaitlistColumns.forEach(function(column) {
    if (!presentWaitlistColumns.includes(column)) missing.push('reservation_waitlist.' + column);
  });
  requiredNotificationColumns.forEach(function(column) {
    if (!presentNotificationColumns.includes(column)) missing.push('notifications.' + column);
  });
  requiredOutboxColumns.forEach(function(column) {
    if (!presentOutboxColumns.includes(column)) missing.push('notification_outbox.' + column);
  });
  requiredTables.forEach(function(table) {
    if (!presentTables.includes(table)) missing.push('table:' + table);
  });
  requiredForeignKeys.forEach(function(constraint) {
    if (!presentForeignKeys.includes(constraint)) missing.push('foreign-key:' + constraint);
  });

  const waitlistGeneratedColumn = waitlistColumnRows.find(function(row) {
    return valueOf(row, 'schema_column', 'SCHEMA_COLUMN') === 'waiting_seat_scope';
  });
  if (waitlistGeneratedColumn) {
    const extra = String(valueOf(waitlistGeneratedColumn, 'column_extra', 'COLUMN_EXTRA') || '').toUpperCase();
    const expression = String(valueOf(waitlistGeneratedColumn, 'generated_expression', 'GENERATED_EXPRESSION') || '').toLowerCase();
    if (!extra.includes('STORED GENERATED')) invalid.push('reservation_waitlist.waiting_seat_scope:not_stored_generated');
    if (!expression.includes('status') || !expression.includes('waiting') || !expression.includes('seat_id')) {
      invalid.push('reservation_waitlist.waiting_seat_scope:unexpected_expression');
    }
  }

  const outboxMap = {};
  outboxColumnRows.forEach(function(row) {
    outboxMap[valueOf(row, 'schema_column', 'SCHEMA_COLUMN')] = row;
  });
  ['event_key', 'channel', 'payload', 'status', 'attempts', 'max_attempts', 'available_at'].forEach(function(column) {
    const row = outboxMap[column];
    if (row && String(valueOf(row, 'column_nullable', 'COLUMN_NULLABLE')).toUpperCase() !== 'NO') {
      invalid.push('notification_outbox.' + column + ':nullable');
    }
  });
  if (outboxMap.payload && String(valueOf(outboxMap.payload, 'column_data_type', 'COLUMN_DATA_TYPE')).toLowerCase() !== 'json') {
    invalid.push('notification_outbox.payload:not_json');
  }
  if (outboxMap.channel) {
    const type = String(valueOf(outboxMap.channel, 'full_column_type', 'FULL_COLUMN_TYPE') || '').toLowerCase();
    if (!type.includes('websocket') || !type.includes('wechat')) invalid.push('notification_outbox.channel:unexpected_enum');
  }
  if (outboxMap.status) {
    const type = String(valueOf(outboxMap.status, 'full_column_type', 'FULL_COLUMN_TYPE') || '').toLowerCase();
    ['pending', 'processing', 'sent', 'failed', 'dead'].forEach(function(status) {
      if (!type.includes(status)) invalid.push('notification_outbox.status:missing_' + status);
    });
  }

  indexNames.forEach(function(indexName) {
    const expected = requiredIndexDefinitions[indexName];
    const actual = indexMap[indexName];
    if (!actual) {
      missing.push('index:' + indexName);
      return;
    }
    if (actual.table !== expected.table) invalid.push('index:' + indexName + ':table=' + actual.table);
    if (actual.columns !== expected.columns) invalid.push('index:' + indexName + ':columns=' + actual.columns);
    if (expected.unique && Number(actual.nonUnique) !== 0) invalid.push('index:' + indexName + ':not_unique');
    if (!expected.unique && Number(actual.nonUnique) !== 1) invalid.push('index:' + indexName + ':unexpected_unique');
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
    if (dbState.mode !== 'mysql') throw readinessError('生产环境必须连接真实MySQL数据库', { dbState });
    if (redisState.mode !== 'redis') throw readinessError('生产环境必须连接真实Redis服务', { redisState });
    if (!schemaState.ready) throw readinessError('数据库一致性迁移尚未完成', schemaState);
  }

  return { ready: schemaState.ready, database: dbState, redis: redisState, schema: schemaState };
};

module.exports = {
  requiredReservationColumns,
  requiredWaitlistColumns,
  requiredNotificationColumns,
  requiredOutboxColumns,
  requiredTables,
  requiredForeignKeys,
  requiredIndexDefinitions,
  checkReservationSchema,
  checkDataReadiness,
  readinessError
};
