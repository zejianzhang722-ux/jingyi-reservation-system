const logger = require('./config/logger');
const db = require('./config/database');
const redis = require('./config/redis');
const dataReadinessService = require('./services/dataReadinessService');
const backupSchemaService = require('./services/backupSchemaService');
const schedulerService = require('./services/schedulerService');
const notificationOutboxPumpService = require('./services/notificationOutboxPumpService');
const backupScheduleService = require('./services/backupScheduleService');

let shuttingDown = false;

const startWorker = async function() {
  const readiness = await dataReadinessService.checkDataReadiness();
  const backupSchema = await backupSchemaService.assertReady();
  const schedulerState = await schedulerService.initScheduler();
  const outboxState = notificationOutboxPumpService.start();
  const backupState = backupScheduleService.start();
  logger.info(
    '定时任务Worker已启动，任务数: ' + schedulerState.jobs +
    '，Redis模式: ' + schedulerState.redisMode +
    '，数据库模式: ' + readiness.database.mode +
    '，备份结构: ' + (backupSchema.ready ? '已就绪' : '未就绪') +
    '，通知Outbox: ' + (outboxState.started ? '已启动' : '未启动') +
    '，自动备份: ' + (backupState.started ? '已启动' : '未启动')
  );
  return { readiness, backupSchema, schedulerState, outboxState, backupState };
};

const shutdownWorker = async function(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('定时任务Worker收到' + signal + '，开始停止');
  try { backupScheduleService.stop(); } catch (err) { logger.error('停止自动备份任务失败:', err); }
  try {
    const outboxStop = await notificationOutboxPumpService.stop({ timeoutMs: 10000 });
    if (!outboxStop.drained) logger.warn('通知Outbox仍有任务未在关闭窗口内完成');
  } catch (err) {
    logger.error('停止通知Outbox失败:', err);
  }
  try {
    await schedulerService.stopScheduler();
  } catch (err) {
    logger.error('停止定时任务Worker失败:', err);
  }
  try {
    await db.close();
  } catch (err) {
    logger.error('关闭Worker数据库连接失败:', err);
  }
  try {
    if (typeof redis.quit === 'function') await redis.quit();
    else if (typeof redis.disconnect === 'function') redis.disconnect();
  } catch (err) {
    if (typeof redis.disconnect === 'function') redis.disconnect();
  }
  process.exit(0);
};

process.once('SIGTERM', function() { shutdownWorker('SIGTERM'); });
process.once('SIGINT', function() { shutdownWorker('SIGINT'); });

startWorker().catch(function(err) {
  logger.error('定时任务Worker启动失败:', err);
  process.exitCode = 1;
  setTimeout(function() { process.exit(1); }, 50);
});

module.exports = { startWorker, shutdownWorker };
