const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const notificationService = require('../services/notificationService');
const reservationCommandService = require('../services/reservationCommandService');

const ACTIVE_RESERVATION_STATUS = ['pending', 'counselor_pending', 'approved', 'checked_in'];

function clean(value) { return String(value || '').trim(); }
function todayText() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}
function normalizeTime(body, prefix) {
  const direct = body[prefix + 'Time'] || body[prefix + 'Hour'];
  if (!direct) return '';
  const value = clean(direct);
  return /^\d{2}:\d{2}$/.test(value) ? value : '';
}
function normalizePayload(body) {
  body = body || {};
  return {
    roomId: parseInt(body.roomId || body.room_id, 10) || 0,
    title: clean(body.title),
    date: clean(body.date),
    startTime: normalizeTime(body, 'start'),
    endTime: normalizeTime(body, 'end'),
    maxMembers: parseInt(body.maxMembers || body.max_members, 10) || 0,
    description: clean(body.description)
  };
}
function validatePayload(data) {
  if (!data.roomId) return '请选择功能房';
  if (!data.title) return '请填写组团标题';
  if (data.title.length > 80) return '组团标题不能超过80字';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return '请选择预约日期';
  if (data.date < todayText()) return '组团日期不能早于今天';
  if (!/^\d{2}:\d{2}$/.test(data.startTime)) return '请选择开始时间';
  if (!/^\d{2}:\d{2}$/.test(data.endTime)) return '请选择结束时间';
  if (data.startTime >= data.endTime) return '结束时间必须晚于开始时间';
  if (!data.maxMembers || data.maxMembers < 2 || data.maxMembers > 20) return '人数上限应为2-20人';
  if (data.description.length > 200) return '组团描述不能超过200字';
  return '';
}
function mapGroup(row) {
  row = row || {};
  return Object.assign({}, row, {
    roomId: row.room_id,
    roomName: row.room_name,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    startHour: row.start_time,
    endHour: row.end_time,
    startTime: row.start_time,
    endTime: row.end_time,
    maxMembers: row.max_members,
    currentMembers: row.current_members || row.member_count || 0,
    reservationId: row.reservation_id || row.reservationId || null,
    createdAt: row.created_at
  });
}
async function findGroup(groupId) {
  const [rows] = await db.query(
    'SELECT g.*, r.name AS room_name, r.building_id, u.real_name AS creator_name, ' +
    '(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count ' +
    'FROM reservation_groups g JOIN rooms r ON r.id = g.room_id JOIN users u ON u.id = g.creator_id WHERE g.id = ?',
    [groupId]
  );
  return rows[0] || null;
}
async function loadMembers(groupId) {
  const [members] = await db.query(
    'SELECT gm.id, gm.user_id, gm.role, gm.joined_at, u.real_name AS name, u.nickname, u.avatar, u.student_id, u.student_no ' +
    'FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY gm.joined_at ASC, gm.id ASC',
    [groupId]
  );
  return members.map(function(item) {
    return Object.assign({}, item, { isCreator: item.role === 'creator', is_creator: item.role === 'creator', avatarUrl: item.avatar || '' });
  });
}
async function detailPayload(groupId, req) {
  const group = await findGroup(groupId);
  if (!group) return null;
  const members = await loadMembers(groupId);
  const currentUserId = req && req.user ? Number(req.user.id) : 0;
  const mapped = mapGroup(group);
  mapped.members = members;
  mapped.isCreator = Number(group.creator_id) === currentUserId;
  mapped.isJoined = members.some(function(m) { return Number(m.user_id) === currentUserId; });
  mapped.currentMembers = members.length;
  if (group.status === 'open' && members.length >= Number(group.max_members)) mapped.status = 'full';
  mapped.canSubmitReservation = mapped.isCreator && !mapped.reservationId && ['open', 'full'].includes(mapped.status) && members.length >= 2;
  return mapped;
}
async function ensureRoomAvailable(data) {
  const [rooms] = await db.query('SELECT id, name, status FROM rooms WHERE id = ? LIMIT 1', [data.roomId]);
  if (!rooms.length) { const err = new Error('功能房不存在'); err.httpStatus = 404; throw err; }
  if (rooms[0].status && rooms[0].status !== 'open') { const err = new Error('该功能房当前未开放，不能发起组团'); err.httpStatus = 400; throw err; }
  const [conflicts] = await db.query(
    'SELECT id FROM reservations WHERE room_id = ? AND date = ? AND status IN (?, ?, ?, ?) AND NOT (end_time <= ? OR start_time >= ?) LIMIT 1',
    [data.roomId, data.date].concat(ACTIVE_RESERVATION_STATUS, [data.startTime, data.endTime])
  );
  if (conflicts.length) { const err = new Error('该时段已有预约，不能发起组团'); err.httpStatus = 409; throw err; }
}

const create = async function(req, res) {
  try {
    const data = normalizePayload(req.body);
    const error = validatePayload(data);
    if (error) return response.error(res, error, 400);
    await ensureRoomAvailable(data);
    const [result] = await db.query(
      'INSERT INTO reservation_groups (room_id, creator_id, title, date, start_time, end_time, max_members, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [data.roomId, req.user.id, data.title, data.date, data.startTime, data.endTime, data.maxMembers, data.description, 'open']
    );
    await db.query('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, NOW())', [result.insertId, req.user.id, 'creator']);
    const detail = await detailPayload(result.insertId, req);
    return response.success(res, detail, '组团已创建');
  } catch (err) {
    logger.error('创建组团预约异常:', err);
    return response.error(res, err.message || '创建组团失败', err.httpStatus || 500);
  }
};

