const db = require('../config/database');
const logger = require('../config/logger');
const config = require('../config');

const addCredit = async function(userId, score, type, description, relatedId, options) {
  let connection;
  let inTransaction = false;
  try {
    connection = db.getConnection ? await db.getConnection() : db;
    if (!connection.isMock && typeof connection.beginTransaction === 'function') {
      await connection.beginTransaction();
      inTransaction = true;
    }
    const result = await addCreditWithinTransaction(connection.isMock ? db : connection, userId, score, type, description, Object.assign({ relatedId }, options || {}));
    if (inTransaction) await connection.commit();
    await notifyCreditThreshold(userId, result);
    if (result) logger.info('信用分变动: 用户ID=' + userId + ', 变动=' + result.change + ', 新分数=' + result.score + ', 类型=' + type);
    return result;
  } catch (err) {
    if (inTransaction) await connection.rollback();
    logger.error('信用分变动异常:', err);
    throw err;
  } finally {
    if (connection && typeof connection.release === 'function') connection.release();
  }
};

const checkCreditThreshold = async function(userId, score, previousScore) {
  if (previousScore !== undefined && require('./creditBookingPolicy').forScore(score).minScore !== require('./creditBookingPolicy').forScore(previousScore).minScore) {
    await notifyCreditThreshold(userId, { notification: { type: 'credit_restricted', title: '预约权限已更新', content: require('./creditBookingPolicy').description() } });
  }
};

const checkAndRestoreUsers = async function() {
  try {
    if (db.isMock && db.isMock()) {
      const tables = require('../config/mock-db').__tables;
      const now = Date.now();
      const expired = tables.users.filter(function(user) {
        return ['restricted', 'banned'].includes(user.status) && user.restricted_until && new Date(user.restricted_until).getTime() <= now;
      });
      for (const user of expired) {
        await db.query("UPDATE users SET status = 'active', restricted_until = NULL WHERE id = ? AND status = ?", [user.id, user.status]);
        logger.info('用户解封: 用户ID=' + user.id);
      }
      return;
    }
    const [restricted] = await db.query(
      "SELECT id FROM users WHERE status IN ('restricted', 'banned') AND restricted_until IS NOT NULL AND restricted_until <= NOW()"
    );

    for (const user of restricted) {
      await db.query("UPDATE users SET status = 'active', restricted_until = NULL WHERE id = ? AND status IN ('restricted', 'banned') AND restricted_until IS NOT NULL AND restricted_until <= NOW()", [user.id]);
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

const getCreditRules = function() {
  return Object.assign({}, config.credit, {
    bookingTiers: require('./creditBookingPolicy').tiers(),
    bookingDescription: require('./creditBookingPolicy').description(),
    recovery: '信用分不限制登录；预约权限按当前分数即时调整，无信用封禁期限。',
    rewardDescription: '正常完成预约并签退奖励' + config.credit.goodReward + '分；信用分最高' + config.credit.maxScore + '分，最低0分，记录仅显示实际变化。'
  });
};

const clearLegacyCreditRestriction = async function(user) {
  if (!['banned', 'restricted'].includes(user.status) || !user.restricted_until) return;
  await db.query("UPDATE users SET status = 'active', restricted_until = NULL WHERE id = ? AND status IN ('restricted', 'banned') AND restricted_until IS NOT NULL", [user.id]);
  user.status = 'active';
  user.restricted_until = null;
};

// 调用者负责事务提交，通知必须在提交后发送。
const addCreditWithinTransaction = async function(connection, userId, score, type, description, options) {
  const settings = options || {};
  const runner = typeof connection.query === 'function' ? connection : { query: connection.execute.bind(connection) };
  const change = Number(score);
  if (!Number.isFinite(change)) throw new Error('信用分变动必须为有效数字');
  const lock = db.isMock && db.isMock() ? '' : ' FOR UPDATE';
  const [users] = await runner.query('SELECT credit_score, status, restricted_until FROM users WHERE id = ?' + lock, [userId]);
  if (!users.length) return null;
  const user = users[0];
  const currentScore = Number(user.credit_score) || 0;
  const relatedId = settings.reservationId || settings.relatedId || null;
  if (settings.dedupeKey && relatedId) {
    const [existing] = await runner.query('SELECT id FROM credits_log WHERE user_id = ? AND type = ? AND related_id = ? LIMIT 1', [userId, type, relatedId]);
    if (existing.length) return { score: currentScore, change: 0, idempotent: true, creditLogId: existing[0].id };
  }
  if (settings.targetScore !== undefined && (!Number.isInteger(settings.targetScore) || settings.targetScore < 0 || settings.targetScore > config.credit.maxScore)) throw new Error('目标信用分无效');
  const newScore = settings.targetScore === undefined ? Math.max(0, Math.min(config.credit.maxScore, currentScore + change)) : settings.targetScore;
  await runner.query('UPDATE users SET credit_score = ? WHERE id = ?', [newScore, userId]);
  const [inserted] = await runner.query(
    'INSERT INTO credits_log (user_id, score_change, score_after, type, description, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
    [userId, newScore - currentScore, newScore, type, description, relatedId]
  );
  let notification = null;
  const level = getCreditLevel(newScore);
  if (getCreditLevel(currentScore) !== level) {
    notification = { type: 'credit_restricted', title: '预约权限已更新', content: require('./creditBookingPolicy').description() };
  }
  return { score: newScore, change: newScore - currentScore, creditLogId: inserted.insertId, notification };
};

const notifyCreditThreshold = async function(userId, result) {
  if (!result || !result.notification || result.idempotent) return;
  const notice = result.notification;
  try {
    await require('./notificationService').createNotification(userId, notice.type, notice.title, notice.content,
      result.creditLogId ? { creditLogId: result.creditLogId } : {});
  } catch (err) { logger.error('信用分通知异常:', err); }
};

module.exports = { addCredit, addCreditWithinTransaction, notifyCreditThreshold, checkCreditThreshold, checkAndRestoreUsers, clearLegacyCreditRestriction, getCreditLevel, getCreditRules };
