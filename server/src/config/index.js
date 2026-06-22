module.exports = {
  port: process.env.PORT || 3000,
  jwt: {
    secret: process.env.JWT_SECRET || 'jingyi-reservation-jwt-secret-2026-dev',
    expiresIn: '2h',
    refreshExpiresIn: '7d'
  },
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '123456',
    database: process.env.MYSQL_DATABASE || 'jingyi_reservation',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: process.env.REDIS_DB || 0
  },
  wechat: {
    appId: process.env.WECHAT_APPID || 'wx_test_appid',
    appSecret: process.env.WECHAT_APPSECRET || 'wx_test_secret'
  },
  upload: {
    dir: './uploads',
    maxSize: 5 * 1024 * 1024
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
