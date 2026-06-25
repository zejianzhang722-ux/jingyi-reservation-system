const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./config/logger');
const db = require('./config/database');
const redis = require('./config/redis');
const routes = require('./routes');
const { apiLimiter } = require('./middleware/rateLimit');
const { checkTokenBlacklist } = require('./middleware/auth');
const schedulerService = require('./services/schedulerService');
const dataReadinessService = require('./services/dataReadinessService');

const app = express();
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

var corsOptions = {
  origin: function (origin, callback) {
    if (!origin || config.corsOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS origin not allowed: ' + origin));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Idempotency-Key']
};
app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('combined', { stream: { write: function(msg) { logger.info(msg.trim()); } } }));
app.use(checkTokenBlacklist);
app.use(apiLimiter);

const uploadsDir = path.join(__dirname, '..', config.upload.dir);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir, {
  dotfiles: 'deny',
  setHeaders: function(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

app.use('/api/v1', routes);

app.use('/api', function(req, res) {
  res.status(404).json({ code: 404, message: '接口不存在', data: null });
});

app.use(function(err, req, res, next) {
  logger.error('未捕获异常:', err);
  if (res.headersSent) return next(err);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    code: 500,
    message: isProduction ? '服务器内部错误' : (err.message || '服务器内部错误'),
    data: null
  });
});

io.on('connection', function(socket) {
  logger.info('WebSocket客户端连接: ' + socket.id);

  socket.on('join', function(room) {
    socket.join(room);
  });

  socket.on('leave', function(room) {
    socket.leave(room);
  });

  socket.on('disconnect', function() {
    logger.info('WebSocket客户端断开: ' + socket.id);
  });
});

app.set('io', io);

const startServer = async function() {
  try {
    const readiness = await dataReadinessService.checkDataReadiness();

    if (process.env.ENABLE_SCHEDULER === 'true') {
      const schedulerState = await schedulerService.initScheduler();
      logger.info('定时任务协调已就绪，任务数: ' + schedulerState.jobs + '，Redis模式: ' + schedulerState.redisMode);
    } else {
      logger.info('定时任务默认未启动；如需启用请设置 ENABLE_SCHEDULER=true');
    }

    server.listen(config.port, function() {
      var dbMode = db.isMock() ? '模拟数据' : '生产环境(MySQL)';
      var redisMode = redis.isMock() ? '模拟数据' : '生产环境(Redis)';
      var schemaMode = readiness.schema.ready ? '已就绪' : '未完成迁移';
      console.log('========================================');
      console.log('  敬一书院预约管理系统服务已启动');
      console.log('  端口: ' + config.port);
      console.log('  数据库运行模式: ' + dbMode);
      console.log('  Redis运行模式: ' + redisMode);
      console.log('  预约一致性结构: ' + schemaMode);
      console.log('========================================');
      logger.info(
        '敬一书院预约管理系统服务已启动，端口: ' + config.port +
        '，数据库: ' + dbMode + '，Redis: ' + redisMode + '，预约结构: ' + schemaMode
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

const shutdown = async function(signal) {
  logger.info('收到' + signal + '，开始关闭服务');
  try {
    await schedulerService.stopScheduler();
  } catch (err) {
    logger.error('停止定时任务失败:', err);
  }
  server.close(function() {
    logger.info('HTTP服务已关闭');
  });
};

process.once('SIGTERM', function() { shutdown('SIGTERM'); });
process.once('SIGINT', function() { shutdown('SIGINT'); });

startServer();

module.exports = { app, server, io, startServer, shutdown };
