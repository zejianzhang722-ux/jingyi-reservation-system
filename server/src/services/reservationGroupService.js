/**
 * 团队预约（组团预约）服务
 *
 * 业务模型（重要，改动前请先读）：
 *  1. 团队预约按「整房占用」处理，成员不单独占座。主预约的 seat_id 为 NULL，
 *     写入 reservation_slots 时 seat_scope = 0，与既有普通整房预约共用同一套
 *     唯一键 uk_room_seat_date_minute，因此天然互斥，无需额外冲突检测。
 *  2. 创建团队时立即生成主预约并占槽。之所以不在审批通过时才占，是为了避免
 *     多个团队同时预约同一房间同一时段、审批阶段才发现冲突。
 *  3. 主预约挂在创建者名下，签到、爽约、信用分变动全部归属创建者，
 *     成员仅作为参与人登记（reservation_group_members），不产生独立预约记录。
 *  4. 成员加入/退出仅登记参与人，不改变声明实际人数或库存占用。
 *  5. 团队被拒绝或取消后锁定，成员不能再加入或退出；
 *     预约开始或主预约结束、取消、爽约、签到后停止招募。
 *  6. 自习室等按座位预约的空间不支持组团（成员无法各自落座）。
 */

const db = require('../config/database');
const config = require('../config');
const logger = require('../config/logger');
const commandService = require('./reservationCommandService');
const lifecycleService = require('./reservationLifecycleService');
const notificationService = require('./notificationService');
const auditTrailService = require('./auditTrailService');
const reservationAuditTrailService = require('./reservationAuditTrailService');
const dailyPolicy = require('./reservationDailyPolicy');
const roomPolicy = require('./roomBookingPolicy');

const httpError = commandService.httpError;

const DEFAULT_MAX_MEMBERS = 4;
const MAX_MEMBERS_HARD_LIMIT = 50;
// 只有被拒绝或取消的团队才锁定；审批状态不影响招募——
// 无需审核的房间创建即 approved，此时仍应允许成员加入。
const CLOSED_STATUSES = ['rejected', 'cancelled'];
// 主预约的这些状态表示库存仍被占用。
const HOLDING_STATUSES = ['approved', 'pending', 'counselor_pending', 'checked_in'];

const isGroupLocked = function(group) {
  return CLOSED_STATUSES.indexOf(group.status) !== -1;
};

/**
 * 统一事务内外查询入口。事务内传 connection，非事务传 { execute: db.query }。
 * Mock 模式没有事务能力，executor 上带 __noLock 时跳过 FOR UPDATE。
 */
const withLock = function(executor, sql) {
  return executor.__noLock ? sql : sql + ' FOR UPDATE';
};

const plainExecutor = { execute: db.query, __noLock: true };
const mockGroupQueues = new Map();
const serializeMockGroup = function(groupId, work) {
  if (!db.isMock()) return work();
  const key = Number(groupId);
  const previous = mockGroupQueues.get(key) || Promise.resolve();
  const run = previous.then(work);
  const tail = run.catch(() => {});
  mockGroupQueues.set(key, tail);
  tail.then(() => { if (mockGroupQueues.get(key) === tail) mockGroupQueues.delete(key); });
  return run;
};

const assertRecruitmentOpen = async function(executor, group) {
  if (!group.reservation_id) throw httpError(409, '该组团缺少关联预约，无法招募');
  const [rows] = await executor.execute(withLock(executor, 'SELECT * FROM reservations WHERE id = ?'), [group.reservation_id]);
  const reservation = rows[0];
  if (!reservation || !['pending', 'counselor_pending', 'approved'].includes(reservation.status)) {
    throw httpError(409, '主预约已取消、结束或办理签到，该组团已停止招募');
  }
  const [rooms] = await executor.execute(withLock(executor, 'SELECT * FROM rooms WHERE id = ?'), [reservation.room_id]);
  if (!rooms[0] || !require('./roomStatusSchedule').bookingAllowed(rooms[0], { date: reservation.date, startTime: reservation.start_time, endTime: reservation.end_time })) {
    throw httpError(409, '所选时段空间不可预约，暂不能加入该组团');
  }
  const start = require('./checkinWindowPolicy').startDate(reservation);
  if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) {
    throw httpError(409, '预约已开始，该组团已停止招募');
  }
};

