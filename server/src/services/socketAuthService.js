const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');
const redis = require('../config/redis');
const logger = require('../config/logger');
const authMiddleware = require('../middleware/auth');

const ADMIN_ROLES = ['super_admin', 'admin', 'counselor'];
const ROOM_EVENT_LIMIT = 30;
const ROOM_EVENT_WINDOW_MS = 60 * 1000;

const socketError = function(message, code) {
  const err = new Error(message);
  err.data = { code: code || 'SOCKET_AUTH_FAILED' };
  return err;
};

const normalizeRole = function(role) {
  return role === 'superadmin' ? 'super_admin' : role;
};

const extractToken = function(socket) {
  const authToken = socket && socket.handshake && socket.handshake.auth
    ? socket.handshake.auth.token
    : null;
  const header = socket && socket.handshake && socket.handshake.headers
    ? socket.handshake.headers.authorization
    : null;
  const raw = authToken || header || '';
  return String(raw).startsWith('Bearer ') ? String(raw).slice(7) : String(raw);
};

const loadPrincipal = async function(decoded, dependencies) {
  const dbClient = dependencies.dbClient;
  const role = normalizeRole(decoded.role);
  if (!ADMIN_ROLES.includes(role)) {
    throw socketError('实时监控仅允许管理员连接', 'SOCKET_ROLE_FORBIDDEN');
  }

  const [rows] = await dbClient.query(
    'SELECT id, username, real_name, role, building_id, status FROM admins WHERE id = ?',
    [decoded.id]
  );
  if (!rows || !rows.length) {
    throw socketError('管理员账号不存在', 'SOCKET_ACCOUNT_NOT_FOUND');
  }

  const admin = rows[0];
  const databaseRole = normalizeRole(admin.role);
  if (admin.status !== 'active') {
    throw socketError('管理员账号已禁用', 'SOCKET_ACCOUNT_DISABLED');
  }
  if (databaseRole !== role) {
    throw socketError('令牌角色与当前账号不一致', 'SOCKET_ROLE_CHANGED');
  }

  return {
    id: Number(admin.id),
    role: databaseRole,
    username: admin.username,
    name: admin.real_name || admin.username,
    buildingId: admin.building_id ? Number(admin.building_id) : null
  };
};

const authenticateSocket = async function(socket, options) {
  const dependencies = Object.assign({
    jwtLib: jwt,
    configObject: config,
    dbClient: db,
    redisClient: redis,
    isStoredRefreshToken: authMiddleware.isStoredRefreshToken
  }, options || {});
  const token = extractToken(socket);
  if (!token) throw socketError('未提供实时连接认证令牌', 'SOCKET_TOKEN_REQUIRED');

  let decoded;
  try {
    decoded = dependencies.jwtLib.verify(token, dependencies.configObject.jwt.secret);
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      throw socketError('实时连接认证令牌已过期', 'SOCKET_TOKEN_EXPIRED');
    }
    throw socketError('实时连接认证令牌无效', 'SOCKET_TOKEN_INVALID');
  }

  if (decoded.tokenType === 'refresh' || decoded.typ === 'refresh') {
    throw socketError('刷新令牌不能用于实时连接', 'SOCKET_REFRESH_TOKEN_REJECTED');
  }
  if (!decoded.tokenType && !decoded.typ) {
    const storedRefresh = await dependencies.isStoredRefreshToken(decoded, token);
    if (storedRefresh) {
      throw socketError('刷新令牌不能用于实时连接', 'SOCKET_REFRESH_TOKEN_REJECTED');
    }
  }

  let blacklisted;
  try {
    blacklisted = await dependencies.redisClient.get('blacklist:' + token);
  } catch (err) {
    throw socketError('实时认证服务暂不可用', 'SOCKET_AUTH_DEPENDENCY_UNAVAILABLE');
  }
  if (blacklisted) throw socketError('认证令牌已失效', 'SOCKET_TOKEN_REVOKED');

  const principal = await loadPrincipal(decoded, dependencies);
  socket.data = socket.data || {};
  socket.data.user = principal;
  socket.data.accessToken = token;
  socket.data.roomEventTimestamps = [];
  return principal;
};

const normalizeRoomName = function(value) {
  const room = String(value || '').trim();
  if (!room || room.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(room)) {
    throw socketError('实时房间名称无效', 'SOCKET_ROOM_INVALID');
  }
  return room;
};

