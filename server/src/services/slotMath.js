function parseTime(value) {
  var parts = String(value || '').split(':');
  if (parts.length !== 2) throw new Error('预约时间格式无效');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function formatTime(total) {
  var hour = Math.floor(total / 60);
  var minute = total % 60;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00';
}

function build(startTime, endTime, interval) {
  var start = parseTime(startTime);
  var end = parseTime(endTime);
  var step = interval || 30;
  if (end <= start) throw new Error('结束时间必须晚于开始时间');
  if (start % step !== 0 || end % step !== 0) throw new Error('预约时间必须按时间槽选择');
  var result = [];
  for (var cursor = start; cursor < end; cursor += step) result.push(formatTime(cursor));
  return result;
}

function resourceKey(roomId, seatId) {
  return seatId ? 'seat:' + Number(seatId) : 'room:' + Number(roomId);
}

module.exports = { parseTime, formatTime, build, resourceKey };
