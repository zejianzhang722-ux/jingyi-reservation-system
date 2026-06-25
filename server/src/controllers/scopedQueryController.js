const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const reservationApprovalController = require('./reservationApprovalController');

const pagination = function(query, defaultSize) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || defaultSize || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

const pendingQuery = function(req) {
  const statuses = reservationApprovalController.allowedStatusesForRole(req.adminScope.role);
  if (!statuses.length) return null;
  const placeholders = statuses.map(function() { return '?'; }).join(',');
  let where = ' WHERE r.status IN (' + placeholders + ')';
  const params = statuses.slice();
  if (!req.adminScope.isGlobal) {
    where += ' AND rm.building_id = ?';
    params.push(req.adminScope.buildingId);
  }
  return { where, params };
};

const loadPendingRows = async function(req, limit, offset) {
  const query = pendingQuery(req);
  if (!query) return null;
  let sql = 'SELECT r.*, rm.name AS room_name, rm.name AS roomName, rm.building_id, ' +
    'u.real_name AS user_name, u.real_name AS userName, u.student_id, u.student_no ' +
    'FROM reservations r JOIN rooms rm ON rm.id = r.room_id JOIN users u ON u.id = r.user_id' +
    query.where + ' ORDER BY r.created_at ASC, r.id ASC';
  const params = query.params.slice();
  if (Number.isInteger(limit)) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, Number(offset || 0));
  }
  const [rows] = await db.query(sql, params);
  return { rows, query };
};

// `/reservation/pending` historically returns a plain array and existing clients rely on it.
const pendingReservations = async function(req, res) {
  try {
    const loaded = await loadPendingRows(req, 50, 0);
    if (!loaded) return response.error(res, '当前角色无权查看审核队列', 403);
    return response.success(res, loaded.rows);
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
    const [countRows] = await db.query(
      'SELECT COUNT(*) AS total FROM reservations r JOIN rooms rm ON rm.id = r.room_id' + loaded.query.where,
      loaded.query.params
    );
    return response.paginate(res, loaded.rows, Number(countRows[0].total || 0), page.page, page.pageSize);
  } catch (err) {
    logger.error('获取分页审核队列失败:', err);
    return response.error(res, err.message || '获取待审核预约失败', 500);
  }
};

const pendingReservationCount = async function(req, res) {
  try {
    const query = pendingQuery(req);
    if (!query) return response.error(res, '当前角色无权查看审核队列', 403);
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
    return response.paginate(res, rows, Number(countRows[0].total || 0), page.page, page.pageSize);
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
      'SELECT p.*, u.nickname, u.real_name, u.student_id FROM posters p JOIN users u ON u.id = p.user_id' +
      where + ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?',
      params.concat([page.pageSize, page.offset])
    );
    return response.paginate(res, rows, Number(countRows[0].total || 0), page.page, page.pageSize);
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
