const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const reservationApprovalController = require('./reservationApprovalController');
const reservationPresenter = require('../utils/reservationPresenter');
const privacyAuditService = require('../services/privacyAuditService');

const pagination = function(query, defaultSize) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || defaultSize || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

const requestedStatuses = function(req) {
  const allowed = reservationApprovalController.allowedStatusesForRole(req.adminScope.role);
  const type = String((req.query && req.query.type) || '').trim() || (String(req.originalUrl || '').includes('/counselor/') ? 'counselor' : '');
  let wanted = allowed;
  if (type === 'counselor') wanted = ['counselor_pending'];
  if (type === 'admin') wanted = ['pending'];
  return wanted.filter(function(status) { return allowed.includes(status); });
};

const pendingQuery = function(req) {
  const statuses = requestedStatuses(req);
  if (!statuses.length) return null;
  const placeholders = statuses.map(function() { return '?'; }).join(',');
  let where = ' WHERE r.status IN (' + placeholders + ')';
  const params = statuses.slice();
  if (!req.adminScope.isGlobal) {
    where += ' AND rm.building_id = ?';
    params.push(req.adminScope.buildingId);
  } else if (req.query.buildingId) {
    where += ' AND rm.building_id = ?';
    params.push(Number(req.query.buildingId));
  }
  if (req.query.roomId) {
    where += ' AND r.room_id = ?';
    params.push(Number(req.query.roomId));
  }
  if (req.query.date) {
    where += ' AND r.date = ?';
    params.push(String(req.query.date));
  }
  return { where, params, statuses };
};

const loadPendingRows = async function(req, limit, offset) {
  const query = pendingQuery(req);
  if (!query) return null;

  if (db.isMock()) {
    let rows = reservationPresenter.getMockReservationRows({
      adminScope: req.adminScope,
      statuses: query.statuses,
      buildingId: req.adminScope.isGlobal ? req.query.buildingId : '',
      roomId: req.query.roomId,
      date: req.query.date
    }).sort(function(a, b) {
      const byCreated = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      return byCreated || (Number(a.id) - Number(b.id));
    });
    const total = rows.length;
    if (Number.isInteger(limit)) rows = rows.slice(Number(offset || 0), Number(offset || 0) + limit);
    return { rows, query, total };
  }

  // 附带 rm.building_id，供隐私脱敏按管理员数据域判定可见性（R-14）。
  let sql = 'SELECT r.*, rm.name AS room_name, rm.name AS roomName, rm.type AS room_type, rm.type AS roomType, rm.building_id, ' +
    'u.real_name AS user_name, u.real_name AS userName, u.student_id, u.student_no ' +
    'FROM reservations r JOIN rooms rm ON rm.id = r.room_id JOIN users u ON u.id = r.user_id' +
    query.where + ' ORDER BY r.created_at ASC, r.id ASC';
  const params = query.params.slice();
  if (Number.isInteger(limit)) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, Number(offset || 0));
  }
  const [rows] = await db.query(sql, params);
  // ⚠️ 不要把 formatReservationRow 直接作为 map 回调：map 会把数组下标当成第二参数(viewer)。
  return { rows: rows.map(function(row) { return reservationPresenter.formatReservationRow(row); }), query };
};

// `/reservation/pending` historically returns a plain array and existing clients rely on it.
const pendingReservations = async function(req, res) {
  try {
    const loaded = await loadPendingRows(req, 50, 0);
    if (!loaded) return response.error(res, '当前角色无权查看审核队列', 403);
    const rows = await privacyAuditService.maskRowsForRequest(req, loaded.rows, {
      targetTable: 'reservations',
      description: '待审核预约列表：管理员查看明文个人信息'
    });
    return response.success(res, rows);
  } catch (err) {
    logger.error('获取楼栋范围内待审核预约失败:', err);
    return response.error(res, err.message || '获取待审核预约失败', 500);
  }
};

// `/audit/pending` keeps the paginated contract used by the audit management page.
const pendingAuditList = async function(req, res) {
  try {
    const page = pagination(req.query, 20);
    const loaded = await loadPendingRows(req, page.pageSize, page.offset);
    if (!loaded) return response.error(res, '当前角色无权查看审核队列', 403);
    const rows = await privacyAuditService.maskRowsForRequest(req, loaded.rows, {
      targetTable: 'reservations',
      description: '分页审核队列：管理员查看明文个人信息'
    });
    if (db.isMock()) {
      return response.paginate(res, rows, loaded.total, page.page, page.pageSize);
    }
    const [countRows] = await db.query(
      'SELECT COUNT(*) AS total FROM reservations r JOIN rooms rm ON rm.id = r.room_id' + loaded.query.where,
      loaded.query.params
    );
    return response.paginate(res, rows, Number(countRows[0].total || 0), page.page, page.pageSize);
  } catch (err) {
    logger.error('获取分页审核队列失败:', err);
    return response.error(res, err.message || '获取待审核预约失败', 500);
  }
};

