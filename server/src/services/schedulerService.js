const schedule = require('node-schedule');
const logger = require('../config/logger');
const reservationService = require('./reservationService');
const reservationLifecycleService = require('./reservationLifecycleService');
const creditService = require('./creditService');

const initScheduler = function() {
  schedule.scheduleJob('*/5 * * * *', async function() {
    logger.info('执行爽约自动检测定时任务');
    try {
      await reservationLifecycleService.detectNoshow();
    } catch (err) {
      logger.error('爽约检测任务执行失败:', err);
    }
  });

  schedule.scheduleJob('* * * * *', async function() {
    logger.info('执行预约开始提醒定时任务');
    try {
      await reservationService.sendReservationReminders();
    } catch (err) {
      logger.error('预约提醒任务执行失败:', err);
    }
  });

  schedule.scheduleJob('0 */1 * * *', async function() {
    logger.info('执行预约结束提醒定时任务');
    try {
      const db = require('../config/database');
      const helpers = require('../utils/helpers');
      const notificationService = require('./notificationService');

      const now = new Date();
      const today = helpers.formatDate(now);
      const currentTime = helpers.formatTime(now);
      const endTime = helpers.addMinutes(currentTime, 15);

      const [ending] = await db.query(
        "SELECT r.*, u.openid, rm.name as room_name FROM reservations r JOIN users u ON r.user_id = u.id JOIN rooms rm ON r.room_id = rm.id WHERE r.date = ? AND r.end_time = ? AND r.status = 'checked_in'",
        [today, endTime]
      );

      for (const reservation of ending) {
        await notificationService.createNotification(
          reservation.user_id,
          'reservation_ending',
          '预约即将结束',
          '您在' + reservation.room_name + '的预约将在15分钟后结束，请及时签退',
          { reservationId: reservation.id }
        );
      }
    } catch (err) {
      logger.error('预约结束提醒任务执行失败:', err);
    }
  });

  schedule.scheduleJob('0 8 * * *', async function() {
    logger.info('执行海报到期检测定时任务');
    try {
      const db = require('../config/database');
      const today = new Date().toISOString().split('T')[0];

      const [expired] = await db.query(
        "SELECT * FROM posters WHERE status = 'approved' AND end_date < ?",
        [today]
      );

      for (const poster of expired) {
        await db.query("UPDATE posters SET status = 'expired' WHERE id = ?", [poster.id]);
      }

      logger.info('海报到期检测完成: ' + expired.length + '条已过期');
    } catch (err) {
      logger.error('海报到期检测任务执行失败:', err);
    }
  });

  schedule.scheduleJob('0 */10 * * *', async function() {
    logger.info('执行候补超时处理定时任务');
    try {
      const db = require('../config/database');

      const [expired] = await db.query(
        "UPDATE reservation_waitlist SET status = 'expired' WHERE status = 'waiting' AND CONCAT(date, ' ', end_time) < NOW()"
      );

      if (expired.affectedRows > 0) {
        logger.info('候补超时处理完成: ' + expired.affectedRows + '条已过期');
      }
    } catch (err) {
      logger.error('候补超时处理任务执行失败:', err);
    }
  });

  schedule.scheduleJob('0 0 * * *', async function() {
    logger.info('执行用户解封检查定时任务');
    try {
      await creditService.checkAndRestoreUsers();
    } catch (err) {
      logger.error('用户解封检查任务执行失败:', err);
    }
  });

  logger.info('定时任务服务已初始化');
};

module.exports = { initScheduler };
