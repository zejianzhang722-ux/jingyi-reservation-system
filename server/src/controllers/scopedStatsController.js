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
const roomTypeLabels = {
  study_room: '自习室', seminar_room: '共享空间', media_room: '影音室',
  competition_room: '备赛间', roadshow_space: '路演空间', dance_room: '舞蹈室',
  reading_room: '阅览室', multi_purpose_hall: '多功能厅', study_center: '学业辅导中心',
  career_center: '生涯发展咨询室', job_studio: '求职就业工作室',
  innovation_workshop: '创新工作坊', party_room: '党团活动室',
  national_defense_studio: '国防教育工作室', mentor_room: '导师交流室',
  psychology_room: '心理咨询室', tutor: '团员模范岗', data_room: '资料室'
};

const getRoomTypeLabel = function(type) {
  return roomTypeLabels[type] || type || '其他空间';
};

const buildMockDashboard = function(req) {
  const tables = require('../config/mock-db').__tables;
  const today = helpers.formatDate(new Date());
  const start30 = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const isGlobal = req.adminScope && req.adminScope.isGlobal;
  const buildingId = req.adminScope ? Number(req.adminScope.buildingId) : null;
  const rooms = (tables.rooms || []).filter(function(room) {
    return isGlobal || Number(room.building_id) === buildingId;
  });
  const roomIds = new Set(rooms.map(function(room) { return Number(room.id); }));
  const reservations = (tables.reservations || []).filter(function(row) {
    return roomIds.has(Number(row.room_id));
  });
  const users = new Map((tables.users || []).map(function(user) { return [Number(user.id), user]; }));
  const roomById = new Map(rooms.map(function(room) { return [Number(room.id), room]; }));
  const activeStatuses = ['approved', 'checked_in', 'completed'];
  const ordinaryPendingCount = reservations.filter(function(row) { return row.status === 'pending'; }).length;
  const rawCounselorPendingCount = reservations.filter(function(row) { return row.status === 'counselor_pending'; }).length;
  const canReviewCounselorPending = req.adminScope && ['counselor', 'super_admin'].includes(req.adminScope.role);
  const counselorPendingCount = canReviewCounselorPending ? rawCounselorPendingCount : 0;
  const actionablePendingCount = ordinaryPendingCount + counselorPendingCount;
  const activeRoomCount = rooms.filter(function(room) { return room.status === 'open'; }).length;

  const dates = [];
  const trendReservations = [];
  const trendUsed = [];
  const trendNoshow = [];
  for (let index = 6; index >= 0; index -= 1) {
    const date = dayjs().subtract(index, 'day').format('YYYY-MM-DD');
    const dayRows = reservations.filter(function(row) { return row.date === date; });
    dates.push(dayjs(date).format('MM-DD'));
    trendReservations.push(dayRows.length);
    trendUsed.push(dayRows.filter(function(row) { return activeStatuses.includes(row.status); }).length);
    trendNoshow.push(dayRows.filter(function(row) { return row.status === 'noshow'; }).length);
  }

  const typeCounts = new Map();
  rooms.filter(function(room) { return room.status === 'open'; }).forEach(function(room) {
    typeCounts.set(room.type, (typeCounts.get(room.type) || 0) + 1);
  });

  const ranking = rooms.map(function(room) {
    const count = reservations.filter(function(row) {
      return Number(row.room_id) === Number(room.id) && row.date >= start30 && activeStatuses.includes(row.status);
    }).length;
    return { name: room.name, reservation_count: count };
  }).sort(function(a, b) { return b.reservation_count - a.reservation_count; }).slice(0, 8);

  const pendingItems = reservations
    .filter(function(row) { return row.status === 'pending' || row.status === 'counselor_pending'; })
    .sort(function(a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })
    .slice(0, 10)
    .map(function(row) {
      const user = users.get(Number(row.user_id)) || {};
      const room = roomById.get(Number(row.room_id)) || {};
      return {
        id: row.id,
        tag: row.status === 'counselor_pending' ? '辅导员审核' : '待审核',
        text: (user.real_name || user.nickname || '') + ' 申请 ' + (room.name || '') + (row.purpose ? ' - ' + row.purpose : ''),
        time: row.date + ' ' + row.start_time
      };
    });

  return {
    todayReservations: reservations.filter(function(row) { return row.date === today; }).length,
    ordinaryPendingCount,
    counselorPendingCount,
    actionablePendingCount,
    activeRoomCount,
    pendingCount: actionablePendingCount,
    usingCount: reservations.filter(function(row) { return row.status === 'checked_in'; }).length,
    noshowCount: reservations.filter(function(row) { return row.status === 'noshow' && row.date === today; }).length,
    trend: { dates: dates, reservations: trendReservations, used: trendUsed, noshow: trendNoshow },
    roomTypeStats: Array.from(typeCounts.entries()).map(function(entry) {
      return { name: getRoomTypeLabel(entry[0]), value: entry[1] };
    }),
    usageRanking: {
      rooms: ranking.map(function(row) { return row.name; }),
      rates: ranking.map(function(row) { var count = Number(row.reservation_count || 0); return count > 0 ? Math.min(100, Math.max(1, Math.round(count / 30 * 100))) : 0; })
    },
    pendingItems: pendingItems
  };
};

