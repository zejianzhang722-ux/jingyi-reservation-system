const dayjs = require('dayjs');
const STATES = ['open', 'closed', 'maintenance', 'counselor_only'];
function schedules(room) {
  const value = room && room.status_schedules;
  if (Array.isArray(value)) return value;
  if (!value) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('空间定时状态数据格式错误');
  return parsed;
}
function normalize(rows) {
  if (!Array.isArray(rows) || rows.length > 50) throw new Error('定时安排最多50项');
  const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(value) && dayjs(value).isValid() && dayjs(value).format('YYYY-MM-DD HH:mm') === value;
  const result = rows.map(row => {
    if (!row || !STATES.includes(row.status) || !validTime(row.startAt) || !validTime(row.endAt) || row.startAt >= row.endAt) throw new Error('请选择有效状态及起止日期、时间，结束须晚于开始');
    return { status: row.status, startAt: row.startAt, endAt: row.endAt };
  }).sort((a, b) => a.startAt.localeCompare(b.startAt));
  for (let i = 1; i < result.length; i++) if (result[i].startAt < result[i - 1].endAt) throw new Error('定时状态不能重叠，请先调整已有安排');
  return result;
}
function statusAt(room, reference = new Date()) {
  const time = dayjs(reference).format('YYYY-MM-DD HH:mm');
  const active = schedules(room).find(row => row.startAt <= time && time < row.endAt);
  return active ? active.status : (room.baseStatus || room.status);
}
function bookingAllowed(room, input) {
  const date = dayjs(input.date).format('YYYY-MM-DD');
  const start = date + ' ' + String(input.startTime).slice(0, 5);
  const end = date + ' ' + String(input.endTime).slice(0, 5);
  if (!(start < end)) return false;
  const rows = schedules(room).filter(row => row.startAt < end && row.endAt > start);
  if (rows.some(row => row.status !== 'open')) return false;
  if ((room.baseStatus || room.status) === 'open') return true;
  // An opening override must cover the entire requested interval.
  let cursor = start;
  for (const row of rows.sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    if (row.startAt > cursor) return false;
    if (row.endAt > cursor) cursor = row.endAt;
  }
  return cursor >= end;
}
module.exports = { schedules, normalize, statusAt, bookingAllowed };
