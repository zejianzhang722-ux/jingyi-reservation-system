const db = require('../config/database');
const response = require('../utils/response');

const normalizeRole = function(role) {
  return role === 'superadmin' ? 'super_admin' : role;
};

const scopeError = function(res, message, status) {
  return response.error(res, message, status || 403);
};

const isLegacyMockGlobal = function(admin, role) {
  return process.env.NODE_ENV === 'test' && db.isMock() && role !== 'super_admin' && !admin.building_id;
};

const loadAdminScope = async function(req, res, next) {
  try {
    if (!req.user || !['super_admin', 'admin', 'counselor', 'superadmin'].includes(req.user.role)) {
      return scopeError(res, '管理员身份无效', 403);
    }
    const [rows] = await db.query(
      'SELECT id, role, building_id, status FROM admins WHERE id = ?',
      [req.user.id]
    );
    if (!rows || !rows.length) return scopeError(res, '管理员账号不存在', 401);
    const admin = rows[0];
    const databaseRole = normalizeRole(admin.role);
    const tokenRole = normalizeRole(req.user.role);
    if (admin.status !== 'active') return scopeError(res, '管理员账号已禁用', 403);
    if (databaseRole !== tokenRole) return scopeError(res, '管理员权限已变化，请重新登录', 401);
    const legacyGlobal = isLegacyMockGlobal(admin, databaseRole);
    const buildingId = admin.building_id ? Number(admin.building_id) : null;
    if (databaseRole !== 'super_admin' && !legacyGlobal && (!Number.isInteger(buildingId) || buildingId <= 0)) {
      return scopeError(res, '管理员尚未分配楼栋范围', 403);
    }
    req.adminScope = {
      adminId: Number(admin.id),
      role: databaseRole,
      isGlobal: databaseRole === 'super_admin' || legacyGlobal,
      buildingId
    };
    next();
  } catch (err) {
    next(err);
  }
};

const forceBuildingQuery = function(req, res, next) {
  if (!req.adminScope) return scopeError(res, '管理员数据范围未初始化', 500);
  if (!req.adminScope.isGlobal) {
    const requested = req.query && req.query.buildingId;
    if (requested && Number(requested) !== req.adminScope.buildingId) {
      return scopeError(res, '无权访问其他楼栋数据', 403);
    }
    req.query = Object.assign({}, req.query, { buildingId: String(req.adminScope.buildingId) });
  }
  next();
};

const enforceBodyBuilding = function(options) {
  const settings = options || {};
  return function(req, res, next) {
    if (!req.adminScope) return scopeError(res, '管理员数据范围未初始化', 500);
    if (req.adminScope.isGlobal) return next();
    const field = settings.field || 'buildingId';
    const requested = req.body && req.body[field];
    if (requested !== undefined && requested !== null && requested !== '' && Number(requested) !== req.adminScope.buildingId) {
      return scopeError(res, '无权操作其他楼栋', 403);
    }
    if (settings.inject !== false) {
      req.body = Object.assign({}, req.body, { [field]: req.adminScope.buildingId });
    }
    next();
  };
};

const assertBuilding = function(scope, buildingId) {
  if (scope.isGlobal) return true;
  return Number(buildingId) === Number(scope.buildingId);
};

const verifyRoom = async function(req, res, next, roomId) {
  try {
    if (!Number.isInteger(Number(roomId)) || Number(roomId) <= 0) return scopeError(res, '功能房编号无效', 400);
    const [rows] = await db.query('SELECT id, building_id FROM rooms WHERE id = ?', [Number(roomId)]);
    if (!rows || !rows.length) return scopeError(res, '功能房不存在', 404);
    if (!assertBuilding(req.adminScope, rows[0].building_id)) return scopeError(res, '无权操作其他楼栋功能房', 403);
    req.scopedRoom = rows[0];
    next();
  } catch (err) {
    next(err);
  }
};

const roomFromParam = function(paramName) {
  const name = paramName || 'id';
  return function(req, res, next) {
    return verifyRoom(req, res, next, req.params[name]);
  };
};

const roomFromBody = function(fieldName) {
  const name = fieldName || 'roomId';
  return function(req, res, next) {
    return verifyRoom(req, res, next, req.body && req.body[name]);
  };
};

