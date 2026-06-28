const rateLimit = require('express-rate-limit');
const response = require('../utils/response');

const skipInTest = function() {
  return process.env.NODE_ENV === 'test';
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function(req, res) {
    return response.error(res, '请求过于频繁，请稍后再试', 429);
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function(req, res) {
    return response.error(res, '登录请求过于频繁，请稍后再试', 429);
  }
});

const studentLoginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: function(req) {
    const studentNo = req.body && req.body.studentNo ? String(req.body.studentNo).trim() : 'missing';
    return 'student-account:' + req.ip + ':' + studentNo;
  },
  handler: function(req, res) {
    return response.error(res, '登录请求过于频繁，请稍后再试', 429);
  }
});

const studentLoginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: function(req) {
    return 'student-ip:' + req.ip;
  },
  handler: function(req, res) {
    return response.error(res, '登录请求过于频繁，请稍后再试', 429);
  }
});

// Token 刷新是正常会话维护，不应与登录失败共享同一个计数器，
// 否则多个页面并发刷新会误伤后续登录。
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function(req, res) {
    return response.error(res, '登录状态刷新过于频繁，请稍后再试', 429);
  }
});

const reservationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function(req, res) {
    return response.error(res, '预约请求过于频繁，请稍后再试', 429);
  }
});

const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function(req, res) {
    return response.error(res, '签到请求过于频繁，请稍后再试', 429);
  }
});

module.exports = {
  apiLimiter,
  authLimiter,
  studentLoginAccountLimiter,
  studentLoginIpLimiter,
  refreshLimiter,
  reservationLimiter,
  checkinLimiter
};
