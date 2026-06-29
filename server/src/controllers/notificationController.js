const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');

const canonicalType = function(value) {
  const key = String(value || '').trim().toLowerCase();
  const map = {
    approve: 'audit',
    approval: 'audit',
    reservation_audit: 'audit',
    reservation_review: 'audit',
    audit_notice: 'audit',
    use_reminder: 'reminder',
    usage_reminder: 'reminder',
    reservation_reminder: 'reminder',
    checkin_reminder: 'reminder',
    noshow: 'noshow_warning',
    no_show: 'noshow_warning',
    no_show_warning: 'noshow_warning',
    noshow_warning: 'noshow_warning',
    credit_change: 'credit',
    credit_update: 'credit',
    poster_notice: 'poster',
    announcement: 'system',
    system_notice: 'system',
    violation_notice: 'violation'
  };
  return map[key] || key;
};

const list = async function(req, res) {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const type = canonicalType(req.query.type || req.query.category);
    const offset = (page - 1) * pageSize;
    const userId = req.user.id;

    let whereSql = 'FROM notifications WHERE user_id = ?';
    const whereParams = [userId];

    if (type && type !== 'all') {
      whereSql += ' AND type = ?';
      whereParams.push(type);
    }

    const sql = 'SELECT * ' + whereSql + ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const params = whereParams.concat([parseInt(pageSize), parseInt(offset)]);

    const [notifications] = await db.query(sql, params);
    const [countResult] = await db.query('SELECT COUNT(*) as total ' + whereSql, whereParams);

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
