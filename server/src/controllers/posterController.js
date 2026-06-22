const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const creditService = require('../services/creditService');
const config = require('../config');

const create = async function(req, res) {
  try {
    const { title, organization, startDate, endDate, contactName, contactPhone, description, imageUrl, position } = req.body;
    const userId = req.user.id;

    const [result] = await db.query(
      'INSERT INTO posters (user_id, title, organization, start_date, end_date, contact_name, contact_phone, description, image_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [userId, title, organization, startDate, endDate, contactName || '', contactPhone || '', description || '', imageUrl || '', 'pending']
    );

    return response.success(res, { id: result.insertId }, '海报申请已提交');
  } catch (err) {
    logger.error('海报申请异常:', err);
    return response.error(res, err.message);
  }
};

const list = async function(req, res) {
  try {
    const { page = 1, pageSize = 10, status } = req.query;
    const offset = (page - 1) * pageSize;

    let sql = 'SELECT p.*, u.nickname, u.real_name, u.student_id FROM posters p JOIN users u ON p.user_id = u.id WHERE 1=1';
    const params = [];

    if (status) { sql += ' AND p.status = ?'; params.push(status); }

    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [posters] = await db.query(sql, params);

    let countSql = 'SELECT COUNT(*) as total FROM posters WHERE 1=1';
    const countParams = [];
    if (status) { countSql += ' AND status = ?'; countParams.push(status); }
    const [countResult] = await db.query(countSql, countParams);

    return response.paginate(res, posters, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取海报列表异常:', err);
    return response.error(res, err.message);
  }
};

const approve = async function(req, res) {
  try {
    const posterId = req.params.id;
    const { position, positionIndex } = req.body;

    const [posters] = await db.query('SELECT * FROM posters WHERE id = ?', [posterId]);
    if (posters.length === 0) {
      return response.error(res, '海报申请不存在', 404);
    }

    await db.query(
      "UPDATE posters SET status = 'approved', approved_at = NOW(), approved_by = ?, position = ?, position_index = ? WHERE id = ?",
      [req.user.id, position || '', positionIndex || 0, posterId]
    );

    const notificationService = require('../services/notificationService');
    await notificationService.createNotification(posters[0].user_id, 'poster_approved', '海报审核通过', '您的海报"' + posters[0].title + '"已审核通过', { posterId: posterId });

    return response.success(res, null, '审核通过');
  } catch (err) {
    logger.error('海报审核通过异常:', err);
    return response.error(res, err.message);
  }
};

const reject = async function(req, res) {
  try {
    const posterId = req.params.id;
    const { reason } = req.body;

    const [posters] = await db.query('SELECT * FROM posters WHERE id = ?', [posterId]);
    if (posters.length === 0) {
      return response.error(res, '海报申请不存在', 404);
    }

    await db.query(
      "UPDATE posters SET status = 'rejected', approved_at = NOW(), approved_by = ?, reject_reason = ? WHERE id = ?",
      [req.user.id, reason || '', posterId]
    );

    const notificationService = require('../services/notificationService');
    await notificationService.createNotification(posters[0].user_id, 'poster_rejected', '海报审核驳回', '您的海报"' + posters[0].title + '"被驳回' + (reason ? '：' + reason : ''), { posterId: posterId });

    return response.success(res, null, '已驳回');
  } catch (err) {
    logger.error('海报审核驳回异常:', err);
    return response.error(res, err.message);
  }
};

const clean = async function(req, res) {
  try {
    const posterId = req.params.id;

    await db.query("UPDATE posters SET status = 'cleaned', cleaned_at = NOW() WHERE id = ?", [posterId]);

    return response.success(res, null, '已标记为清理');
  } catch (err) {
    logger.error('海报清理异常:', err);
    return response.error(res, err.message);
  }
};

const violation = async function(req, res) {
  try {
    const posterId = req.params.id;

    const [posters] = await db.query('SELECT * FROM posters WHERE id = ?', [posterId]);
    if (posters.length === 0) {
      return response.error(res, '海报不存在', 404);
    }

    await db.query("UPDATE posters SET status = 'violation' WHERE id = ?", [posterId]);

    await creditService.addCredit(posters[0].user_id, config.credit.violationPenalty, 'poster_violation', '海报栏违规');

    return response.success(res, null, '已标记违规并扣分');
  } catch (err) {
    logger.error('海报违规异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { create, list, approve, reject, clean, violation };
