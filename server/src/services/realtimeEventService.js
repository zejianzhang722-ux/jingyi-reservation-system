const db = require('../config/database');
const logger = require('../config/logger');
const helpers = require('../utils/helpers');

let io = null;

const setIO = function(socketServer) {
  io = socketServer || null;
  return io;
};

const getIO = function() {
  return io;
};

const deriveRoomStatus = function(room, currentCheckin, currentReservation) {
  if (!room) return 'unknown';
  if (room.status && room.status !== 'open') return room.status;
  if (currentCheckin) return 'using';
  if (currentReservation) return 'reserved';
  return 'open';
};

const loadRoomStatus = async function(roomId, options) {
  const settings = options || {};
  const dbClient = settings.dbClient || db;
  const numericRoomId = Number(roomId);
  if (!Number.isInteger(numericRoomId) || numericRoomId <= 0) {
    const err = new Error('实时状态功能房编号无效');
    err.code = 'REALTIME_ROOM_ID_INVALID';
    throw err;
  }

  const [rooms] = await dbClient.query(
    'SELECT id, name, building_id, status, capacity FROM rooms WHERE id = ?',
    [numericRoomId]
  );
  if (!rooms || !rooms.length) {
    const err = new Error('实时状态功能房不存在');
    err.code = 'REALTIME_ROOM_NOT_FOUND';
    throw err;
  }
  const room = rooms[0];

  const [checkins] = await dbClient.query(
    'SELECT c.reservation_id, c.user_id, c.checkin_time, u.real_name, u.nickname ' +
      'FROM checkins c JOIN users u ON u.id = c.user_id ' +
      'WHERE c.room_id = ? AND c.checkout_time IS NULL ORDER BY c.checkin_time DESC LIMIT 1',
    [numericRoomId]
  );
  const currentCheckin = checkins && checkins.length ? checkins[0] : null;

  const now = new Date();
  const today = helpers.formatDate(now);
  const currentTime = helpers.formatTime(now);
  const [reservations] = await dbClient.query(
    "SELECT id, user_id, start_time, end_time, status FROM reservations " +
      "WHERE room_id = ? AND date = ? " +
      "AND status IN ('approved','checked_in') AND start_time <= ? AND end_time > ? " +
      'ORDER BY start_time ASC, id ASC LIMIT 1',
    [numericRoomId, today, currentTime, currentTime]
  );
  const currentReservation = reservations && reservations.length ? reservations[0] : null;

  return {
    roomId: Number(room.id),
    buildingId: room.building_id ? Number(room.building_id) : null,
    name: room.name || '',
    status: deriveRoomStatus(room, currentCheckin, currentReservation),
    roomStatus: room.status || 'open',
    capacity: Number(room.capacity || 0),
    currentUser: currentCheckin
      ? (currentCheckin.real_name || currentCheckin.nickname || '')
      : '',
    currentReservationId: currentReservation ? Number(currentReservation.id) : null,
    updatedAt: new Date().toISOString()
  };
};

const emitRoomStatus = function(socketServer, payload) {
  if (!socketServer || typeof socketServer.to !== 'function') {
    return { emitted: false, rooms: [] };
  }
  const targets = ['monitor:all', 'room:' + payload.roomId];
  if (payload.buildingId) targets.push('building:' + payload.buildingId);
  const uniqueTargets = Array.from(new Set(targets));
  uniqueTargets.forEach(function(target) {
    socketServer.to(target).emit('room-status-update', payload);
  });
  return { emitted: true, rooms: uniqueTargets };
};

const publishRoomStatus = async function(roomId, options) {
  const settings = options || {};
  const socketServer = settings.io || io;
  if (!socketServer) return { emitted: false, skipped: true, reason: 'io-not-configured' };
  const payload = await loadRoomStatus(roomId, settings);
  const result = emitRoomStatus(socketServer, payload);
  return Object.assign({ payload }, result);
};

const publishRoomStatusSafely = async function(roomId, context, options) {
  try {
    return await publishRoomStatus(roomId, options);
  } catch (err) {
    logger.error('发布功能房实时状态失败 roomId=' + roomId + ' context=' + (context || 'unknown'), err);
    return { emitted: false, skipped: true, error: err };
  }
};

const publishReservationRoomsSafely = async function(reservations, context, options) {
  const roomIds = Array.from(new Set((reservations || []).map(function(reservation) {
    return Number(reservation && (reservation.roomId || reservation.room_id));
  }).filter(function(roomId) {
    return Number.isInteger(roomId) && roomId > 0;
  })));
  const results = [];
  for (const roomId of roomIds) {
    results.push(await publishRoomStatusSafely(roomId, context, options));
  }
  return results;
};

module.exports = {
  setIO,
  getIO,
  deriveRoomStatus,
  loadRoomStatus,
  emitRoomStatus,
  publishRoomStatus,
  publishRoomStatusSafely,
  publishReservationRoomsSafely
};
