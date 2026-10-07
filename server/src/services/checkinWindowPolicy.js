const helpers = require('../utils/helpers');
const EARLY_MINUTES = 15;
const LATE_MINUTES = 15;
function startDate(reservation) {
  const date = reservation.date instanceof Date ? helpers.formatDate(reservation.date) : String(reservation.date).slice(0, 10);
  return new Date(date + 'T' + String(reservation.start_time).padEnd(8, ':00'));
}
function windowStatus(reservation, now = new Date()) {
  const start = startDate(reservation).getTime();
  if (!Number.isFinite(start)) return { eligible: false, reason: '预约时间无效' };
  if (now.getTime() < start - EARLY_MINUTES * 60000) return { eligible: false, reason: '未到签到时间，最早可提前15分钟签到' };
  if (now.getTime() > start + LATE_MINUTES * 60000) return { eligible: false, reason: '已超过签到时间，预约开始后15分钟内须签到' };
  return { eligible: true };
}
function isOverdue(reservation, now = new Date()) {
  return now.getTime() > startDate(reservation).getTime() + LATE_MINUTES * 60000;
}
module.exports = { EARLY_MINUTES, LATE_MINUTES, startDate, windowStatus, isOverdue };