const dashboard = async function(req, res) {
  try {
    if (db.isMock()) {
      return response.success(res, buildMockDashboard(req));
    }
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
    const ordinaryPendingCount = await count("r.status = 'pending'", []);
    const rawCounselorPendingCount = await count("r.status = 'counselor_pending'", []);
    const canReviewCounselorPending = req.adminScope && ['counselor', 'super_admin'].includes(req.adminScope.role);
    const counselorPendingCount = canReviewCounselorPending ? rawCounselorPendingCount : 0;
    const actionablePendingCount = ordinaryPendingCount + counselorPendingCount;
    const [activeRoomRows] = await db.query(
      "SELECT COUNT(*) AS count FROM rooms rm WHERE rm.status = 'open'" + scope.sql,
      scope.params
    );
    const activeRoomCount = Number(activeRoomRows[0].count || 0);
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
      ordinaryPendingCount,
      counselorPendingCount,
      actionablePendingCount,
      activeRoomCount,
      pendingCount: actionablePendingCount,
      usingCount,
      noshowCount,
      trend: { dates, reservations, used, noshow },
      roomTypeStats: roomTypes.map(function(row) { return { name: getRoomTypeLabel(row.type), value: Number(row.count || 0) }; }),
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
    if (db.isMock()) {
      const tables = require('../config/mock-db').__tables;
      const isGlobal = req.adminScope && req.adminScope.isGlobal;
      const buildingId = req.adminScope ? Number(req.adminScope.buildingId) : null;
      const requestedRoomId = req.query.roomId ? Number(req.query.roomId) : null;
      const activeStatuses = ['approved', 'checked_in', 'completed'];
      const rows = (tables.rooms || []).filter(function(room) {
        if (!isGlobal && Number(room.building_id) !== buildingId) return false;
        return requestedRoomId === null || Number(room.id) === requestedRoomId;
      }).map(function(room) {
        const roomReservations = (tables.reservations || []).filter(function(row) {
          return Number(row.room_id) === Number(room.id) &&
            row.date >= range.start && row.date <= range.end &&
            activeStatuses.includes(row.status);
        });
        return {
          room_id: Number(room.id),
          room_name: room.name,
          room_type: room.type,
          reservation_count: roomReservations.length,
          used_days: new Set(roomReservations.map(function(row) { return row.date; })).size
        };
      }).filter(function(row) {
        return row.reservation_count > 0;
      }).sort(function(a, b) {
        return b.reservation_count - a.reservation_count || String(a.room_name).localeCompare(String(b.room_name));
      });
      return response.success(res, rows);
    }
    const scope = buildingFilter(req, 'rm');
    let sql = "SELECT rm.id AS room_id, rm.name AS room_name, rm.type AS room_type, COUNT(r.id) AS reservation_count, COUNT(DISTINCT r.date) AS used_days " +
      "FROM rooms rm LEFT JOIN reservations r ON r.room_id = rm.id AND r.date BETWEEN ? AND ? " +
      "AND r.status IN ('approved','checked_in','completed') WHERE 1=1" + scope.sql;
    const params = [range.start, range.end].concat(scope.params);
    if (req.query.roomId) {
      sql += ' AND rm.id = ?';
      params.push(Number(req.query.roomId));
    }
    sql += ' GROUP BY rm.id, rm.name, rm.type HAVING COUNT(r.id) > 0 ORDER BY reservation_count DESC, room_name ASC';
    const [rows] = await db.query(sql, params);
    return response.success(res, rows.map(function(row) {
      return {
        room_id: Number(row.room_id),
        room_name: row.room_name,
        room_type: row.room_type,
        reservation_count: Number(row.reservation_count || 0),
        used_days: Number(row.used_days || 0)
      };
    }));
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
      "SELECT rm.name, SUM(CASE WHEN r.status = 'noshow' THEN 1 ELSE 0 END) AS noshow_count, " +
      "COUNT(*) AS reservation_count FROM reservations r JOIN rooms rm ON rm.id = r.room_id " +
      "WHERE r.date BETWEEN ? AND ?" + scope.sql +
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


