const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const helpers = require('../utils/helpers');
const dayjs = require('dayjs');

const list = async function(req, res) {
  try {
    const { type, buildingId, status, keyword } = req.query;
    let sql = 'SELECT r.*, b.name as building_name FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id WHERE 1=1';
    const params = [];

    if (type) { sql += ' AND r.type = ?'; params.push(type); }
    if (buildingId) { sql += ' AND r.building_id = ?'; params.push(buildingId); }
    if (status) { sql += ' AND r.status = ?'; params.push(status); }
    if (keyword) { sql += ' AND (r.name LIKE ? OR r.description LIKE ? OR r.location LIKE ?)'; params.push('%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%'); }

    sql += ' ORDER BY r.building_id, r.floor, r.name';

    const [rooms] = await db.query(sql, params);

    return response.success(res, rooms);
  } catch (err) {
    logger.error('获取功能房列表异常:', err);
    return response.error(res, err.message);
  }
};

const detail = async function(req, res) {
  try {
    const roomId = req.params.id;

    const [rooms] = await db.query(
      'SELECT r.*, b.name as building_name FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id WHERE r.id = ?',
      [roomId]
    );
    if (rooms.length === 0) {
      return response.error(res, '功能房不存在', 404);
    }

    const room = rooms[0];

    const [seatCount] = await db.query(
      'SELECT COUNT(*) as total, SUM(CASE WHEN status = "available" THEN 1 ELSE 0 END) as available FROM seats WHERE room_id = ?',
      [roomId]
    );

    room.seat_total = seatCount[0].total;
    room.seat_available = seatCount[0].available;

    return response.success(res, room);
  } catch (err) {
    logger.error('获取功能房详情异常:', err);
    return response.error(res, err.message);
  }
};

const seats = async function(req, res) {
  try {
    const roomId = req.params.id;

    const [seatList] = await db.query(
      'SELECT * FROM seats WHERE room_id = ? ORDER BY row_num, col_num, seat_number',
      [roomId]
    );

    return response.success(res, seatList);
  } catch (err) {
    logger.error('获取座位列表异常:', err);
    return response.error(res, err.message);
  }
};

function reservationVisualStatus(reservation, req) {
  if (req.user && reservation.user_id === req.user.id) return 'myReservation';
  if (reservation.status === 'pending' || reservation.status === 'counselor_pending') return 'pending';
  return 'occupied';
}

const timeline = async function(req, res) {
  try {
    const roomId = req.params.id;
    const date = req.query.date;

    const [rooms] = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (rooms.length === 0) {
      return response.error(res, '功能房不存在', 404);
    }
    const room = rooms[0];

    const [seatList] = await db.query(
      "SELECT * FROM seats WHERE room_id = ? AND status != 'disabled' ORDER BY row_num, col_num, seat_number",
      [roomId]
    );

    const [reservations] = await db.query(
      "SELECT r.*, u.nickname, u.real_name FROM reservations r LEFT JOIN users u ON r.user_id = u.id WHERE r.room_id = ? AND r.date = ? AND r.status IN ('approved', 'checked_in', 'pending', 'counselor_pending')",
      [roomId, date]
    );
    logger.info('Timeline query - roomId:' + roomId + ' date:' + date + ' reservations:' + reservations.length + ' seats:' + seatList.length);

    const openStart = room.open_start_time || '08:00';
    const openEnd = room.open_end_time || '23:00';
    const hours = helpers.getHourRange(openStart, openEnd);
    const isStudyRoom = room.type === 'study_room';
    const hasSeats = isStudyRoom && seatList.length > 0;

    const timelineData = hours.map(function(hour) {
      const slotEnd = helpers.addMinutes(hour, 30);

      if (hasSeats) {
        const seatStatuses = seatList.map(function(seat) {
          let status = 'available';

          if (seat.status === 'maintenance') {
            status = 'unavailable';
          } else {
            const conflict = reservations.find(function(r) {
              return r.seat_id === seat.id && helpers.checkTimeConflict(r.start_time, r.end_time, hour, slotEnd);
            });

            if (conflict) status = reservationVisualStatus(conflict, req);
          }

          return {
            seatId: seat.id,
            seatNumber: seat.seat_number,
            row: seat.row_num,
            col: seat.col_num,
            status: status
          };
        });

        const availableCount = seatStatuses.filter(function(s) { return s.status === 'available'; }).length;
        const totalCount = seatStatuses.length;
        let slotStatus = 'available';
        if (availableCount === 0) {
          const hasMyReservation = seatStatuses.some(function(s) { return s.status === 'myReservation'; });
          const hasPending = seatStatuses.some(function(s) { return s.status === 'pending'; });
          slotStatus = hasMyReservation ? 'myReservation' : (hasPending ? 'pending' : 'occupied');
        }

        return {
          time: hour,
          endTime: slotEnd,
          status: slotStatus,
          availableCount: availableCount,
          totalCount: totalCount,
          seats: seatStatuses
        };
      } else {
        const conflictReservations = reservations.filter(function(r) {
          return helpers.checkTimeConflict(r.start_time, r.end_time, hour, slotEnd);
        });

        let status = 'available';
        const occupiedCount = conflictReservations.length;
        if (occupiedCount > 0) {
          const hasMyReservation = conflictReservations.some(function(r) { return req.user && r.user_id === req.user.id; });
          const hasPending = conflictReservations.some(function(r) { return r.status === 'pending' || r.status === 'counselor_pending'; });
          if (hasMyReservation) status = 'myReservation';
          else if (hasPending) status = 'pending';
          else status = 'occupied';
        }

        return {
          time: hour,
          endTime: slotEnd,
          status: status,
          availableCount: status === 'available' ? room.capacity : Math.max(0, room.capacity - occupiedCount),
          totalCount: room.capacity || 1
        };
      }
    });

    return response.success(res, {
      roomId: room.id,
      roomName: room.name,
      roomType: room.type,
      date: date,
      weekDay: helpers.getWeekDay(date),
      openStartTime: openStart,
      openEndTime: openEnd,
      maxDuration: room.max_duration,
      timeline: timelineData
    });
  } catch (err) {
    logger.error('获取时间线异常:', err);
    return response.error(res, err.message);
  }
};

