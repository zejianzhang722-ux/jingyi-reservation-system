const dayjs = require('dayjs');
const config = require('../config');

const formatDate = function(date) {
  return dayjs(date).format('YYYY-MM-DD');
};

const formatDateTime = function(date) {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
};

const formatTime = function(date) {
  return dayjs(date).format('HH:mm');
};

const isDateInRange = function(dateStr, advanceDays) {
  const today = dayjs().startOf('day');
  const target = dayjs(dateStr).startOf('day');
  const maxDate = today.add(advanceDays || config.reservation.advanceDays, 'day');
  return !target.isBefore(today) && !target.isAfter(maxDate);
};

const isTimeInRange = function(timeStr, startTime, endTime) {
  return timeStr >= startTime && timeStr <= endTime;
};

const generateTimeSlots = function(startTime, endTime, intervalMinutes) {
  const slots = [];
  const interval = intervalMinutes || 60;
  let current = startTime;
  while (current < endTime) {
    const nextTime = addMinutes(current, interval);
    slots.push({
      startTime: current,
      endTime: nextTime > endTime ? endTime : nextTime
    });
    current = nextTime;
  }
  return slots;
};

const addMinutes = function(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(totalMinutes / 60);
  const newM = totalMinutes % 60;
  return String(newH).padStart(2, '0') + ':' + String(newM).padStart(2, '0');
};

const timeToMinutes = function(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const minutesToTime = function(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
};

const calculateDuration = function(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return end - start;
};

const checkTimeConflict = function(existingStart, existingEnd, newStart, newEnd) {
  return newStart < existingEnd && newEnd > existingStart;
};

const generateReservationCode = function() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return 'JY' + timestamp + random;
};

const getWeekDay = function(dateStr) {
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return '周' + days[dayjs(dateStr).day()];
};

const isWorkday = function(dateStr) {
  const day = dayjs(dateStr).day();
  return day !== 0 && day !== 6;
};

const getDateRange = function(startDate, endDate) {
  const dates = [];
  let current = dayjs(startDate);
  const end = dayjs(endDate);
  while (!current.isAfter(end)) {
    dates.push(current.format('YYYY-MM-DD'));
    current = current.add(1, 'day');
  }
  return dates;
};

const getHourRange = function(startTime, endTime) {
  const startParts = startTime.split(':').map(Number);
  const endParts = endTime.split(':').map(Number);
  const startMinutes = startParts[0] * 60 + startParts[1];
  const endMinutes = endParts[0] * 60 + endParts[1];
  const slots = [];
  for (let m = startMinutes; m < endMinutes; m += 30) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0'));
  }
  return slots;
};

module.exports = {
  formatDate,
  formatDateTime,
  formatTime,
  isDateInRange,
  isTimeInRange,
  generateTimeSlots,
  addMinutes,
  timeToMinutes,
  minutesToTime,
  calculateDuration,
  checkTimeConflict,
  generateReservationCode,
  getWeekDay,
  isWorkday,
  getDateRange,
  getHourRange
};
