const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const config = require('../config');
const creditService = require('../services/creditService');
const credentialService = require('../services/checkinCredentialService');
const reservationLifecycleService = require('../services/reservationLifecycleService');
const realtimeEventService = require('../services/realtimeEventService');
const privacyAuditService = require('../services/privacyAuditService');
const helpers = require('../utils/helpers');

const ensureProductionDatabase = function() {
  if (process.env.NODE_ENV === 'production' && db.isMock()) {
    const err = new Error('动态签到数据库暂不可用');
    err.httpStatus = 503;
    throw err;
  }
};

const isTransactionalConnection = function(connection) {
  return !!(
    connection &&
    typeof connection.beginTransaction === 'function' &&
    typeof connection.execute === 'function'
  );
};

const ensureProductionTransaction = function(transactional, message) {
  if (process.env.NODE_ENV === 'production' && !transactional) {
    const err = new Error(message || '动态签到事务服务暂不可用');
    err.httpStatus = 503;
    throw err;
  }
};

const checkin = async function(req, res) {
  let connection = null;
  let transactional = false;
  try {
    ensureProductionDatabase();
    const reservationId = req.body.reservationId;
    const credential = req.body.credential || req.body.code;

    const [reservations] = await db.query(
      'SELECT r.*, rm.name AS room_name FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.id = ?',
      [reservationId]
    );
    ensureProductionDatabase();
    if (!reservations.length) return response.error(res, '预约不存在', 404);

    const reservation = reservations[0];
    if (Number(reservation.user_id) !== Number(req.user.id) && req.user.role === 'student') {
      return response.error(res, '无权签到此预约', 403);
    }
    if (reservation.status !== 'approved') {
      if (reservation.status === 'checked_in') {
        return response.error(res, '已签到，请勿重复签到', 409);
      }
      return response.error(res, '当前预约状态无法签到', 400);
    }

    const now = new Date();
    const today = helpers.formatDate(now);
    if (String(reservation.date).slice(0, 10) !== today) {
      return response.error(res, '只能在预约当天签到', 400);
    }

    const currentMinutes = helpers.timeToMinutes(helpers.formatTime(now));
    const startMinutes = helpers.timeToMinutes(reservation.start_time);
    if (currentMinutes < startMinutes - 30) {
      return response.error(res, '未到签到时间，最早可提前30分钟签到', 400);
    }
    if (currentMinutes > startMinutes + config.reservation.lateMinutes) {
      return response.error(res, '已超过签到时间' + config.reservation.lateMinutes + '分钟', 400);
    }

    const [existingCheckin] = await db.query('SELECT id FROM checkins WHERE reservation_id = ?', [reservationId]);
    ensureProductionDatabase();
    if (existingCheckin.length) return response.error(res, '已签到，请勿重复签到', 409);

    connection = await db.getConnection();
    ensureProductionDatabase();
    transactional = isTransactionalConnection(connection);
    ensureProductionTransaction(transactional);
    if (transactional) await connection.beginTransaction();

    // 凭证只在确认数据库事务可用后消费，避免数据库故障导致有效凭证被提前作废。
    await credentialService.consume(credential, reservation);

    const runQuery = transactional
      ? function(sql, params) { return connection.execute(sql, params); }
      : db.query;

    const [updateResult] = await runQuery(
      "UPDATE reservations SET status = 'checked_in' WHERE id = ? AND status = 'approved'",
      [reservationId]
    );
    if (!updateResult || updateResult.affectedRows === 0) {
      const err = new Error('预约状态已变化，请刷新后重试');
      err.httpStatus = 409;
      throw err;
    }

    await runQuery(
      'INSERT INTO checkins (reservation_id, user_id, room_id, checkin_time, checkin_type, created_at) VALUES (?, ?, ?, NOW(), ?, NOW())',
      [reservationId, reservation.user_id, reservation.room_id, 'qrcode']
    );

    if (transactional) await connection.commit();
    await realtimeEventService.publishRoomStatusSafely(reservation.room_id, 'qrcode-checkin');
    return response.success(res, null, '签到成功');
  } catch (err) {
    if (transactional && connection && typeof connection.rollback === 'function') {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        logger.error('签到事务回滚失败:', rollbackErr);
      }
    }
    logger.error('签到异常:', err);
    return response.error(res, err.message || '签到失败', err.httpStatus || 500);
  } finally {
    if (connection && typeof connection.release === 'function') connection.release();
  }
};

