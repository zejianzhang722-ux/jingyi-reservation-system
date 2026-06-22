const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');

const list = async function(req, res) {
  try {
    const { page = 1, pageSize = 10, type } = req.query;
    const offset = (page - 1) * pageSize;
    const userId = req.user.id;

    let sql = 'SELECT * FROM notifications WHERE user_id = ?';
    const params = [userId];

    if (type) { sql += ' AND type = ?'; params.push(type); }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [notifications] = await db.query(sql, params);

    const [countResult] = await db.query('SELECT COUNT(*) as total FROM notifications WHERE user_id = ?', [userId]);

    return response.paginate(res, notifications, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取通知列表异常:', err);
    return response.error(res, err.message);
  }
};

const markRead = async function(req, res) {
  try {
    const notificationId = req.params.id;

    await db.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [notificationId, req.user.id]);

    return response.success(res, null, '已标记为已读');
  } catch (err) {
    logger.error('标记已读异常:', err);
    return response.error(res, err.message);
  }
};

const markAllRead = async function(req, res) {
  try {
    await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);

    return response.success(res, null, '已全部标记为已读');
  } catch (err) {
    logger.error('全部标记已读异常:', err);
    return response.error(res, err.message);
  }
};

const unreadCount = async function(req, res) {
  try {
    const [result] = await db.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);

    return response.success(res, { count: result[0].count });
  } catch (err) {
    logger.error('获取未读数量异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { list, markRead, markAllRead, unreadCount };
