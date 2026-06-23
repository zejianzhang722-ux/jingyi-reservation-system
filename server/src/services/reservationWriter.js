const helpers = require('../utils/helpers');

async function insert(connection, input, room) {
  const code = helpers.generateReservationCode();
  const sql = 'INSERT INTO reservations (user_id, room_id, seat_id, date, start_time, end_time, purpose, participants, status, reservation_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())';
  const resultSet = await connection.execute(sql, [input.userId, input.roomId, input.seatId || null, input.date, input.startTime, input.endTime, input.purpose || '', input.participants || 1, input.status, code]);
  const result = resultSet[0];
  return { id: result.insertId, roomId: Number(input.roomId), roomName: room.name, date: input.date, startTime: input.startTime, endTime: input.endTime, seatId: input.seatId || null, purpose: input.purpose || '', participants: input.participants || 1, reservationCode: code, status: input.status, idempotentReplay: false };
}

module.exports = { insert };
