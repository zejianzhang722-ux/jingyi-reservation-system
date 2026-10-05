const db = require('../config/database');
const helpers = require('../utils/helpers');
const policy = require('./verificationPolicy');
async function list(scope, now = new Date()) {
  policy.assertScope(scope, scope.buildingId);
  const date = helpers.formatDate(now), time = helpers.formatTime(now);
  let rooms, reservations;
  if (db.isMock()) {
    const t = require('../config/mock-db').__tables;
    rooms = t.rooms.filter(r => scope.isGlobal || Number(r.building_id) === scope.buildingId).map(r => ({ ...r, building_name: t.buildings.find(b => b.id === r.building_id)?.name || '' }));
    const ids = new Set(rooms.map(r => r.id));
    reservations = t.reservations.filter(r => ids.has(r.room_id) && String(r.date).slice(0, 10) === date && ['approved', 'checked_in'].includes(r.status)).map(r => {
      const u = t.users.find(u => u.id === r.user_id), room = rooms.find(room => room.id === r.room_id);
      return { ...r, real_name: u?.real_name, student_id: u?.student_id, room_name: room.name, building_id: room.building_id, building_name: room.building_name, room_location: room.location };
    });
  } else {
    const where = scope.isGlobal ? '' : ' WHERE rm.building_id = ?';
    [rooms] = await db.query('SELECT rm.id, rm.name, rm.building_id, b.name AS building_name, rm.location, rm.floor, rm.capacity, rm.status, rm.open_start_time, rm.open_end_time FROM rooms rm LEFT JOIN buildings b ON b.id = rm.building_id' + where, scope.isGlobal ? [] : [scope.buildingId]);
    [reservations] = await db.query("SELECT r.*, u.real_name, u.student_id, rm.name AS room_name, rm.building_id, b.name AS building_name, rm.location AS room_location FROM reservations r JOIN rooms rm ON rm.id = r.room_id JOIN users u ON u.id = r.user_id LEFT JOIN buildings b ON b.id = rm.building_id WHERE r.date = ? AND r.status IN ('approved','checked_in')" + (scope.isGlobal ? '' : ' AND rm.building_id = ?'), scope.isGlobal ? [date] : [date, scope.buildingId]);
  }
  const minutes = helpers.timeToMinutes(time);
  const future = r => helpers.timeToMinutes(String(r.end_time)) > minutes;
  const active = r => helpers.timeToMinutes(String(r.start_time)) <= minutes && future(r);
  const list = rooms.map(room => {
    const upcoming = reservations.filter(r => Number(r.room_id) === Number(room.id) && (future(r) || r.status === 'checked_in')).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    const current = upcoming.filter(r => active(r) || r.status === 'checked_in');
    const used = current.some(r => r.status === 'checked_in');
    const closed = room.status !== 'open' || minutes < helpers.timeToMinutes(room.open_start_time) || minutes >= helpers.timeToMinutes(room.open_end_time);
    const state = used ? 'in_use' : closed ? 'closed' : current.length ? 'awaiting' : 'idle';
    const overdue = current.some(r => r.status === 'checked_in' && !future(r));
    return { id: room.id, name: room.name, buildingId: room.building_id, buildingName: room.building_name, location: room.location, floor: room.floor, capacity: room.capacity, state, label: overdue ? '时段已结束 · 待巡房核实' : { in_use: '已签到 · 使用中', awaiting: '当前有预约 · 待签到', idle: '当前无使用记录', closed: '当前未开放' }[state], requiresInspection: used && (closed || overdue), current: current.map(policy.present), next: upcoming.find(r => !current.includes(r)) ? policy.present(upcoming.find(r => !current.includes(r))) : null };
  }).sort((a, b) => Number(a.floor) - Number(b.floor) || a.name.localeCompare(b.name));
  return { list, updatedAt: now.toISOString(), summary: { total: list.length, inUse: list.filter(r => r.state === 'in_use').length, awaiting: list.filter(r => r.state === 'awaiting').length, idle: list.filter(r => r.state === 'idle').length } };
}
module.exports = { list };
