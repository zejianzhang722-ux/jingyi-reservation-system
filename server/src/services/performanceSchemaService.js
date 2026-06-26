const db = require('../config/database');

const REQUIRED_INDEXES = {
  rooms: ['idx_rooms_status_type_building'],
  seats: ['idx_seats_room_status_order'],
  reservations: [
    'idx_reservation_status_created',
    'idx_reservation_user_status_schedule',
    'idx_reservation_room_schedule_status'
  ],
  checkins: ['idx_checkins_room_time'],
  notifications: ['idx_notifications_user_read_created'],
  reservation_waitlist: ['idx_waitlist_status_created']
};

const check = async function() {
  if (db.isMock()) return { mode: 'mock', ready: true, missing: [] };
  const [databaseRows] = await db.query('SELECT DATABASE() AS database_name');
  const database = databaseRows[0].database_name || databaseRows[0].DATABASE_NAME;
  const missing = [];
  for (const table of Object.keys(REQUIRED_INDEXES)) {
    const [rows] = await db.query(
      'SELECT DISTINCT index_name FROM information_schema.statistics WHERE table_schema=? AND table_name=?',
      [database, table]
    );
    const indexes = rows.map(function(row) { return row.index_name || row.INDEX_NAME; });
    REQUIRED_INDEXES[table].forEach(function(index) {
      if (!indexes.includes(index)) missing.push(table + '.' + index);
    });
  }
  return { mode: 'mysql', database, ready: missing.length === 0, missing };
};

const assertReady = async function() {
  const state = await check();
  if (!state.ready) {
    const err = new Error('性能索引迁移尚未完成');
    err.code = 'PERFORMANCE_SCHEMA_NOT_READY';
    err.httpStatus = 503;
    err.details = state;
    throw err;
  }
  return state;
};

module.exports = { REQUIRED_INDEXES, check, assertReady };
