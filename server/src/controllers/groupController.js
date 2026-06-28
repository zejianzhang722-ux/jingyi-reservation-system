const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const notificationService = require('../services/notificationService');
const reservationCommandService = require('../services/reservationCommandService');

const ACTIVE_RESERVATION_STATUS = ['pending', 'counselor_pending', 'approved', 'checked_in'];

function clean(value) { return String(value || '').trim(); }
function todayText() { const now = new Date(); return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'); }
function normalizeTime(body, prefix) { const direct = body[prefix + 'Time'] || body[prefix + 'Hour']; if (!direct) return ''; const value = clean(direct); return /^\d{2}:\d{2}$/.test(value) ? value : ''; }
function normalizeInvitedMembers(body) {
  const rows = Array.isArray(body && body.invitedMembers) ? body.invitedMembers : [];
  return rows.map(function(row) { return { studentNo: clean(row.studentNo || row.student_no || row.studentId || row.student_id), realName: clean(row.realName || row.real_name || row.name) }; }).filter(function(row) { return row.studentNo || row.realName; });
}
function normalizePayload(body) {
  body = body || {};
  return {
    roomId: parseInt(body.roomId || body.room_id, 10) || 0,
    title: clean(body.title || body.purpose || '团队预约'),
    purpose: clean(body.purpose || body.description || body.title || '团队预约'),
    date: clean(body.date),
    startTime: normalizeTime(body, 'start'),
    endTime: normalizeTime(body, 'end'),
    maxMembers: parseInt(body.maxMembers || body.max_members || body.participants || body.participantCount, 10) || 0,
    description: clean(body.description || body.purpose || ''),
    invitedMembers: normalizeInvitedMembers(body)
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
  if (!data.maxMembers || data.maxMembers < 2 || data.maxMembers > 500) return '团队人数应不少于2人，且不能超过功能房容量';
  if (data.invitedMembers.length && data.invitedMembers.length !== data.maxMembers - 1) return '团队成员数量应等于参与人数减去本人';
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
    'SELECT gm.*, u.real_name AS name, u.nickname, u.avatar, u.student_id, u.student_no ' +
    'FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY gm.joined_at ASC, gm.id ASC',
    [groupId]
  );
  return members.map(function(item) {
    const status = item.status || 'confirmed';
    return Object.assign({}, item, { status: status, statusText: status === 'confirmed' ? '已确认' : status === 'rejected' ? '已拒绝' : '待确认', isCreator: item.role === 'creator', is_creator: item.role === 'creator', avatarUrl: item.avatar || '' });
  });
}
function allConfirmed(members) { return members.length >= 2 && members.every(function(m) { return (m.status || 'confirmed') === 'confirmed'; }); }
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
  mapped.pendingCount = members.filter(function(m) { return m.status === 'pending'; }).length;
  if (group.status === 'open' && mapped.pendingCount > 0) mapped.status = 'pending_confirm';
  if (group.status === 'open' && members.length >= Number(group.max_members) && mapped.pendingCount === 0) mapped.status = 'full';
  const currentMember = members.find(function(m) { return Number(m.user_id) === currentUserId; });
  mapped.canConfirm = !!currentMember && currentMember.status === 'pending' && !mapped.reservationId;
  mapped.canSubmitReservation = mapped.isCreator && !mapped.reservationId && ['open', 'full', 'pending_confirm'].includes(mapped.status) && allConfirmed(members);
  return mapped;
}
async function ensureRoomAvailable(data) {
  const [rooms] = await db.query('SELECT id, name, status, capacity FROM rooms WHERE id = ? LIMIT 1', [data.roomId]);
  if (!rooms.length) { const err = new Error('功能房不存在'); err.httpStatus = 404; throw err; }
  if (rooms[0].status && rooms[0].status !== 'open') { const err = new Error('该功能房当前未开放，不能发起团队预约'); err.httpStatus = 400; throw err; }
  if (rooms[0].capacity && data.maxMembers > Number(rooms[0].capacity)) { const err = new Error('参与人数不能超过功能房容量'); err.httpStatus = 400; throw err; }
  const [conflicts] = await db.query(
    'SELECT id FROM reservations WHERE room_id = ? AND date = ? AND status IN (?, ?, ?, ?) AND NOT (end_time <= ? OR start_time >= ?) LIMIT 1',
    [data.roomId, data.date].concat(ACTIVE_RESERVATION_STATUS, [data.startTime, data.endTime])
  );
  if (conflicts.length) { const err = new Error('该时段已有预约，不能发起团队预约'); err.httpStatus = 409; throw err; }
}
async function findInvitedUsers(data, creatorId) {
  const seen = {};
  const result = [];
  for (let i = 0; i < data.invitedMembers.length; i++) {
    const item = data.invitedMembers[i];
    if (!/^\d{9,10}$/.test(item.studentNo)) { const err = new Error('第' + (i + 1) + '名成员学号应为9-10位数字'); err.httpStatus = 400; throw err; }
    if (!item.realName) { const err = new Error('第' + (i + 1) + '名成员姓名不能为空'); err.httpStatus = 400; throw err; }
    if (seen[item.studentNo]) { const err = new Error('成员学号不能重复'); err.httpStatus = 400; throw err; }
    seen[item.studentNo] = true;
    const [users] = await db.query(
      'SELECT id, real_name, name, student_no, student_id FROM users WHERE role = ? AND (student_no = ? OR student_id = ?) AND (real_name = ? OR name = ?) LIMIT 1',
      ['student', item.studentNo, item.studentNo, item.realName, item.realName]
    );
    if (!users.length) { const err = new Error('未匹配到成员：' + item.studentNo + ' ' + item.realName); err.httpStatus = 404; throw err; }
    if (Number(users[0].id) === Number(creatorId)) { const err = new Error('团队成员不需要填写本人'); err.httpStatus = 400; throw err; }
    result.push(users[0]);
  }
  return result;
}
async function insertMember(groupId, userId, role, status) {
  try {
    await db.query('INSERT INTO group_members (group_id, user_id, role, status, joined_at) VALUES (?, ?, ?, ?, NOW())', [groupId, userId, role, status]);
  } catch (err) {
    await db.query('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, NOW())', [groupId, userId, role]);
  }
}
async function setMemberStatus(groupId, userId, status) {
  try { await db.query('UPDATE group_members SET status = ? WHERE group_id = ? AND user_id = ?', [status, groupId, userId]); } catch (err) {}
}
async function notifyMembers(members, type, title, content, meta) {
  members.forEach(function(member) { notificationService.createNotification(member.user_id || member.id, type, title, content, meta).catch(function() {}); });
}
async function finalizeReservationIfReady(groupId, req) {
  const group = await findGroup(groupId);
  if (!group || group.reservation_id) return null;
  const members = await loadMembers(groupId);
  if (!allConfirmed(members)) return null;
  const created = await reservationCommandService.createReservation({
    userId: group.creator_id,
    roomId: group.room_id,
    seatId: null,
    date: group.date,
    startTime: String(group.start_time).slice(0, 5),
    endTime: String(group.end_time).slice(0, 5),
    purpose: group.purpose || group.title || group.description || '团队预约',
    participants: members.length,
    idempotencyKey: 'group-reservation:' + groupId
  });
  await db.query("UPDATE reservation_groups SET status = 'submitted', reservation_id = ?, updated_at = NOW() WHERE id = ?", [created.id, groupId]);
  const statusText = created.status === 'approved' ? '已自动通过' : '已进入审核';
  notifyMembers(members, 'group_submitted', '团队预约' + statusText, '您参与的团队预约“' + (group.title || '团队预约') + '”' + statusText, { groupId: groupId, reservationId: created.id });
  return created;
}

