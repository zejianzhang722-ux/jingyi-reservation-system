const crypto = require('crypto');

const boundedInteger = function(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
};

const config = {
  port: process.env.PORT || 3000,
  jwt: {
    secret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
    expiresIn: '2h',
    refreshExpiresIn: '7d'
  },
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jingyi_reservation',
    waitForConnections: true,
    connectionLimit: boundedInteger(process.env.MYSQL_CONNECTION_LIMIT, 10, 2, 100),
    maxIdle: boundedInteger(process.env.MYSQL_MAX_IDLE, 10, 1, 100),
    idleTimeout: boundedInteger(process.env.MYSQL_IDLE_TIMEOUT_MS, 60000, 1000, 600000),
    queueLimit: boundedInteger(process.env.MYSQL_QUEUE_LIMIT, 1000, 0, 100000),
    connectTimeout: boundedInteger(process.env.MYSQL_CONNECT_TIMEOUT_MS, 10000, 1000, 60000),
    dateStrings: true
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: process.env.REDIS_DB || 0
  },
  wechat: {
    appId: process.env.WECHAT_APPID || '',
    appSecret: process.env.WECHAT_APPSECRET || ''
  },
  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxSize: Math.min(10 * 1024 * 1024, Math.max(64 * 1024, Number(process.env.UPLOAD_MAX_SIZE || 5 * 1024 * 1024)))
  },
  reservation: {
    advanceDays: 3,
    advanceStartTime: '08:00',
    advanceEndTime: '23:00',
    cancelBeforeHours: 3,
    lateMinutes: 15,
    noshowCountLimit: 3,
    noshowPauseDays: 7
  },
  credit: {
    initialScore: 100,
    maxScore: 120,
    noshowPenalty: -20,
    violationPenalty: -10,
    goodReward: 5,
    goodThreshold: 10,
    feedbackReward: 3,
    warningThreshold: 80,
    restrictThreshold: 60,
    banThreshold: 30,
    restrictDays: 7,
    banDays: 30
  },
  baseUrl: process.env.BASE_URL || 'http://127.0.0.1:3000',
  adminOrigin: process.env.ADMIN_ORIGIN || 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS || [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://servicewechat.com',
    'https://mp.weixin.qq.com'
  ].join(',')).split(',').map(function(origin) {
    return origin.trim();
  }).filter(Boolean)
};

module.exports = config;
module.exports.boundedInteger = boundedInteger;
