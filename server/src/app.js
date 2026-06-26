const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const logger = require('./config/logger');
const db = require('./config/database');
const redis = require('./config/redis');
const routes = require('./routes');
const mediaRouter = require('./routes/media');
const { apiLimiter } = require('./middleware/rateLimit');
const { checkTokenBlacklist } = require('./middleware/auth');
const requestContext = require('./middleware/requestContext');
const auditTrail = require('./middleware/auditTrail');
const schedulerService = require('./services/schedulerService');
const notificationOutboxPumpService = require('./services/notificationOutboxPumpService');
const operationalMonitorService = require('./services/operationalMonitorService');
const socketConnectionRateLimitService = require('./services/socketConnectionRateLimitService');
const socketAuthService = require('./services/socketAuthService');
const socketRedisAdapterService = require('./services/socketRedisAdapterService');
const realtimeEventService = require('./services/realtimeEventService');
const dataReadinessService = require('./services/dataReadinessService');
const productionConfigGuard = require('./services/productionConfigGuard');

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});
let shuttingDown = false;

app.use(requestContext.middleware);

const corsOptions = {
  origin: function(origin, callback) {
    if (!origin || config.corsOrigins.indexOf(origin) !== -1) callback(null, true);
    else callback(new Error('CORS origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'Idempotency-Key', 'X-Idempotency-Key',
    'X-Request-Id', 'X-Ops-Token'
  ],
  exposedHeaders: ['X-Request-Id']
};
app.use(cors(corsOptions));
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(auditTrail.middleware);
app.use(checkTokenBlacklist);
app.use(apiLimiter);

app.use('/uploads', mediaRouter);
app.use('/api/v1', routes);

app.use('/api', function(req, res) {
  res.status(404).json({ code: 404, message: '接口不存在', data: null });
});

app.use(function(err, req, res, next) {
  const requestLogger = req && req.log ? req.log : logger;
  requestLogger.error('unhandled_request_error', {
    error: err && err.message,
    code: err && err.code,
    stack: err && err.stack
  });
  if (res.headersSent) return next(err);
  const status = Number(err.httpStatus) >= 400 && Number(err.httpStatus) <= 599 ? Number(err.httpStatus) : 500;
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(status).json({
    code: status,
    message: isProduction && status === 500 ? '服务器内部错误' : (err.message || '服务器内部错误'),
    data: null,
    requestId: req && req.requestId ? req.requestId : undefined
  });
});

socketConnectionRateLimitService.configure(io);
socketAuthService.configureSocketServer(io);
realtimeEventService.setIO(io);
app.set('io', io);

const startServer = async function() {
  try {
    productionConfigGuard.validate();
    const readiness = await dataReadinessService.checkDataReadiness();
    const socketAdapterState = await socketRedisAdapterService.initSocketAdapter(io);
    logger.info('实时广播适配器已就绪，模式: ' + socketAdapterState.mode);

    if (process.env.ENABLE_SCHEDULER === 'true') {
      const schedulerState = await schedulerService.initScheduler();
      const outboxState = notificationOutboxPumpService.start();
      logger.info(
        '定时任务协调已就绪，任务数: ' + schedulerState.jobs +
        '，Redis模式: ' + schedulerState.redisMode +
        '，通知Outbox: ' + (outboxState.started ? '已启动' : '未启动')
      );
    } else {
      logger.info('定时任务默认未启动；通知Outbox应由独立Scheduler Worker处理');
    }

    const monitorState = operationalMonitorService.start();
    logger.info('运行监控已启动，间隔毫秒: ' + monitorState.intervalMs);

    server.listen(config.port, function() {
      const dbMode = db.isMock() ? '模拟数据' : '生产环境(MySQL)';
      const redisMode = redis.isMock() ? '模拟数据' : '生产环境(Redis)';
      const schemaMode = readiness.schema.ready ? '已就绪' : '未完成迁移';
      logger.info(
        '敬一书院预约管理系统服务已启动，端口: ' + config.port +
        '，数据库: ' + dbMode + '，Redis: ' + redisMode +
        '，预约结构: ' + schemaMode + '，实时广播: ' + socketAdapterState.mode
      );
    });
  } catch (err) {
    logger.error('服务启动失败:', err);
    if (process.env.NODE_ENV === 'production') {
      process.exitCode = 1;
      setTimeout(function() { process.exit(1); }, 50);
    }
  }
};

const closeSocketServer = function() {
  return new Promise(function(resolve) {
    if (!server.listening) return resolve();
    let resolved = false;
    const done = function() {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    const timeout = setTimeout(done, 5000);
    if (typeof timeout.unref === 'function') timeout.unref();
    io.close(function() {
      clearTimeout(timeout);
      logger.info('HTTP与WebSocket服务已关闭');
      done();
    });
  });
};

const shutdown = async function(signal) {
  if (shuttingDown) return { stopped: true, reused: true };
  shuttingDown = true;
  logger.info('收到' + signal + '，开始关闭服务');
  try {
    const monitorStop = await operationalMonitorService.stop({ timeoutMs: 10000 });
    if (!monitorStop.drained) logger.warn('运行监控仍有任务未在关闭窗口内完成');
  } catch (err) {
    logger.error('停止运行监控失败:', err);
  }
  try {
    const outboxStop = await notificationOutboxPumpService.stop({ timeoutMs: 10000 });
    if (!outboxStop.drained) logger.warn('通知Outbox仍有任务未在关闭窗口内完成');
  } catch (err) {
    logger.error('停止通知Outbox失败:', err);
  }
  try { await schedulerService.stopScheduler(); } catch (err) { logger.error('停止定时任务失败:', err); }
  try { await closeSocketServer(); } catch (err) { logger.error('关闭HTTP与WebSocket服务失败:', err); }
  try { await socketRedisAdapterService.closeSocketAdapter(); } catch (err) { logger.error('关闭实时广播适配器失败:', err); }
  try { await db.close(); } catch (err) { logger.error('关闭MySQL连接池失败:', err); }
  try {
    if (typeof redis.quit === 'function') await redis.quit();
    else if (typeof redis.disconnect === 'function') redis.disconnect();
  } catch (err) {
    if (typeof redis.disconnect === 'function') redis.disconnect();
    logger.error('关闭Redis连接失败:', err);
  }
  logger.info('服务资源已全部关闭');
  return { stopped: true, reused: false };
};

const handleSignal = function(signal) {
  shutdown(signal).then(function() { process.exit(0); }).catch(function(err) {
    logger.error('服务关闭异常:', err);
    process.exit(1);
  });
};

process.once('SIGTERM', function() { handleSignal('SIGTERM'); });
process.once('SIGINT', function() { handleSignal('SIGINT'); });

startServer();

module.exports = { app, server, io, startServer, shutdown, closeSocketServer };