const checkout = async function(req, res) {
  let connection = null;
  let transactional = false;
  let checkedOutUserId = null;
  let checkedOutRoomId = null;
  try {
    ensureProductionDatabase();
    const reservationId = Number(req.body.reservationId);
    connection = await db.getConnection();
    ensureProductionDatabase();
    transactional = isTransactionalConnection(connection);
    ensureProductionTransaction(transactional, '签退事务服务暂不可用');
    if (transactional) await connection.beginTransaction();

    const runQuery = transactional
      ? function(sql, params) { return connection.execute(sql, params); }
      : db.query;
    const lockClause = transactional ? ' FOR UPDATE' : '';
    const [checkins] = await runQuery(
      'SELECT * FROM checkins WHERE reservation_id = ? AND checkout_time IS NULL' + lockClause,
      [reservationId]
    );
    if (!checkins.length) {
      const err = new Error('未找到可签退的签到记录');
      err.httpStatus = 409;
      throw err;
    }

    const [checkinUpdate] = await runQuery(
      'UPDATE checkins SET checkout_time = NOW() WHERE id = ? AND checkout_time IS NULL',
      [checkins[0].id]
    );
    if (checkinUpdate && checkinUpdate.affectedRows !== undefined && checkinUpdate.affectedRows !== 1) {
      const err = new Error('签到记录已被其他操作签退');
      err.httpStatus = 409;
      throw err;
    }

    const [reservationUpdate] = await runQuery(
      "UPDATE reservations SET status = 'completed', updated_at = NOW() WHERE id = ? AND status = 'checked_in'",
      [reservationId]
    );
    if (reservationUpdate && reservationUpdate.affectedRows !== undefined && reservationUpdate.affectedRows !== 1) {
      const err = new Error('预约状态已变化，请刷新后重试');
      err.httpStatus = 409;
      throw err;
    }

    // completed 不再占用有效时间槽；与签到记录和预约状态在同一事务提交。
    await runQuery('DELETE FROM reservation_slots WHERE reservation_id = ?', [reservationId]);

    checkedOutUserId = checkins[0].user_id;
    checkedOutRoomId = checkins[0].room_id;
    if (transactional) await connection.commit();
  } catch (err) {
    if (transactional && connection && typeof connection.rollback === 'function') {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        logger.error('签退事务回滚失败:', rollbackErr);
      }
    }
    logger.error('签退异常:', err);
    return response.error(res, err.message || '签退失败', err.httpStatus || 500);
  } finally {
    if (connection && typeof connection.release === 'function') connection.release();
  }

  await realtimeEventService.publishRoomStatusSafely(checkedOutRoomId, 'checkout');
  try {
    await creditService.addCredit(
      checkedOutUserId,
      config.credit.goodReward,
      'good_behavior',
      '正常使用功能房'
    );
  } catch (creditErr) {
    logger.error('签退已提交，但信用奖励写入失败:', creditErr);
  }
  return response.success(res, null, '签退成功');
};

const getStatus = async function(req, res) {
  try {
    const [checkins] = await db.query(
      'SELECT * FROM checkins WHERE reservation_id = ?',
      [req.params.reservationId]
    );
    return response.success(res, {
      checkedIn: checkins.length > 0,
      checkinTime: checkins.length ? checkins[0].checkin_time : null,
      checkoutTime: checkins.length ? checkins[0].checkout_time : null
    });
  } catch (err) {
    logger.error('获取签到状态异常:', err);
    return response.error(res, err.message || '获取签到状态失败', err.httpStatus || 500);
  }
};

const lockSuffix = function(transactional) {
  return transactional ? ' FOR UPDATE' : '';
};

/**
 * 事务化「手动补签到」写入（R-08 复用）。
 *
 * 把 `reservations.status` 置为 `checked_in`，并写入 `checkins(checkin_type='admin_manual')`。
 * 由两处共用：
 *   1) `checkinController.manualCheckin`——管理员**直接写入**的旧路径（前端待迁移，见 docs/upgrade-followups.md）；
 *   2) `services/supplementService.approve`——补签工单「审核通过后」才写入的新路径。
 *
 * 兼容性：仅当调用方显式传入 `supplementRequestId` 时，INSERT 才带上 `supplement_request_id` 列，
 * 避免迁移未应用的环境下破坏既有 `manualCheckin`（列不存在）。
 *
 * @param {{transactional: boolean, query: Function}} runner 事务执行器
 * @param {object} options
 * @param {number} options.reservationId 预约 id
 * @param {number|undefined} [options.supplementRequestId] 关联补签工单 id（传 undefined 则沿用旧 INSERT）
 * @param {string} [options.statusMessage] 状态不可签到时的中文提示
 * @returns {Promise<{reservation: object, roomId: number}>}
 */
