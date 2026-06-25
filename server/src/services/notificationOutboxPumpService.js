const crypto = require('crypto');
const logger = require('../config/logger');
const dispatcher = require('./notificationOutboxDispatcher');

let timer = null;
let running = false;
let workerId = null;

const tick = async function(options) {
  if (running) return { skipped: true, reason: 'previous-tick-running' };
  running = true;
  try {
    const result = await dispatcher.processBatch({
      limit: Number((options && options.batchSize) || process.env.NOTIFICATION_OUTBOX_BATCH_SIZE || 50),
      workerId: workerId || ('notification-worker-' + crypto.randomUUID())
    });
    if (result.claimed) logger.info('[NotificationOutbox] ' + JSON.stringify(result));
    return result;
  } finally {
    running = false;
  }
};

const start = function(options) {
  if (timer) return { started: true, reused: true, workerId };
  const settings = options || {};
  workerId = String(settings.workerId || ('notification-worker-' + process.pid + '-' + crypto.randomUUID())).slice(0, 100);
  const intervalMs = Math.max(5000, Number(settings.intervalMs || process.env.NOTIFICATION_OUTBOX_INTERVAL_MS || 15000));
  timer = setInterval(function() {
    tick(settings).catch(function(err) {
      logger.error('[NotificationOutbox] pump failed:', err);
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  tick(settings).catch(function(err) { logger.error('[NotificationOutbox] initial tick failed:', err); });
  return { started: true, reused: false, workerId, intervalMs };
};

const stop = function() {
  if (timer) clearInterval(timer);
  timer = null;
  workerId = null;
  return { stopped: true };
};

const state = function() {
  return { started: !!timer, running, workerId };
};

module.exports = { tick, start, stop, state };
