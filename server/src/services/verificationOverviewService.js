const db = require('../config/database');
const helpers = require('../utils/helpers');
const policy = require('./verificationPolicy');
const statuses = ['pending', 'pending_counselor', 'approved', 'checked_in', 'completed', 'cancelled', 'rejected', 'noshow'];
const dateText = value => value instanceof Date ? helpers.formatDate(value) : String(value).slice(0, 10);
function shape(row) {
  return { ...policy.present(row), buildingName: row.building_name || '', purpose: row.purpose || '未填写用途', participants: Number(row.participants) || 1 };
}
async function list(scope, input) {
  policy.assertScope(scope, scope.buildingId);
  const date = String(input.date || helpers.formatDate(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + 'T12:00:00').getTime()) || helpers.formatDate(new Date(date + 'T12:00:00')) !== date) throw policy.error('请选择有效日期');
  const status = String(input.status || '');
  if (status && !statuses.includes(status)) throw policy.error('预约状态无效');
  const q = String(input.q || '').trim();
  if (q.length > 80) throw policy.error('搜索内容最多80字');
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 12));
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    let all = tables.reservations.filter(r => dateText(r.date) === date).map(r => {
      const room = tables.rooms.find(room => Number(room.id) === Number(r.room_id));
      const user = tables.users.find(user => Number(user.id) === Number(r.user_id));
      if (!room || !user || (!scope.isGlobal && Number(room.building_id) !== scope.buildingId)) return null;
      const building = tables.buildings.find(b => Number(b.id) === Number(room.building_id));
      return { ...r, building_id: room.building_id, building_name: building && building.name, room_name: room.name, real_name: user.real_name, nickname: user.nickname, student_id: user.student_id };
    }).filter(Boolean);
    const summary = { total: all.length, waiting: all.filter(r => r.status === 'approved').length, checkedIn: all.filter(r => r.status === 'checked_in').length, finished: all.filter(r => r.status === 'completed').length };
    all = all.filter(r => (!status || r.status === status) && (!q || [r.id, r.room_name, r.real_name, r.nickname, r.student_id].some(value => String(value || '').toLowerCase().includes(q.toLowerCase())))).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)) || Number(a.id) - Number(b.id));
    return { list: all.slice((page - 1) * pageSize, page * pageSize).map(shape), total: all.length, page, pageSize, date, summary };
  }
  const base = ' FROM reservations r JOIN rooms rm ON rm.id = r.room_id JOIN users u ON u.id = r.user_id LEFT JOIN buildings b ON b.id = rm.building_id';
  let where = ' WHERE r.date = ?', params = [date];
  if (!scope.isGlobal) { where += ' AND rm.building_id = ?'; params.push(scope.buildingId); }
  const [stats] = await db.query("SELECT COUNT(*) AS total, SUM(r.status = 'approved') AS waiting, SUM(r.status = 'checked_in') AS checkedIn, SUM(r.status = 'completed') AS finished" + base + where, params);
  if (status) { where += ' AND r.status = ?'; params.push(status); }
  if (q) { where += ' AND (CAST(r.id AS CHAR) = ? OR rm.name LIKE ? OR u.real_name LIKE ? OR u.nickname LIKE ? OR u.student_id LIKE ?)'; const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'; params.push(q, like, like, like, like); }
  const [counts] = await db.query('SELECT COUNT(*) AS total' + base + where, params);
  const [rows] = await db.query('SELECT r.id, r.date, r.start_time, r.end_time, r.status, r.purpose, r.participants, rm.building_id, rm.name AS room_name, b.name AS building_name, u.real_name, u.nickname, u.student_id' + base + where + ' ORDER BY r.start_time ASC, r.id ASC LIMIT ? OFFSET ?', params.concat([pageSize, (page - 1) * pageSize]));
  return { list: rows.map(shape), total: Number(counts[0].total), page, pageSize, date, summary: Object.fromEntries(Object.entries(stats[0]).map(([k, v]) => [k, Number(v) || 0])) };
}
module.exports = { list };