const applyManualCheckinWithinTransaction = async function(runner, options) {
  const reservationId = Number(options.reservationId);
  const statusMessage = options.statusMessage || '当前预约状态无法补签';
  const lock = lockSuffix(runner.transactional);

  const [reservations] = await runner.query('SELECT * FROM reservations WHERE id = ?' + lock, [reservationId]);
  if (!reservations.length) {
    const err = new Error('预约不存在');
    err.httpStatus = 404;
    throw err;
  }
  const reservation = reservations[0];
  if (reservation.status !== 'approved') {
    const err = new Error(reservation.status === 'checked_in' ? '已签到' : statusMessage);
    err.httpStatus = reservation.status === 'checked_in' ? 409 : 400;
    throw err;
  }

  const [existingCheckin] = await runner.query('SELECT id FROM checkins WHERE reservation_id = ?' + lock, [reservationId]);
  if (existingCheckin.length) {
    const err = new Error('已签到');
    err.httpStatus = 409;
    throw err;
  }

  const [updateResult] = await runner.query(
    "UPDATE reservations SET status = 'checked_in', updated_at = NOW() WHERE id = ? AND status = 'approved'",
    [reservationId]
  );
  if (!updateResult || updateResult.affectedRows === 0) {
    const err = new Error('预约状态已变化，请刷新后重试');
    err.httpStatus = 409;
    throw err;
  }

  if (options.supplementRequestId === undefined) {
    // 旧路径（manualCheckin）：INSERT 不含 supplement_request_id，迁移未应用时同样可用。
    await runner.query(
      'INSERT INTO checkins (reservation_id, user_id, room_id, checkin_time, checkin_type, created_at) VALUES (?, ?, ?, NOW(), ?, NOW())',
      [reservationId, reservation.user_id, reservation.room_id, 'admin_manual']
    );
  } else {
    // 新路径（补签审核通过）：回填 supplement_request_id（依赖 20260919_supplement_request.sql 迁移）。
    const supplementRequestId = options.supplementRequestId === null ? null : Number(options.supplementRequestId);
    await runner.query(
      'INSERT INTO checkins (reservation_id, user_id, room_id, checkin_time, checkin_type, supplement_request_id, created_at) VALUES (?, ?, ?, NOW(), ?, ?, NOW())',
      [reservationId, reservation.user_id, reservation.room_id, 'admin_manual', Number.isInteger(supplementRequestId) ? supplementRequestId : null]
    );
  }

  return { reservation: reservation, roomId: reservation.room_id };
};

/**
 * 事务化「手动补签退」写入（R-08 复用，仅供 supplementService.approve 的 type='signout' 调用）。
 *
 * 语义对齐 `checkinController.checkout`：给未签退的签到记录补 `checkout_time`，
 * 把预约置为 `completed`，并释放占用的时间槽（`reservation_slots`）。同一事务提交。
 *
 * @param {{transactional: boolean, query: Function}} runner 事务执行器
 * @param {object} options
 * @param {number} options.reservationId 预约 id
 * @param {number|null} options.supplementRequestId 关联补签工单 id
 * @returns {Promise<{reservation: object, roomId: number}>}
 */
const applyManualSignoutWithinTransaction = async function(runner, options) {
  const reservationId = Number(options.reservationId);
  const lock = lockSuffix(runner.transactional);

  const [reservations] = await runner.query('SELECT * FROM reservations WHERE id = ?' + lock, [reservationId]);
  if (!reservations.length) {
    const err = new Error('预约不存在');
    err.httpStatus = 404;
    throw err;
  }
  const reservation = reservations[0];
  if (reservation.status !== 'checked_in') {
    const err = new Error('当前预约状态无法补签退');
    err.httpStatus = 409;
    throw err;
  }

  const [checkins] = await runner.query(
    'SELECT * FROM checkins WHERE reservation_id = ? AND checkout_time IS NULL' + lock,
    [reservationId]
  );
  if (!checkins.length) {
    const err = new Error('未找到可补签退的签到记录');
    err.httpStatus = 409;
    throw err;
  }

  const supplementRequestId = options.supplementRequestId === null || options.supplementRequestId === undefined
    ? null
    : Number(options.supplementRequestId);
  await runner.query(
    'UPDATE checkins SET checkout_time = NOW(), supplement_request_id = ? WHERE id = ? AND checkout_time IS NULL',
    [Number.isInteger(supplementRequestId) ? supplementRequestId : null, checkins[0].id]
  );
  await runner.query(
    "UPDATE reservations SET status = 'completed', updated_at = NOW() WHERE id = ? AND status = 'checked_in'",
    [reservationId]
  );
  await runner.query('DELETE FROM reservation_slots WHERE reservation_id = ?', [reservationId]);

  return { reservation: reservation, roomId: reservation.room_id };
};

