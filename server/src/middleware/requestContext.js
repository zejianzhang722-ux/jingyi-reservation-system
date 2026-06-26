const crypto = require('crypto');
const logger = require('../config/logger');
const metricsService = require('../services/metricsService');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

const requestId = function(req) {
  const supplied = String((req.headers && req.headers['x-request-id']) || '').trim();
  return REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
};

const safePath = function(req) {
  return metricsService.normalizePath(req && (req.originalUrl || req.url || req.path));
};

const middleware = function(req, res, next) {
  const id = requestId(req);
  const started = process.hrtime.bigint();
  const completeMetric = metricsService.beginRequest();
  let completed = false;

  req.requestId = id;
  req.log = logger.child({ requestId: id });
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);

  const complete = function(kind) {
    if (completed) return;
    completed = true;
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    completeMetric(req, res.statusCode, elapsed);
    const level = res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'info');
    req.log.log(level, 'http_request_completed', {
      method: req.method,
      path: safePath(req),
      statusCode: res.statusCode,
      durationMs: Math.round(elapsed * 100) / 100,
      actorId: req.user && req.user.id ? Number(req.user.id) : null,
      actorRole: req.user && req.user.role ? req.user.role : null,
      completion: kind
    });
  };

  res.once('finish', function() { complete('finish'); });
  res.once('close', function() { complete('close'); });
  next();
};

module.exports = {
  REQUEST_ID_PATTERN,
  requestId,
  safePath,
  middleware
};
