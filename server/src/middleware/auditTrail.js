const logger = require('../config/logger');
const auditTrailService = require('../services/auditTrailService');

const AUDIT_WAIT_TIMEOUT_MS = Math.max(250, Number(process.env.AUDIT_WRITE_TIMEOUT_MS || 2000));

const waitWithTimeout = function(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise(function(resolve) {
      const timeout = setTimeout(function() { resolve({ timedOut: true }); }, timeoutMs);
      if (typeof timeout.unref === 'function') timeout.unref();
    })
  ]);
};

const middleware = function(req, res, next) {
  const originalJson = res.json.bind(res);
  let auditStarted = false;

  const writeAudit = async function() {
    if (auditStarted || !auditTrailService.shouldAuditRequest(req)) return { skipped: true };
    auditStarted = true;
    const event = auditTrailService.eventFromRequest(req, res);
    try {
      const result = await waitWithTimeout(auditTrailService.record(event), AUDIT_WAIT_TIMEOUT_MS);
      if (result && result.timedOut) {
        logger.warn('audit_trail_write_timeout', {
          requestId: req.requestId,
          action: event.action,
          timeoutMs: AUDIT_WAIT_TIMEOUT_MS
        });
      }
      return result;
    } catch (err) {
      logger.error('audit_trail_request_write_failed', {
        requestId: req.requestId,
        action: event.action,
        error: err && err.message
      });
      return { failed: true };
    }
  };

  res.json = function(body) {
    if (!auditTrailService.shouldAuditRequest(req) || auditStarted) return originalJson(body);
    writeAudit().then(function() {
      if (!res.headersSent) originalJson(body);
    }).catch(function() {
      if (!res.headersSent) originalJson(body);
    });
    return res;
  };

  res.once('finish', function() {
    if (!auditStarted && auditTrailService.shouldAuditRequest(req)) {
      writeAudit().catch(function() {});
    }
  });

  next();
};

module.exports = {
  AUDIT_WAIT_TIMEOUT_MS,
  waitWithTimeout,
  middleware
};
