const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const helpers = require('../utils/helpers');
const dayjs = require('dayjs');

const dashboard = async function(req, res) {
  try {
    const today = helpers.formatDate(new Date());

    const [todayRes] = await db.query(
      "SELECT COUNT(*) as count FROM reservations WHERE date = ?",
      [today]
    );

    const [pendingRes] = await db.query(
      "SELECT COUNT(*) as count FROM reservations WHERE status IN ('pending', 'counselor_pending')"
    );

    const [usingRes] = await db.query(
      "SELECT COUNT(*) as count FROM reservations WHERE status = 'checked_in'"
    );

    const [noshowRes] = await db.query(
      "SELECT COUNT(*) as count FROM reservations WHERE status = 'noshow' AND date = ?",
      [today]
    );

    const dates = [];
    const trendReservations = [];
    const trendUsed = [];
    const trendNoshow = [];
    for (let i = 6; i >= 0; i--) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      dates.push(dayjs(d).format('MM-DD'));
      const [dayRes] = await db.query(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status IN ('approved', 'checked_in', 'completed') THEN 1 ELSE 0 END) as used, SUM(CASE WHEN status = 'noshow' THEN 1 ELSE 0 END) as noshow FROM reservations WHERE date = ?",
        [d]
      );
      trendReservations.push(dayRes[0].total || 0);
      trendUsed.push(dayRes[0].used || 0);
      trendNoshow.push(dayRes[0].noshow || 0);
    }

    const [roomTypeRows] = await db.query(
      "SELECT type, COUNT(*) as count FROM rooms WHERE status = 'open' GROUP BY type"
    );

    const typeLabels = {
      study_room: '自习室', seminar_room: '共享空间', media_room: '影音室',
      competition_room: '备赛间', roadshow_space: '路演空间', dance_room: '舞蹈室',
      reading_room: '阅览室', multi_purpose_hall: '多功能厅', study_center: '学业辅导中心',
      career_center: '生涯发展咨询室', job_studio: '求职就业工作室',
      innovation_workshop: '创新工作坊', party_room: '党团活动室',
      national_defense_studio: '国防教育工作室', mentor_room: '导师交流室',
      psychology_room: '心理咨询室', tutor: '团员模范岗'
    };
    const pieColors = ['#0066CC', '#C4943A', '#52C41A', '#3399FF', '#D4A94F', '#E8684A', '#7B68EE', '#FF69B4', '#20B2AA', '#FF8C00', '#9370DB', '#3CB371', '#CD853F', '#6495ED', '#FF6347', '#40E0D0', '#DA70D6'];
    const pieData = roomTypeRows.map(function(row, idx) {
      return { value: row.count, name: typeLabels[row.type] || row.type, itemStyle: { color: pieColors[idx % pieColors.length] } };
    });

    const [usageRows] = await db.query(
      "SELECT rm.name, COUNT(r.id) as reservation_count FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.status IN ('approved', 'checked_in', 'completed') AND r.date >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY r.room_id ORDER BY reservation_count DESC LIMIT 8"
    );
    const barRooms = usageRows.map(function(r) { return r.name; }).reverse();
    const barRates = usageRows.map(function(r) {
      return Math.min(100, Math.round((r.reservation_count / 30) * 100));
    }).reverse();

    const [pendingList] = await db.query(
      "SELECT r.id, r.status, r.purpose, r.date, r.start_time, u.real_name, rm.name as room_name FROM reservations r LEFT JOIN users u ON r.user_id = u.id LEFT JOIN rooms rm ON r.room_id = rm.id WHERE r.status IN ('pending', 'counselor_pending') ORDER BY r.created_at DESC LIMIT 10"
    );
    const pendingItems = pendingList.map(function(r) {
      const isCounselor = r.status === 'counselor_pending';
      return {
        id: r.id,
        tag: isCounselor ? '辅导员审核' : '待审核',
        tagType: isCounselor ? 'warning' : 'info',
        text: (r.real_name || '') + ' 申请 ' + (r.room_name || '') + (r.purpose ? ' - ' + r.purpose : ''),
        time: r.date + ' ' + r.start_time
      };
    });

    const [openRooms] = await db.query("SELECT id, name, open_start_time, open_end_time FROM rooms WHERE status = 'open' ORDER BY building_id, floor LIMIT 6");
    const currentHour = dayjs().hour();
    const timelineRooms = openRooms.map(function(r) { return r.name; });
    const timelineSlots = openRooms.map(function(room) {
      const openStart = parseInt((room.open_start_time || '08:00').split(':')[0]);
      const openEnd = parseInt((room.open_end_time || '22:00').split(':')[0]);
      return Array.from({ length: 14 }, function(_, i) {
        const hour = i + 8;
        if (hour < openStart || hour >= openEnd) return 0;
        if (hour <= currentHour) return 1;
        return 0;
      });
    });

    return response.success(res, {
      todayReservations: todayRes[0].count,
      pendingCount: pendingRes[0].count,
      usingCount: usingRes[0].count,
      noshowCount: noshowRes[0].count,
      trend: { dates: dates, reservations: trendReservations, used: trendUsed, noshow: trendNoshow },
      roomTypeStats: pieData,
      usageRanking: { rooms: barRooms, rates: barRates },
      pendingItems: pendingItems,
      timeline: { rooms: timelineRooms, slots: timelineSlots }
    });
  } catch (err) {
    logger.error('获取仪表盘数据异常:', err);
    return response.error(res, err.message);
  }
};

