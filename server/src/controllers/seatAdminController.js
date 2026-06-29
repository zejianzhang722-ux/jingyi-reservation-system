const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');

const ACTIVE_RESERVATION_STATUS = ['pending', 'counselor_pending', 'approved', 'checked_in'];

function toPositiveInt(value, fallback) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function todayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function normalizeSeatPayload(body) {
  body = body || {};
  return {
    roomId: toPositiveInt(body.roomId || body.room_id, 0),
    count: toPositiveInt(body.count, 0),
    startNumber: toPositiveInt(body.startNumber || body.start_number, 1),
    rowSize: toPositiveInt(body.rowSize || body.row_size, 10)
  };
}

function validateSeatPayload(payload) {
  if (!payload.roomId) return '功能房ID无效';
  if (!payload.count || payload.count < 1 || payload.count > 500) return '座位数量应为1-500';
  if (!payload.startNumber || payload.startNumber < 1 || payload.startNumber > 9999) return '起始编号应为1-9999';
  if (!payload.rowSize || payload.rowSize < 1 || payload.rowSize > 50) return '每行数量应为1-50';
  return '';
}

function buildSeatRows(payload) {
  const rows = [];
  for (let i = 0; i < payload.count; i++) {
    const seatNumber = String(payload.startNumber + i).padStart(2, '0');
    const rowNum = Math.floor(i / payload.rowSize) + 1;
    const colNum = (i % payload.rowSize) + 1;
    rows.push([payload.roomId, seatNumber, rowNum, colNum, 'available']);
  }
  return rows;
}

async function assertRoomCanRebuild(roomId, queryRunner) {
  const [rooms] = await queryRunner(
    'SELECT id, name FROM rooms WHERE id = ? LIMIT 1',
    [roomId]
  );
  if (!rooms || rooms.length === 0) {
    const err = new Error('功能房不存在');
    err.httpStatus = 404;
    throw err;
  }

  const [activeResult] = await queryRunner(
    'SELECT COUNT(*) as active FROM reservations WHERE room_id = ? AND status IN (?, ?, ?, ?) AND date >= ?',
    [roomId].concat(ACTIVE_RESERVATION_STATUS, [todayString()])
  );
  const activeCount = Number(activeResult && activeResult[0] ? activeResult[0].active : 0) || 0;
  if (activeCount > 0) {
    const err = new Error('该功能房存在未完成或未来预约，暂不能重新生成座位');
    err.httpStatus = 409;
    throw err;
  }

  return rooms[0];
}

async function rebuildSeatsWithQueries(req, res, payload) {
  await assertRoomCanRebuild(payload.roomId, function(sql, params) { return db.query(sql, params); });
  const rows = buildSeatRows(payload);
  await db.query('DELETE FROM seats WHERE room_id = ?', [payload.roomId]);
  if (rows.length > 0) {
    const placeholders = rows.map(function() { return '(?, ?, ?, ?, ?)'; }).join(',');
    await db.query(
      'INSERT INTO seats (room_id, seat_number, row_num, col_num, status) VALUES ' + placeholders,
      rows.flat()
    );
  }
  await db.query('UPDATE rooms SET capacity = ? WHERE id = ?', [payload.count, payload.roomId]);
  await db.query(
    'INSERT INTO operation_logs (admin_id, action, target_type, target_id, description, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
    [req.user.id, 'rebuild_seats', 'rooms', payload.roomId, '重新生成座位：' + payload.count + '个']
  ).catch(function() {});
  return response.success(res, { count: payload.count }, '座位已重新生成');
}

async function rebuildSeatsWithTransaction(req, res, payload) {
  const connection = await db.getConnection();
  if (!connection || connection.isMock || typeof connection.beginTransaction !== 'function') {
    return rebuildSeatsWithQueries(req, res, payload);
  }

  try {
    await connection.beginTransaction();
    await assertRoomCanRebuild(payload.roomId, function(sql, params) { return connection.execute(sql, params); });
    const rows = buildSeatRows(payload);
    await connection.execute('DELETE FROM seats WHERE room_id = ?', [payload.roomId]);
    if (rows.length > 0) {
      const placeholders = rows.map(function() { return '(?, ?, ?, ?, ?)'; }).join(',');
      await connection.execute(
        'INSERT INTO seats (room_id, seat_number, row_num, col_num, status) VALUES ' + placeholders,
        rows.flat()
      );
    }
    await connection.execute('UPDATE rooms SET capacity = ? WHERE id = ?', [payload.count, payload.roomId]);
    await connection.execute(
      'INSERT INTO operation_logs (admin_id, action, target_type, target_id, description, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [req.user.id, 'rebuild_seats', 'rooms', payload.roomId, '重新生成座位：' + payload.count + '个']
    ).catch(function() {});
    await connection.commit();
    return response.success(res, { count: payload.count }, '座位已重新生成');
  } catch (err) {
    if (typeof connection.rollback === 'function') {
      await connection.rollback().catch(function() {});
    }
    throw err;
  } finally {
    if (typeof connection.release === 'function') connection.release();
  }
}

const rebuildSeats = async function(req, res) {
  try {
    const payload = normalizeSeatPayload(req.body);
    const error = validateSeatPayload(payload);
    if (error) return response.error(res, error, 400);
    return await rebuildSeatsWithTransaction(req, res, payload);
  } catch (err) {
    logger.error('重新生成座位异常:', err);
    return response.error(res, err.message || '重新生成座位失败', err.httpStatus || 500);
  }
};

module.exports = { rebuildSeats };