const create = async function(req, res) {
  try {
    const data = normalizePayload(req.body);
    const error = validatePayload(data);
    if (error) return response.error(res, error, 400);
    await ensureRoomAvailable(data);
    const invitedUsers = await findInvitedUsers(data, req.user.id);
    const [result] = await db.query(
      'INSERT INTO reservation_groups (room_id, creator_id, title, purpose, date, start_time, end_time, max_members, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [data.roomId, req.user.id, data.title, data.purpose, data.date, data.startTime, data.endTime, data.maxMembers, data.description, 'open']
    );
    await insertMember(result.insertId, req.user.id, 'creator', 'confirmed');
    for (const user of invitedUsers) {
      await insertMember(result.insertId, user.id, 'member', 'pending');
      notificationService.createNotification(user.id, 'group_confirm_required', '团队预约待确认', '请确认是否参加“' + data.title + '”', { groupId: result.insertId }).catch(function() {});
    }
    const detail = await detailPayload(result.insertId, req);
    return response.success(res, detail, invitedUsers.length ? '已发送成员确认通知' : '组团已创建');
  } catch (err) {
    logger.error('创建团队预约异常:', err);
    return response.error(res, err.message || '创建团队预约失败', err.httpStatus || 500);
  }
};

const list = async function(req, res) {
  try {
    const mine = String(req.query.mine || '') === '1';
    const status = req.query.status === undefined ? (mine ? 'all' : 'open') : clean(req.query.status);
    const params = [];
    let where = ' WHERE 1=1';
    if (status && status !== 'all') { where += ' AND g.status = ?'; params.push(status); }
    if (mine) { where += ' AND EXISTS (SELECT 1 FROM group_members gm2 WHERE gm2.group_id = g.id AND gm2.user_id = ?)'; params.push(req.user.id); }
    const [rows] = await db.query(
      'SELECT g.*, r.name AS room_name, u.real_name AS creator_name, (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count ' +
      'FROM reservation_groups g JOIN rooms r ON r.id = g.room_id JOIN users u ON u.id = g.creator_id' + where +
      ' ORDER BY CASE WHEN g.status IN (\'open\',\'full\') THEN 0 WHEN g.status = \'submitted\' THEN 1 ELSE 2 END, g.date ASC, g.start_time ASC, g.created_at DESC LIMIT 80',
      params
    );
    return response.success(res, rows.map(mapGroup));
  } catch (err) { logger.error('获取组团列表异常:', err); return response.error(res, err.message || '获取组团列表失败', 500); }
};

