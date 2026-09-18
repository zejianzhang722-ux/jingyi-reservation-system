const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const creditService = require('../services/creditService');
const privacyAuditService = require('../services/privacyAuditService');

const violationList = async function(req, res) {
  try {
    const { page = 1, pageSize = 10, userId, type } = req.query;
    const offset = (page - 1) * pageSize;

    // R-14：投影带 u.building_id，供 maskPresenter 按数据域判定；
    // 仅补投影、不加行级过滤，保持"管理员可见全部违规"的既有返回集合不变（域外行由脱敏降级为掩码）。
    let sql = 'SELECT v.*, u.nickname, u.real_name, u.student_id, u.building_id FROM violations v JOIN users u ON v.user_id = u.id WHERE 1=1';
    const params = [];

    if (userId) { sql += ' AND v.user_id = ?'; params.push(userId); }
    if (type) { sql += ' AND v.type = ?'; params.push(type); }

    sql += ' ORDER BY v.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [violations] = await db.query(sql, params);

    let countSql = 'SELECT COUNT(*) as total FROM violations WHERE 1=1';
    const countParams = [];
    if (userId) { countSql += ' AND user_id = ?'; countParams.push(userId); }
    if (type) { countSql += ' AND type = ?'; countParams.push(type); }
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
      [60]
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

    if (action === 'ban') {
      const banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + (days || 30));
      await db.query("UPDATE users SET status = 'banned', restricted_until = ? WHERE id = ?", [banUntil, userId]);
    } else if (action === 'restrict') {
      const restrictUntil = new Date();
      restrictUntil.setDate(restrictUntil.getDate() + (days || 7));
      await db.query("UPDATE users SET status = 'restricted', restricted_until = ? WHERE id = ?", [restrictUntil, userId]);
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
