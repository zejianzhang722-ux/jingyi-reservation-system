const crypto = require('crypto');
const logger = require('../config/logger');
const dispatcher = require('./notificationOutboxDispatcher');

let timer = null;
let activeTick = null;
let workerId = null;

const tick = function(options) {
  if (activeTick) return Promise.resolve({ skipped: true, reason: 'previous-tick-running' });
  const settings = options || {};
  activeTick = dispatcher.processBatch({
    limit: Number(settings.batchSize || process.env.NOTIFICATION_OUTBOX_BATCH_SIZE || 50),
    workerId: workerId || ('notification-worker-' + crypto.randomUUID())
  }).finally(function() {
    activeTick = null;
  });
  return activeTick;
};

const start = function(options) {
  if (timer) return { started: true, reused: true, workerId };
  const settings = options || {};
  workerId = String(settings.workerId || ('notification-worker-' + process.pid + '-' + crypto.randomUUID())).slice(0, 100);
  const intervalMs = Math.max(5000, Number(settings.intervalMs || process.env.NOTIFICATION_OUTBOX_INTERVAL_MS || 15000));
  timer = setInterval(function() {
    tick(settings).then(function(result) {
      if (result && result.claimed) logger.info('[NotificationOutbox] ' + JSON.stringify(result));
    }).catch(function(err) {
      logger.error('[NotificationOutbox] pump failed:', err);
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  tick(settings).then(function(result) {
    if (result && result.claimed) logger.info('[NotificationOutbox] ' + JSON.stringify(result));
  }).catch(function(err) { logger.error('[NotificationOutbox] initial tick failed:', err); });
  return { started: true, reused: false, workerId, intervalMs };
};

const stop = async function(options) {
  const settings = options || {};
  const timeoutMs = Math.max(100, Number(settings.timeoutMs || 5000));
  if (timer) clearInterval(timer);
  timer = null;
  const pending = activeTick;
  let drained = true;
  if (pending) {
    drained = await Promise.race([
      pending.then(function() { return true; }).catch(function() { return true; }),
      new Promise(function(resolve) {
        const timeout = setTimeout(function() { resolve(false); }, timeoutMs);
        if (typeof timeout.unref === 'function') timeout.unref();
      })
    ]);
  }
  workerId = null;
  return { stopped: true, drained };
};

const state = function() {
  return { started: !!timer, running: !!activeTick, workerId };
};

module.exports = { tick, start, stop, state };
