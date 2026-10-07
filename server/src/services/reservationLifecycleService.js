const db = require('../config/database');
const logger = require('../config/logger');
const helpers = require('../utils/helpers');
const config = require('../config');
const errorCodes = require('../config/errorCodes');
const commandService = require('./reservationCommandService');
const notificationService = require('./notificationService');
const realtimeEventService = require('./realtimeEventService');
const checkinWindowPolicy = require('./checkinWindowPolicy');

const validateNoshow = async function(reservation, options, query) {
  if (options.nextStatus !== 'noshow') return;
  if (!checkinWindowPolicy.isOverdue(reservation, options.now || new Date())) {
    throw commandService.httpError(409, '仍在签到时段内，不能标记爽约');
  }
  const [checkins] = await query('SELECT id FROM checkins WHERE reservation_id = ?', [reservation.id]);
  if (checkins.length) throw commandService.httpError(409, '预约已签到，不能标记爽约');
};

const applyNoshowCredit = async function(connection, reservation, options) {
  if (options.nextStatus !== 'noshow') return null;
  const result = await require('./creditService').addCreditWithinTransaction(
    connection, reservation.user_id, config.credit.noshowPenalty, 'noshow',
    '超时未签到，自动标记爽约', { reservationId: reservation.id, dedupeKey: 'noshow:' + reservation.id }
  );
  if (!result) throw commandService.httpError(503, '预约用户不存在，爽约处理已取消');
  return result;
};

const notifyNoshow = async function(reservation, creditResult) {
  if (creditResult) await require('./creditService').notifyCreditThreshold(reservation.user_id, creditResult);
  await notificationService.createNotification(reservation.user_id, 'noshow', '预约爽约提醒',
    '预约开始后超过15分钟未签到，已标记爽约并扣除' + Math.abs(config.credit.noshowPenalty) + '信用分',
    { reservationId: reservation.id });
};

const ACTIVE_STATUSES = commandService.ACTIVE_STATUSES;
let mockLifecycleQueue = Promise.resolve();

/**
 * 归一化「期望版本号」（R-02 乐观锁）。
 * 未传（undefined/null/''）或非法值一律返回 null，表示**退化**为既有 `WHERE status` 条件更新，
 * 保证蓝绿过渡期新旧客户端行为一致。
 * @param {*} value 原始入参
 * @returns {number|null}
 */
const normalizeExpectedVersion = function(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
};

/**
 * 构造审核乐观锁冲突错误（HTTP 409，业务码 AUDIT_VERSION_CONFLICT）。
 * 由控制器层映射为带 businessCode 的响应。
 * @returns {Error}
 */
const auditVersionConflictError = function() {
  const err = new Error('审核记录已被其他人修改，请刷新后重试');
  err.businessCode = errorCodes.ERROR_CODES.AUDIT_VERSION_CONFLICT;
  err.httpStatus = 409;
  return err;
};

const mapReservation = function(row, status) {
  return {
    id: row.id,
    roomId: row.room_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    seatId: row.seat_id || null,
    purpose: row.purpose || '',
    participants: Number(row.participants || 1),
    reservationCode: row.reservation_code,
    status: status || row.status
  };
};

const validateRelease = function(reservation, options) {
  if (!reservation) throw commandService.httpError(404, '预约不存在');
  if (options.actorRole === 'student' && Number(reservation.user_id) !== Number(options.actorUserId)) {
    throw commandService.httpError(403, '无权操作此预约');
  }
  const cancelling = !options.nextStatus || options.nextStatus === 'cancelled';
  if (cancelling && reservation.status === 'cancelled') return;
  const allowedStatuses = cancelling ? ['approved', 'pending', 'counselor_pending'] : (options.allowedCurrentStatuses || ACTIVE_STATUSES);
  if (!allowedStatuses.includes(reservation.status)) {
    throw commandService.httpError(409, '预约已被处理或当前状态无法释放');
  }
};

const synchronizeCancelledGroup = async function(query, reservationId) {
  await query("UPDATE reservation_groups SET status = 'cancelled', updated_at = NOW() WHERE reservation_id = ? AND status != 'cancelled'", [reservationId]);
};