/**
 * 管理员「手动签到」（**旧路径**）。
 *
 * ⚠️ FOLLOWUP（P1）：本接口是「管理员直接写入 checkins」的直写路径，尚未接入补签申请-审核流。
 * 前端（admin UI）当前仍在使用，故本批次**保留可用**，不做禁用，避免蓝绿期前端 500。
 * 待前端迁移到「补签申请 → 审核」后停用直写（见 docs/upgrade-followups.md 的 P1 条目）。
 */
const manualCheckin = async function(req, res) {
  let connection = null;
  let transactional = false;
  let checkedInRoomId = null;
  try {
    ensureProductionDatabase();
    const reservationId = Number(req.body.reservationId);
    connection = await db.getConnection();
    ensureProductionDatabase();
    transactional = isTransactionalConnection(connection);
    ensureProductionTransaction(transactional, '手动签到事务服务暂不可用');
    if (transactional) await connection.beginTransaction();

    const runner = {
      transactional: transactional,
      query: transactional
        ? function(sql, params) { return connection.execute(sql, params); }
        : db.query
    };
    const result = await applyManualCheckinWithinTransaction(runner, {
      reservationId: reservationId,
      statusMessage: '当前预约状态无法手动签到'
      // 不传 supplementRequestId：沿用「不含 supplement_request_id 列」的旧 INSERT，保持向后兼容。
    });

    checkedInRoomId = result.roomId;
    if (transactional) await connection.commit();
    await realtimeEventService.publishRoomStatusSafely(checkedInRoomId, 'manual-checkin');
    return response.success(res, null, '手动签到成功');
  } catch (err) {
    if (transactional && connection && typeof connection.rollback === 'function') {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        logger.error('手动签到事务回滚失败:', rollbackErr);
      }
    }
    logger.error('手动签到异常:', err);
    return response.error(res, err.message || '手动签到失败', err.httpStatus || 500);
  } finally {
    if (connection && typeof connection.release === 'function') connection.release();
  }
};

const currentCheckins = async function(req, res) {
  try {
    // 附带 rm.building_id，供隐私脱敏按管理员数据域判定可见性（R-14）。
    const [checkins] = await db.query(
      'SELECT c.*, r.date, r.start_time, r.end_time, rm.building_id, u.nickname, u.real_name, u.student_id ' +
      'FROM checkins c JOIN reservations r ON c.reservation_id = r.id ' +
      'JOIN rooms rm ON rm.id = c.room_id ' +
      'JOIN users u ON c.user_id = u.id WHERE c.room_id = ? AND c.checkout_time IS NULL ' +
      'ORDER BY c.checkin_time DESC',
      [req.params.roomId]
    );
    // 按请求者身份分级脱敏：管理员在数据域内可见明文（并落审计），否则掩码。
    const safeCheckins = await privacyAuditService.maskRowsForRequest(req, checkins, {
      targetTable: 'checkins',
      description: '当前在场签到列表：管理员查看明文个人信息'
    });
    return response.success(res, safeCheckins);
  } catch (err) {
    logger.error('获取当前签到列表异常:', err);
    return response.error(res, err.message || '获取当前签到列表失败', err.httpStatus || 500);
  }
};

const patrol = async function(req, res) {
  try {
    const reservationId = Number(req.body.reservationId);
    const status = req.body.status;
    const [reservations] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (!reservations.length) return response.error(res, '预约不存在', 404);

    if (status === 'absent') {
      await reservationLifecycleService.releaseAndPromote({
        reservationId,
        nextStatus: 'noshow',
        allowedCurrentStatuses: ['approved']
      });
      try {
        await creditService.addCredit(
          reservations[0].user_id,
          config.credit.noshowPenalty,
          'noshow',
          '巡查发现爽约'
        );
      } catch (creditErr) {
        logger.error('巡查爽约已提交，但信用扣分失败:', creditErr);
      }
    }

    return response.success(res, null, '巡查记录已提交');
  } catch (err) {
    logger.error('巡查异常:', err);
    return response.error(res, err.message || '巡查提交失败', err.httpStatus || 500);
  }
};

module.exports = {
  ensureProductionDatabase,
  checkin,
  checkout,
  getStatus,
  manualCheckin,
  applyManualCheckinWithinTransaction,
  applyManualSignoutWithinTransaction,
  currentCheckins,
  patrol
};
