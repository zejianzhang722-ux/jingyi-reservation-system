const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const privacyAuditService = require('../services/privacyAuditService');

const enter = async function(req, res) {
  try {
    const userId = req.user.id;

    const [active] = await db.query(
      "SELECT * FROM reading_room_logs WHERE user_id = ? AND leave_time IS NULL",
      [userId]
    );
    if (active.length > 0) {
      return response.error(res, '您已在阅览室中，请先登记离开', 400);
    }

    const [result] = await db.query(
      'INSERT INTO reading_room_logs (user_id, enter_time, created_at) VALUES (?, NOW(), NOW())',
      [userId]
    );

    return response.success(res, { id: result.insertId }, '登记进入成功');
  } catch (err) {
    logger.error('阅览室登记进入异常:', err);
    return response.error(res, err.message);
  }
};

const leave = async function(req, res) {
  try {
    const userId = req.user.id;

    const [active] = await db.query(
      "SELECT * FROM reading_room_logs WHERE user_id = ? AND leave_time IS NULL",
      [userId]
    );
    if (active.length === 0) {
      return response.error(res, '未找到在馆记录', 404);
    }

    await db.query('UPDATE reading_room_logs SET leave_time = NOW() WHERE id = ?', [active[0].id]);

    return response.success(res, null, '登记离开成功');
  } catch (err) {
    logger.error('阅览室登记离开异常:', err);
    return response.error(res, err.message);
  }
};

const current = async function(req, res) {
  try {
    const [list] = await db.query(
      "SELECT r.*, u.nickname, u.real_name, u.student_id FROM reading_room_logs r JOIN users u ON r.user_id = u.id WHERE r.leave_time IS NULL ORDER BY r.enter_time DESC"
    );

    // R-14 统一出口：在馆列表含学号 / 姓名明文，按请求者身份分级脱敏（管理员明文并落审计）。
    const safeList = await privacyAuditService.maskRowsForRequest(req, list, {
      targetTable: 'reading_room_logs',
      description: '当前在馆列表：查看明文个人信息'
    });

    return response.success(res, safeList);
  } catch (err) {
    logger.error('获取当前在馆列表异常:', err);
    return response.error(res, err.message);
  }
};

/**
 * 把「停留时长」格式化为中文读数<｜hy_place▁holder▁no▁813｜>。
 * 只依赖 enter/leave 两个时间字符串，DB 无关（MySQL 与 mock 均已在查出后计算）。
 * @param {string} enterTime 进入时间
 * @param {string} leaveTime 离开时间（为空表示仍在阅）
 * @returns {string} 形如 "2小时30分"；未离开或数据不完整时返回空串
 */
const toLocalDate = function(value) {
  if (!value) return null;
  // mock / MySQL 返回的都是 'YYYY-MM-DD HH:mm:ss'，替换分隔符可避免各引擎 UTC 解析差异
  const parsed = new Date(String(value).replace(/-/g, '/'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDuration = function(enterTime, leaveTime) {
  const start = toLocalDate(enterTime);
  const end = toLocalDate(leaveTime);
  if (!start || !end) return '';
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return '';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return hours + '小时' + minutes + '分';
  if (hours) return hours + '小时';
  return minutes + '分';
};

/**
 * 把阅览记录原始行格式化为管理端视图字段。
 * 约定同 utils/reservationPresenter：后端是 snake_case，前端消费 camelCase，由 presenter 归一。
 * 保留 user_id / building_id 原字段——它们是 R-14 脱敏判定「归属人」与「数据域」的依据。
 * @param {object} row 原始行
 * @returns {object} 视图行
 */
const formatReadingLogRow = function(row) {
  if (!row) return row;
  const enterTime = row.enter_time || row.enterTime || '';
  const leaveTime = row.leave_time || row.leaveTime || '';
  return Object.assign({}, row, {
    userId: row.user_id !== undefined ? row.user_id : row.userId,
    userName: row.real_name || row.userName || row.nickname || '',
    studentId: row.student_id || row.studentId || row.student_no || '',
    enterTime: enterTime,
    leaveTime: leaveTime,
    duration: formatDuration(enterTime, leaveTime),
    // schema 里 reading_room_logs 没有座位字段，有值才带出，不做数据编造
    seatNumber: row.seat_number !== undefined ? row.seat_number : (row.seatNumber || ''),
    // leave_time 为空即「在阅」，与前端 Logs.vue 的 reading / 非 reading 判断保持一致
    status: leaveTime ? 'left' : 'reading',
    createdAt: row.created_at || row.createdAt || ''
  });
};

const history = async function(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    // 与其余分页列表保持同一上限约定，避免超大 pageSize 拖垮 mock 与 MySQL
    const pageSize = Math.min(100, parseInt(req.query.pageSize, 10) || 10);
    const offset = (page - 1) * pageSize;
    const date = String(req.query.date || '').trim();
    const studentId = String(req.query.studentId || '').trim();

    // 双身份：req.adminScope 由路由层按需装载（只有管理员才有），据此决定可见范围。
    // 缺该字段一律按「只看自己」处理——最小权限，不会因漏挂中间件而放大可见面。
    const scope = req.adminScope || null;

    const joinSql = ' FROM reading_room_logs r JOIN users u ON r.user_id = u.id';
    const conditions = [];
    const params = [];

    if (scope) {
      // 管理员：可见数据域内全部宿生的阅览记录；非全局管理员按 users.building_id 隔离
      if (!scope.isGlobal) {
        conditions.push('u.building_id = ?');
        params.push(scope.buildingId);
      }
    } else {
      // 学生：保持既有行为，只能查自己的记录
      conditions.push('r.user_id = ?');
      params.push(req.user.id);
    }
    if (date) {
      conditions.push('r.enter_time LIKE ?');
      params.push(date + '%');
    }
    if (studentId) {
      conditions.push('u.student_id LIKE ?');
      params.push('%' + studentId + '%');
    }
    const whereSql = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

    const [countResult] = await db.query('SELECT COUNT(*) as total' + joinSql + whereSql, params);

    const [list] = await db.query(
      'SELECT r.*, u.real_name, u.nickname, u.student_id, u.building_id' + joinSql + whereSql +
      ' ORDER BY r.enter_time DESC LIMIT ? OFFSET ?',
      params.concat([pageSize, offset])
    );

    const rows = (list || []).map(function(row) { return formatReadingLogRow(row); });

    // R-14 统一出口：历史记录含学号 / 姓名明文，按请求者身份分级脱敏并留痕，与 current 完全一致。
    const safeRows = await privacyAuditService.maskRowsForRequest(req, rows, {
      targetTable: 'reading_room_logs',
      description: '阅览室历史记录：查看明文个人信息'
    });

    return response.paginate(res, safeRows, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取阅览室历史异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { enter, leave, current, history };