const normalizeHour = function(value, label) {
  if (value === undefined || value === null || value === '') {
    throw httpError(400, '请填写' + label);
  }
  const text = String(value).trim();

  const withMinute = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (withMinute) {
    const hour = Number(withMinute[1]);
    const minute = Number(withMinute[2]);
    if (hour > 23 || minute > 59) throw httpError(400, label + '格式无效');
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  // 小程序 <picker mode="time"> 与表单里可能直接给小时数，如 14。
  const hourOnly = text.match(/^(\d{1,2})$/);
  if (hourOnly) {
    const hour = Number(hourOnly[1]);
    if (hour > 23) throw httpError(400, label + '格式无效');
    return String(hour).padStart(2, '0') + ':00';
  }

  throw httpError(400, label + '格式无效');
};

const resolveMaxMembers = function(raw, room) {
  let value = Number(raw);
  if (raw === undefined || raw === null || raw === '') value = DEFAULT_MAX_MEMBERS;
  if (!Number.isInteger(value)) throw httpError(400, '实际参与人数必须为至少2人的整数');
  if (value < 2) throw httpError(400, '实际参与人数至少2人');
  if (value > MAX_MEMBERS_HARD_LIMIT) {
    throw httpError(400, '团队人数上限不能超过' + MAX_MEMBERS_HARD_LIMIT + '人');
  }
  const capacity = Number(room && room.capacity);
  if (Number.isFinite(capacity) && capacity > 0 && value > capacity) {
    throw httpError(400, '团队人数上限不能超过功能房容量（' + capacity + '人）');
  }
  return value;
};

const assertGroupRoomAllowed = function(room) {
  if (!room) throw httpError(404, '功能房不存在');
  if (commandService.SEAT_REQUIRED_TYPES.indexOf(String(room.type || '')) !== -1) {
    throw httpError(400, '自习室不支持组团预约，请按座位单独预约');
  }
};

const normalizeGroupInput = function(raw) {
  const source = raw || {};
  const title = String(source.title || source.name || '').trim();
  if (!title) throw httpError(400, '请填写组团标题');
  if (title.length > 100) throw httpError(400, '组团标题不能超过100个字符');

  const roomId = Number(source.roomId || source.room_id);
  if (!Number.isInteger(roomId) || roomId <= 0) throw httpError(400, '请选择功能房');

  const date = commandService.normalizeDate(source.date);
  const startTime = normalizeHour(
    source.startHour || source.start_hour || source.startTime || source.start_time,
    '开始时间'
  );
  const endTime = normalizeHour(
    source.endHour || source.end_hour || source.endTime || source.end_time,
    '结束时间'
  );

  return {
    title,
    roomId,
    date,
    startTime,
    endTime,
    description: String(source.description || source.purpose || '').trim().slice(0, 500),
    maxMembers: source.maxMembers !== undefined ? source.maxMembers : source.max_members
  };
};

const recruitmentStatus = function(group, memberCount) {
  // 小程序依据 group.status === 'open' 决定是否显示「加入组团」。
  if (isGroupLocked(group)) return 'closed';
  return Number(memberCount) >= Number(group.max_members) ? 'full' : 'open';
};

const fetchGroupRow = async function(executor, groupId, lock) {
  const sql = 'SELECT g.*, rm.name AS room_name, rm.building_id, rm.type AS room_type ' +
    'FROM reservation_groups g JOIN rooms rm ON g.room_id = rm.id WHERE g.id = ?';
  const [rows] = await executor.execute(lock ? withLock(executor, sql) : sql, [Number(groupId)]);
  return rows[0] || null;
};

const fetchMembers = async function(executor, groupId) {
  const [rows] = await executor.execute(
    'SELECT m.id, m.user_id, m.status, u.name, u.real_name, u.avatar, u.student_id, u.student_no ' +
    'FROM reservation_group_members m JOIN users u ON m.user_id = u.id ' +
    'WHERE m.group_id = ? ORDER BY m.id ASC',
    [Number(groupId)]
  );
  return rows;
};

const countActiveMembers = function(members) {
  return members.filter(function(row) {
    return row.status !== 'rejected';
  }).length;
};

const presentGroup = function(group, memberRows, viewerId) {
  const members = (memberRows || []).map(function(row) {
    return {
      id: row.id,
      userId: Number(row.user_id),
      name: row.real_name || row.name || '',
      avatarUrl: row.avatar || '',
      studentId: row.student_id || row.student_no || '',
      status: row.status,
      isCreator: Number(row.user_id) === Number(group.created_by)
    };
  });
  const memberCount = countActiveMembers(memberRows || []);
  const viewerIdNumber = Number(viewerId);

  return {
    id: Number(group.id),
    title: group.name || '',
    description: group.purpose || '',
    date: commandService.normalizeDate(group.date),
    // 小程序模板读 startHour/endHour，同时保留 snake_case 与 HH:MM 形式便于管理端复用。
    startHour: String(group.start_time).slice(0, 5),
    endHour: String(group.end_time).slice(0, 5),
    startTime: String(group.start_time).slice(0, 5),
    endTime: String(group.end_time).slice(0, 5),
    start_time: String(group.start_time).slice(0, 5),
    end_time: String(group.end_time).slice(0, 5),
    maxMembers: Number(group.max_members),
    memberCount,
    status: recruitmentStatus(group, memberCount),
    approvalStatus: group.status,
    rejectReason: group.reject_reason || '',
    roomId: Number(group.room_id),
    roomName: group.room_name || '',
    roomType: group.room_type || '',
    buildingId: group.building_id === undefined || group.building_id === null
      ? null
      : Number(group.building_id),
    createdBy: Number(group.created_by),
    isCreator: viewerIdNumber === Number(group.created_by),
    isMember: members.some(function(member) {
      return member.userId === viewerIdNumber && member.status !== 'rejected';
    }),
    reservationId: group.reservation_id ? Number(group.reservation_id) : null,
    members,
    createdAt: group.created_at
  };
};

const loadGroup = async function(groupId, viewerId, executor) {
  const runner = executor || plainExecutor;
  const group = await fetchGroupRow(runner, groupId, false);
  if (!group) throw httpError(404, '组团不存在');
  const members = await fetchMembers(runner, groupId);
  return presentGroup(group, members, viewerId);
};

const syncParticipants = async function(executor, reservationId, count) {
  if (!reservationId) return;
  // Registration/recruitment does not change the declared actual headcount.
  // Releasing it here lets other bookings consume capacity already promised.
};

const notifySafely = async function(userId, type, title, content, data) {
  try {
    await notificationService.createNotification(userId, type, title, content, data || {});
  } catch (err) {
    logger.error('团队预约站内通知失败:', err && err.message);
  }
};

/** 校验用户在目标时段没有其它进行中的个人预约，避免同一个人分身两地。 */
const assertNoPersonalConflict = async function(executor, userId, date, startTime, endTime, excludeReservationId) {
  const [rows] = await executor.execute(
    "SELECT id FROM reservations WHERE user_id = ? AND date = ? AND status IN ('approved','pending','counselor_pending','checked_in') " +
    'AND start_time < ? AND end_time > ? AND id <> ? LIMIT 1',
    [userId, date, endTime, startTime, excludeReservationId || 0]
  );
  if (rows.length) throw httpError(409, '该时段你已有其它预约，无法加入', 'PERSONAL_SLOT_CONFLICT');
};

const assertMemberEligible = async function(executor, userId) {
  const [users] = await executor.execute(
    'SELECT id, status, credit_score, restricted_until FROM users WHERE id = ?',
    [Number(userId)]
  );
  const user = users[0];
  if (!user) throw httpError(404, '用户不存在');
  if (require('./creditBookingPolicy').isAccountDisabled(user)) throw httpError(403, '账号已被停用');
  return user;
};

// ---------------------------------------------------------------------------
// 创建
// ---------------------------------------------------------------------------

const createGroup = async function(userId, rawInput) {
  const input = normalizeGroupInput(rawInput);

  if (db.isMock()) {
    const room = await loadRoomPlain(input.roomId);
    assertGroupRoomAllowed(room);
    const maxMembers = resolveMaxMembers(input.maxMembers, room);
    const reservation = await commandService.createReservation({
      userId,
      roomId: input.roomId,
      seatId: null,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      purpose: input.title,
      participants: maxMembers,
      groupBooking: true
    });
    const [result] = await db.query(
      'INSERT INTO reservation_groups (name, room_id, date, start_time, end_time, purpose, max_members, status, reservation_id, created_by, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [input.title, input.roomId, input.date, input.startTime, input.endTime, input.description,
        maxMembers, reservation.status, reservation.id, userId]
    );
    await db.query(
      "INSERT INTO reservation_group_members (group_id, user_id, seat_id, status, created_at) VALUES (?, ?, NULL, 'confirmed', NOW())",
      [result.insertId, userId]
    );
    await require('./danceGroupNotificationService').notifySafely(reservation.id);
    return loadGroup(result.insertId, userId);
  }

  const connection = await db.getConnection();
  db.assertTransactional(connection);
  try {
    await connection.beginTransaction();

    const [rooms] = await connection.execute('SELECT * FROM rooms WHERE id = ? FOR UPDATE', [input.roomId]);
    assertGroupRoomAllowed(rooms[0]);
    const maxMembers = resolveMaxMembers(input.maxMembers, rooms[0]);

    // 复用主预约写入：一次调用完成用户状态、信用分、日期范围、开放时间、
    // 时长上限、每日次数上限的校验，并写入 reservations + reservation_slots。
    const reservation = await commandService.createReservationWithinTransaction(connection, {
      userId,
      roomId: input.roomId,
      seatId: null,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      purpose: input.title,
      participants: maxMembers,
      groupBooking: true
    });

    const [result] = await connection.execute(
      'INSERT INTO reservation_groups (name, room_id, date, start_time, end_time, purpose, max_members, status, reservation_id, created_by, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [input.title, input.roomId, input.date, input.startTime, input.endTime, input.description,
        maxMembers, reservation.status, reservation.id, userId]
    );
    const groupId = result.insertId;

    await connection.execute(
      "INSERT INTO reservation_group_members (group_id, user_id, seat_id, status, created_at) VALUES (?, ?, NULL, 'confirmed', NOW())",
      [groupId, userId]
    );

    await connection.commit();
    logger.info('团队预约创建成功: groupId=' + groupId + ' reservationId=' + reservation.id + ' userId=' + userId);
    await require('./danceGroupNotificationService').notifySafely(reservation.id);
    return await loadGroup(groupId, userId);
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    if (err && (err.code === 'ER_DUP_ENTRY' || Number(err.errno) === 1062)) {
      throw httpError(409, '该时间段已有预约，存在冲突', 'SLOT_CONFLICT');
    }
    if (commandService.isDatabaseConcurrencyError(err)) {
      throw httpError(409, '预约请求发生并发冲突，请重试', 'CONCURRENT_WRITE_CONFLICT');
    }
    throw err;
  } finally {
    connection.release();
  }
};

