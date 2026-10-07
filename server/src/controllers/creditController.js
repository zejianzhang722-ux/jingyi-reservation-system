const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const creditService = require('../services/creditService');
const privacyAuditService = require('../services/privacyAuditService');

const violationList = async function(req, res) {
  try {
    const { page = 1, pageSize = 10, userId, type, keyword } = req.query;
    const offset = (page - 1) * pageSize;

    // R-14：投影带 u.building_id，供 maskPresenter 按数据域判定；
    // 仅补投影、不加行级过滤，保持"管理员可见全部违规"的既有返回集合不变（域外行由脱敏降级为掩码）。
    let sql = 'SELECT v.*, u.nickname, u.real_name, u.student_id, u.building_id FROM violations v JOIN users u ON v.user_id = u.id WHERE 1=1';
    const params = [];

    if (userId) { sql += ' AND v.user_id = ?'; params.push(userId); }
    if (type) { sql += ' AND v.type = ?'; params.push(type); }
    if (keyword) { sql += ' AND (u.real_name LIKE ? OR u.nickname LIKE ? OR u.student_id LIKE ?)'; params.push(...Array(3).fill('%' + String(keyword).slice(0,100) + '%')); }

    sql += ' ORDER BY v.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [violations] = await db.query(sql, params);

    let countSql = keyword ? 'SELECT COUNT(*) as total FROM violations v JOIN users u ON v.user_id = u.id WHERE 1=1' : 'SELECT COUNT(*) as total FROM violations WHERE 1=1';
    const countParams = [];
    if (userId) { countSql += ' AND user_id = ?'; countParams.push(userId); }
    if (type) { countSql += ' AND type = ?'; countParams.push(type); }
    if (keyword) { countSql += ' AND (u.real_name LIKE ? OR u.nickname LIKE ? OR u.student_id LIKE ?)'; countParams.push(...Array(3).fill('%' + String(keyword).slice(0,100) + '%')); }
    const [countResult] = await db.query(countSql, countParams);

    // R-14 统一出口：违规记录含学号 / 姓名明文，按请求者身份分级脱敏（学生看他人掩码，管理员明文并落审计）。
    const safeViolations = await privacyAuditService.maskRowsForRequest(req, violations, {
      targetTable: 'violations',
      description: '违规记录列表：查看明文个人信息'
    });

    return response.paginate(res, safeViolations, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取违规记录异常:', err);
    return response.error(res, err.message);
  }
};

const createViolation = async function(req, res) {
  try {
    const { userId, type, description, score, relatedId } = req.body;

    await creditService.addCredit(userId, score, type, description, relatedId);

    await db.query(
      'INSERT INTO violations (user_id, type, description, score, related_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, type, description, score, relatedId || null, req.user.id]
    );

    return response.success(res, null, '违规记录已创建');
  } catch (err) {
    logger.error('创建违规记录异常:', err);
    return response.error(res, err.message);
  }
};

const blacklist = async function(req, res) {
  try {
    const [list] = await db.query(
      "SELECT u.id, u.nickname, u.real_name, u.student_id, u.credit_score, u.status, u.restricted_until FROM users u WHERE u.status IN ('banned', 'restricted') OR u.credit_score < ? ORDER BY u.credit_score ASC",
      [require('../config').credit.warningThreshold]
    );

    // R-14 统一出口：黑名单含学号 / 姓名明文，按请求者身份分级脱敏。
    const safeList = await privacyAuditService.maskRowsForRequest(req, list, {
      targetTable: 'users',
      description: '信用黑名单：查看明文个人信息'
    });

    return response.success(res, safeList);
  } catch (err) {
    logger.error('获取黑名单异常:', err);
    return response.error(res, err.message);
  }
};

const updateBlacklist = async function(req, res) {
  try {
    const userId = req.params.userId;
    const { action, days, reason } = req.body;

    if (action === 'ban' || action === 'restrict') {
      return response.error(res, '信用分仅按区间调整预约权限，不支持封禁或暂停账号', 400);
    } else if (action === 'unban') {
      await db.query("UPDATE users SET status = 'active', restricted_until = NULL WHERE id = ?", [userId]);
    }

    return response.success(res, null, '操作成功');
  } catch (err) {
    logger.error('更新黑名单异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { violationList, createViolation, blacklist, updateBlacklist };

async function loadManagedStudent(req) {
  const key = String(req.params.id || '');
  if (!/^\d{1,10}$/.test(key)) return null;
  const [rows] = key.length >= 9
    ? await db.query('SELECT * FROM users WHERE (student_id = ? OR student_no = ?)', [key, key])
    : await db.query('SELECT * FROM users WHERE id = ?', [Number(key)]);
  const student = rows[0];
  if (!student) return null;
  if (req.adminScope && !req.adminScope.isGlobal && Number(student.building_id) !== Number(req.adminScope.buildingId)) {
    const error = new Error('无权操作其他楼栋宿生'); error.httpStatus = 403; throw error;
  }
  return student;
}
module.exports.studentDetail = async function(req, res) {
  try {
    const student = await loadManagedStudent(req);
    if (!student) return response.error(res, '宿生不存在，请核对学号', 404);
    const [logs] = await db.query('SELECT * FROM credits_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [student.id]);
    const projected = { id: student.id, real_name: student.real_name || student.name || student.nickname, student_id: student.student_id || student.student_no,
      building_id: student.building_id, credit_score: Number(student.credit_score), status: student.status, restricted_until: student.restricted_until };
    const safe = await privacyAuditService.maskRowsForRequest(req, [projected], { targetTable: 'users', description: '信用管理查看宿生详情' });
    return response.success(res, { student: safe[0], logs, bookingPermission: require('../services/creditBookingPolicy').forScore(student.credit_score), rules: creditService.getCreditRules() });
  } catch (err) { return response.error(res, err.message, err.httpStatus || 500); }
};
module.exports.setStudentCredit = async function(req, res) {
  try {
    const score = req.body.score, reason = String(req.body.reason || '').trim();
    if (!Number.isInteger(score) || score < 0 || score > creditService.getCreditRules().maxScore) return response.error(res, '信用分超出允许范围', 400);
    if (!reason || reason.length > 500) return response.error(res, '请填写500字以内的调整原因', 400);
    const student = await loadManagedStudent(req);
    if (!student) return response.error(res, '宿生不存在', 404);
    const result = await creditService.addCredit(student.id, 0, 'manual_adjust', reason, null, { targetScore: score });
    return response.success(res, { score: result.score, change: result.change, bookingPermission: require('../services/creditBookingPolicy').forScore(result.score) }, '信用分及预约权限已更新');
  } catch (err) { return response.error(res, err.message, err.httpStatus || 500); }
};
