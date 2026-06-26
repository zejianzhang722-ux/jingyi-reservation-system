const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../config/logger');
const realtimeEventService = require('./realtimeEventService');
const socketRedisAdapterService = require('./socketRedisAdapterService');
const outboxRepository = require('./notificationOutboxRepository');

const normalizeKey = function(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length <= 191) return raw;
  return raw.slice(0, 120) + ':' + crypto.createHash('sha256').update(raw).digest('hex');
};

const deriveDedupeKey = function(type, data, options) {
  const settings = options || {};
  if (settings.dedupeKey) return normalizeKey(settings.dedupeKey);
  const payload = data || {};
  const identifiers = [
    ['reservation', payload.reservationId || payload.reservation_id],
    ['poster', payload.posterId || payload.poster_id],
    ['feedback', payload.feedbackId || payload.feedback_id],
    ['waitlist', payload.waitlistId || payload.waitlist_id],
    ['credit', payload.creditLogId || payload.credit_log_id]
  ];
  const entity = identifiers.find(function(pair) { return pair[1] !== undefined && pair[1] !== null; });
  return entity ? normalizeKey(String(type) + ':' + entity[0] + ':' + entity[1]) : null;
};

const mapNotification = function(row) {
  let data = row.data || {};
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (err) { data = {}; }
  }
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    type: row.type,
    title: row.title,
    content: row.content,
    data,
    dedupeKey: row.dedupe_key || null,
    createdAt: row.created_at || new Date().toISOString()
  };
};

const createMock = function(userId, type, title, content, data, options) {
  const tables = require('../config/mock-db').__tables;
  if (!tables.notifications) tables.notifications = [];
  const dedupeKey = deriveDedupeKey(type, data, options);
  const existing = dedupeKey && tables.notifications.find(function(row) {
    return Number(row.user_id) === Number(userId) && row.dedupe_key === dedupeKey;
  });
  if (existing) return Object.assign(mapNotification(existing), { idempotent: true });
  const id = tables.notifications.reduce(function(max, row) { return Math.max(max, Number(row.id || 0)); }, 0) + 1;
  const row = {
    id,
    user_id: Number(userId),
    type,
    title,
    content,
    data: JSON.stringify(data || {}),
    dedupe_key: dedupeKey,
    is_read: 0,
    created_at: new Date().toISOString()
  };
  tables.notifications.push(row);
  outboxRepository.enqueueMock({
    eventKey: 'notification:' + userId + ':' + (dedupeKey || id) + ':websocket',
    notificationId: id,
    userId,
    channel: 'websocket',
    eventName: 'notification',
    payload: mapNotification(row)
  });
  return Object.assign(mapNotification(row), { idempotent: false });
};

const createNotification = async function(userId, type, title, content, data, options) {
  if (db.isMock()) return createMock(userId, type, title, content, data, options);
  const dedupeKey = deriveDedupeKey(type, data, options);
  const connection = await db.getConnection();
  db.assertTransactional(connection);
  try {
    await connection.beginTransaction();
    let row;
    let inserted = true;
    try {
      const [result] = await connection.execute(
        'INSERT INTO notifications (user_id,type,title,content,data,dedupe_key,is_read,created_at) VALUES (?,?,?,?,?,?,0,NOW())',
        [userId, type, title, content, JSON.stringify(data || {}), dedupeKey]
      );
      const [rows] = await connection.execute('SELECT * FROM notifications WHERE id = ?', [result.insertId]);
      row = rows[0];
    } catch (err) {
      if (!dedupeKey || !(err.code === 'ER_DUP_ENTRY' || Number(err.errno) === 1062)) throw err;
      const [rows] = await connection.execute(
        'SELECT * FROM notifications WHERE user_id = ? AND dedupe_key = ? FOR UPDATE',
        [userId, dedupeKey]
      );
      if (!rows.length) throw err;
      row = rows[0];
      inserted = false;
    }

    if (inserted) {
      const notification = mapNotification(row);
      await outboxRepository.enqueueTx(connection, {
        eventKey: 'notification:' + userId + ':' + (dedupeKey || row.id) + ':websocket',
        notificationId: row.id,
        userId,
        channel: 'websocket',
        eventName: 'notification',
        payload: notification
      });
    }
    await connection.commit();
    return Object.assign(mapNotification(row), { idempotent: !inserted });
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {
      logger.error('创建通知回滚失败:', rollbackErr);
    }
    logger.error('创建通知异常:', err);
    throw err;
  } finally {
    connection.release();
  }
};

const pushToUser = async function(userId, event, data) {
  const io = realtimeEventService.getIO();
  if (io && typeof io.to === 'function') {
    io.to('user:' + userId).emit(event, data);
    return { mode: 'local' };
  }
  await socketRedisAdapterService.publishExternalBroadcast(['user:' + userId], event, data);
  return { mode: 'redis' };
};

const pushToRoom = async function(roomId, event, data) {
  const io = realtimeEventService.getIO();
  if (!io) return { skipped: true };
  io.to('room:' + roomId).emit(event, data);
  return { mode: 'local' };
};

const pushToAll = async function(event, data) {
  const io = realtimeEventService.getIO();
  if (!io) return { skipped: true };
  io.emit(event, data);
  return { mode: 'local' };
};

const sendWechatNotification = async function(userId, templateId, templateData, page, options) {
  const settings = options || {};
  const raw = settings.dedupeKey || JSON.stringify({ userId, templateId, templateData, page });
  const key = normalizeKey('wechat:' + crypto.createHash('sha256').update(raw).digest('hex'));
  return outboxRepository.enqueue({
    eventKey: key,
    userId,
    channel: 'wechat',
    eventName: templateId,
    payload: { userId, templateId, templateData: templateData || {}, page: page || '' }
  });
};

const batchCreateNotification = async function(userIds, type, title, content, data, options) {
  const results = [];
  for (const userId of userIds) {
    results.push(await createNotification(userId, type, title, content, data, options));
  }
  return results;
};

module.exports = {
  normalizeKey,
  deriveDedupeKey,
  mapNotification,
  createNotification,
  pushToUser,
  pushToRoom,
  pushToAll,
  sendWechatNotification,
  batchCreateNotification
};
