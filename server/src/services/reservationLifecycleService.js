const db = require('../config/database');
const logger = require('../config/logger');
const helpers = require('../utils/helpers');
const config = require('../config');
const commandService = require('./reservationCommandService');
const notificationService = require('./notificationService');
const realtimeEventService = require('./realtimeEventService');

const ACTIVE_STATUSES = commandService.ACTIVE_STATUSES;

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
  const allowedStatuses = options.allowedCurrentStatuses || ACTIVE_STATUSES;
  if (!allowedStatuses.includes(reservation.status)) {
    throw commandService.httpError(409, '预约已被处理或当前状态无法释放');
  }
  if (options.actorRole === 'student' && Number(reservation.user_id) !== Number(options.actorUserId)) {
    throw commandService.httpError(403, '无权操作此预约');
  }
};

const updateReleasedReservation = async function(connection, reservation, options) {
  const nextStatus = options.nextStatus || 'cancelled';
  if (nextStatus === 'rejected') {
    await connection.execute(
      "UPDATE reservations SET status = 'rejected', reject_reason = ?, audited_by = ?, audited_at = NOW(), updated_at = NOW() WHERE id = ? AND status = ?",
      [options.reason || '', options.auditedBy || null, reservation.id, reservation.status]
    );
  } else if (nextStatus === 'noshow') {
    await connection.execute(
      "UPDATE reservations SET status = 'noshow', updated_at = NOW() WHERE id = ? AND status = ?",
      [reservation.id, reservation.status]
    );
  } else {
    await connection.execute(
      "UPDATE reservations SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = ? AND status = ?",
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
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [Number(options.reservationId)]);
    reservation = rows[0];
    validateRelease(reservation, options);
    nextStatus = await updateReleasedReservation(connection, reservation, options);
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
  await publishLifecycleRooms(reservation, promotion, 'reservation-lifecycle-committed');
  return {
    reservation: mapReservation(reservation, nextStatus),
    promotedReservation: promotion ? promotion.promoted : null,
    waitlistEntry: promotion ? promotion.entry : null
  };
};

const copyMockState = function(tables) {
  return {
    reservations: JSON.parse(JSON.stringify(tables.reservations || [])),
    reservationSlots: JSON.parse(JSON.stringify(tables.reservation_slots || [])),
    waitlist: JSON.parse(JSON.stringify(tables.reservation_waitlist || []))
  };
};

const restoreMockState = function(tables, snapshot) {
  tables.reservations = snapshot.reservations;
  tables.reservation_slots = snapshot.reservationSlots;
  tables.reservation_waitlist = snapshot.waitlist;
};

const releaseAndPromoteMock = async function(options) {
  const tables = require('../config/mock-db').__tables;
  if (!tables.reservation_slots) tables.reservation_slots = [];
  if (!tables.reservation_waitlist) tables.reservation_waitlist = [];
  const snapshot = copyMockState(tables);
  let promotion = null;
  try {
    const reservation = tables.reservations.find(function(row) {
      return Number(row.id) === Number(options.reservationId);
    });
    validateRelease(reservation, options);
    const nextStatus = options.nextStatus || 'cancelled';
    reservation.status = nextStatus;
    reservation.updated_at = helpers.formatDateTime(new Date());
    if (nextStatus === 'cancelled') reservation.cancelled_at = reservation.updated_at;
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

    await notifyPromotion(promotion);
    await publishLifecycleRooms(reservation, promotion, 'reservation-lifecycle-mock');
    return {
      reservation: mapReservation(reservation, nextStatus),
      promotedReservation: promotion ? promotion.promoted : null,
      waitlistEntry: promotion ? promotion.entry : null
    };
  } catch (err) {
    restoreMockState(tables, snapshot);
    throw err;
  }
};

const releaseAndPromote = async function(options) {
  if (db.isMock()) return releaseAndPromoteMock(options);
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

const detectNoshow = async function() {
  const now = new Date();
  const today = helpers.formatDate(now);
  const [reservations] = await db.query(
    "SELECT r.* FROM reservations r WHERE r.date = ? AND r.status = 'approved' AND CONCAT(r.date, ' ', r.start_time) < DATE_SUB(NOW(), INTERVAL 15 MINUTE)",
    [today]
  );

  for (const reservation of reservations) {
    try {
      const [checkins] = await db.query('SELECT id FROM checkins WHERE reservation_id = ?', [reservation.id]);
      if (checkins.length) continue;
      await releaseAndPromote({
        reservationId: reservation.id,
        nextStatus: 'noshow',
        allowedCurrentStatuses: ['approved']
      });
      const creditService = require('./creditService');
      await creditService.addCredit(
        reservation.user_id,
        config.credit.noshowPenalty,
        'noshow',
        '超时未签到，自动标记爽约'
      );
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
