const dayjs = require('dayjs');
const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const helpers = require('../utils/helpers');

const buildingFilter = function(req, alias) {
  if (req.adminScope.isGlobal) return { sql: '', params: [] };
  return { sql: ' AND ' + (alias || 'rm') + '.building_id = ?', params: [req.adminScope.buildingId] };
};

const dateRange = function(req) {
  return {
    start: req.query.startDate || helpers.formatDate(dayjs().subtract(30, 'day')),
    end: req.query.endDate || helpers.formatDate(new Date())
  };
};

const scopedMockData = function(req) {
  const tables = require('../config/mock-db').__tables;
  const rooms = (tables.rooms || []).filter(function(room) {
    return req.adminScope.isGlobal || Number(room.building_id) === Number(req.adminScope.buildingId);
  });
  const roomIds = new Set(rooms.map(function(room) { return Number(room.id); }));
  const reservations = (tables.reservations || []).filter(function(row) {
    return roomIds.has(Number(row.room_id));
  });
  return { rooms, reservations, users: tables.users || [] };
};

const mockDashboard = function(req, res) {
  const today = helpers.formatDate(new Date());
  const data = scopedMockData(req);
  const reservations = data.reservations;
  const rooms = data.rooms;
  const dates = [];
  const trendReservations = [];
  const trendUsed = [];
  const trendNoshow = [];

  for (let index = 6; index >= 0; index -= 1) {
    const date = dayjs().subtract(index, 'day').format('YYYY-MM-DD');
    const dayRows = reservations.filter(function(row) { return String(row.date) === date; });
    dates.push(dayjs(date).format('MM-DD'));
    trendReservations.push(dayRows.length);
    trendUsed.push(dayRows.filter(function(row) { return ['approved', 'checked_in', 'completed'].includes(row.status); }).length);
    trendNoshow.push(dayRows.filter(function(row) { return row.status === 'noshow'; }).length);
  }

  const roomTypeMap = {};
  rooms.filter(function(room) { return room.status === 'open'; }).forEach(function(room) {
    roomTypeMap[room.type] = (roomTypeMap[room.type] || 0) + 1;
  });

  const roomNameById = {};
  rooms.forEach(function(room) { roomNameById[Number(room.id)] = room.name; });
  const reservationCountByRoom = {};
  reservations.filter(function(row) {
    return ['approved', 'checked_in', 'completed'].includes(row.status);
  }).forEach(function(row) {
    reservationCountByRoom[Number(row.room_id)] = (reservationCountByRoom[Number(row.room_id)] || 0) + 1;
  });

  const ranking = Object.keys(roomNameById).map(function(id) {
    return { name: roomNameById[id], count: reservationCountByRoom[Number(id)] || 0 };
  }).sort(function(a, b) { return b.count - a.count; }).slice(0, 8);

  const userNameById = {};
  data.users.forEach(function(user) { userNameById[Number(user.id)] = user.real_name || user.name || user.nickname || ''; });

  return response.success(res, {
    todayReservations: reservations.filter(function(row) { return String(row.date) === today; }).length,
    pendingCount: reservations.filter(function(row) { return ['pending', 'counselor_pending'].includes(row.status); }).length,
    usingCount: reservations.filter(function(row) { return row.status === 'checked_in'; }).length,
    noshowCount: reservations.filter(function(row) { return row.status === 'noshow' && String(row.date) === today; }).length,
    trend: { dates, reservations: trendReservations, used: trendUsed, noshow: trendNoshow },
    roomTypeStats: Object.keys(roomTypeMap).map(function(type) { return { name: type, value: roomTypeMap[type] }; }),
    usageRanking: {
      rooms: ranking.map(function(row) { return row.name; }),
      rates: ranking.map(function(row) { return Math.min(100, Math.round(row.count / 30 * 100)); })
    },
    pendingItems: reservations.filter(function(row) {
      return ['pending', 'counselor_pending'].includes(row.status);
    }).slice(0, 10).map(function(row) {
      return {
        id: row.id,
        tag: row.status === 'counselor_pending' ? '辅导员审核' : '待审核',
        text: (userNameById[Number(row.user_id)] || '') + ' 申请 ' + (roomNameById[Number(row.room_id)] || '') + (row.purpose ? ' - ' + row.purpose : ''),
        time: row.date + ' ' + row.start_time
      };
    })
  });
};

