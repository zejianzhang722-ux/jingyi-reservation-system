const db = require('../config/database');
const logger = require('../config/logger');
const repository = require('./notificationOutboxRepository');
const realtimeEventService = require('./realtimeEventService');
const socketRedisAdapterService = require('./socketRedisAdapterService');

const parsePayload = function(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (err) { return {}; }
};

const websocket = async function(row, payload, dependencies) {
  const userId = Number(row.user_id || payload.userId);
  if (!userId) throw new Error('WebSocket通知缺少用户编号');
  const eventName = row.event_name || 'notification';
  const io = dependencies.getIO();
  if (io && typeof io.to === 'function') {
    io.to('user:' + userId).emit(eventName, payload);
    return { mode: 'local' };
  }
  await dependencies.publishExternalBroadcast(['user:' + userId], eventName, payload);
  return { mode: 'redis' };
};

const wechat = async function(row, payload, dependencies) {
  const userId = Number(row.user_id || payload.userId);
  if (!userId) throw new Error('微信通知缺少用户编号');
  const [users] = await dependencies.dbClient.query('SELECT openid FROM users WHERE id = ?', [userId]);
  if (!users.length || !users[0].openid) return { skipped: true, reason: 'openid-missing' };
  await dependencies.wechatClient.sendSubscribeMessage(
    users[0].openid,
    payload.templateId,
    payload.templateData || {},
    payload.page || ''
  );
  return { sent: true };
};

const dispatch = async function(row, options) {
  const settings = options || {};
  const dependencies = {
    dbClient: settings.dbClient || db,
    getIO: settings.getIO || realtimeEventService.getIO,
    publishExternalBroadcast: settings.publishExternalBroadcast || socketRedisAdapterService.publishExternalBroadcast,
    wechatClient: settings.wechatClient || require('../utils/wechat')
  };
  const payload = parsePayload(row.payload);
  if (row.channel === 'websocket') return websocket(row, payload, dependencies);
  if (row.channel === 'wechat') return wechat(row, payload, dependencies);
  throw new Error('不支持的通知通道: ' + row.channel);
};

const processBatch = async function(options) {
  const settings = options || {};
  const rows = await repository.claim({ limit: settings.limit, workerId: settings.workerId });
  const result = { claimed: rows.length, sent: 0, failed: 0, dead: 0 };
  for (const row of rows) {
    try {
      await dispatch(row, settings);
      await repository.sent(row);
      result.sent += 1;
    } catch (err) {
      logger.error('通知Outbox发送失败 id=' + row.id + ' channel=' + row.channel + ':', err);
      await repository.failed(row, err);
      if (Number(row.attempts || 1) >= Number(row.max_attempts || repository.MAX_ATTEMPTS)) result.dead += 1;
      else result.failed += 1;
    }
  }
  return result;
};

module.exports = { parsePayload, websocket, wechat, dispatch, processBatch };