const updateReleasedReservation = async function(connection, reservation, options) {
  const nextStatus = options.nextStatus || 'cancelled';
  const expectedVersion = normalizeExpectedVersion(options.expectedVersion);
  if (nextStatus === 'rejected') {
    // 乐观锁（R-02）：带 version 时追加 `AND version = ?`；不带时退化为 `AND status = ?`。
    // 两种路径都执行 `version = version + 1`，保证「每次审核写入必然推进版本号」。
    let sql = "UPDATE reservations SET status = 'rejected', reject_reason = ?, audited_by = ?, audited_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = ? AND status = ?";
    const params = [options.reason || '', options.auditedBy || null, reservation.id, reservation.status];
    if (expectedVersion !== null) {
      sql += ' AND version = ?';
      params.push(expectedVersion);
    }
    const [result] = await connection.execute(sql, params);
    if (expectedVersion !== null && (!result || Number(result.affectedRows) === 0)) {
      throw auditVersionConflictError();
    }
  } else if (nextStatus === 'noshow') {
    await connection.execute(
      "UPDATE reservations SET status = 'noshow', updated_at = NOW(), version = version + 1 WHERE id = ? AND status = ?",
      [reservation.id, reservation.status]
    );
  } else {
    await connection.execute(
      "UPDATE reservations SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = ? AND status = ?",
      [reservation.id, reservation.status]
    );
  }
  await connection.execute('DELETE FROM reservation_slots WHERE reservation_id = ?', [reservation.id]);
  return nextStatus;
};

const waitlistQuery = function(source) {
  const params = [source.room_id, source.date, source.start_time, source.end_time];
  let seatClause;
  if (source.seat_id) {
    seatClause = ' AND (seat_id IS NULL OR seat_id = 0 OR seat_id = ?)';
    params.push(source.seat_id);
  } else {
    seatClause = ' AND (seat_id IS NULL OR seat_id = 0)';
  }
  return {
    sql: "SELECT * FROM reservation_waitlist WHERE room_id = ? AND date = ? AND start_time = ? AND end_time = ? AND status = 'waiting'" +
      seatClause + ' ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE',
    params
  };
};

const markWaitlistExpired = async function(connection, entry) {
  await connection.execute(
    "UPDATE reservation_waitlist SET status = 'expired', updated_at = NOW() WHERE id = ? AND status = 'waiting'",
    [entry.id]
  );
};

const promoteWithinTransaction = async function(connection, source) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const query = waitlistQuery(source);
    const [rows] = await connection.execute(query.sql, query.params);
    if (!rows.length) return null;

    const entry = rows[0];
    try {
      const promoted = await commandService.createReservationWithinTransaction(connection, {
        userId: entry.user_id,
        roomId: entry.room_id,
        seatId: entry.seat_id || source.seat_id || null,
        date: entry.date,
        startTime: entry.start_time,
        endTime: entry.end_time,
        purpose: '候补转正',
        participants: 1,
        idempotencyKey: 'waitlist:' + entry.id
      });
      const [updated] = await connection.execute(
        "UPDATE reservation_waitlist SET status = 'converted', updated_at = NOW() WHERE id = ? AND status = 'waiting'",
        [entry.id]
      );
      if (!updated || updated.affectedRows !== 1) {
        throw commandService.httpError(409, '候补记录已被其他任务处理', 'WAITLIST_RACE');
      }
      return { entry, promoted };
    } catch (err) {
      if ([400, 403, 404].includes(Number(err.httpStatus))) {
        await markWaitlistExpired(connection, entry);
        continue;
      }
      if (err.code === 'IDEMPOTENCY_CONFLICT') {
        await markWaitlistExpired(connection, entry);
        continue;
      }
      throw err;
    }
  }
  throw commandService.httpError(409, '候补队列存在过多无效记录，请稍后重试', 'WAITLIST_INVALID_QUEUE');
};

