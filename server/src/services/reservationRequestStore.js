function validateKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,64}$/.test(key)) {
    const err = new Error('请求标识格式无效');
    err.httpStatus = 400;
    throw err;
  }
  return key;
}

async function find(connection, userId, key, locked) {
  const suffix = locked ? ' FOR UPDATE' : '';
  const [rows] = await connection.execute(
    'SELECT * FROM reservation_requests WHERE user_id = ? AND idempotency_key = ? LIMIT 1' + suffix,
    [userId, key]
  );
  return rows && rows[0] ? rows[0] : null;
}

async function begin(connection, userId, key, fingerprint) {
  return connection.execute(
    "INSERT INTO reservation_requests (user_id, idempotency_key, request_fingerprint, state) VALUES (?, ?, ?, 'processing')",
    [userId, key, fingerprint]
  );
}

async function finish(connection, userId, key, reservationId, responseData) {
  return connection.execute(
    "UPDATE reservation_requests SET reservation_id = ?, response_json = ?, state = 'completed' WHERE user_id = ? AND idempotency_key = ?",
    [reservationId, JSON.stringify(responseData), userId, key]
  );
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

module.exports = { validateKey, find, begin, finish, read };
