const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const notificationPresenter = require('../utils/notificationPresenter');
const adminNotificationService = require('../services/adminNotificationService');

const list = async function(req, res) {
  try {
    const { page = 1, pageSize = 10, type, category } = req.query;
    const offset = (page - 1) * pageSize;
    const userId = req.user.id;
    const owner = adminNotificationService.owner(req.user.role);

    let sql = 'SELECT * FROM ' + owner.table + ' WHERE ' + owner.field + ' = ?';
    const params = [userId];

    if (type) { sql += ' AND type = ?'; params.push(type); }

    sql += ' ORDER BY created_at DESC';
    if (!category || category === 'all') {
      sql += ' LIMIT ? OFFSET ?';
      params.push(parseInt(pageSize), parseInt(offset));
    }

    const [notifications] = await db.query(sql, params);

    let presented = notifications.map(row => notificationPresenter.present(row, req.user.role));
    let total;
    if (category && category !== 'all') {
      presented = presented.filter(item => item.category === category);
      total = presented.length;
      presented = presented.slice(offset, Number(offset) + Number(pageSize));
    } else {
      const countSql = 'SELECT COUNT(*) as total FROM ' + owner.table + ' WHERE ' + owner.field + ' = ?' + (type ? ' AND type = ?' : '');
      const [countResult] = await db.query(countSql, type ? [userId, type] : [userId]);
      total = countResult[0].total;
    }
    return response.paginate(res, presented, total, page, pageSize);
  } catch (err) {
    logger.error('获取通知列表异常:', err);
    return response.error(res, err.message, err.httpStatus || 500);
  }
};

const markRead = async function(req, res) {
  try {
    const notificationId = req.params.id;
    const owner = adminNotificationService.owner(req.user.role);

    await db.query('UPDATE ' + owner.table + ' SET is_read = 1 WHERE id = ? AND ' + owner.field + ' = ?', [notificationId, req.user.id]);
    if (owner.table === 'admin_notifications') adminNotificationService.persistMock();

    return response.success(res, null, '已标记为已读');
  } catch (err) {
    logger.error('标记已读异常:', err);
    return response.error(res, err.message, err.httpStatus || 500);
  }
};

const markAllRead = async function(req, res) {
  try {
    const owner = adminNotificationService.owner(req.user.role);
    await db.query('UPDATE ' + owner.table + ' SET is_read = 1 WHERE ' + owner.field + ' = ? AND is_read = 0', [req.user.id]);
    if (owner.table === 'admin_notifications') adminNotificationService.persistMock();

    return response.success(res, null, '已全部标记为已读');
  } catch (err) {
    logger.error('全部标记已读异常:', err);
    return response.error(res, err.message, err.httpStatus || 500);
  }
};

const unreadCount = async function(req, res) {
  try {
    const owner = adminNotificationService.owner(req.user.role);
    const [result] = await db.query('SELECT COUNT(*) as count FROM ' + owner.table + ' WHERE ' + owner.field + ' = ? AND is_read = 0', [req.user.id]);

    return response.success(res, { count: result[0].count });
  } catch (err) {
    logger.error('获取未读数量异常:', err);
    return response.error(res, err.message, err.httpStatus || 500);
  }
};

module.exports = { list, markRead, markAllRead, unreadCount };