const dashboard = async function(req, res) {
  try {
    if (db.isMock()) return mockDashboard(req, res);

    const today = helpers.formatDate(new Date());
    const scope = buildingFilter(req, 'rm');
    const count = async function(condition, params) {
      const [rows] = await db.query(
        'SELECT COUNT(*) AS count FROM reservations r JOIN rooms rm ON rm.id = r.room_id WHERE ' + condition + scope.sql,
        (params || []).concat(scope.params)
      );
      return Number(rows[0].count || 0);
    };
    const todayReservations = await count('r.date = ?', [today]);
    const pendingCount = await count("r.status IN ('pending','counselor_pending')", []);
    const usingCount = await count("r.status = 'checked_in'", []);
    const noshowCount = await count("r.status = 'noshow' AND r.date = ?", [today]);

    const dates = [];
    const reservations = [];
    const used = [];
    const noshow = [];
    for (let index = 6; index >= 0; index -= 1) {
      const date = dayjs().subtract(index, 'day').format('YYYY-MM-DD');
      dates.push(dayjs(date).format('MM-DD'));
      const [rows] = await db.query(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN r.status IN ('approved','checked_in','completed') THEN 1 ELSE 0 END) AS used, " +
        "SUM(CASE WHEN r.status = 'noshow' THEN 1 ELSE 0 END) AS noshow " +
        'FROM reservations r JOIN rooms rm ON rm.id = r.room_id WHERE r.date = ?' + scope.sql,
        [date].concat(scope.params)
      );
      reservations.push(Number(rows[0].total || 0));
      used.push(Number(rows[0].used || 0));
      noshow.push(Number(rows[0].noshow || 0));
    }

    const [roomTypes] = await db.query(
      "SELECT rm.type, COUNT(*) AS count FROM rooms rm WHERE rm.status = 'open'" + scope.sql + ' GROUP BY rm.type',
      scope.params
    );
    const [ranking] = await db.query(
      "SELECT rm.name, COUNT(r.id) AS reservation_count FROM rooms rm LEFT JOIN reservations r ON r.room_id = rm.id " +
      "AND r.status IN ('approved','checked_in','completed') AND r.date >= DATE_SUB(NOW(), INTERVAL 30 DAY) " +
      "WHERE 1=1" + scope.sql + ' GROUP BY rm.id, rm.name ORDER BY reservation_count DESC LIMIT 8',
      scope.params
    );
    const [pendingItems] = await db.query(
      "SELECT r.id, r.status, r.purpose, r.date, r.start_time, u.real_name, rm.name AS room_name " +
      "FROM reservations r LEFT JOIN users u ON u.id = r.user_id JOIN rooms rm ON rm.id = r.room_id " +
      "WHERE r.status IN ('pending','counselor_pending')" + scope.sql + ' ORDER BY r.created_at DESC LIMIT 10',
      scope.params
    );

    return response.success(res, {
      todayReservations,
      pendingCount,
      usingCount,
      noshowCount,
      trend: { dates, reservations, used, noshow },
      roomTypeStats: roomTypes.map(function(row) { return { name: row.type, value: Number(row.count || 0) }; }),
      usageRanking: {
        rooms: ranking.map(function(row) { return row.name; }),
        rates: ranking.map(function(row) { return Math.min(100, Math.round(Number(row.reservation_count || 0) / 30 * 100)); })
      },
      pendingItems: pendingItems.map(function(row) {
        return {
          id: row.id,
          tag: row.status === 'counselor_pending' ? '辅导员审核' : '待审核',
          text: (row.real_name || '') + ' 申请 ' + (row.room_name || '') + (row.purpose ? ' - ' + row.purpose : ''),
          time: row.date + ' ' + row.start_time
        };
      })
    });
  } catch (err) {
    logger.error('获取楼栋范围内仪表盘失败:', err);
    return response.error(res, err.message || '获取仪表盘失败', 500);
  }
};

