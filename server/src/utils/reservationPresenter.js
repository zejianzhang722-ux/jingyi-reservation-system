const db = require('../config/database');
const maskPresenter = require('./maskPresenter');

const valueOf = function(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null) return row[key];
  }
  return '';
};

/**
 * 格式化预约行。
 *
 * 第二参数为**可选的查看者身份**（R-14 隐私脱敏）：
 *  - 不传 viewer 时，行为与改造前**完全一致**（不做任何脱敏），保证既有调用点零影响；
 *  - 传入 viewer 时，按 utils/maskPresenter 的分级策略脱敏。
 *
 * ⚠️ 注意：不要把本函数直接作为 Array.map 的回调（`rows.map(formatReservationRow)`），
 * 因为 map 会把「数组下标」当作第二个实参传入，从而被误当作 viewer 触发脱敏。
 * 必须写成 `rows.map(function(row) { return formatReservationRow(row, viewer); })`。
 *
 * @param {object} row 原始行
 * @param {object} [viewer] 查看者身份（见 maskPresenter.viewerFromRequest）
 * @returns {object}
 */
const formatReservationRow = function(row, viewer) {
  const start = valueOf(row, ['start_time', 'startTime']);
  const end = valueOf(row, ['end_time', 'endTime']);
  const formatted = Object.assign({}, row, {
    id: valueOf(row, ['id', 'r.id']),
    userName: valueOf(row, ['userName', 'user_name', 'real_name', 'nickname']),
    studentId: valueOf(row, ['studentId', 'student_id', 'student_no']),
    roomName: valueOf(row, ['roomName', 'room_name', 'name', 'rm.name']),
    date: valueOf(row, ['date', 'r.date']),
    timeSlot: start && end ? start + '-' + end : valueOf(row, ['timeSlot']),
    status: valueOf(row, ['status', 'r.status']),
    purpose: valueOf(row, ['purpose', 'r.purpose']),
    createdAt: valueOf(row, ['createdAt', 'created_at', 'r.created_at']),
    auditedAt: valueOf(row, ['auditedAt', 'audited_at', 'r.audited_at']),
    rejectReason: valueOf(row, ['rejectReason', 'reject_reason', 'r.reject_reason']),
    counselorName: valueOf(row, ['counselorName', 'counselor_name'])
  });
  if (viewer === undefined || viewer === null) return formatted;
  return maskPresenter.applyViewerMask(formatted, viewer);
};

const getMockReservationRows = function(options) {
  const settings = options || {};
  const tables = require('../config/mock-db').__tables;
  const adminScope = settings.adminScope || { isGlobal: true };
  const viewer = settings.viewer;
  const rooms = tables.rooms || [];
  const users = tables.users || [];
  const roomById = new Map(rooms.map(function(room) { return [Number(room.id), room]; }));
  const userById = new Map(users.map(function(user) { return [Number(user.id), user]; }));
  const statuses = Array.isArray(settings.statuses) && settings.statuses.length ? settings.statuses : null;
  const status = settings.status ? String(settings.status) : '';
  const roomId = settings.roomId ? Number(settings.roomId) : null;
  const userId = settings.userId ? Number(settings.userId) : null;
  const buildingId = settings.buildingId ? Number(settings.buildingId) : null;
  const date = settings.date ? String(settings.date) : '';
  const startDate = settings.startDate ? String(settings.startDate) : '';
  const endDate = settings.endDate ? String(settings.endDate) : '';
  const keyword = settings.keyword ? String(settings.keyword).trim() : '';

  return (tables.reservations || []).filter(function(row) {
    const room = roomById.get(Number(row.room_id));
    const user = userById.get(Number(row.user_id));
    if (!room || !user) return false;
    if (!adminScope.isGlobal && Number(room.building_id) !== Number(adminScope.buildingId)) return false;
    if (buildingId && Number(room.building_id) !== buildingId) return false;
    if (statuses && !statuses.includes(row.status)) return false;
    if (status && row.status !== status) return false;
    if (roomId && Number(row.room_id) !== roomId) return false;
    if (userId && Number(row.user_id) !== userId) return false;
    if (date && row.date !== date) return false;
    if (startDate && row.date < startDate) return false;
    if (endDate && row.date > endDate) return false;
    if (keyword) {
      const text = [user.real_name, user.nickname, user.student_id, user.student_no, room.name].join(' ');
      if (!text.includes(keyword)) return false;
    }
    return true;
  }).map(function(row) {
    const room = roomById.get(Number(row.room_id)) || {};
    const user = userById.get(Number(row.user_id)) || {};
    return formatReservationRow(Object.assign({}, row, {
      roomName: room.name,
      room_name: room.name,
      room_type: room.type,
      building_id: room.building_id,
      userName: user.real_name || user.nickname,
      user_name: user.real_name || user.nickname,
      student_id: user.student_id || user.student_no,
      student_no: user.student_no || user.student_id
    }), viewer);
  });
};

const paginateRows = function(rows, page, pageSize) {
  const currentPage = Math.max(1, Number(page || 1));
  const size = Math.min(100, Math.max(1, Number(pageSize || 20)));
  const start = (currentPage - 1) * size;
  return {
    page: currentPage,
    pageSize: size,
    total: rows.length,
    list: rows.slice(start, start + size)
  };
};

module.exports = {
  formatReservationRow,
  getMockReservationRows,
  paginateRows,
  isMock: function() { return db.isMock(); }
};
