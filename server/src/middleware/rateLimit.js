const rateLimit = require('express-rate-limit');
const response = require('../utils/response');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function(req, res) {
    return response.error(res, '请求过于频繁，请稍后再试', 429);
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function(req, res) {
    return response.error(res, '登录请求过于频繁，请稍后再试', 429);
  }
});

const reservationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function(req, res) {
    return response.error(res, '预约请求过于频繁，请稍后再试', 429);
  }
});

const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function(req, res) {
    return response.error(res, '签到请求过于频繁，请稍后再试', 429);
  }
});

module.exports = { apiLimiter, authLimiter, reservationLimiter, checkinLimiter };