const notifyPromotion = async function(result) {
  if (!result || !result.entry || !result.promoted) return;
  try {
    await notificationService.createNotification(
      result.entry.user_id,
      'waitlist_converted',
      '候补已转为预约',
      result.promoted.status === 'approved'
        ? '您的候补已自动转为正式预约'
        : '您的候补已转为预约，请留意后续审核状态',
      { reservationId: result.promoted.id, roomId: result.promoted.roomId, date: result.promoted.date }
    );
  } catch (err) {
    logger.error('候补转正已提交，但通知失败:', err);
  }
};

const publishLifecycleRooms = async function(reservation, promotion, context) {
  await realtimeEventService.publishReservationRoomsSafely([
    reservation,
    promotion && promotion.promoted
  ], context);
};

const releaseAndPromoteMysql = async function(options) {
  const connection = await db.getConnection();
  db.assertTransactional(connection);
  let reservation;
  let promotion;
  let nextStatus;
  let creditResult;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [Number(options.reservationId)]);
    reservation = rows[0];
    validateRelease(reservation, options);
    if ((!options.nextStatus || options.nextStatus === 'cancelled') && reservation.status === 'cancelled') {
      await synchronizeCancelledGroup((sql, params) => connection.execute(sql, params), reservation.id);
      await connection.commit();
      return { reservation: mapReservation(reservation), promotedReservation: null, waitlistEntry: null, idempotent: true };
    }
    await validateNoshow(reservation, options, (sql, params) => connection.execute(sql, params));
    nextStatus = await updateReleasedReservation(connection, reservation, options);
    if (nextStatus === 'cancelled') await synchronizeCancelledGroup((sql, params) => connection.execute(sql, params), reservation.id);
    creditResult = await applyNoshowCredit(connection, reservation, options);
    promotion = await promoteWithinTransaction(connection, reservation);
    await connection.commit();
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {
      logger.error('释放预约与候补转正回滚失败:', rollbackErr);
    }
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      throw commandService.httpError(409, '候补转正时段已被占用，请刷新后重试', 'SLOT_CONFLICT');
    }
    throw err;
  } finally {
    connection.release();
  }

  await notifyPromotion(promotion);
  if (nextStatus === 'noshow') await notifyNoshow(reservation, creditResult);
  await publishLifecycleRooms(reservation, promotion, 'reservation-lifecycle-committed');
  if (['cancelled', 'rejected', 'noshow'].includes(nextStatus)) await require('./danceGroupNotificationService').notifySafely(reservation.id, true);
  return {
    reservation: mapReservation(reservation, nextStatus),
    promotedReservation: promotion ? promotion.promoted : null,
    waitlistEntry: promotion ? promotion.entry : null
  };
};

const copyMockState = function(tables) {
  return {
    reservations: JSON.parse(JSON.stringify(tables.reservations || [])),
    groups: JSON.parse(JSON.stringify(tables.reservation_groups || [])),
    reservationSlots: JSON.parse(JSON.stringify(tables.reservation_slots || [])),
    waitlist: JSON.parse(JSON.stringify(tables.reservation_waitlist || []))
  };
};

const restoreMockState = function(tables, snapshot) {
  tables.reservations = snapshot.reservations;
  tables.reservation_groups = snapshot.groups;
  tables.reservation_slots = snapshot.reservationSlots;
  tables.reservation_waitlist = snapshot.waitlist;
};

