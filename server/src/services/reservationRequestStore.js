const db = require('../config/database');
const mockRequests = new Map();

function validateKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,64}$/.test(key)) {
    const err = new Error('请求标识格式无效');
    err.httpStatus = 400;
    throw err;
  }
  return key;
}

function mockKey(userId, key) { return String(userId) + ':' + key; }

async function find(connection, userId, key, locked) {
  if (db.isMock()) return mockRequests.get(mockKey(userId, key)) || null;
  const suffix = locked ? ' FOR UPDATE' : '';
  const [rows] = await connection.execute('SELECT * FROM reservation_requests WHERE user_id = ? AND idempotency_key = ? LIMIT 1' + suffix, [userId, key]);
  return rows && rows[0] ? rows[0] : null;
}

async function begin(connection, userId, key, fingerprint) {
  if (db.isMock()) {
    const storageKey = mockKey(userId, key);
    if (mockRequests.has(storageKey)) {
      const err = new Error('相同预约请求正在处理中');
      err.httpStatus = 409;
      throw err;
    }
    mockRequests.set(storageKey, { user_id: userId, idempotency_key: key, request_fingerprint: fingerprint, state: 'processing', response_json: null });
    return;
  }
  await connection.execute("INSERT INTO reservation_requests (user_id, idempotency_key, request_fingerprint, state) VALUES (?, ?, ?, 'processing')", [userId, key, fingerprint]);
}

async function finish(connection, userId, key, reservationId, responseData) {
  if (db.isMock()) {
    const row = mockRequests.get(mockKey(userId, key));
    if (!row) throw new Error('预约请求状态不存在');
    row.reservation_id = reservationId;
    row.response_json = JSON.stringify(responseData);
    row.state = 'completed';
    return;
  }
  await connection.execute("UPDATE reservation_requests SET reservation_id = ?, response_json = ?, state = 'completed' WHERE user_id = ? AND idempotency_key = ?", [reservationId, JSON.stringify(responseData), userId, key]);
}

function read(existing, fingerprint) {
  if (!existing) return null;
  if (existing.request_fingerprint !== fingerprint) {
    const err = new Error('相同请求标识不能用于不同预约');
    err.httpStatus = 409;
    throw err;
  }
  if (existing.state !== 'completed' || !existing.response_json) {
    const err = new Error('相同预约请求正在处理中');
    err.httpStatus = 409;
    throw err;
  }
  return JSON.parse(existing.response_json);
}

function removeMock(userId, key) { if (db.isMock()) mockRequests.delete(mockKey(userId, key)); }

module.exports = { validateKey, find, begin, finish, read, removeMock, _mockRequests: mockRequests };