const reservationStats = async function(req, res) {
  try {
    const { startDate, endDate, groupBy } = req.query;
    const start = startDate || helpers.formatDate(dayjs().subtract(30, 'day'));
    const end = endDate || helpers.formatDate(new Date());
    const group = groupBy || 'day';

    let dateFormat = '%Y-%m-%d';
    if (group === 'week') dateFormat = '%Y-W%u';
    if (group === 'month') dateFormat = '%Y-%m';

    const [stats] = await db.query(
      'SELECT DATE_FORMAT(date, ?) as period, COUNT(*) as total, SUM(CASE WHEN status = "approved" THEN 1 ELSE 0 END) as approved, SUM(CASE WHEN status = "cancelled" THEN 1 ELSE 0 END) as cancelled, SUM(CASE WHEN status = "noshow" THEN 1 ELSE 0 END) as noshow, SUM(CASE WHEN status = "completed" THEN 1 ELSE 0 END) as completed FROM reservations WHERE date BETWEEN ? AND ? GROUP BY period ORDER BY period',
      [dateFormat, start, end]
    );

    return response.success(res, stats);
  } catch (err) {
    logger.error('获取预约统计异常:', err);
    return response.error(res, err.message);
  }
};

const usageRate = async function(req, res) {
  try {
    const { startDate, endDate, roomId } = req.query;
    const start = startDate || helpers.formatDate(dayjs().subtract(30, 'day'));
    const end = endDate || helpers.formatDate(new Date());

    let sql = 'SELECT rm.name as room_name, rm.type, COUNT(r.id) as reservation_count, COUNT(DISTINCT r.date) as used_days FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.date BETWEEN ? AND ? AND r.status IN ("approved", "checked_in", "completed")';
    const params = [start, end];

    if (roomId) { sql += ' AND r.room_id = ?'; params.push(roomId); }

    sql += ' GROUP BY r.room_id ORDER BY reservation_count DESC';

    const [stats] = await db.query(sql, params);

    return response.success(res, stats);
  } catch (err) {
    logger.error('获取使用率异常:', err);
    return response.error(res, err.message);
  }
};

const peakHours = async function(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || helpers.formatDate(dayjs().subtract(30, 'day'));
    const end = endDate || helpers.formatDate(new Date());

    const [stats] = await db.query(
      'SELECT start_time, COUNT(*) as count FROM reservations WHERE date BETWEEN ? AND ? AND status IN ("approved", "checked_in", "completed") GROUP BY start_time ORDER BY count DESC',
      [start, end]
    );

    return response.success(res, stats);
  } catch (err) {
    logger.error('获取高峰时段异常:', err);
    return response.error(res, err.message);
  }
};

