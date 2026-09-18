/**
 * 补签工单服务（架构设计 R-08 / 任务 T04）。
 *
 * 流程：申请人提交补签工单（pending） -> 另一位管理员审核（approve / reject）。
 *   - approve：在同一事务内「置工单 approved + 写入 checkins（补签到）/ 补 checkout_time（补签退）」，
 *     复用 `checkinController` 抽出的事务写入函数（沿用 FOR UPDATE 与 admin_manual 语义）。
 *   - reject：仅置工单 rejected。
 *
 * 关键约束：
 *   1) **禁止自审**：`applicant_id === reviewer_id` 时返回业务码 SUPPLEMENT_SELF_REVIEW_FORBIDDEN（403）。
 *   2) 楼栋数据域：审核校验收紧在请求的 `adminScope` 内（越权返回 PERMISSION_DENIED）。
 *   3) 关键动作同时落**防篡改审计链**（auditTrailService.record）；业务可见轨迹由工单行本身承载。
 *
 * 兼容性：只新增表读写，不改动既有接口；旧路径 checkinController.manualCheckin 保持可用。
 */

const db = require('../config/database');
const logger = require('../config/logger');
const errorCodes = require('../config/errorCodes');
const auditTrailService = require('./auditTrailService');
const realtimeEventService = require('./realtimeEventService');
const checkinController = require('../controllers/checkinController');

const STATUSES = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' });
const TYPES = Object.freeze({ SIGNIN: 'signin', SIGNOUT: 'signout' });
const ACTIONS = Object.freeze({ APPROVE: 'approve', REJECT: 'reject' });

const COLUMNS = 'id, reservation_id, applicant_id, type, reason, status, reviewer_id, reviewed_at, review_remark, created_at';

const buildError = function(message, businessCode, httpStatus) {
  const err = new Error(message);
  err.businessCode = businessCode || null;
  err.httpStatus = httpStatus || 400;
  return err;
};

const normalizeType = function(type) {
  return Object.keys(TYPES).some(function(key) { return TYPES[key] === type; }) ? type : null;
};

const normalizeStatus = function(status) {
  return Object.keys(STATUSES).some(function(key) { return STATUSES[key] === status; }) ? status : null;
};

const normalizeAction = function(action) {
  return Object.keys(ACTIONS).some(function(key) { return ACTIONS[key] === action; }) ? action : null;
};

/**
 * 在一个（可能存在的）数据库事务内执行工作单元。
 * mock 模式不支持事务，退化为顺序执行（与 checkinController / adminHandoverService 的既有做法一致）。
 * @param {(runner: {transactional: boolean, query: Function}) => Promise<any>} work
 * @returns {Promise<any>}
 */
const runAtomically = async function(work) {
  const connection = await db.getConnection();
  const transactional = !!(
    connection &&
    !connection.isMock &&
    typeof connection.beginTransaction === 'function' &&
    typeof connection.execute === 'function'
  );
  let committed = false;
  try {
    if (transactional) await connection.beginTransaction();
    const runner = {
      transactional: transactional,
      query: transactional
        ? function(sql, params) { return connection.execute(sql, params); }
        : db.query
    };
    const result = await work(runner);
    if (transactional) {
      await connection.commit();
      committed = true;
    }
    return result;
  } catch (err) {
    if (transactional && !committed) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        logger.error('补签审核事务回滚失败:', rollbackErr);
      }
    }
    throw err;
  } finally {
    if (connection && typeof connection.release === 'function') connection.release();
  }
};

const recordAuditSafe = async function(event) {
  try {
    await auditTrailService.record(event);
  } catch (err) {
    logger.error('补签审计链写入失败:', err && err.message ? err.message : err);
  }
};

/**
 * 提交补签申请。
 * @param {object} input
 * @param {number} input.reservationId 预约 id
 * @param {number} input.applicantId 申请人（管理员）id
 * @param {string} input.type 补签类型（signin / signout）
 * @param {string} input.reason 补签原因（必填，<=255）
 * @returns {Promise<{id:number, reservationId:number, type:string, status:string, reason:string}>}
 */