const reservationStats = async function(req, res) {
  try {
    const range = dateRange(req);
    const group = ['day', 'week', 'month'].includes(req.query.groupBy) ? req.query.groupBy : 'day';
    const format = group === 'week' ? '%Y-W%u' : (group === 'month' ? '%Y-%m' : '%Y-%m-%d');
    const scope = buildingFilter(req, 'rm');
    const [rows] = await db.query(
      'SELECT DATE_FORMAT(r.date, ?) AS period, COUNT(*) AS total, ' +
      "SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS approved, " +
      "SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled, " +
      "SUM(CASE WHEN r.status = 'noshow' THEN 1 ELSE 0 END) AS noshow, " +
      "SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS completed " +
      'FROM reservations r JOIN rooms rm ON rm.id = r.room_id WHERE r.date BETWEEN ? AND ?' + scope.sql +
      ' GROUP BY period ORDER BY period',
      [format, range.start, range.end].concat(scope.params)
    );
    return response.success(res, rows);
  } catch (err) {
    logger.error('获取楼栋范围内预约统计失败:', err);
    return response.error(res, err.message || '获取预约统计失败', 500);
  }
};

const usageRate = async function(req, res) {
  try {
    const range = dateRange(req);
    const scope = buildingFilter(req, 'rm');
    let sql = "SELECT rm.id AS room_id, rm.name AS room_name, rm.type, COUNT(r.id) AS reservation_count, COUNT(DISTINCT r.date) AS used_days " +
      "FROM rooms rm LEFT JOIN reservations r ON r.room_id = rm.id AND r.date BETWEEN ? AND ? " +
      "AND r.status IN ('approved','checked_in','completed') WHERE 1=1" + scope.sql;
    const params = [range.start, range.end].concat(scope.params);
    if (req.query.roomId) {
      sql += ' AND rm.id = ?';
      params.push(Number(req.query.roomId));
    }
    sql += ' GROUP BY rm.id, rm.name, rm.type ORDER BY reservation_count DESC';
    const [rows] = await db.query(sql, params);
    return response.success(res, rows);
  } catch (err) {
    logger.error('获取楼栋范围内使用率失败:', err);
    return response.error(res, err.message || '获取使用率失败', 500);
  }
};

const peakHours = async function(req, res) {
  try {
    const range = dateRange(req);
    const scope = buildingFilter(req, 'rm');
    const [rows] = await db.query(
      "SELECT r.start_time, COUNT(*) AS count FROM reservations r JOIN rooms rm ON rm.id = r.room_id " +
      "WHERE r.date BETWEEN ? AND ? AND r.status IN ('approved','checked_in','completed')" + scope.sql +
      ' GROUP BY r.start_time ORDER BY count DESC',
      [range.start, range.end].concat(scope.params)
    );
    return response.success(res, rows);
  } catch (err) {
    logger.error('获取楼栋范围内高峰时段失败:', err);
    return response.error(res, err.message || '获取高峰时段失败', 500);
  }
};

const noshowStats = async function(req, res) {
  try {
    const range = dateRange(req);
    const scope = buildingFilter(req, 'rm');
    const params = [range.start, range.end].concat(scope.params);
    const [total] = await db.query(
      "SELECT COUNT(*) AS total FROM reservations r JOIN rooms rm ON rm.id = r.room_id " +
      "WHERE r.status = 'noshow' AND r.date BETWEEN ? AND ?" + scope.sql,
      params
    );
    const [users] = await db.query(
      "SELECT u.id, u.real_name, u.student_id, u.credit_score, COUNT(*) AS noshow_count " +
      "FROM reservations r JOIN users u ON u.id = r.user_id JOIN rooms rm ON rm.id = r.room_id " +
      "WHERE r.status = 'noshow' AND r.date BETWEEN ? AND ?" + scope.sql +
      ' GROUP BY u.id, u.real_name, u.student_id, u.credit_score ORDER BY noshow_count DESC LIMIT 10',
      params
    );
    const [rooms] = await db.query(
      "SELECT rm.name, COUNT(*) AS noshow_count FROM reservations r JOIN rooms rm ON rm.id = r.room_id " +
      "WHERE r.status = 'noshow' AND r.date BETWEEN ? AND ?" + scope.sql +
      ' GROUP BY rm.id, rm.name ORDER BY noshow_count DESC',
      params
    );
    return response.success(res, {
      totalNoshow: Number(total[0].total || 0),
      topNoshowUsers: users,
      roomNoshowStats: rooms
    });
  } catch (err) {
    logger.error('获取楼栋范围内爽约统计失败:', err);
    return response.error(res, err.message || '获取爽约统计失败', 500);
  }
};