const listByType = async function(req, res) {
  try {
    const type = req.params.type;

    const [rooms] = await db.query(
      'SELECT r.*, b.name as building_name FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id WHERE r.type = ? ORDER BY r.building_id, r.name',
      [type]
    );

    return response.success(res, rooms);
  } catch (err) {
    logger.error('按类型查询功能房异常:', err);
    return response.error(res, err.message);
  }
};

const listByBuilding = async function(req, res) {
  try {
    const building = req.params.building;

    const [rooms] = await db.query(
      'SELECT r.*, b.name as building_name FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id WHERE b.name LIKE ? ORDER BY r.floor, r.name',
      ['%' + building + '%']
    );

    return response.success(res, rooms);
  } catch (err) {
    logger.error('按楼栋查询功能房异常:', err);
    return response.error(res, err.message);
  }
};

const compare = async function(req, res) {
  try {
    const { roomIds } = req.body;
    if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
      return response.error(res, '请选择要对比的功能房', 400);
    }

    const placeholders = roomIds.map(function() { return '?'; }).join(',');
    const [rooms] = await db.query(
      'SELECT r.*, b.name as building_name FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id WHERE r.id IN (' + placeholders + ')',
      roomIds
    );

    return response.success(res, rooms);
  } catch (err) {
    logger.error('功能房对比异常:', err);
    return response.error(res, err.message);
  }
};

const listAnnouncements = async function(req, res) {
  try {
    const [announcements] = await db.query(
      "SELECT id, title, content, type, is_top, created_at FROM announcements WHERE status = 'published' ORDER BY is_top DESC, created_at DESC LIMIT 5"
    );
    return response.success(res, announcements);
  } catch (err) {
    logger.error('获取公告列表异常:', err);
    return response.error(res, err.message);
  }
};

const stats = async function(req, res) {
  try {
    const [roomResult] = await db.query("SELECT COUNT(*) as total FROM rooms WHERE status = 'open'");
    const [todayResult] = await db.query("SELECT COUNT(*) as count FROM reservations WHERE date = CURDATE() AND status IN ('approved', 'pending', 'checked_in')");
    return response.success(res, {
      activeRooms: roomResult[0].total,
      todayReservations: todayResult[0].count
    });
  } catch (err) {
    logger.error('获取房间统计异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { list, detail, seats, timeline, listByType, listByBuilding, compare, listAnnouncements, stats };
