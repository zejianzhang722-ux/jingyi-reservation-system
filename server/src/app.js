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
const { initScheduler } = require('./services/schedulerService');

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

const corsOptions = {
  origin: function(origin, callback) {
    if (!origin || config.corsOrigins.indexOf(origin) !== -1) callback(null, true);
    else callback(new Error('CORS origin not allowed: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key']
};

app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('combined', { stream: { write: function(msg) { logger.info(msg.trim()); } } }));

app.use(function(req, res, next) {
  if (process.env.NODE_ENV === 'production' && (db.isMock() || redis.isMock())) {
    return res.status(503).json({ code: 503, message: '核心数据服务暂不可用', data: null });
  }
  next();
});

app.use(checkTokenBlacklist);
app.use(apiLimiter);

const uploadsDir = path.join(__dirname, '..', config.upload.dir);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, {
  dotfiles: 'deny',
  setHeaders: function(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); }
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
  socket.on('join', function(room) { socket.join(room); });
  socket.on('leave', function(room) { socket.leave(room); });
  socket.on('disconnect', function() { logger.info('WebSocket客户端断开: ' + socket.id); });
});
app.set('io', io);

async function start() {
  await db.initialize();
  await redis.ping();
  if (process.env.NODE_ENV === 'production' && (db.isMock() || redis.isMock())) {
    throw new Error('生产环境禁止使用Mock数据库或Mock Redis');
  }

  if (process.env.ENABLE_SCHEDULER === 'true') initScheduler();
  else logger.info('定时任务默认未启动；如需启用请设置 ENABLE_SCHEDULER=true');

  return new Promise(function(resolve) {
    server.listen(config.port, function() {
      const dbMode = db.isMock() ? '显式Mock' : 'MySQL';
      const redisMode = redis.isMock() ? '显式Mock' : 'Redis';
      logger.info('服务已启动，端口: ' + config.port + '，数据库: ' + dbMode + '，缓存: ' + redisMode);
      resolve(server);
    });
  });
}

const startupPromise = start().catch(function(err) {
  logger.error('服务启动失败:', err);
  if (require.main === module) {
    setTimeout(function() { process.exit(1); }, 20);
  }
  throw err;
});

module.exports = { app, server, io, start, startupPromise };
