const db = require('../config/database');
const logger = require('../config/logger');
const scopePolicy = require('../middleware/adminScope');
const adminNotifications = require('./adminNotificationService');
const helpers = require('../utils/helpers');
const noticeData = function(row) {
  if (row.data && typeof row.data === 'object') return row.data;
  try { return JSON.parse(row.data || '{}'); } catch { return {}; }
};
async function load(id) {
  const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [Number(id)]);
  if (!reservations[0]) return null;
  const reservation = reservations[0];
  const [rooms] = await db.query('SELECT * FROM rooms WHERE id = ?', [reservation.room_id]);
  if (!rooms[0] || rooms[0].type !== 'dance_room') return null;
  const [groups] = await db.query('SELECT * FROM reservation_groups WHERE reservation_id = ?', [reservation.id]);
  if (!groups[0]) return null;
  return { reservation, room: rooms[0], group: groups[0] };
}
async function notify(id, released) {
  const context = await load(id);
  if (!context) return { processed: 0 };
  const { reservation, room, group } = context;
  if (!released && !['approved', 'checked_in'].includes(reservation.status)) return { processed: 0 };
  if (released && !['cancelled', 'rejected', 'noshow', 'completed'].includes(reservation.status)) return { processed: 0 };
  const type = released ? 'dance_group_released' : 'dance_group_reserved';
  const date = reservation.date instanceof Date ? helpers.formatDate(reservation.date) : String(reservation.date).slice(0, 10);
  const data = { reservationId: Number(reservation.id), groupId: Number(group.id), roomId: Number(room.id), buildingId: Number(room.building_id), date, startTime: String(reservation.start_time).slice(0, 5), endTime: String(reservation.end_time).slice(0, 5) };
  const [admins] = await db.query("SELECT * FROM admins WHERE status = 'active'");
  let processed = 0;
  for (const admin of admins) {
    if (!adminNotifications.ADMIN_ROLES.includes(admin.role)) continue;
    const scope = scopePolicy.resolveScope(admin);
    if (!scope || (!scope.isGlobal && Number(scope.buildingId) !== Number(room.building_id))) continue;
    const [previousRows] = await db.query("SELECT * FROM admin_notifications WHERE admin_id = ? AND type = 'dance_group_reserved'", [admin.id]);
    const previous = previousRows.filter(row => Number(noticeData(row).reservationId) === Number(reservation.id)).sort((a, b) => Number(b.id) - Number(a.id));
    if (released && !previous.length) continue;
    const latestData = previous[0] && noticeData(previous[0]);
    const sameTime = latestData && latestData.date === data.date && latestData.startTime === data.startTime && latestData.endTime === data.endTime;
    const changed = !released && previous.length > 0 && !sameTime;
    const revision = sameTime ? Number(latestData.noticeRevision || 1) : previous.reduce((max, row) => Math.max(max, Number(noticeData(row).noticeRevision || 1)), 0) + 1;
    const dedupeKey = released ? 'dance-group-released:' + reservation.id : sameTime ? previous[0].dedupe_key
      : 'dance-group-reserved:' + reservation.id + ':' + date + ':' + data.startTime + ':' + data.endTime + ':' + revision;
    const time = date + ' ' + data.startTime + '—' + data.endTime;
    await adminNotifications.create(admin.id, room.building_id, type,
      released ? '舞蹈室团队占用已解除' : changed ? '舞蹈室团队预约时段已更新' : '舞蹈室团队占用提醒',
      released ? room.name + ' ' + time + ' 的团队预约占用已解除。开门及巡房前请重新核对当前预约安排。'
        : (changed ? '预约时段已更新，原时段占用已解除，请以最新安排为准。' : '') + room.name + ' ' + time + ' 已由团队「' + (group.name || '团队预约') + '」预约，该时段个人不可进入。开门前请核对团队预约及身份，巡房时请留意团队使用安排。',
      { ...data, noticeRevision: revision }, dedupeKey);
    processed += 1;
  }
  return { processed };
}
const notifyApproved = id => notify(id, false);
const notifyReleased = id => notify(id, true);
async function notifySafely(id, released = false) {
  try { return await notify(id, released); }
  catch (err) { logger.error('舞蹈室团队管理提醒保存失败 reservation=' + id, err); return { processed: 0, error: err }; }
}
async function reconcile(now = new Date()) {
  const [rows] = db.isMock() ? [require('../config/mock-db').__tables.reservations] : await db.query(
    "SELECT r.* FROM reservations r JOIN reservation_groups g ON g.reservation_id = r.id JOIN rooms rm ON rm.id = r.room_id WHERE rm.type = 'dance_room' AND r.status IN ('approved','checked_in','cancelled','rejected','noshow','completed') AND CONCAT(r.date, ' ', r.end_time) > ?",
    [helpers.formatDateTime(now)]);
  let processed = 0;
  for (const row of rows) {
    const date = row.date instanceof Date ? helpers.formatDate(row.date) : String(row.date).slice(0, 10);
    if (!['approved', 'checked_in', 'cancelled', 'rejected', 'noshow', 'completed'].includes(row.status) || new Date(date + 'T' + String(row.end_time).padEnd(8, ':00')) <= now) continue;
    const result = await notifySafely(row.id, !['approved', 'checked_in'].includes(row.status));
    processed += result.processed;
  }
  return { processed };
}
module.exports = { notifyApproved, notifyReleased, notifySafely, reconcile };
