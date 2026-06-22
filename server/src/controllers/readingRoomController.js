const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');

const enter = async function(req, res) {
  try {
    const userId = req.user.id;

    const [active] = await db.query(
      "SELECT * FROM reading_room_logs WHERE user_id = ? AND leave_time IS NULL",
      [userId]
    );
    if (active.length > 0) {
      return response.error(res, '您已在阅览室中，请先登记离开', 400);
    }

    const [result] = await db.query(
      'INSERT INTO reading_room_logs (user_id, enter_time, created_at) VALUES (?, NOW(), NOW())',
      [userId]
    );

    return response.success(res, { id: result.insertId }, '登记进入成功');
  } catch (err) {
    logger.error('阅览室登记进入异常:', err);
    return response.error(res, err.message);
  }
};

const leave = async function(req, res) {
  try {
    const userId = req.user.id;

    const [active] = await db.query(
      "SELECT * FROM reading_room_logs WHERE user_id = ? AND leave_time IS NULL",
      [userId]
    );
    if (active.length === 0) {
      return response.error(res, '未找到在馆记录', 404);
    }

    await db.query('UPDATE reading_room_logs SET leave_time = NOW() WHERE id = ?', [active[0].id]);

    return response.success(res, null, '登记离开成功');
  } catch (err) {
    logger.error('阅览室登记离开异常:', err);
    return response.error(res, err.message);
  }
};

const current = async function(req, res) {
  try {
    const [list] = await db.query(
      "SELECT r.*, u.nickname, u.real_name, u.student_id FROM reading_room_logs r JOIN users u ON r.user_id = u.id WHERE r.leave_time IS NULL ORDER BY r.enter_time DESC"
    );

    return response.success(res, list);
  } catch (err) {
    logger.error('获取当前在馆列表异常:', err);
    return response.error(res, err.message);
  }
};

const history = async function(req, res) {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const offset = (page - 1) * pageSize;

    const [list] = await db.query(
      'SELECT * FROM reading_room_logs WHERE user_id = ? ORDER BY enter_time DESC LIMIT ? OFFSET ?',
      [req.user.id, parseInt(pageSize), parseInt(offset)]
    );

    const [countResult] = await db.query(
      'SELECT COUNT(*) as total FROM reading_room_logs WHERE user_id = ?',
      [req.user.id]
    );

    return response.paginate(res, list, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取阅览室历史异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { enter, leave, current, history };
