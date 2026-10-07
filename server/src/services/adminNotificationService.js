const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');
const realtime = require('./realtimeEventService');
const file = path.join(process.env.MOCK_DATA_DIR || path.join(__dirname, '../../data'), 'mock-admin-notifications.json');
const ADMIN_ROLES = ['admin', 'super_admin', 'superadmin', 'counselor', 'dorm_manager'];
function owner(role) {
  if (role === 'student') return { table: 'notifications', field: 'user_id' };
  if (ADMIN_ROLES.includes(role)) return { table: 'admin_notifications', field: 'admin_id' };
  throw Object.assign(new Error('通知身份无效'), { httpStatus: 403 });
}
function persistMock() {
  if (!db.isMock()) return;
  const rows = require('../config/mock-db').__tables.admin_notifications || [];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(rows), 'utf8');
  fs.renameSync(file + '.tmp', file);
}
function present(row) {
  let data = row.data || {};
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
  return { ...row, data };
}
async function create(adminId, buildingId, type, title, content, data, dedupeKey) {
  let row, inserted = false;
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    tables.admin_notifications = tables.admin_notifications || [];
    row = tables.admin_notifications.find(n => Number(n.admin_id) === Number(adminId) && n.dedupe_key === dedupeKey);
    if (!row) {
      row = { id: Math.max(0, ...tables.admin_notifications.map(n => Number(n.id) || 0)) + 1, admin_id: Number(adminId), building_id: Number(buildingId), type, title, content, data: JSON.stringify(data || {}), dedupe_key: dedupeKey, is_read: 0, created_at: new Date().toISOString() };
      tables.admin_notifications.push(row);
      try { persistMock(); } catch (err) { tables.admin_notifications = tables.admin_notifications.filter(n => n !== row); throw err; }
      inserted = true;
    }
  } else {
    try {
      const [result] = await db.query('INSERT INTO admin_notifications (admin_id,building_id,type,title,content,data,dedupe_key,is_read,created_at) VALUES (?,?,?,?,?,?,?,0,NOW())', [adminId, buildingId, type, title, content, JSON.stringify(data || {}), dedupeKey]);
      const [rows] = await db.query('SELECT * FROM admin_notifications WHERE id = ?', [result.insertId]);
      row = rows[0]; inserted = true;
    } catch (err) {
      if (!(err.code === 'ER_DUP_ENTRY' || Number(err.errno) === 1062)) throw err;
      const [rows] = await db.query('SELECT * FROM admin_notifications WHERE admin_id = ? AND dedupe_key = ?', [adminId, dedupeKey]);
      if (!rows.length) throw err;
      row = rows[0];
    }
  }
  const result = { ...present(row), idempotent: !inserted };
  if (inserted) {
    try {
      const io = realtime.getIO();
      if (io) io.to('admin:' + adminId).emit('notification', result);
      else await require('./socketRedisAdapterService').publishExternalBroadcast(['admin:' + adminId], 'notification', result);
    } catch (err) { logger.error('管理通知已保存，实时推送失败:', err); }
  }
  return result;
}
module.exports = { ADMIN_ROLES, owner, create, persistMock };