const pendingReservationCount = async function(req, res) {
  try {
    const query = pendingQuery(req);
    if (!query) return response.error(res, '当前角色无权查看审核队列', 403);
    if (db.isMock()) {
      const rows = reservationPresenter.getMockReservationRows({
        adminScope: req.adminScope,
        statuses: query.statuses,
        buildingId: req.adminScope.isGlobal ? req.query.buildingId : '',
        roomId: req.query.roomId,
        date: req.query.date
      });
      return response.success(res, { count: rows.length });
    }
    const [rows] = await db.query(
      'SELECT COUNT(*) AS count FROM reservations r JOIN rooms rm ON rm.id = r.room_id' + query.where,
      query.params
    );
    return response.success(res, { count: Number(rows[0].count || 0) });
  } catch (err) {
    logger.error('获取楼栋范围内待审核数量失败:', err);
    return response.error(res, err.message || '获取待审核数量失败', 500);
  }
};
const users = async function(req, res) {
  try {
    const page = pagination(req.query, 20);
    const keyword = String(req.query.keyword || '').trim();
    let where = ' WHERE 1=1';
    const params = [];
    if (!req.adminScope.isGlobal) {
      where += ' AND u.building_id = ?';
      params.push(req.adminScope.buildingId);
    }
    if (keyword) {
      where += ' AND (u.name LIKE ? OR u.real_name LIKE ? OR u.student_id LIKE ? OR u.student_no LIKE ?)';
      const pattern = '%' + keyword + '%';
      params.push(pattern, pattern, pattern, pattern);
    }
    const [countRows] = await db.query('SELECT COUNT(*) AS total FROM users u' + where, params);
    const [rows] = await db.query(
      'SELECT u.id, u.nickname, u.name, u.real_name, u.student_id, u.student_no, u.card_no, ' +
      'u.phone, u.email, u.college, u.major, u.grade, u.building_id, u.credit_score, u.status, u.created_at ' +
      'FROM users u' + where + ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?',
      params.concat([page.pageSize, page.offset])
    );
    // 按请求者身份分级脱敏：管理员在数据域内可见明文（并落审计），否则掩码（R-14）。
    const safeRows = await privacyAuditService.maskRowsForRequest(req, rows, {
      targetTable: 'users',
      description: '用户列表：管理员查看明文个人信息'
    });
    return response.paginate(res, safeRows, Number(countRows[0].total || 0), page.page, page.pageSize);
  } catch (err) {
    logger.error('获取楼栋范围内用户列表失败:', err);
    return response.error(res, err.message || '获取用户列表失败', 500);
  }
};

const posters = async function(req, res) {
  try {
    const page = pagination(req.query, 10);
    const status = String(req.query.status || '').trim();
    let where = ' WHERE 1=1';
    const params = [];
    const isAdmin = req.adminScope && ['super_admin', 'admin', 'counselor'].includes(req.adminScope.role);
    if (!isAdmin) {
      where += ' AND p.user_id = ?';
      params.push(req.user.id);
    } else if (!req.adminScope.isGlobal) {
      where += ' AND u.building_id = ?';
      params.push(req.adminScope.buildingId);
    }
    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }
    const [countRows] = await db.query(
      'SELECT COUNT(*) AS total FROM posters p JOIN users u ON u.id = p.user_id' + where,
      params
    );
    const [rows] = await db.query(
      'SELECT p.*, u.nickname, u.real_name, u.student_id, u.building_id FROM posters p JOIN users u ON u.id = p.user_id' +
      where + ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?',
      params.concat([page.pageSize, page.offset])
    );
    // 按请求者身份分级脱敏（R-14）。
    const safeRows = await privacyAuditService.maskRowsForRequest(req, rows, {
      targetTable: 'posters',
      description: '海报列表：管理员查看明文个人信息'
    });
    return response.paginate(res, safeRows, Number(countRows[0].total || 0), page.page, page.pageSize);
  } catch (err) {
    logger.error('获取安全范围内海报列表失败:', err);
    return response.error(res, err.message || '获取海报列表失败', 500);
  }
};

module.exports = {
  pendingReservations,
  pendingAuditList,
  pendingReservationCount,
  users,
  posters
};