const detail = async function(req, res) { try { const group = await detailPayload(req.params.id, req); if (!group) return response.error(res, '组团不存在', 404); return response.success(res, group); } catch (err) { logger.error('获取组团详情异常:', err); return response.error(res, err.message || '获取组团失败', 500); } };

const join = async function(req, res) {
  try {
    const groupId = req.params.id; const group = await findGroup(groupId); if (!group) return response.error(res, '组团不存在', 404); if (group.status !== 'open') return response.error(res, '该组团已停止加入', 409); if (Number(group.creator_id) === Number(req.user.id)) return response.error(res, '发起人已在组团中', 409);
    const members = await loadMembers(groupId); if (members.some(function(m) { return Number(m.user_id) === Number(req.user.id); })) return response.error(res, '你已加入该组团', 409); if (members.length >= Number(group.max_members)) return response.error(res, '该组团人数已满', 409);
    await insertMember(groupId, req.user.id, 'member', 'confirmed');
    try { await notificationService.createNotification(group.creator_id, 'group_joined', '组团有新成员', '有同学加入了您的组团：' + group.title, { groupId: groupId }); } catch (e) {}
    return response.success(res, await detailPayload(groupId, req), '加入成功');
  } catch (err) { logger.error('加入组团异常:', err); return response.error(res, err.message || '加入组团失败', 500); }
};

const confirm = async function(req, res) {
  try {
    const groupId = req.params.id; const group = await findGroup(groupId); if (!group) return response.error(res, '组团不存在', 404); if (group.reservation_id) return response.error(res, '该团队预约已生成正式预约单', 409);
    const members = await loadMembers(groupId); const current = members.find(function(m) { return Number(m.user_id) === Number(req.user.id); });
    if (!current) return response.error(res, '您不在该团队预约中', 403);
    if (current.status === 'confirmed') return response.success(res, await detailPayload(groupId, req), '已确认');
    await setMemberStatus(groupId, req.user.id, 'confirmed');
    try { await notificationService.createNotification(group.creator_id, 'group_member_confirmed', '成员已确认', (current.name || '成员') + '已确认参加“' + group.title + '”', { groupId: groupId }); } catch (e) {}
    const created = await finalizeReservationIfReady(groupId, req);
    const payload = await detailPayload(groupId, req);
    if (created) payload.reservation = created;
    return response.success(res, payload, created ? '全员已确认，已进入预约流程' : '已确认参与');
  } catch (err) { logger.error('确认团队预约异常:', err); return response.error(res, err.message || '确认失败', err.httpStatus || 500); }
};

const leave = async function(req, res) {
  try {
    const groupId = req.params.id; const group = await findGroup(groupId); if (!group) return response.error(res, '组团不存在', 404); const members = await loadMembers(groupId); const isMember = members.some(function(m) { return Number(m.user_id) === Number(req.user.id); }); if (!isMember) return response.error(res, '你尚未加入该组团', 404);
    if (Number(group.creator_id) === Number(req.user.id)) { if (group.reservation_id) return response.error(res, '已生成正式预约，不能取消组团', 409); await db.query("UPDATE reservation_groups SET status = 'cancelled', updated_at = NOW() WHERE id = ?", [groupId]); return response.success(res, await detailPayload(groupId, req), '已取消组团'); }
    if (group.reservation_id) return response.error(res, '已生成正式预约，不能退出组团', 409); await db.query('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.user.id]); return response.success(res, await detailPayload(groupId, req), '已退出组团');
  } catch (err) { logger.error('退出组团异常:', err); return response.error(res, err.message || '退出组团失败', 500); }
};

const submitReservation = async function(req, res) {
  try {
    const groupId = req.params.id; const group = await findGroup(groupId); if (!group) return response.error(res, '组团不存在', 404); if (Number(group.creator_id) !== Number(req.user.id)) return response.error(res, '只有发起人可以提交正式预约', 403); if (group.reservation_id) return response.error(res, '该组团已提交正式预约', 409);
    const members = await loadMembers(groupId); if (!allConfirmed(members)) return response.error(res, '需所有成员确认后才能提交预约', 400);
    const created = await finalizeReservationIfReady(groupId, req);
    return response.success(res, Object.assign(await detailPayload(groupId, req), { reservation: created }), '已提交正式预约');
  } catch (err) { logger.error('组团提交正式预约异常:', err); return response.error(res, err.message || '提交正式预约失败', err.httpStatus || 500); }
};

module.exports = { create, list, detail, join, confirm, leave, submitReservation };
