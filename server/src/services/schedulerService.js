const schedule = require('node-schedule');
const logger = require('../config/logger');
const db = require('../config/database');
const redis = require('../config/redis');
const helpers = require('../utils/helpers');
const reservationService = require('./reservationService');
const reservationLifecycleService = require('./reservationLifecycleService');
const creditService = require('./creditService');
const notificationService = require('./notificationService');
const distributedLockService = require('./distributedLockService');

let initialized = false;
let scheduledJobs = [];

const taskWindowName = function(taskName, windowMs, now) {
  const timestamp = now instanceof Date ? now.getTime() : Date.now();
  const bucket = Math.floor(timestamp / windowMs);
  return 'scheduler:' + taskName + ':' + bucket;
};

const runCoordinatedTask = async function(definition, now) {
  const windowMs = Number(definition.windowMs);
  const lockTtlMs = Number(definition.lockTtlMs || windowMs + 30000);
  const lockName = taskWindowName(definition.name, windowMs, now || new Date());
  const startedAt = Date.now();

  try {
    const execution = await distributedLockService.runExclusive(
      lockName,
      { ttlMs: lockTtlMs, retainOnSuccess: true },
      function(context) { return definition.run(context, now || new Date()); }
    );

    if (!execution.acquired) {
      logger.info('定时任务跳过（其他实例已执行）: ' + definition.name);
      return execution;
    }

    logger.info(
      '定时任务执行成功: ' + definition.name +
      '，耗时=' + execution.durationMs + 'ms，执行窗口锁已保留'
    );
    return execution;
  } catch (err) {
    logger.error(
      '定时任务执行失败: ' + definition.name +
      '，耗时=' + (Date.now() - startedAt) + 'ms',
      err
    );
    throw err;
  }
};

const taskDefinitions = [
  {
    name: 'detect-noshow',
    cron: '*/5 * * * *',
    windowMs: 5 * 60 * 1000,
    lockTtlMs: 7 * 60 * 1000,
    run: function() {
      return reservationLifecycleService.detectNoshow();
    }
  },
  {
    name: 'reservation-start-reminder',
    cron: '* * * * *',
    windowMs: 60 * 1000,
    lockTtlMs: 90 * 1000,
    run: function() {
      return reservationService.sendReservationReminders();
    }
  },
  {
    name: 'reservation-end-reminder',
    cron: '* * * * *',
    windowMs: 60 * 1000,
    lockTtlMs: 90 * 1000,
    run: async function(context, now) {
      const today = helpers.formatDate(now);
      const currentTime = helpers.formatTime(now);
      const endTime = helpers.addMinutes(currentTime, 15);
      const [ending] = await db.query(
        "SELECT r.*, rm.name AS room_name FROM reservations r " +
        "JOIN rooms rm ON r.room_id = rm.id " +
        "WHERE r.date = ? AND r.end_time = ? AND r.status = 'checked_in'",
        [today, endTime]
      );

      let sent = 0;
      for (const reservation of ending) {
        try {
          await notificationService.createNotification(
            reservation.user_id,
            'reservation_ending',
            '预约即将结束',
            '您在' + reservation.room_name + '的预约将在15分钟后结束，请及时签退',
            { reservationId: reservation.id }
          );
          sent += 1;
        } catch (err) {
          logger.error('预约结束提醒发送失败，reservationId=' + reservation.id, err);
        }
      }
      return { matched: ending.length, sent };
    }
  },
  {
    name: 'poster-expiry',
    cron: '0 8 * * *',
    windowMs: 24 * 60 * 60 * 1000,
    lockTtlMs: 25 * 60 * 60 * 1000,
    run: async function(context, now) {
      const today = helpers.formatDate(now);
      const [result] = await db.query(
        "UPDATE posters SET status = 'expired', updated_at = NOW() " +
        "WHERE status = 'approved' AND end_date < ?",
        [today]
      );
      return { expired: Number(result.affectedRows || 0) };
    }
  },
  {
    name: 'waitlist-expiry',
    cron: '*/10 * * * *',
    windowMs: 10 * 60 * 1000,
    lockTtlMs: 12 * 60 * 1000,
    run: async function() {
      const [result] = await db.query(
        "UPDATE reservation_waitlist SET status = 'expired', updated_at = NOW() " +
        "WHERE status = 'waiting' AND CONCAT(date, ' ', end_time) < NOW()"
      );
      return { expired: Number(result.affectedRows || 0) };
    }
  },
  {
    name: 'restore-restricted-users',
    cron: '0 0 * * *',
    windowMs: 24 * 60 * 60 * 1000,
    lockTtlMs: 25 * 60 * 60 * 1000,
    run: function() {
      return creditService.checkAndRestoreUsers();
    }
  }
];

const initScheduler = async function() {
  if (initialized) {
    logger.warn('定时任务服务已初始化，本次重复初始化已忽略');
    return { initialized: false, reason: 'already_initialized', jobs: scheduledJobs.length };
  }

  const redisState = await redis.ready();
  if (process.env.NODE_ENV === 'production' && redisState.mode !== 'redis') {
    const err = new Error('生产环境启用定时任务必须连接真实Redis');
    err.code = 'SCHEDULER_REDIS_REQUIRED';
    throw err;
  }

  scheduledJobs = taskDefinitions.map(function(definition) {
    const job = schedule.scheduleJob(definition.cron, function(fireDate) {
      runCoordinatedTask(definition, fireDate).catch(function() {});
    });
    if (!job) {
      const err = new Error('无法注册定时任务: ' + definition.name);
      err.code = 'SCHEDULER_REGISTRATION_FAILED';
      throw err;
    }
    return { name: definition.name, cron: definition.cron, job };
  });

  initialized = true;
  logger.info(
    '定时任务服务已初始化，任务数=' + scheduledJobs.length +
    '，协调模式=' + (redisState.mode === 'redis' ? 'redis' : 'mock')
  );
  return { initialized: true, jobs: scheduledJobs.length, redisMode: redisState.mode };
};

const stopScheduler = function() {
  scheduledJobs.forEach(function(entry) {
    if (entry.job && typeof entry.job.cancel === 'function') entry.job.cancel();
  });
  const stopped = scheduledJobs.length;
  scheduledJobs = [];
  initialized = false;
  logger.info('定时任务服务已停止，取消任务数=' + stopped);
  return stopped;
};

const getSchedulerState = function() {
  return {
    initialized,
    jobs: scheduledJobs.map(function(entry) {
      return { name: entry.name, cron: entry.cron };
    })
  };
};

module.exports = {
  taskDefinitions,
  taskWindowName,
  runCoordinatedTask,
  initScheduler,
  stopScheduler,
  getSchedulerState
};