const create = async function(input) {
  const settings = input || {};
  const reservationId = Number(settings.reservationId);
  const applicantId = Number(settings.applicantId);
  const type = normalizeType(settings.type);
  const reason = String(settings.reason === undefined || settings.reason === null ? '' : settings.reason).trim();

  if (!Number.isInteger(reservationId) || reservationId <= 0) throw buildError('预约编号无效', null, 400);
  if (!Number.isInteger(applicantId) || applicantId <= 0) throw buildError('申请人无效', null, 400);
  if (!type) throw buildError('补签类型无效', null, 400);
  if (!reason) throw buildError('请填写补签原因', null, 400);
  if (reason.length > 255) throw buildError('补签原因不能超过255字', null, 400);

  const [reservations] = await db.query('SELECT id FROM reservations WHERE id = ?', [reservationId]);
  if (!reservations || !reservations.length) throw buildError('预约不存在', null, 404);

  const [dup] = await db.query(
    "SELECT id FROM supplement_requests WHERE reservation_id = ? AND type = ? AND status = 'pending'",
    [reservationId, type]
  );
  if (dup && dup.length) throw buildError('该预约已有待审核的补签申请', null, 409);

  const [result] = await db.query(
    'INSERT INTO supplement_requests (reservation_id, applicant_id, type, reason, status) VALUES (?, ?, ?, ?, ?)',
    [reservationId, applicantId, type, reason, STATUSES.PENDING]
  );
  const id = Number(result && result.insertId ? result.insertId : 0);

  await recordAuditSafe({
    operatorId: applicantId,
    actorRole: settings.actorRole || 'admin',
    action: 'supplement.create',
    targetTable: 'supplement_requests',
    targetId: id,
    description: '提交补签申请（' + type + '）',
    statusCode: 200,
    metadata: { reservationId: reservationId, type: type }
  });

  return { id: id, reservationId: reservationId, type: type, status: STATUSES.PENDING, reason: reason };
};

/**
 * 为工单行附加「预约归属 + 宿生信息」上下文，供出口脱敏使用。
 * @param {Array<object>} rows 工单行
 * @returns {Promise<Array<object>>}
 */
const decorateWithReservationContext = async function(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const ids = Array.from(new Set(list.map(function(row) { return Number(row.reservation_id); })
    .filter(function(num) { return Number.isInteger(num) && num > 0; })));
  if (!ids.length) return list;
  const placeholders = ids.map(function() { return '?'; }).join(',');
  const [reservations] = await db.query(
    'SELECT r.id, r.user_id, rm.building_id, u.real_name, u.real_name AS user_name, u.student_id, u.student_no ' +
    'FROM reservations r JOIN rooms rm ON r.room_id = rm.id JOIN users u ON r.user_id = u.id ' +
    'WHERE r.id IN (' + placeholders + ')',
    ids
  );
  const byId = new Map();
  (reservations || []).forEach(function(row) { byId.set(Number(row.id), row); });
  return list.map(function(row) {
    const ctx = byId.get(Number(row.reservation_id)) || {};
    return Object.assign({}, row, {
      user_id: ctx.user_id === undefined ? null : ctx.user_id,
      building_id: ctx.building_id === undefined ? null : ctx.building_id,
      userName: ctx.user_name === undefined ? '' : ctx.user_name,
      user_name: ctx.user_name === undefined ? '' : ctx.user_name,
      real_name: ctx.real_name === undefined ? '' : ctx.real_name,
      student_id: ctx.student_id === undefined ? '' : ctx.student_id,
      student_no: ctx.student_no === undefined ? '' : ctx.student_no
    });
  });
};

/**
 * 查询补签工单列表（可按状态 / 预约筛选），并附加上下文供脱敏。
 * @param {object} [options]
 * @param {string} [options.status] 工单状态
 * @param {number} [options.reservationId] 预约 id
 * @returns {Promise<Array<object>>}
 */
const list = async function(options) {
  const settings = options || {};
  let sql = 'SELECT ' + COLUMNS + ' FROM supplement_requests WHERE 1=1';
  const params = [];
  if (settings.status) {
    const status = normalizeStatus(settings.status);
    if (!status) throw buildError('工单状态无效', null, 400);
    sql += ' AND status = ?';
    params.push(status);
  }
  if (settings.reservationId !== undefined && settings.reservationId !== null && settings.reservationId !== '') {
    const reservationId = Number(settings.reservationId);
    if (!Number.isInteger(reservationId) || reservationId <= 0) throw buildError('预约编号无效', null, 400);
    sql += ' AND reservation_id = ?';
    params.push(reservationId);
  }
  sql += ' ORDER BY id DESC';
  const [rows] = await db.query(sql, params);
  return decorateWithReservationContext(rows || []);
};

/**
 * 查询单条补签工单（原始行）。
 * @param {number} id 工单 id
 * @returns {Promise<object|null>}
 */
const getById = async function(id) {
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) return null;
  const [rows] = await db.query('SELECT ' + COLUMNS + ' FROM supplement_requests WHERE id = ?', [requestId]);
  return rows && rows.length ? rows[0] : null;
};

/**
 * 审核补签工单（事务化）。
 * @param {object} input
 * @param {number} input.requestId 工单 id
 * @param {number} input.reviewerId 审核人（管理员）id
 * @param {string} input.action 审核动作（approve / reject）
 * @param {string} [input.reason] 驳回原因（reject 必填）
 * @param {string} [input.reviewerRole] 审核人角色
 * @param {object} [input.adminScope] 审核人数据域（{isGlobal, buildingId}），用于楼栋校验
 * @returns {Promise<object>} 审核结果摘要
 */
