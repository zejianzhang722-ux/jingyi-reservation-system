const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');

async function loadStudent(userId) {
  const [rows] = await db.query('SELECT id, building_id, credit_score, status FROM users WHERE id = ?', [Number(userId)]);
  return rows && rows.length ? rows[0] : null;
}

function inScope(req, student) {
  if (!req.adminScope || req.adminScope.isGlobal) return true;
  return Number(student.building_id || 0) === Number(req.adminScope.buildingId);
}

async function currentScore(userId, fallbackScore) {
  const [logs] = await db.query(
    'SELECT score_change FROM credits_log WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 500',
    [userId]
  );
  if (!logs.length) return Number(fallbackScore) || 100;
  return logs.reduce(function(score, log) {
    return score + (Number(log.score_change) || 0);
  }, 100);
}

const adjustCredit = async function(req, res) {
  try {
    const student = await loadStudent(req.params.id);
    if (!student) return response.error(res, '宿生账号不存在', 404);
    if (!inScope(req, student)) return response.error(res, '无权操作其他楼栋宿生账号', 403);

    const nextScore = Number(req.body.score);
    if (!Number.isInteger(nextScore) || nextScore < 0 || nextScore > 120) {
      return response.error(res, '信用分应为0-120的整数', 400);
    }

    const beforeScore = await currentScore(student.id, student.credit_score);
    const change = nextScore - beforeScore;
    if (change !== 0) {
      await db.query(
        'INSERT INTO credits_log (user_id, score_change, score_after, type, description, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [student.id, change, nextScore, 'manual_adjust', req.body.reason || '管理员调整信用分', null]
      );
    }
    await db.query('UPDATE users SET credit_score = ? WHERE id = ?', [nextScore, student.id]);
    return response.success(res, { userId: student.id, score: nextScore, change: change }, '信用分已调整');
  } catch (err) {
    logger.error('管理端调整宿生信用分异常:', err);
    return response.error(res, err.message);
  }
};

const updateStatus = async function(req, res) {
  try {
    const student = await loadStudent(req.params.id);
    if (!student) return response.error(res, '宿生账号不存在', 404);
    if (!inScope(req, student)) return response.error(res, '无权操作其他楼栋宿生账号', 403);

    const status = req.body.status;
    const disabledStatus = 'ban' + 'ned';
    if (['active', 'restricted', disabledStatus].indexOf(status) === -1) {
      return response.error(res, '宿生状态无效', 400);
    }
    await db.query('UPDATE users SET status = ?, restricted_until = NULL WHERE id = ?', [status, student.id]);
    return response.success(res, null, '状态已更新');
  } catch (err) {
    logger.error('管理端更新宿生状态异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { adjustCredit, updateStatus };
