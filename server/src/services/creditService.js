const db = require('../config/database');
const logger = require('../config/logger');
const config = require('../config');

const addCredit = async function(userId, score, type, description, relatedId) {
  try {
    const [users] = await db.query('SELECT credit_score, status FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return;

    const user = users[0];
    const currentScore = Number(user.credit_score) || 0;
    const changeScore = Number(score) || 0;
    let newScore = currentScore + changeScore;

    if (newScore > config.credit.maxScore) {
      newScore = config.credit.maxScore;
    }
    if (newScore < 0) {
      newScore = 0;
    }

    await db.query('UPDATE users SET credit_score = ? WHERE id = ?', [newScore, userId]);

    await db.query(
      'INSERT INTO credits_log (user_id, score_change, score_after, type, description, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, changeScore, newScore, type, description, relatedId || null]
    );

    await checkCreditThreshold(userId, newScore);

    logger.info('信用分变动: 用户ID=' + userId + ', 变动=' + changeScore + ', 新分数=' + newScore + ', 类型=' + type);
  } catch (err) {
    logger.error('信用分变动异常:', err);
    throw err;
  }
};

const checkCreditThreshold = async function(userId, score) {
  try {
    if (score < config.credit.banThreshold) {
      const banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + config.credit.banDays);
      await db.query("UPDATE users SET status = 'banned', restricted_until = ? WHERE id = ?", [banUntil, userId]);

      const notificationService = require('./notificationService');
      await notificationService.createNotification(userId, 'credit_banned', '账号被封禁', '您的信用分低于' + config.credit.banThreshold + '分，账号已被封禁' + config.credit.banDays + '天', {});
    } else if (score < config.credit.restrictThreshold) {
      const restrictUntil = new Date();
      restrictUntil.setDate(restrictUntil.getDate() + config.credit.restrictDays);
      await db.query("UPDATE users SET status = 'restricted', restricted_until = ? WHERE id = ? AND status NOT IN ('banned')", [restrictUntil, userId]);

      const notificationService = require('./notificationService');
      await notificationService.createNotification(userId, 'credit_restricted', '预约受限', '您的信用分低于' + config.credit.restrictThreshold + '分，预约功能受限' + config.credit.restrictDays + '天', {});
    } else if (score < config.credit.warningThreshold) {
      const notificationService = require('./notificationService');
      await notificationService.createNotification(userId, 'credit_warning', '信用分警告', '您的信用分低于' + config.credit.warningThreshold + '分，请注意规范使用', {});
    }
  } catch (err) {
    logger.error('信用分阈值检查异常:', err);
  }
};

const checkAndRestoreUsers = async function() {
  try {
    const [restricted] = await db.query(
      "SELECT id FROM users WHERE status IN ('restricted', 'banned') AND restricted_until IS NOT NULL AND restricted_until <= NOW()"
    );

    for (const user of restricted) {
      await db.query("UPDATE users SET status = 'active', restricted_until = NULL WHERE id = ?", [user.id]);
      logger.info('用户解封: 用户ID=' + user.id);
    }
  } catch (err) {
    logger.error('检查用户解封异常:', err);
  }
};

const getCreditLevel = function(score) {
  if (score >= config.credit.warningThreshold) return 'good';
  if (score >= config.credit.restrictThreshold) return 'warning';
  if (score >= config.credit.banThreshold) return 'restricted';
  return 'banned';
};

module.exports = { addCredit, checkCreditThreshold, checkAndRestoreUsers, getCreditLevel };
