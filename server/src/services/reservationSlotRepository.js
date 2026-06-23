const slotMath = require('./slotMath');

function conflictError() {
  const err = new Error('该时间段已被预约');
  err.httpStatus = 409;
  err.code = 'RESERVATION_SLOT_CONFLICT';
  return err;
}

function duplicate(err) {
  return !!(err && (err.code === 'ER_DUP_ENTRY' || Number(err.errno) === 1062));
}

async function allocate(connection, data, interval) {
  const slots = slotMath.build(data.startTime, data.endTime, interval);
  const resource = slotMath.resourceKey(data.roomId, data.seatId);
  for (const slot of slots) {
    try {
      await connection.execute(
        'INSERT INTO reservation_slots (reservation_id, room_id, seat_id, resource_key, reservation_date, slot_start) VALUES (?, ?, ?, ?, ?, ?)',
        [data.id, data.roomId, data.seatId || null, resource, data.date, slot]
      );
    } catch (err) {
      if (duplicate(err)) throw conflictError();
      throw err;
    }
  }
  return slots;
}

async function release(connection, reservationId) {
  return connection.execute('DELETE FROM reservation_slots WHERE reservation_id = ?', [reservationId]);
}

async function replace(connection, data, interval) {
  await release(connection, data.id);
  return allocate(connection, data, interval);
}

module.exports = { allocate, release, replace, duplicate, conflictError };