const noshowStats = async function(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || helpers.formatDate(dayjs().subtract(30, 'day'));
    const end = endDate || helpers.formatDate(new Date());

    const [totalNoshow] = await db.query(
      'SELECT COUNT(*) as total FROM reservations WHERE status = "noshow" AND date BETWEEN ? AND ?',
      [start, end]
    );

    const [topNoshow] = await db.query(
      'SELECT u.id, u.nickname, u.real_name, u.student_id, u.credit_score, COUNT(*) as noshow_count FROM reservations r JOIN users u ON r.user_id = u.id WHERE r.status = "noshow" AND r.date BETWEEN ? AND ? GROUP BY r.user_id ORDER BY noshow_count DESC LIMIT 10',
      [start, end]
    );

    const [roomNoshow] = await db.query(
      'SELECT rm.name, COUNT(*) as noshow_count FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.status = "noshow" AND r.date BETWEEN ? AND ? GROUP BY r.room_id ORDER BY noshow_count DESC',
      [start, end]
    );

    return response.success(res, {
      totalNoshow: totalNoshow[0].total,
      topNoshowUsers: topNoshow,
      roomNoshowStats: roomNoshow
    });
  } catch (err) {
    logger.error('获取爽约统计异常:', err);
    return response.error(res, err.message);
  }
};

const userStats = async function(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || helpers.formatDate(dayjs().subtract(30, 'day'));
    const end = endDate || helpers.formatDate(new Date());

    const [newUsers] = await db.query(
      'SELECT DATE_FORMAT(created_at, "%Y-%m-%d") as date, COUNT(*) as count FROM users WHERE created_at BETWEEN ? AND ? GROUP BY date ORDER BY date',
      [start + ' 00:00:00', end + ' 23:59:59']
    );

    const [activeUsers] = await db.query(
      'SELECT DATE_FORMAT(date, "%Y-%m-%d") as date, COUNT(DISTINCT user_id) as count FROM reservations WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date',
      [start, end]
    );

    const [creditDistribution] = await db.query(
      'SELECT CASE WHEN credit_score >= 80 THEN "good" WHEN credit_score >= 60 THEN "warning" WHEN credit_score >= 30 THEN "restricted" ELSE "banned" END as level, COUNT(*) as count FROM users GROUP BY level'
    );

    return response.success(res, {
      newUsers: newUsers,
      activeUsers: activeUsers,
      creditDistribution: creditDistribution
    });
  } catch (err) {
    logger.error('获取用户统计异常:', err);
    return response.error(res, err.message);
  }
};

const exportData = async function(req, res) {
  try {
    const { type, startDate, endDate } = req.query;
    const start = startDate || helpers.formatDate(dayjs().subtract(30, 'day'));
    const end = endDate || helpers.formatDate(new Date());

    let data = [];

    if (type === 'reservations') {
      const [rows] = await db.query(
        'SELECT r.id, u.student_id, u.real_name, rm.name as room_name, r.date, r.start_time, r.end_time, r.status, r.purpose, r.created_at FROM reservations r JOIN users u ON r.user_id = u.id JOIN rooms rm ON r.room_id = rm.id WHERE r.date BETWEEN ? AND ? ORDER BY r.date DESC',
        [start, end]
      );
      data = rows;
    } else if (type === 'users') {
      const [rows] = await db.query(
        'SELECT id, nickname, real_name, student_id, phone, college, credit_score, status, created_at FROM users ORDER BY created_at DESC'
      );
      data = rows;
    } else if (type === 'violations') {
      const [rows] = await db.query(
        'SELECT v.id, u.student_id, u.real_name, v.type, v.description, v.score, v.created_at FROM violations v JOIN users u ON v.user_id = u.id WHERE v.created_at BETWEEN ? AND ? ORDER BY v.created_at DESC',
        [start + ' 00:00:00', end + ' 23:59:59']
      );
      data = rows;
    }

    return response.success(res, { type: type, data: data, count: data.length, startDate: start, endDate: end });
  } catch (err) {
    logger.error('导出数据异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { dashboard, reservationStats, usageRate, peakHours, noshowStats, userStats, exportData };