const review = async function(input) {
  const settings = input || {};
  const requestId = Number(settings.requestId);
  const reviewerId = Number(settings.reviewerId);
  const action = normalizeAction(settings.action);
  const reason = String(settings.reason === undefined || settings.reason === null ? '' : settings.reason).trim();

  if (!Number.isInteger(requestId) || requestId <= 0) throw buildError('工单编号无效', null, 400);
  if (!Number.isInteger(reviewerId) || reviewerId <= 0) throw buildError('审核人无效', null, 400);
  if (!action) throw buildError('审核动作无效', null, 400);
  if (action === ACTIONS.REJECT && !reason) throw buildError('请填写驳回原因', null, 400);

  const result = await runAtomically(async function(runner) {
    const lock = runner.transactional ? ' FOR UPDATE' : '';
    const [requests] = await runner.query('SELECT ' + COLUMNS + ' FROM supplement_requests WHERE id = ?' + lock, [requestId]);
    if (!requests || !requests.length) throw buildError('补签工单不存在', null, 404);
    const request = requests[0];

    if (request.status !== STATUSES.PENDING) {
      throw buildError('该工单已处理，请刷新后重试', null, 409);
    }

    // 禁止自审（R-08 / Q4）
    if (Number(request.applicant_id) === reviewerId) {
      throw buildError('不能审核本人提交的补签申请', errorCodes.ERROR_CODES.SUPPLEMENT_SELF_REVIEW_FORBIDDEN, 403);
    }

    // 楼栋数据域校验（与预约审核一致）
    const scope = settings.adminScope || null;
    if (scope) {
      const [scoped] = await runner.query(
        'SELECT r.id, rm.building_id FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.id = ?',
        [Number(request.reservation_id)]
      );
      if (scoped && scoped.length && scope.isGlobal !== true &&
          Number(scoped[0].building_id) !== Number(scope.buildingId)) {
        throw buildError('无权审核其他楼栋的补签', errorCodes.ERROR_CODES.PERMISSION_DENIED, 403);
      }
    }

    if (action === ACTIONS.APPROVE) {
      if (request.type === TYPES.SIGNOUT) {
        await checkinController.applyManualSignoutWithinTransaction(runner, {
          reservationId: Number(request.reservation_id),
          supplementRequestId: Number(request.id)
        });
      } else {
        await checkinController.applyManualCheckinWithinTransaction(runner, {
          reservationId: Number(request.reservation_id),
          supplementRequestId: Number(request.id)
        });
      }
    }

    const nextStatus = action === ACTIONS.APPROVE ? STATUSES.APPROVED : STATUSES.REJECTED;
    // 审核意见持久化到独立列 `review_remark`（approve/reject 均可填；无意见写 NULL），
    // 与申请人填写的 `reason` 分列存放，互不覆盖。驳回时业务已强校验 reason 非空。
    const reviewRemark = reason ? reason : null;
    const [updateResult] = await runner.query(
      "UPDATE supplement_requests SET status = ?, reviewer_id = ?, reviewed_at = NOW(), review_remark = ? WHERE id = ? AND status = 'pending'",
      [nextStatus, reviewerId, reviewRemark, requestId]
    );
    if (!updateResult || Number(updateResult.affectedRows) !== 1) {
      throw buildError('该工单已被其他管理员处理，请刷新后重试', null, 409);
    }

    return {
      id: requestId,
      reservationId: Number(request.reservation_id),
      applicantId: Number(request.applicant_id),
      type: request.type,
      action: action,
      status: nextStatus,
      reason: reason,
      reviewRemark: reviewRemark
    };
  });

  // 事务提交后广播房间状态（best-effort）
  try {
    if (result.action === ACTIONS.APPROVE) {
      const [reservations] = await db.query('SELECT room_id FROM reservations WHERE id = ?', [result.reservationId]);
      if (reservations && reservations.length) {
        await realtimeEventService.publishRoomStatusSafely(reservations[0].room_id, 'supplement-approved');
      }
    }
  } catch (err) {
    logger.error('补签通过后房间状态广播失败:', err && err.message ? err.message : err);
  }

  await recordAuditSafe({
    operatorId: reviewerId,
    actorRole: settings.reviewerRole || 'admin',
    action: 'supplement.' + action,
    targetTable: 'supplement_requests',
    targetId: result.id,
    description: action === ACTIONS.APPROVE ? '补签审核通过' : '补签审核驳回：' + reason,
    statusCode: 200,
    metadata: { reservationId: result.reservationId, type: result.type, reason: reason }
  });

  return result;
};

/** 审核通过（= review 的 approve 便捷封装）。 */
const approve = function(input) {
  return review(Object.assign({}, input, { action: ACTIONS.APPROVE }));
};

/** 审核驳回（= review 的 reject 便捷封装）。 */
const reject = function(input) {
  return review(Object.assign({}, input, { action: ACTIONS.REJECT }));
};

module.exports = {
  STATUSES,
  TYPES,
  ACTIONS,
  COLUMNS,
  buildError,
  runAtomically,
  create,
  list,
  getById,
  review,
  approve,
  reject,
  decorateWithReservationContext
};