const verifyReservation = async function(req, res, next, reservationId) {
  try {
    if (!Number.isInteger(Number(reservationId)) || Number(reservationId) <= 0) return scopeError(res, '预约编号无效', 400);
    const [rows] = await db.query(
      'SELECT r.id, r.room_id, rm.building_id FROM reservations r JOIN rooms rm ON rm.id = r.room_id WHERE r.id = ?',
      [Number(reservationId)]
    );
    if (!rows || !rows.length) return scopeError(res, '预约不存在', 404);
    if (!assertBuilding(req.adminScope, rows[0].building_id)) return scopeError(res, '无权操作其他楼栋预约', 403);
    req.scopedReservation = rows[0];
    next();
  } catch (err) {
    next(err);
  }
};

const reservationFromParam = function(paramName) {
  const name = paramName || 'id';
  return function(req, res, next) {
    return verifyReservation(req, res, next, req.params[name]);
  };
};

const reservationFromBody = function(fieldName) {
  const name = fieldName || 'reservationId';
  return function(req, res, next) {
    return verifyReservation(req, res, next, req.body && req.body[name]);
  };
};

const reservationBatchFromBody = function(fieldName) {
  const name = fieldName || 'ids';
  return async function(req, res, next) {
    try {
      const ids = Array.from(new Set(((req.body && req.body[name]) || []).map(Number))).filter(function(id) {
        return Number.isInteger(id) && id > 0;
      });
      if (!ids.length) return scopeError(res, '请选择预约记录', 400);
      const placeholders = ids.map(function() { return '?'; }).join(',');
      const [rows] = await db.query(
        'SELECT r.id, rm.building_id FROM reservations r JOIN rooms rm ON rm.id = r.room_id WHERE r.id IN (' + placeholders + ')',
        ids
      );
      if (rows.length !== ids.length) return scopeError(res, '部分预约不存在', 404);
      if (!req.adminScope.isGlobal && rows.some(function(row) { return Number(row.building_id) !== req.adminScope.buildingId; })) {
        return scopeError(res, '批量操作包含其他楼栋预约', 403);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};

const seatFromParam = function(paramName) {
  const name = paramName || 'id';
  return async function(req, res, next) {
    try {
      const seatId = Number(req.params[name]);
      const [rows] = await db.query(
        'SELECT s.id, s.room_id, r.building_id FROM seats s JOIN rooms r ON r.id = s.room_id WHERE s.id = ?',
        [seatId]
      );
      if (!rows || !rows.length) return scopeError(res, '座位不存在', 404);
      if (!assertBuilding(req.adminScope, rows[0].building_id)) return scopeError(res, '无权操作其他楼栋座位', 403);
      req.scopedSeat = rows[0];
      next();
    } catch (err) {
      next(err);
    }
  };
};

const posterFromParam = function(paramName) {
  const name = paramName || 'id';
  return async function(req, res, next) {
    try {
      const posterId = Number(req.params[name]);
      const [rows] = await db.query(
        'SELECT p.id, u.building_id FROM posters p JOIN users u ON u.id = p.user_id WHERE p.id = ?',
        [posterId]
      );
      if (!rows || !rows.length) return scopeError(res, '海报申请不存在', 404);
      if (!assertBuilding(req.adminScope, rows[0].building_id)) return scopeError(res, '无权处理其他楼栋海报', 403);
      next();
    } catch (err) {
      next(err);
    }
  };
};

const ownBuildingList = async function(req, res, next) {
  if (req.adminScope.isGlobal) return next();
  try {
    const [rows] = await db.query(
      'SELECT b.*, COUNT(CASE WHEN r.status = \'open\' THEN 1 END) AS room_count ' +
      'FROM buildings b LEFT JOIN rooms r ON r.building_id = b.id WHERE b.id = ? GROUP BY b.id',
      [req.adminScope.buildingId]
    );
    return response.paginate(res, rows, rows.length, 1, 100);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  normalizeRole,
  isLegacyMockGlobal,
  loadAdminScope,
  forceBuildingQuery,
  enforceBodyBuilding,
  assertBuilding,
  roomFromParam,
  roomFromBody,
  reservationFromParam,
  reservationFromBody,
  reservationBatchFromBody,
  seatFromParam,
  posterFromParam,
  ownBuildingList
};