const list = async function(req, res) {
  try {
    const status = clean(req.query.status || 'open');
    const mine = String(req.query.mine || '') === '1';
    const params = [];
    let where = ' WHERE 1=1';
    if (status) { where += ' AND g.status = ?'; params.push(status); }
    if (mine) { where += ' AND EXISTS (SELECT 1 FROM group_members gm2 WHERE gm2.group_id = g.id AND gm2.user_id = ?)'; params.push(req.user.id); }
    const [rows] = await db.query(
      'SELECT g.*, r.name AS room_name, u.real_name AS creator_name, (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count ' +
      'FROM reservation_groups g JOIN rooms r ON r.id = g.room_id JOIN users u ON u.id = g.creator_id' + where +
      ' ORDER BY g.date ASC, g.start_time ASC, g.created_at DESC LIMIT 50',
      params
    );
    return response.success(res, rows.map(mapGroup));
  } catch (err) {
    logger.error('获取组团列表异常:', err);
    return response.error(res, err.message || '获取组团列表失败', 500);
  }
};

const detail = async function(req, res) {
  try {
    const group = await detailPayload(req.params.id, req);
    if (!group) return response.error(res, '组团不存在', 404);
    return response.success(res, group);
  } catch (err) {
    logger.error('获取组团详情异常:', err);
    return response.error(res, err.message || '获取组团失败', 500);
  }
};

const join = async function(req, res) {
  try {
    const groupId = req.params.id;
    const group = await findGroup(groupId);
    if (!group) return response.error(res, '组团不存在', 404);
    if (group.status !== 'open') return response.error(res, '该组团已停止加入', 409);
    if (Number(group.creator_id) === Number(req.user.id)) return response.error(res, '发起人已在组团中', 409);
    const members = await loadMembers(groupId);
    if (members.some(function(m) { return Number(m.user_id) === Number(req.user.id); })) return response.error(res, '你已加入该组团', 409);
    if (members.length >= Number(group.max_members)) return response.error(res, '该组团人数已满', 409);
    await db.query('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, NOW())', [groupId, req.user.id, 'member']);
    const nextCount = members.length + 1;
    if (nextCount >= Number(group.max_members)) await db.query("UPDATE reservation_groups SET status = 'full', updated_at = NOW() WHERE id = ?", [groupId]);
    try { await notificationService.createNotification(group.creator_id, 'group_joined', '组团有新成员', '有同学加入了您的组团：' + group.title, { groupId: groupId }); } catch (e) {}
    return response.success(res, await detailPayload(groupId, req), '加入成功');
  } catch (err) {
    logger.error('加入组团异常:', err);
    return response.error(res, err.message || '加入组团失败', 500);
  }
};

const leave = async function(req, res) {
  try {
    const groupId = req.params.id;
    const group = await findGroup(groupId);
    if (!group) return response.error(res, '组团不存在', 404);
    const members = await loadMembers(groupId);
    const isMember = members.some(function(m) { return Number(m.user_id) === Number(req.user.id); });
    if (!isMember) return response.error(res, '你尚未加入该组团', 404);
    if (Number(group.creator_id) === Number(req.user.id)) {
      if (group.reservation_id) return response.error(res, '已提交正式预约，不能取消组团', 409);
      await db.query("UPDATE reservation_groups SET status = 'cancelled', updated_at = NOW() WHERE id = ?", [groupId]);
      return response.success(res, await detailPayload(groupId, req), '已取消组团');
    }
    if (group.reservation_id) return response.error(res, '已提交正式预约，不能退出组团', 409);
    await db.query('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.user.id]);
    if (group.status === 'full') await db.query("UPDATE reservation_groups SET status = 'open', updated_at = NOW() WHERE id = ?", [groupId]);
    return response.success(res, await detailPayload(groupId, req), '已退出组团');
  } catch (err) {
    logger.error('退出组团异常:', err);
    return response.error(res, err.message || '退出组团失败', 500);
  }
};

const submitReservation = async function(req, res) {
  try {
    const groupId = req.params.id;
    const group = await findGroup(groupId);
    if (!group) return response.error(res, '组团不存在', 404);
    if (Number(group.creator_id) !== Number(req.user.id)) return response.error(res, '只有发起人可以提交正式预约', 403);
    if (group.reservation_id) return response.error(res, '该组团已提交正式预约', 409);
    if (!['open', 'full'].includes(group.status)) return response.error(res, '当前组团状态不能提交预约', 409);
    const members = await loadMembers(groupId);
    if (members.length < 2) return response.error(res, '至少2名成员后才能提交正式预约', 400);

    const created = await reservationCommandService.createReservation({
      userId: req.user.id,
      roomId: group.room_id,
      seatId: null,
      date: group.date,
      startTime: String(group.start_time).slice(0, 5),
      endTime: String(group.end_time).slice(0, 5),
      purpose: group.title + (group.description ? '：' + group.description : ''),
      participants: members.length,
      idempotencyKey: 'group-reservation:' + groupId
    });

    await db.query("UPDATE reservation_groups SET status = 'submitted', reservation_id = ?, updated_at = NOW() WHERE id = ?", [created.id, groupId]);
    members.forEach(function(member) {
      if (Number(member.user_id) !== Number(req.user.id)) {
        notificationService.createNotification(member.user_id, 'group_submitted', '组团已提交预约', '您参与的组团“' + group.title + '”已由发起人提交正式预约', { groupId: groupId, reservationId: created.id }).catch(function() {});
      }
    });
    return response.success(res, Object.assign(await detailPayload(groupId, req), { reservation: created }), '已提交正式预约');
  } catch (err) {
    logger.error('组团提交正式预约异常:', err);
    return response.error(res, err.message || '提交正式预约失败', err.httpStatus || 500);
  }
};

module.exports = { create, list, detail, join, leave, submitReservation };
