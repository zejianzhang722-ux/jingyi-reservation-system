const db = require('../config/database');
const fs = require('fs');
const path = require('path');
const policy = require('./verificationPolicy');
const file = path.join(process.env.MOCK_DATA_DIR || path.join(__dirname, '../../data'), 'mock-verification-state.json');
let state;
let queue = Promise.resolve();
function applySnapshots(data) {
  const tables = require('../config/mock-db').__tables;
  for (const item of data.checkins || []) {
    const reservation = tables.reservations.find(r => Number(r.id) === item.reservation_id);
    if (!reservation || Number(reservation.user_id) !== item.user_id || Number(reservation.room_id) !== item.room_id || String(reservation.date).slice(0, 10) !== item.reservation_date || !['approved', 'checked_in'].includes(reservation.status)) continue;
    if (!tables.checkins.some(c => Number(c.reservation_id) === item.reservation_id)) tables.checkins.push({ ...item, id: Math.max(0, ...tables.checkins.map(c => Number(c.id))) + 1 });
    reservation.status = 'checked_in';
  }
}
function mockState() {
  if (!state) {
    state = { events: [], successes: [], checkins: [] };
    if (fs.existsSync(file)) {
      try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { state = null; throw policy.error('核验记录文件损坏，请联系管理员恢复', 503, 'STORE_UNAVAILABLE'); }
      if (!Array.isArray(state.events) || !Array.isArray(state.successes)) { state = null; throw policy.error('核验记录文件格式异常', 503, 'STORE_UNAVAILABLE'); }
    }
  }
  applySnapshots(state);
  return state;
}
async function atomic(work, attempt = 0) {
  if (process.env.NODE_ENV === 'production' && db.isMock()) throw policy.error('签到数据库不可用', 503, 'STORE_UNAVAILABLE');
  if (db.isMock()) {
    const run = queue.then(async () => {
      const original = mockState();
      const draft = JSON.parse(JSON.stringify(original));
      const runner = { mock: draft, query: db.query, claimedReservations: [] };
      try {
        const result = await work(runner);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(draft), 'utf8');
        fs.renameSync(file + '.tmp', file);
        state = draft;
        applySnapshots(state);
        return result;
      } catch (err) {
        for (const reservation of runner.claimedReservations) {
          if (reservation.status === 'checked_in') reservation.status = 'approved';
        }
        throw err;
      }
    });
    queue = run.catch(() => {});
    return run;
  }
  const connection = await db.getConnection();
  let released = false;
  if (!connection || typeof connection.beginTransaction !== 'function') throw policy.error('核验事务服务不可用', 503, 'STORE_UNAVAILABLE');
  try {
    await connection.beginTransaction();
    const result = await work({ query: (sql, params) => connection.execute(sql, params) });
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY' && attempt < 1) { connection.release(); released = true; return atomic(work, attempt + 1); }
    if (err.code === 'ER_NO_SUCH_TABLE') throw policy.error('核验数据库迁移尚未完成', 503, 'SCHEMA_NOT_READY');
    throw err;
  } finally { if (!released) connection.release(); }
}
async function findRequest(runner, adminId, requestId) {
  if (runner.mock) return runner.mock.events.find(e => e.admin_id === adminId && e.request_id === requestId);
  const [rows] = await runner.query('SELECT * FROM verification_events WHERE admin_id = ? AND request_id = ?', [adminId, requestId]);
  return rows[0];
}
async function findSuccess(runner, reservationId) {
  if (runner.mock) {
    const current = require('../config/mock-db').__tables.reservations.find(r => Number(r.id) === reservationId);
    const snapshot = (runner.mock.checkins || []).find(c => c.reservation_id === reservationId && current && c.user_id === Number(current.user_id) && c.room_id === Number(current.room_id) && c.reservation_date === String(current.date).slice(0, 10));
    return snapshot ? runner.mock.successes.find(e => e.reservation_id === reservationId) : null;
  }
  const [rows] = await runner.query('SELECT * FROM reservation_verifications WHERE reservation_id = ? FOR UPDATE', [reservationId]);
  return rows[0];
}
async function applyCheckin(runner, reservation, geoColumns) {
  const window = require('./checkinWindowPolicy').windowStatus(reservation);
  if (!window.eligible) throw policy.error(window.reason, 400, 'OUTSIDE_WINDOW');
  const [existing] = await runner.query('SELECT id FROM checkins WHERE reservation_id = ?', [reservation.id]);
  if (existing.length) throw policy.error('已经办理签到，请勿重复签到', 409, 'ALREADY_CHECKED_IN');
  if (runner.mock) {
    const current = require('../config/mock-db').__tables.reservations.find(r => Number(r.id) === Number(reservation.id));
    if (!current || current.status !== 'approved') throw policy.error('预约状态已变化，请刷新后重试', 409, 'STATUS_CHANGED');
    runner.claimedReservations.push(current);
    current.status = 'checked_in';
    runner.mock.checkins = runner.mock.checkins || [];
    runner.mock.checkins.push({ reservation_id: Number(reservation.id), user_id: Number(reservation.user_id), room_id: Number(reservation.room_id), reservation_date: String(reservation.date).slice(0, 10), checkin_time: new Date().toISOString(), created_at: new Date().toISOString(), checkout_time: null, checkin_type: 'qrcode', ...geoColumns });
    return;
  }
  const [updated] = await runner.query("UPDATE reservations SET status = 'checked_in', updated_at = NOW() WHERE id = ? AND status = 'approved'", [reservation.id]);
  if (updated.affectedRows !== 1) throw policy.error('预约状态已变化，请刷新后重试', 409, 'STATUS_CHANGED');
  await runner.query('INSERT INTO checkins (reservation_id, user_id, room_id, checkin_time, checkin_type, geo_mode, geo_verified, checkin_lat, checkin_lng, geo_distance_m, created_at) VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, NOW())', [reservation.id, reservation.user_id, reservation.room_id, 'qrcode', geoColumns.geo_mode, geoColumns.geo_verified, geoColumns.checkin_lat, geoColumns.checkin_lng, geoColumns.geo_distance_m]);
}
async function readSuccess(reservationId) {
  if (db.isMock()) return findSuccess({ mock: mockState() }, reservationId);
  const [rows] = await db.query('SELECT * FROM reservation_verifications WHERE reservation_id = ?', [reservationId]);
  return rows[0];
}
async function addEvent(runner, data) {
  if (runner.mock) {
    const row = { ...data, id: runner.mock.events.reduce((max, e) => Math.max(max, e.id), 0) + 1, created_at: new Date().toISOString(), resolved_by: null, resolved_at: null, resolution: null };
    runner.mock.events.push(row);
    return row;
  }
  const keys = ['admin_id', 'request_id', 'building_id', 'reservation_id', 'outcome', 'reason_code', 'note', 'result_json'];
  const [result] = await runner.query('INSERT INTO verification_events (' + keys.join(', ') + ') VALUES (?, ?, ?, ?, ?, ?, ?, ?)', keys.map(k => data[k]));
  const [rows] = await runner.query('SELECT * FROM verification_events WHERE id = ?', [result.insertId]);
  return rows[0];
}
async function addSuccess(runner, reservationId, eventId) {
  if (runner.mock) { runner.mock.successes = runner.mock.successes.filter(e => e.reservation_id !== reservationId); runner.mock.successes.push({ reservation_id: reservationId, event_id: eventId, verified_at: new Date().toISOString() }); return; }
  await runner.query('INSERT INTO reservation_verifications (reservation_id, event_id) VALUES (?, ?)', [reservationId, eventId]);
}
async function list(scope, filters) {
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(filters.pageSize, 10) || 20));
  let clauses = [], params = [];
  if (!scope.isGlobal) { clauses.push('building_id = ?'); params.push(scope.buildingId); }
  if (filters.outcome) { clauses.push('outcome = ?'); params.push(filters.outcome); }
  if (filters.reservationId) { clauses.push('reservation_id = ?'); params.push(Number(filters.reservationId)); }
  if (filters.from) { clauses.push('created_at >= ?'); params.push(filters.from + ' 00:00:00'); }
  if (filters.to) { clauses.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(filters.to); }
  if (db.isMock()) {
    const rows = mockState().events.filter(e => (scope.isGlobal || e.building_id === scope.buildingId) && (!filters.outcome || e.outcome === filters.outcome) && (!filters.reservationId || e.reservation_id === Number(filters.reservationId)) && (!filters.from || e.created_at.slice(0, 10) >= filters.from) && (!filters.to || e.created_at.slice(0, 10) <= filters.to)).slice().reverse();
    return { list: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
  }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  try {
    const [counts] = await db.query('SELECT COUNT(*) AS total FROM verification_events' + where, params);
    const [rows] = await db.query('SELECT * FROM verification_events' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?', params.concat([pageSize, (page - 1) * pageSize]));
    return { list: rows, total: counts[0].total, page, pageSize };
  } catch (err) { if (err.code === 'ER_NO_SUCH_TABLE') throw policy.error('核验数据库迁移尚未完成', 503, 'SCHEMA_NOT_READY'); throw err; }
}
async function resolve(runner, id, scope, note) {
  let row;
  if (runner.mock) row = runner.mock.events.find(e => e.id === id);
  else { const [rows] = await runner.query('SELECT * FROM verification_events WHERE id = ? FOR UPDATE', [id]); row = rows[0]; }
  if (!row) throw policy.error('核验记录不存在', 404, 'NOT_FOUND');
  policy.assertScope(scope, row.building_id);
  if (!['exception', 'rejected'].includes(row.outcome)) throw policy.error('该记录无需处理', 409, 'NOT_EXCEPTION');
  if (row.resolved_by) return { ...row, repeated: true };
  if (runner.mock) Object.assign(row, { resolved_by: scope.adminId, resolved_at: new Date().toISOString(), resolution: note });
  else await runner.query('UPDATE verification_events SET resolved_by = ?, resolved_at = NOW(), resolution = ? WHERE id = ? AND resolved_by IS NULL', [scope.adminId, note, id]);
  return { id, resolved: true };
}
module.exports = { atomic, findRequest, findSuccess, readSuccess, addEvent, addSuccess, applyCheckin, list, resolve };