const userStats = async function(req, res) {
  try {
    const range = dateRange(req);
    const userScope = req.adminScope.isGlobal ? { sql: '', params: [] } : { sql: ' AND u.building_id = ?', params: [req.adminScope.buildingId] };
    const roomScope = buildingFilter(req, 'rm');
    const [newUsers] = await db.query(
      'SELECT DATE_FORMAT(u.created_at, "%Y-%m-%d") AS date, COUNT(*) AS count FROM users u ' +
      'WHERE u.created_at BETWEEN ? AND ?' + userScope.sql + ' GROUP BY date ORDER BY date',
      [range.start + ' 00:00:00', range.end + ' 23:59:59'].concat(userScope.params)
    );
    const [activeUsers] = await db.query(
      'SELECT DATE_FORMAT(r.date, "%Y-%m-%d") AS date, COUNT(DISTINCT r.user_id) AS count ' +
      'FROM reservations r JOIN rooms rm ON rm.id = r.room_id WHERE r.date BETWEEN ? AND ?' + roomScope.sql +
      ' GROUP BY date ORDER BY date',
      [range.start, range.end].concat(roomScope.params)
    );
    const [creditDistribution] = await db.query(
      'SELECT CASE WHEN u.credit_score >= 80 THEN "good" WHEN u.credit_score >= 60 THEN "warning" ' +
      'WHEN u.credit_score >= 30 THEN "restricted" ELSE "banned" END AS level, COUNT(*) AS count ' +
      'FROM users u WHERE 1=1' + userScope.sql + ' GROUP BY level',
      userScope.params
    );
    return response.success(res, { newUsers, activeUsers, creditDistribution });
  } catch (err) {
    logger.error('获取楼栋范围内用户统计失败:', err);
    return response.error(res, err.message || '获取用户统计失败', 500);
  }
};

const exportData = async function(req, res) {
  try {
    const range = dateRange(req);
    const type = String(req.query.type || 'reservations');
    let rows;
    if (type === 'users') {
      const scope = req.adminScope.isGlobal ? { sql: '', params: [] } : { sql: ' WHERE u.building_id = ?', params: [req.adminScope.buildingId] };
      [rows] = await db.query(
        'SELECT u.id, u.real_name, u.student_id, u.college, u.credit_score, u.status, u.created_at FROM users u' +
        scope.sql + ' ORDER BY u.created_at DESC',
        scope.params
      );
    } else if (type === 'violations') {
      const scope = buildingFilter(req, 'rm');
      [rows] = await db.query(
        'SELECT v.id, u.student_id, u.real_name, v.type, v.description, v.score, v.created_at ' +
        'FROM violations v JOIN users u ON u.id = v.user_id LEFT JOIN reservations r ON r.id = v.related_id ' +
        'LEFT JOIN rooms rm ON rm.id = r.room_id WHERE v.created_at BETWEEN ? AND ?' + scope.sql +
        ' ORDER BY v.created_at DESC',
        [range.start + ' 00:00:00', range.end + ' 23:59:59'].concat(scope.params)
      );
    } else {
      const scope = buildingFilter(req, 'rm');
      [rows] = await db.query(
        'SELECT r.id, u.student_id, u.real_name, rm.name AS room_name, r.date, r.start_time, r.end_time, r.status, r.purpose, r.created_at ' +
        'FROM reservations r JOIN users u ON u.id = r.user_id JOIN rooms rm ON rm.id = r.room_id ' +
        'WHERE r.date BETWEEN ? AND ?' + scope.sql + ' ORDER BY r.date DESC, r.start_time DESC',
        [range.start, range.end].concat(scope.params)
      );
    }
    return response.success(res, { type, startDate: range.start, endDate: range.end, rows });
  } catch (err) {
    logger.error('导出楼栋范围内统计失败:', err);
    return response.error(res, err.message || '导出失败', 500);
  }
};

module.exports = {
  dashboard,
  reservationStats,
  usageRate,
  peakHours,
  noshowStats,
  userStats,
  exportData
};
