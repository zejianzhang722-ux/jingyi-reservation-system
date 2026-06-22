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
  allowedHeaders: ['Content-Type', 'Authorization']
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
  fallthrough: false,
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

io.use(function(socket, next) {
  const token = socket.handshake && socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('unauthorized'));
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.tokenType === 'refresh' || decoded.typ === 'refresh') {
      return next(new Error('unauthorized'));
    }
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});

io.on('connection', function(socket) {
  logger.info('WebSocket客户端连接: ' + socket.id);

  socket.on('join', function(room) {
    const normalizedRoom = String(room || '');
    const ownUserRoom = 'user:' + socket.user.id;
    const isAdmin = ['admin', 'super_admin', 'counselor'].includes(socket.user.role);
    if (normalizedRoom === ownUserRoom || (isAdmin && normalizedRoom.startsWith('admin:'))) {
      socket.join(normalizedRoom);
    }
  });

  socket.on('leave', function(room) {
    socket.leave(String(room || ''));
  });

  socket.on('disconnect', function() {
    logger.info('WebSocket客户端断开: ' + socket.id);
  });
});

app.set('io', io);

if (process.env.ENABLE_SCHEDULER === 'true') {
  initScheduler();
} else {
  logger.info('定时任务默认未启动；如需启用请设置 ENABLE_SCHEDULER=true');
}

setTimeout(function() {
  server.listen(config.port, function() {
    var dbMode = db.isMock() ? '模拟数据' : '生产环境(MySQL)';
    var redisMode = redis.isMock() ? '模拟数据' : '生产环境(Redis)';
    console.log('========================================');
    console.log('  敬一书院预约管理系统服务已启动');
    console.log('  端口: ' + config.port);
    console.log('  数据库运行模式: ' + dbMode);
    console.log('  Redis运行模式: ' + redisMode);
    console.log('========================================');
    logger.info('敬一书院预约管理系统服务已启动，端口: ' + config.port + '，数据库: ' + dbMode + '，Redis: ' + redisMode);
  });
}, 2000);

module.exports = { app, server, io };
