const config = require('../config');
const runtimeMode = require('../config/runtimeMode');

function fail(status, message) {
  const err = new Error(message);
  err.httpStatus = status;
  return err;
}

async function run(connection, input) {
  const [users] = await connection.execute(
    'SELECT credit_score, status FROM users WHERE id = ? FOR UPDATE',
    [input.userId]
  );
  if (!users || users.length === 0) throw fail(404, '用户不存在');
  if (users[0].status === 'banned' || users[0].status === 'restricted') {
    throw fail(403, '账号已被限制预约');
  }
  if (Number(users[0].credit_score) < config.credit.restrictThreshold) {
    throw fail(403, '信用分过低，无法预约');
  }

  const [rooms] = await connection.execute('SELECT * FROM rooms WHERE id = ?', [input.roomId]);
  if (!rooms || rooms.length === 0) throw fail(404, '功能房不存在');
  if (rooms[0].status !== 'open') throw fail(400, '该功能房当前不可预约');

  if (input.seatId) {
    const [seats] = await connection.execute(
      'SELECT id, room_id, status FROM seats WHERE id = ? AND room_id = ?',
      [input.seatId, input.roomId]
    );
    if (!seats || seats.length === 0) throw fail(400, '所选座位不属于该功能房');
    if (seats[0].status !== 'available') throw fail(409, '所选座位当前不可预约');
  }

  const [dailyRows] = await connection.execute(
    "SELECT COUNT(*) AS count FROM reservations WHERE user_id = ? AND date = ? AND status IN ('approved', 'pending', 'counselor_pending', 'checked_in')",
    [input.userId, input.date]
  );
  if (Number(dailyRows[0].count) >= runtimeMode.dailyLimit) {
    throw fail(409, '每日最多预约' + runtimeMode.dailyLimit + '次');
  }

  const [activeRows] = await connection.execute(
    "SELECT COUNT(*) AS count FROM reservations WHERE user_id = ? AND date >= CURDATE() AND status IN ('approved', 'pending', 'counselor_pending', 'checked_in')",
    [input.userId]
  );
  if (Number(activeRows[0].count) >= runtimeMode.activeLimit) {
    throw fail(409, '同时最多保留' + runtimeMode.activeLimit + '个有效预约');
  }

  return rooms[0];
}

module.exports = { run, fail };
