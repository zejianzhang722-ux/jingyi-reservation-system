const logger = require('./config/logger');
const redis = require('./config/redis');
const dataReadinessService = require('./services/dataReadinessService');
const schedulerService = require('./services/schedulerService');

let shuttingDown = false;

const startWorker = async function() {
  const readiness = await dataReadinessService.checkDataReadiness();
  const schedulerState = await schedulerService.initScheduler();
  logger.info(
    '定时任务Worker已启动，任务数: ' + schedulerState.jobs +
    '，Redis模式: ' + schedulerState.redisMode +
    '，数据库模式: ' + readiness.database.mode
  );
  return { readiness, schedulerState };
};

const shutdownWorker = async function(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('定时任务Worker收到' + signal + '，开始停止');
  try {
    await schedulerService.stopScheduler();
  } catch (err) {
    logger.error('停止定时任务Worker失败:', err);
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