const loadRoomPlain = async function(roomId) {
  const [rows] = await db.query('SELECT * FROM rooms WHERE id = ?', [Number(roomId)]);
  return rows[0] || null;
};

// ---------------------------------------------------------------------------
// 成员变动
// ---------------------------------------------------------------------------

const joinGroupUnlocked = async function(groupId, userId) {
  if (db.isMock()) {
    const group = await fetchGroupRow(plainExecutor, groupId, false);
    if (!group) throw httpError(404, '组团不存在');
    if (isGroupLocked(group)) {
      throw httpError(409, '该组团已停止招募');
    }
    await assertRecruitmentOpen(plainExecutor, group);
    const members = await fetchMembers(plainExecutor, groupId);
    if (countActiveMembers(members) >= Number(group.max_members)) {
      throw httpError(409, '该组团人数已满');
    }
    if (members.some(function(row) { return Number(row.user_id) === Number(userId) && row.status !== 'rejected'; })) {
      throw httpError(409, '你已在该组团中');
    }
    await assertMemberEligible(plainExecutor, userId);
    dailyPolicy.assertMock({ userId, roomId: group.room_id, date: group.date,
      startTime: group.start_time, endTime: group.end_time }, require('../config/mock-db').__tables, group.reservation_id);
    await db.query(
      "INSERT INTO reservation_group_members (group_id, user_id, seat_id, status, created_at) VALUES (?, ?, NULL, 'confirmed', NOW())",
      [groupId, userId]
    );
    await syncParticipants(plainExecutor, group.reservation_id, countActiveMembers(members) + 1);
    await notifySafely(group.created_by, 'group_member_joined', '有新成员加入', '有成员加入了你的组团：' + (group.name || ''), { groupId });
    return loadGroup(groupId, userId);
  }

  const connection = await db.getConnection();
  db.assertTransactional(connection);
  try {
    await connection.beginTransaction();

    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [Number(userId)]);
    const group = await fetchGroupRow(connection, groupId, true);
    if (!group) throw httpError(404, '组团不存在');
    if (isGroupLocked(group)) {
      throw httpError(409, '该组团已停止招募');
    }
    await assertRecruitmentOpen(connection, group);

    const members = await fetchMembers(connection, groupId);
    const activeCount = countActiveMembers(members);
    if (activeCount >= Number(group.max_members)) {
      throw httpError(409, '该组团人数已满');
    }
    if (members.some(function(row) {
      return Number(row.user_id) === Number(userId) && row.status !== 'rejected';
    })) {
      throw httpError(409, '你已在该组团中');
    }

    await assertMemberEligible(connection, userId);
    await dailyPolicy.assertTransaction(connection, { userId, roomId: group.room_id, date: group.date,
      startTime: group.start_time, endTime: group.end_time }, group.room_type, group.reservation_id);

    try {
      await connection.execute(
        "INSERT INTO reservation_group_members (group_id, user_id, seat_id, status, created_at) VALUES (?, ?, NULL, 'confirmed', NOW())",
        [groupId, userId]
      );
    } catch (err) {
      // uk_group_user 保证并发重复点击只会有一条生效。
      if (err && (err.code === 'ER_DUP_ENTRY' || Number(err.errno) === 1062)) {
        throw httpError(409, '你已在该组团中');
      }
      throw err;
    }

    await syncParticipants(connection, group.reservation_id, activeCount + 1);
    await connection.commit();

    await notifySafely(group.created_by, 'group_member_joined', '有新成员加入', '有成员加入了你的组团：' + (group.name || ''), { groupId });
    return await loadGroup(groupId, userId);
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    throw err;
  } finally {
    connection.release();
  }
};