// 只记录本次爽约的信用副作用；不恢复整张用户/积分表，避免覆盖无关更新。
const mockCreditWork = function(tables, reservation) {
  const userId = Number(reservation.user_id);
  const user = tables.users.find(row => Number(row.id) === userId);
  const original = user && { status: user.status, restricted_until: user.restricted_until,
    hasUntil: Object.prototype.hasOwnProperty.call(user, 'restricted_until') };
  const priorLogIds = new Set((tables.credits_log || []).filter(log => Number(log.user_id) === userId &&
    log.type === 'noshow' && Number(log.related_id) === Number(reservation.id)).map(log => Number(log.id)));
  let creditDelta = 0;
  let lastStatus = null;
  return {
    query: async function(sql, params) {
      const scoreWrite = /^UPDATE users SET credit_score/i.test(sql) && Number(params[1]) === userId;
      const statusWrite = /^UPDATE users SET status/i.test(sql) && Number(params[params.length - 1]) === userId;
      const before = scoreWrite && user ? Number(user.credit_score) : 0;
      try { return await db.query(sql, params); }
      finally {
        if (scoreWrite && user) creditDelta += Number(user.credit_score) - before;
        if (statusWrite && user) lastStatus = { status: user.status, restricted_until: user.restricted_until };
      }
    },
    rollback: function() {
      const current = tables.users.find(row => Number(row.id) === userId);
      if (current) {
        current.credit_score = Number(current.credit_score) - creditDelta;
        if (original && lastStatus && current.status === lastStatus.status && String(current.restricted_until) === String(lastStatus.restricted_until)) {
          current.status = original.status;
          if (original.hasUntil) current.restricted_until = original.restricted_until;
          else delete current.restricted_until;
        }
      }
      tables.credits_log = (tables.credits_log || []).filter(log => !(Number(log.user_id) === userId &&
        log.type === 'noshow' && Number(log.related_id) === Number(reservation.id) && !priorLogIds.has(Number(log.id))));
    }
  };
};

const releaseAndPromoteMock = async function(options) {
  const tables = require('../config/mock-db').__tables;
  if (!tables.reservation_slots) tables.reservation_slots = [];
  if (!tables.reservation_waitlist) tables.reservation_waitlist = [];
  const snapshot = copyMockState(tables);
  let promotion = null;
  let creditWork = null;
  let committed = false;
  try {
    const reservation = tables.reservations.find(function(row) {
      return Number(row.id) === Number(options.reservationId);
    });
    validateRelease(reservation, options);
    if ((!options.nextStatus || options.nextStatus === 'cancelled') && reservation.status === 'cancelled') {
      await synchronizeCancelledGroup(db.query, reservation.id);
      return { reservation: mapReservation(reservation), promotedReservation: null, waitlistEntry: null, idempotent: true };
    }
    await validateNoshow(reservation, options, db.query);
    // Awaiting the check above allows another request to win; recheck before the status write.
    validateRelease(reservation, options);
    // 乐观锁（R-02）：mock 模式同样支持 version 校验与自增，行为与 MySQL 路径一致。
    const expectedVersion = normalizeExpectedVersion(options.expectedVersion);
    if (expectedVersion !== null && Number(reservation.version || 1) !== expectedVersion) {
      throw auditVersionConflictError();
    }
    const nextStatus = options.nextStatus || 'cancelled';
    reservation.status = nextStatus;
    reservation.version = Number(reservation.version || 1) + 1;
    reservation.updated_at = helpers.formatDateTime(new Date());
    if (nextStatus === 'cancelled') reservation.cancelled_at = reservation.updated_at;
    if (nextStatus === 'cancelled') await synchronizeCancelledGroup(db.query, reservation.id);
    if (nextStatus === 'rejected') reservation.reject_reason = options.reason || '';
    tables.reservation_slots = tables.reservation_slots.filter(function(slot) {
      return Number(slot.reservation_id) !== Number(reservation.id);
    });

    const candidates = tables.reservation_waitlist
      .filter(function(entry) {
        const seatMatches = reservation.seat_id
          ? (!entry.seat_id || Number(entry.seat_id) === Number(reservation.seat_id))
          : !entry.seat_id;
        return Number(entry.room_id) === Number(reservation.room_id) &&
          String(entry.date) === String(reservation.date) &&
          entry.start_time === reservation.start_time &&
          entry.end_time === reservation.end_time &&
          entry.status === 'waiting' && seatMatches;
      })
      .sort(function(a, b) {
        return String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id);
      });

    for (const entry of candidates) {
      try {
        const promoted = await commandService.createReservation({
          userId: entry.user_id,
          roomId: entry.room_id,
          seatId: entry.seat_id || reservation.seat_id || null,
          date: entry.date,
          startTime: entry.start_time,
          endTime: entry.end_time,
          purpose: '候补转正',
          participants: 1,
          idempotencyKey: 'waitlist:' + entry.id
        });
        entry.status = 'converted';
        entry.updated_at = helpers.formatDateTime(new Date());
        promotion = { entry, promoted };
        break;
      } catch (err) {
        if ([400, 403, 404].includes(Number(err.httpStatus))) {
          entry.status = 'expired';
          entry.updated_at = helpers.formatDateTime(new Date());
          continue;
        }
        throw err;
      }
    }

    if (nextStatus === 'noshow') creditWork = mockCreditWork(tables, reservation);
    const creditResult = await applyNoshowCredit(creditWork || { query: db.query }, reservation, options);
    committed = true;
    await notifyPromotion(promotion);
    if (nextStatus === 'noshow') {
      try { await notifyNoshow(reservation, creditResult); }
      catch (err) { logger.error('爽约已提交，通知将由后续扫描重试:', err); }
    }
    await publishLifecycleRooms(reservation, promotion, 'reservation-lifecycle-mock');
    if (['cancelled', 'rejected', 'noshow'].includes(nextStatus)) await require('./danceGroupNotificationService').notifySafely(reservation.id, true);
    return {
      reservation: mapReservation(reservation, nextStatus),
      promotedReservation: promotion ? promotion.promoted : null,
      waitlistEntry: promotion ? promotion.entry : null
    };
  } catch (err) {
    if (!committed) {
      if (creditWork) creditWork.rollback();
      restoreMockState(tables, snapshot);
    }
    throw err;
  }
};