const authorizeRoom = async function(socket, requestedRoom, options) {
  const dependencies = Object.assign({ dbClient: db }, options || {});
  const user = socket && socket.data ? socket.data.user : null;
  if (!user) throw socketError('实时连接尚未认证', 'SOCKET_NOT_AUTHENTICATED');
  const room = normalizeRoomName(requestedRoom);

  if (room === 'monitor:all') {
    if (user.role !== 'super_admin') {
      throw socketError('仅超级管理员可订阅全部楼栋', 'SOCKET_ROOM_FORBIDDEN');
    }
    return room;
  }

  const adminMatch = room.match(/^admin:(\d+)$/);
  if (adminMatch) {
    if (Number(adminMatch[1]) !== Number(user.id)) {
      throw socketError('不能订阅其他管理员的私有房间', 'SOCKET_ROOM_FORBIDDEN');
    }
    return room;
  }

  const buildingMatch = room.match(/^building:(\d+)$/);
  if (buildingMatch) {
    const buildingId = Number(buildingMatch[1]);
    if (user.role !== 'super_admin' && Number(user.buildingId) !== buildingId) {
      throw socketError('无权订阅其他楼栋', 'SOCKET_ROOM_FORBIDDEN');
    }
    return room;
  }

  const roomMatch = room.match(/^room:(\d+)$/);
  if (roomMatch) {
    const roomId = Number(roomMatch[1]);
    const [rows] = await dependencies.dbClient.query(
      'SELECT id, building_id FROM rooms WHERE id = ?',
      [roomId]
    );
    if (!rows || !rows.length) throw socketError('功能房不存在', 'SOCKET_ROOM_NOT_FOUND');
    if (user.role !== 'super_admin' && Number(user.buildingId) !== Number(rows[0].building_id)) {
      throw socketError('无权订阅该功能房', 'SOCKET_ROOM_FORBIDDEN');
    }
    return room;
  }

  throw socketError('不允许订阅该实时房间', 'SOCKET_ROOM_FORBIDDEN');
};

const consumeRoomEventQuota = function(socket) {
  const now = Date.now();
  const timestamps = (socket.data.roomEventTimestamps || []).filter(function(timestamp) {
    return now - timestamp < ROOM_EVENT_WINDOW_MS;
  });
  if (timestamps.length >= ROOM_EVENT_LIMIT) {
    throw socketError('实时房间操作过于频繁', 'SOCKET_RATE_LIMITED');
  }
  timestamps.push(now);
  socket.data.roomEventTimestamps = timestamps;
};

const acknowledge = function(socket, callback, payload) {
  if (typeof callback === 'function') callback(payload);
  else if (!payload.ok) socket.emit('socket-error', payload);
};

const configureSocketServer = function(io, options) {
  const settings = options || {};
  io.use(function(socket, next) {
    authenticateSocket(socket, settings).then(function() {
      next();
    }).catch(function(err) {
      next(err);
    });
  });

  io.on('connection', function(socket) {
    const user = socket.data.user;
    socket.join('admin:' + user.id);
    if (user.role === 'super_admin') socket.join('monitor:all');
    else if (user.buildingId) socket.join('building:' + user.buildingId);

    logger.info('WebSocket管理员连接: socket=' + socket.id + ' admin=' + user.id + ' role=' + user.role);

    const joinHandler = function(room, callback) {
      try {
        consumeRoomEventQuota(socket);
      } catch (err) {
        acknowledge(socket, callback, { ok: false, code: err.data.code, message: err.message });
        return;
      }
      authorizeRoom(socket, room, settings).then(function(authorizedRoom) {
        socket.join(authorizedRoom);
        acknowledge(socket, callback, { ok: true, room: authorizedRoom });
      }).catch(function(err) {
        acknowledge(socket, callback, { ok: false, code: err.data && err.data.code, message: err.message });
      });
    };

    const leaveHandler = function(room, callback) {
      try {
        consumeRoomEventQuota(socket);
        const normalized = normalizeRoomName(room);
        const protectedRoom = normalized === 'admin:' + user.id;
        if (protectedRoom) throw socketError('不能退出管理员私有房间', 'SOCKET_ROOM_PROTECTED');
        socket.leave(normalized);
        acknowledge(socket, callback, { ok: true, room: normalized });
      } catch (err) {
        acknowledge(socket, callback, { ok: false, code: err.data && err.data.code, message: err.message });
      }
    };

    socket.on('join-room', joinHandler);
    socket.on('leave-room', leaveHandler);
    // 兼容旧客户端事件名，但仍执行相同授权，不再允许任意字符串加入。
    socket.on('join', joinHandler);
    socket.on('leave', leaveHandler);

    socket.on('disconnect', function(reason) {
      logger.info('WebSocket管理员断开: socket=' + socket.id + ' admin=' + user.id + ' reason=' + reason);
    });
  });

  return io;
};

module.exports = {
  ADMIN_ROLES,
  ROOM_EVENT_LIMIT,
  ROOM_EVENT_WINDOW_MS,
  socketError,
  normalizeRole,
  extractToken,
  authenticateSocket,
  normalizeRoomName,
  authorizeRoom,
  consumeRoomEventQuota,
  configureSocketServer
};