const leaveGroupUnlocked = async function(groupId, userId) {
  if (db.isMock()) {
    const group = await fetchGroupRow(plainExecutor, groupId, false);
    if (!group) throw httpError(404, '组团不存在');
    if (Number(group.created_by) === Number(userId)) {
      throw httpError(400, '发起人不能退出组团，如需取消请解散组团');
    }
    if (isGroupLocked(group)) {
      throw httpError(409, '该组团已锁定，无法退出');
    }
    await assertRecruitmentOpen(plainExecutor, group);
    await db.query('DELETE FROM reservation_group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
    const members = await fetchMembers(plainExecutor, groupId);
    await syncParticipants(plainExecutor, group.reservation_id, Math.max(1, countActiveMembers(members)));
    return loadGroup(groupId, userId);
  }

  const connection = await db.getConnection();
  db.assertTransactional(connection);
  try {
    await connection.beginTransaction();

    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [Number(userId)]);
    const group = await fetchGroupRow(connection, groupId, true);
    if (!group) throw httpError(404, '组团不存在');
    if (Number(group.created_by) === Number(userId)) {
      throw httpError(400, '发起人不能退出组团，如需取消请解散组团');
    }
    if (isGroupLocked(group)) {
      throw httpError(409, '该组团已锁定，无法退出');
    }
    await assertRecruitmentOpen(connection, group);

    await connection.execute('DELETE FROM reservation_group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
    const members = await fetchMembers(connection, groupId);
    await syncParticipants(connection, group.reservation_id, Math.max(1, countActiveMembers(members)));
    await connection.commit();

    await notifySafely(group.created_by, 'group_member_left', '有成员退出', '有成员退出了你的组团：' + (group.name || ''), { groupId });
    return await loadGroup(groupId, userId);
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    throw err;
  } finally {
    connection.release();
  }
};

// ---------------------------------------------------------------------------
// 解散 / 审批
// ---------------------------------------------------------------------------

const dissolveGroupUnlocked = async function(groupId, userId) {
  const group = await fetchGroupRow(plainExecutor, groupId, false);
  if (!group) throw httpError(404, '组团不存在');
  if (Number(group.created_by) !== Number(userId)) {
    throw httpError(403, '只有发起人可以解散组团');
  }
  if (group.status === 'cancelled') return loadGroup(groupId, userId);
  if (group.status === 'rejected') {
    throw httpError(409, '该组团已取消');
  }
  if (group.status === 'approved' && !group.reservation_id) {
    throw httpError(409, '该组团缺少关联预约，无法释放');
  }

  if (group.reservation_id) {
    await lifecycleService.releaseAndPromote({
      reservationId: group.reservation_id,
      nextStatus: 'cancelled',
      actorRole: 'student',
      actorUserId: userId,
      allowedCurrentStatuses: ['approved', 'pending', 'counselor_pending']
    });
  }

  await db.query(
    "UPDATE reservation_groups SET status = 'cancelled', updated_at = NOW() WHERE id = ?",
    [groupId]
  );
  return loadGroup(groupId, userId);
};

const allowedApprovalStatusesForRole = function(role) {
  if (role === 'super_admin' || role === 'counselor') return ['pending', 'counselor_pending'];
  if (role === 'admin') return ['pending'];
  return [];
};

/**
 * 审批通过组团预约。
 *
 * 一致性约束（与常规预约审批 reservationApprovalController.approve 对齐，F2 收口）：
 *  - R-02 乐观锁：主预约 reservations 的 UPDATE 必须 `version = version + 1`，
 *    即便客户端未传版本号也必然推进版本号，杜绝第三条写路径绕过乐观锁。
 *  - R-08 审计：业务批注轨迹（reservation_audit_trail，用户可见）+ 防篡改审计链
 *    （operation_logs 哈希链，合规取证）双写，与常规审批一致。
 *
 * @param {number} groupId 团队 id
 * @param {number} adminId 操作管理员 id
 * @param {string} role 操作人角色
 * @param {object} [options] 可选上下文，目前仅携带 requestId 供审计链关联
 */
const approveGroup = async function(groupId, adminId, role, options) {
  const settings = options || {};
  const allowed = allowedApprovalStatusesForRole(role);
  if (!allowed.length) throw httpError(403, '当前角色无权审批组团预约');

  const group = await fetchGroupRow(plainExecutor, groupId, false);
  if (!group) throw httpError(404, '组团不存在');
  if (allowed.indexOf(group.status) === -1) {
    throw httpError(409, '该组团已被处理或当前角色无权处理');
  }
  if (!group.reservation_id) throw httpError(409, '该组团缺少关联预约，无法审批');

  // R-02 乐观锁：version = version + 1 必然推进；WHERE status = ? 兜底并发双审。
  const [result] = await db.query(
    "UPDATE reservations SET status = 'approved', audited_by = ?, audited_at = NOW(), version = version + 1 WHERE id = ? AND status = ?",
    [adminId, group.reservation_id, group.status]
  );
  if (!result || result.affectedRows === 0) {
    throw httpError(409, '该组团已被其他管理员处理，请刷新后重试');
  }

  await db.query(
    "UPDATE reservation_groups SET status = 'approved', audited_by = ?, audited_at = NOW(), updated_at = NOW() WHERE id = ?",
    [adminId, groupId]
  );
  await db.query(
    "UPDATE reservation_group_members SET status = 'confirmed' WHERE group_id = ? AND status <> 'rejected'",
    [groupId]
  );

  // R-08 双写轨迹：业务批注轨迹（用户可见）+ 防篡改审计链（合规取证）。
  // 均为 best-effort，失败仅记日志，不影响已提交的业务动作（与常规审批一致）。
  const stage = reservationAuditTrailService.stageForStatus(group.status);
  try {
    await reservationAuditTrailService.record({
      reservationId: group.reservation_id,
      stage: stage,
      actorId: adminId,
      actorRole: role,
      action: reservationAuditTrailService.ACTIONS.APPROVE,
      remark: ''
    });
  } catch (err) {
    logger.error('组团审批业务轨迹写入失败(group=' + groupId + '):', err);
  }
  try {
    await auditTrailService.record({
      operatorId: adminId,
      requestId: settings.requestId || null,
      actorRole: role,
      action: 'reservation.approve',
      targetTable: 'reservations',
      targetId: group.reservation_id,
      description: '组团预约审批通过：' + (group.name || ''),
      method: 'POST',
      path: '/api/v1/groups/' + groupId + '/approve',
      statusCode: 200,
      metadata: {
        groupId: Number(groupId),
        reservationId: Number(group.reservation_id),
        stage: stage
      }
    });
  } catch (err) {
    logger.error('组团审批审计链写入失败(group=' + groupId + '):', err);
  }

  await notifySafely(group.created_by, 'group_approved', '组团预约已通过', '你的组团预约「' + (group.name || '') + '」已通过审批', { groupId });
  await require('./danceGroupNotificationService').notifySafely(group.reservation_id);
  return loadGroup(groupId, group.created_by);
};

/**
 * 拒绝组团预约。
 *
 * 一致性约束（与常规预约拒绝 reservationApprovalController.reject 对齐，F2 收口）：
 *  - R-02 乐观锁：槽位释放走 lifecycleService.releaseAndPromote，内部已 `version = version + 1`。
 *  - R-08 审计：业务批注轨迹（reservation_audit_trail，用户可见）+ 防篡改审计链
 *    （operation_logs 哈希链，合规取证）双写，与常规拒绝一致。
 *
 * @param {number} groupId 团队 id
 * @param {number} adminId 操作管理员 id
 * @param {string} role 操作人角色
 * @param {string} reason 拒绝原因
 * @param {object} [options] 可选上下文，目前仅携带 requestId 供审计链关联
 */
const rejectGroup = async function(groupId, adminId, role, reason, options) {
  const settings = options || {};
  const allowed = allowedApprovalStatusesForRole(role);
  if (!allowed.length) throw httpError(403, '当前角色无权审批组团预约');

  const text = String(reason || '').trim();
  if (!text) throw httpError(400, '请填写拒绝原因');

  const group = await fetchGroupRow(plainExecutor, groupId, false);
  if (!group) throw httpError(404, '组团不存在');
  if (allowed.indexOf(group.status) === -1) {
    throw httpError(409, '该组团已被处理或当前角色无权处理');
  }
  if (!group.reservation_id) throw httpError(409, '该组团缺少关联预约，无法审批');

  const stage = reservationAuditTrailService.stageForStatus(group.status);

  // 拒绝需要释放槽位，走既有生命周期服务（含候补转正 + R-02 version 自增）。
  await lifecycleService.releaseAndPromote({
    reservationId: group.reservation_id,
    nextStatus: 'rejected',
    reason: text,
    auditedBy: adminId,
    allowedCurrentStatuses: [group.status]
  });

  await db.query(
    "UPDATE reservation_groups SET status = 'rejected', reject_reason = ?, audited_by = ?, audited_at = NOW(), updated_at = NOW() WHERE id = ?",
    [text, adminId, groupId]
  );
  await db.query(
    "UPDATE reservation_group_members SET status = 'rejected' WHERE group_id = ?",
    [groupId]
  );

  // R-08 双写轨迹（与 approveGroup 对齐）。
  try {
    await reservationAuditTrailService.record({
      reservationId: group.reservation_id,
      stage: stage,
      actorId: adminId,
      actorRole: role,
      action: reservationAuditTrailService.ACTIONS.REJECT,
      remark: text
    });
  } catch (err) {
    logger.error('组团拒绝业务轨迹写入失败(group=' + groupId + '):', err);
  }
  try {
    await auditTrailService.record({
      operatorId: adminId,
      requestId: settings.requestId || null,
      actorRole: role,
      action: 'reservation.reject',
      targetTable: 'reservations',
      targetId: group.reservation_id,
      description: '组团预约已拒绝：' + (group.name || ''),
      method: 'POST',
      path: '/api/v1/groups/' + groupId + '/reject',
      statusCode: 200,
      metadata: {
        groupId: Number(groupId),
        reservationId: Number(group.reservation_id),
        stage: stage,
        reason: text
      }
    });
  } catch (err) {
    logger.error('组团拒绝审计链写入失败(group=' + groupId + '):', err);
  }

  await notifySafely(group.created_by, 'group_rejected', '组团预约未通过', '你的组团预约「' + (group.name || '') + '」未通过，原因：' + text, { groupId });
  return loadGroup(groupId, group.created_by);
};

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------

const listMyGroups = async function(userId, options) {
  const settings = options || {};
  const page = Math.max(1, Number(settings.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(settings.pageSize) || 10));
  const offset = (page - 1) * pageSize;

  // 不使用 EXISTS 子查询：模拟数据库不解析子查询，这里拆成两次简单查询后合并 id，
  // 保证 MySQL 与 Mock 两条路径行为一致。
  const [createdRows] = await db.query(
    'SELECT id FROM reservation_groups WHERE created_by = ?',
    [userId]
  );
  const [joinedRows] = await db.query(
    'SELECT group_id FROM reservation_group_members WHERE user_id = ? AND status <> ?',
    [userId, 'rejected']
  );

  const idSet = new Set();
  createdRows.forEach(function(row) { idSet.add(Number(row.id)); });
  joinedRows.forEach(function(row) { idSet.add(Number(row.group_id)); });
  const ids = Array.from(idSet);
  const total = ids.length;
  if (!total) return { list: [], total: 0, page, pageSize };

  const placeholders = ids.map(function() { return '?'; }).join(',');
  const [rows] = await db.query(
    'SELECT g.*, rm.name AS room_name, rm.building_id, rm.type AS room_type ' +
    'FROM reservation_groups g JOIN rooms rm ON g.room_id = rm.id ' +
    'WHERE g.id IN (' + placeholders + ') ORDER BY g.created_at DESC LIMIT ? OFFSET ?',
    ids.concat([pageSize, offset])
  );

  const list = [];
  for (const row of rows) {
    const members = await fetchMembers(plainExecutor, row.id);
    list.push(presentGroup(row, members, userId));
  }
  return { list, total, page, pageSize };
};

/**
 * 管理端待审列表。buildingId 为 null 表示全院范围（super_admin / counselor）。
 */
const listPendingGroups = async function(options) {
  const settings = options || {};
  const statuses = settings.statuses && settings.statuses.length
    ? settings.statuses
    : ['pending', 'counselor_pending'];
  const selectedStatuses = settings.status
    ? statuses.filter(function(status) { return status === settings.status; })
    : statuses;
  const page = Math.max(1, Number(settings.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(settings.pageSize) || 10));
  const offset = (page - 1) * pageSize;
  if (!selectedStatuses.length) return { list: [], total: 0, page, pageSize };
  const placeholders = selectedStatuses.map(function() { return '?'; }).join(',');

  // 注意别名：rooms 统一用 rm（Mock 库中 r 会被解析成 reservations，MySQL 下 r 更是未定义）。
  let scopeClause = '';
  const params = selectedStatuses.slice();
  if (settings.buildingId) {
    scopeClause += ' AND rm.building_id = ?';
    params.push(Number(settings.buildingId));
  }
  if (settings.roomId) {
    scopeClause += ' AND g.room_id = ?';
    params.push(Number(settings.roomId));
  }
  if (settings.date) {
    scopeClause += ' AND g.date = ?';
    params.push(commandService.normalizeDate(settings.date));
  }
  const keyword = String(settings.keyword || '').trim();
  if (keyword) {
    scopeClause += ' AND (g.name LIKE ? OR u.real_name LIKE ? OR u.name LIKE ?)';
    const pattern = '%' + keyword + '%';
    params.push(pattern, pattern, pattern);
  }

  const [rows] = await db.query(
    'SELECT g.*, rm.name AS room_name, rm.building_id, rm.type AS room_type, u.real_name AS creator_name, u.name AS creator_fallback ' +
    'FROM reservation_groups g JOIN rooms rm ON g.room_id = rm.id JOIN users u ON g.created_by = u.id ' +
    'WHERE g.status IN (' + placeholders + ')' + scopeClause + ' ' +
    'ORDER BY g.created_at ASC LIMIT ? OFFSET ?',
    params.concat([pageSize, offset])
  );

  const countParams = params.slice(0, params.length);
  const [countRows] = await db.query(
    'SELECT COUNT(*) AS total FROM reservation_groups g JOIN rooms rm ON g.room_id = rm.id JOIN users u ON g.created_by = u.id ' +
    'WHERE g.status IN (' + placeholders + ')' + scopeClause,
    countParams
  );

  const list = [];
  for (const row of rows) {
    const members = await fetchMembers(plainExecutor, row.id);
    const presented = presentGroup(row, members, row.created_by);
    presented.creatorName = row.creator_name || row.creator_fallback || '';
    list.push(presented);
  }
  return { list, total: Number(countRows[0].total) || 0, page, pageSize };
};

const joinGroup = (groupId, userId) => serializeMockGroup(groupId, () => joinGroupUnlocked(groupId, userId));
const leaveGroup = (groupId, userId) => serializeMockGroup(groupId, () => leaveGroupUnlocked(groupId, userId));
const dissolveGroup = (groupId, userId) => serializeMockGroup(groupId, () => dissolveGroupUnlocked(groupId, userId));

module.exports = {
  DEFAULT_MAX_MEMBERS,
  MAX_MEMBERS_HARD_LIMIT,
  CLOSED_STATUSES,
  HOLDING_STATUSES,
  isGroupLocked,
  normalizeHour,
  normalizeGroupInput,
  resolveMaxMembers,
  assertGroupRoomAllowed,
  recruitmentStatus,
  presentGroup,
  allowedApprovalStatusesForRole,
  createGroup,
  loadGroup,
  joinGroup,
  leaveGroup,
  dissolveGroup,
  approveGroup,
  rejectGroup,
  listMyGroups,
  listPendingGroups
};