const releaseAndPromote = async function(options) {
  if (db.isMock()) {
    const run = mockLifecycleQueue.then(() => releaseAndPromoteMock(options));
    mockLifecycleQueue = run.catch(() => {});
    return run;
  }
  return releaseAndPromoteMysql(options);
};

const promoteReleasedReservation = async function(source) {
  if (!source) return null;
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    const syntheticId = Number(source.id);
    const stored = tables.reservations.find(function(row) { return Number(row.id) === syntheticId; });
    if (!stored) return null;
    const originalStatus = stored.status;
    stored.status = 'approved';
    try {
      const result = await releaseAndPromoteMock({
        reservationId: stored.id,
        nextStatus: originalStatus,
        allowedCurrentStatuses: ['approved']
      });
      return result.promotedReservation;
    } finally {
      stored.status = originalStatus;
    }
  }

  const connection = await db.getConnection();
  db.assertTransactional(connection);
  let promotion;
  try {
    await connection.beginTransaction();
    promotion = await promoteWithinTransaction(connection, source);
    await connection.commit();
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) return null;
    throw err;
  } finally {
    connection.release();
  }
  await notifyPromotion(promotion);
  await publishLifecycleRooms(source, promotion, 'waitlist-promotion-committed');
  return promotion ? promotion.promoted : null;
};

const detectNoshow = async function(referenceDate) {
  const now = referenceDate instanceof Date ? referenceDate : new Date();
  const [reservations] = db.isMock() ? [require('../config/mock-db').__tables.reservations.slice()] : await db.query(
    "SELECT r.* FROM reservations r WHERE r.status IN ('approved', 'noshow') AND CONCAT(r.date, ' ', r.start_time) < ? AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = r.user_id AND n.dedupe_key = CONCAT('noshow:reservation:', r.id))",
    [helpers.formatDateTime(new Date(now.getTime() - 15 * 60000))]
  );

  for (const reservation of reservations) {
    try {
      if (!['approved', 'noshow'].includes(reservation.status) || !checkinWindowPolicy.isOverdue(reservation, now)) continue;
      if (reservation.status === 'noshow') {
        await notifyNoshow(reservation);
        continue;
      }
      await releaseAndPromote({
        reservationId: reservation.id,
        nextStatus: 'noshow',
        allowedCurrentStatuses: ['approved'],
        now
      });
      logger.info('爽约检测: 预约ID=' + reservation.id + ', 用户ID=' + reservation.user_id);
    } catch (err) {
      if (Number(err.httpStatus) === 409) continue;
      logger.error('处理爽约预约失败:', err);
    }
  }
};

module.exports = {
  releaseAndPromote,
  promoteReleasedReservation,
  detectNoshow,
  promoteWithinTransaction
};
