const crypto = require('crypto');
const schedule = require('node-schedule');
const logger = require('../config/logger');
const redis = require('../config/redis');
const reservationService = require('./reservationService');
const reservationLifecycleService = require('./reservationLifecycleService');
const creditService = require('./creditService');
const distributedLockService = require('./distributedLockService');

let initialized = false;
let scheduledJobs = [];

const sendEndingReminders = async function() {
  const db = require('../config/database');
  const helpers = require('../utils/helpers');
  const notificationService = require('./notificationService');
  const now = new Date();
  const today = helpers.formatDate(now);
  const currentTime = helpers.formatTime(now);
  const endTime = helpers.addMinutes(currentTime, 15);
  const [ending] = await db.query(
    "SELECT r.*, u.openid, rm.name AS room_name FROM reservations r " +
    "JOIN users u ON r.user_id = u.id JOIN rooms rm ON r.room_id = rm.id " +
    "WHERE r.date = ? AND r.end_time = ? AND r.status = 'checked_in'",
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
  return { processed: ending.length };
};

const expirePosters = async function() {
  const db = require('../config/database');
  const today = new Date().toISOString().split('T')[0];
  const [expired] = await db.query(
    "SELECT id FROM posters WHERE status = 'approved' AND end_date < ?",
    [today]
  );
  for (const poster of expired) {
    await db.query("UPDATE posters SET status = 'expired' WHERE id = ? AND status = 'approved'", [poster.id]);
  }
  return { processed: expired.length };
};

const expireWaitlist = async function() {
  const db = require('../config/database');
  const [result] = await db.query(
    "UPDATE reservation_waitlist SET status = 'expired', updated_at = NOW() " +
    "WHERE status = 'waiting' AND CONCAT(date, ' ', end_time) < NOW()"
  );
  return { processed: Number(result.affectedRows || 0) };
};

const TASK_DEFINITIONS = [
  {
    name: 'detect-noshow',
    cron: '*/5 * * * *',
    ttlMs: 4 * 60 * 1000,
    renewEveryMs: 60 * 1000,
    dedupeTtlMs: 10 * 60 * 1000,
    run: function() { return reservationLifecycleService.detectNoshow(); }
  },
  {
    name: 'reservation-start-reminders',
    cron: '* * * * *',
    ttlMs: 50 * 1000,
    renewEveryMs: 15 * 1000,
    dedupeTtlMs: 3 * 60 * 1000,
    run: function() { return reservationService.sendReservationReminders(); }
  },
  {
    name: 'reservation-ending-reminders',
    cron: '0 */1 * * *',
    ttlMs: 50 * 60 * 1000,
    renewEveryMs: 5 * 60 * 1000,
    dedupeTtlMs: 2 * 60 * 60 * 1000,
    run: sendEndingReminders
  },
  {
    name: 'expire-posters',
    cron: '0 8 * * *',
    ttlMs: 60 * 60 * 1000,
    renewEveryMs: 5 * 60 * 1000,
    dedupeTtlMs: 26 * 60 * 60 * 1000,
    run: expirePosters
  },
  {
    name: 'expire-waitlist',
    cron: '0 */10 * * *',
    ttlMs: 9 * 60 * 1000,
    renewEveryMs: 60 * 1000,
    dedupeTtlMs: 20 * 60 * 1000,
    run: expireWaitlist
  },
  {
    name: 'restore-users',
    cron: '0 0 * * *',
    ttlMs: 60 * 60 * 1000,
    renewEveryMs: 5 * 60 * 1000,
    dedupeTtlMs: 26 * 60 * 60 * 1000,
    run: function() { return creditService.checkAndRestoreUsers(); }
  }
];

const occurrenceKey = function(fireDate) {
  const date = fireDate instanceof Date && !Number.isNaN(fireDate.getTime())
    ? fireDate
    : new Date();
  return String(Math.floor(date.getTime() / 60000));
};

const runLockedTask = async function(definition, options, fireDate) {
  const lockService = options && options.lockService
    ? options.lockService
    : distributedLockService;
  const executionId = crypto.randomUUID();
  const startedAt = Date.now();
  const taskName = definition.name;
  const occurrence = occurrenceKey(fireDate);
  const lockName = 'scheduler:' + taskName + ':' + occurrence;
  let lock = null;
  let renewalTimer = null;

  try {
    lock = await lockService.acquire(lockName, definition.ttlMs);
    if (!lock.acquired) {
      logger.info('[Scheduler] skipped task=' + taskName + ' occurrence=' + occurrence + ' reason=already-claimed');
      return { status: 'skipped', taskName, executionId, occurrence };
    }

    if (definition.renewEveryMs >= 1000 && definition.renewEveryMs < definition.ttlMs) {
      renewalTimer = setInterval(function() {
        lockService.renew(lock, definition.ttlMs).catch(function(err) {
          logger.error('[Scheduler] lock renewal failed task=' + taskName + ' occurrence=' + occurrence, err);
        });
      }, definition.renewEveryMs);
      if (typeof renewalTimer.unref === 'function') renewalTimer.unref();
    }

    logger.info('[Scheduler] acquired task=' + taskName + ' occurrence=' + occurrence + ' execution=' + executionId);
    const value = await definition.run();
    if (renewalTimer) {
      clearInterval(renewalTimer);
      renewalTimer = null;
    }

    // 成功后保留“本次触发已完成”标记直到去重窗口结束，避免另一实例稍晚到达时重复执行。
    const dedupeTtlMs = Number(definition.dedupeTtlMs || Math.max(definition.ttlMs, 2 * 60 * 1000));
    const retained = await lockService.renew(lock, dedupeTtlMs);
    if (!retained) {
      const err = new Error('任务执行完成但已失去分布式锁所有权');
      err.code = 'SCHEDULER_LOCK_LOST';
      throw err;
    }

    const durationMs = Date.now() - startedAt;
    logger.info(
      '[Scheduler] success task=' + taskName + ' occurrence=' + occurrence +
      ' execution=' + executionId + ' durationMs=' + durationMs
    );
    return {
      status: 'success',
      taskName,
      executionId,
      occurrence,
      durationMs,
      value
    };
  } catch (err) {
    if (renewalTimer) clearInterval(renewalTimer);
    // 失败时释放锁，让同一触发周期中稍晚到达的其他实例有机会接管重试。
    if (lock && lock.acquired) {
      try {
        await lockService.release(lock);
      } catch (releaseErr) {
        logger.error('[Scheduler] failed to release failed-task lock task=' + taskName, releaseErr);
      }
    }
    const durationMs = Date.now() - startedAt;
    logger.error(
      '[Scheduler] failed task=' + taskName + ' occurrence=' + occurrence +
      ' execution=' + executionId + ' durationMs=' + durationMs,
      err
    );
    return {
      status: 'failed',
      taskName,
      executionId,
      occurrence,
      durationMs,
      error: err
    };
  }
};

const initScheduler = async function(options) {
  if (initialized) {
    logger.info('定时任务服务已初始化，忽略重复初始化请求');
    return { initialized: true, reused: true, jobs: scheduledJobs.length };
  }

  const settings = options || {};
  const scheduleLib = settings.scheduleLib || schedule;
  const redisClient = settings.redisClient || redis;
  const lockService = settings.lockService || distributedLockService;
  const definitions = settings.taskDefinitions || TASK_DEFINITIONS;
  const redisState = await redisClient.ready();
  const mockMode = typeof redisClient.isMock === 'function' ? redisClient.isMock() : redisState.mode === 'mock';
  if (process.env.NODE_ENV === 'production' && mockMode) {
    const err = new Error('生产环境启用定时任务时必须连接真实Redis');
    err.code = 'SCHEDULER_REDIS_REQUIRED';
    throw err;
  }

  scheduledJobs = definitions.map(function(definition) {
    return scheduleLib.scheduleJob(definition.cron, function(fireDate) {
      return runLockedTask(definition, { lockService }, fireDate);
    });
  });
  initialized = true;
  logger.info('定时任务服务已初始化，任务数: ' + scheduledJobs.length + '，Redis模式: ' + redisState.mode);
  return { initialized: true, reused: false, jobs: scheduledJobs.length, redisMode: redisState.mode };
};

const stopScheduler = async function() {
  for (const job of scheduledJobs) {
    if (job && typeof job.cancel === 'function') job.cancel();
  }
  scheduledJobs = [];
  initialized = false;
  return { stopped: true };
};

const getSchedulerState = function() {
  return {
    initialized,
    jobs: scheduledJobs.length,
    taskNames: TASK_DEFINITIONS.map(function(task) { return task.name; })
  };
};

module.exports = {
  TASK_DEFINITIONS,
  occurrenceKey,
  sendEndingReminders,
  expirePosters,
  expireWaitlist,
  runLockedTask,
  initScheduler,
  stopScheduler,
  getSchedulerState
};
