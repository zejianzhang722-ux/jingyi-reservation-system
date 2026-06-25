const crypto = require('crypto');
const db = require('../config/database');

const MAX_ATTEMPTS = 8;

const eventKey = function(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('通知事件键不能为空');
  if (raw.length <= 191) return raw;
  return raw.slice(0, 120) + ':' + crypto.createHash('sha256').update(raw).digest('hex');
};

const retrySeconds = function(attempt) {
  return Math.min(21600, 30 * Math.pow(2, Math.max(0, Number(attempt || 1) - 1)));
};

const tables = function() {
  const mock = require('../config/mock-db').__tables;
  if (!mock.notification_outbox) mock.notification_outbox = [];
  return mock;
};

const enqueueTx = async function(connection, item) {
  const key = eventKey(item.eventKey);
  const [result] = await connection.execute(
    "INSERT IGNORE INTO notification_outbox (event_key,notification_id,user_id,channel,event_name,payload,status,attempts,max_attempts,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',0,?,NOW(),NOW(),NOW())",
    [key, item.notificationId || null, item.userId || null, item.channel, item.eventName || null, JSON.stringify(item.payload || {}), Number(item.maxAttempts || MAX_ATTEMPTS)]
  );
  return { inserted: Number(result.affectedRows || 0) === 1, eventKey: key };
};

const enqueueMock = function(item) {
  const mock = tables();
  const key = eventKey(item.eventKey);
  const duplicate = mock.notification_outbox.find(function(row) { return row.event_key === key; });
  if (duplicate) return { inserted: false, eventKey: key, row: duplicate };
  const row = {
    id: mock.notification_outbox.reduce(function(max, entry) { return Math.max(max, Number(entry.id || 0)); }, 0) + 1,
    event_key: key,
    notification_id: item.notificationId || null,
    user_id: item.userId || null,
    channel: item.channel,
    event_name: item.eventName || null,
    payload: JSON.stringify(item.payload || {}),
    status: 'pending',
    attempts: 0,
    max_attempts: Number(item.maxAttempts || MAX_ATTEMPTS),
    available_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  mock.notification_outbox.push(row);
  return { inserted: true, eventKey: key, row };
};

const enqueue = async function(item) {
  if (db.isMock()) return enqueueMock(item);
  const connection = await db.getConnection();
  db.assertTransactional(connection);
  try {
    await connection.beginTransaction();
    const result = await enqueueTx(connection, item);
    await connection.commit();
    return result;
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    throw err;
  } finally {
    connection.release();
  }
};

const claimMock = function(limit, workerId) {
  const now = Date.now();
  const rows = tables().notification_outbox.filter(function(row) {
    const available = !row.available_at || new Date(row.available_at).getTime() <= now;
    const stale = row.status === 'processing' && row.locked_at && now - new Date(row.locked_at).getTime() > 300000;
    return available && Number(row.attempts) < Number(row.max_attempts) && (row.status === 'pending' || row.status === 'failed' || stale);
  }).sort(function(a, b) { return Number(a.id) - Number(b.id); }).slice(0, limit);
  rows.forEach(function(row) {
    row.status = 'processing';
    row.attempts = Number(row.attempts || 0) + 1;
    row.locked_at = new Date().toISOString();
    row.locked_by = workerId;
  });
  return rows.map(function(row) { return Object.assign({}, row); });
};

const claim = async function(options) {
  const limit = Math.min(200, Math.max(1, Number((options && options.limit) || 50)));
  const workerId = String((options && options.workerId) || ('outbox-' + crypto.randomUUID())).slice(0, 100);
  if (db.isMock()) return claimMock(limit, workerId);
  const connection = await db.getConnection();
  db.assertTransactional(connection);
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT * FROM notification_outbox WHERE available_at<=NOW() AND attempts<max_attempts AND (status IN ('pending','failed') OR (status='processing' AND locked_at<DATE_SUB(NOW(),INTERVAL 5 MINUTE))) ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED",
      [limit]
    );
    if (rows.length) {
      const ids = rows.map(function(row) { return Number(row.id); });
      await connection.execute(
        "UPDATE notification_outbox SET status='processing',attempts=attempts+1,locked_at=NOW(),locked_by=?,updated_at=NOW() WHERE id IN (" + ids.map(function() { return '?'; }).join(',') + ')',
        [workerId].concat(ids)
      );
      rows.forEach(function(row) { row.attempts = Number(row.attempts || 0) + 1; });
    }
    await connection.commit();
    return rows;
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    throw err;
  } finally {
    connection.release();
  }
};

const markMock = function(id, changes) {
  const row = tables().notification_outbox.find(function(entry) { return Number(entry.id) === Number(id); });
  if (row) Object.assign(row, changes, { updated_at: new Date().toISOString() });
};

const sent = async function(row) {
  if (db.isMock()) return markMock(row.id, { status: 'sent', sent_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null });
  await db.query("UPDATE notification_outbox SET status='sent',sent_at=NOW(),locked_at=NULL,locked_by=NULL,last_error=NULL,updated_at=NOW() WHERE id=? AND status='processing'", [row.id]);
};

const failed = async function(row, err) {
  const attempts = Number(row.attempts || 1);
  const terminal = attempts >= Number(row.max_attempts || MAX_ATTEMPTS);
  const message = String((err && err.message) || err || 'unknown').slice(0, 1000);
  const delay = retrySeconds(attempts);
  if (db.isMock()) return markMock(row.id, { status: terminal ? 'dead' : 'failed', available_at: new Date(Date.now() + delay * 1000).toISOString(), locked_at: null, locked_by: null, last_error: message });
  await db.query("UPDATE notification_outbox SET status=?,available_at=DATE_ADD(NOW(),INTERVAL ? SECOND),locked_at=NULL,locked_by=NULL,last_error=?,updated_at=NOW() WHERE id=?", [terminal ? 'dead' : 'failed', delay, message, row.id]);
};

module.exports = { MAX_ATTEMPTS, eventKey, retrySeconds, enqueueTx, enqueueMock, enqueue, claimMock, claim, sent, failed };
