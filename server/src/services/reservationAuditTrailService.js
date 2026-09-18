/**
 * 预约审核「业务批注轨迹」服务（架构设计 R-02 / 任务 T05）。
 *
 * ⚠️ 职责区分（务必不要混淆）：
 *   - 本服务写入的是 **业务轨迹表 `reservation_audit_trail`**，面向**用户可见**的
 *     「一审 / 二审」批注与动作记录（approve / reject / remark / transfer），供 R-07 用户端展示。
 *   - `services/auditTrailService.js` 是**防篡改审计链**（operation_logs + prev_hash/entry_hash），
 *     面向合规取证，二者职责不同、互补不重叠。
 *   关键审批动作会**同时**落两处：调用方在业务动作成功后自行调用 `auditTrailService.record()`。
 *
 * 幂等 / 兼容：只新增表读写在新增接口里，不改动既有响应字段语义。
 */

const db = require('../config/database');

/** 审核阶段：一审（pending，由 admin 处理）/ 二审（counselor_pending，由辅导员处理）。 */
const STAGES = Object.freeze({ FIRST: 'first', COUNSELOR: 'counselor' });

/** 轨迹动作枚举（与迁移表 ENUM 对齐）。 */
const ACTIONS = Object.freeze({ APPROVE: 'approve', REJECT: 'reject', REMARK: 'remark', TRANSFER: 'transfer' });

const COLUMNS =
  'id, reservation_id, stage, actor_id, actor_role, action, remark, created_at';

/**
 * 由预约「当前（动作发生前）状态」推导审核阶段。
 * @param {string} status 预约状态（pending / counselor_pending / ...）
 * @returns {string} STAGES 之一
 */
const stageForStatus = function(status) {
  return status === 'counselor_pending' ? STAGES.COUNSELOR : STAGES.FIRST;
};

const normalizeRole = function(role) {
  return role === 'superadmin' ? 'super_admin' : role;
};

const toNullId = function(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
};

/**
 * 写入一条业务轨迹（best-effort：异常向上抛，由调用方决定是否容忍）。
 * @param {object} input
 * @param {number} input.reservationId 预约 id
 * @param {string} input.stage 阶段（STAGES）
 * @param {number} [input.actorId] 操作人管理员 id
 * @param {string} [input.actorRole] 操作人角色
 * @param {string} input.action 动作（ACTIONS）
 * @param {string} [input.remark] 批注 / 原因
 * @returns {Promise<{id: number}>}
 */
const record = async function(input) {
  const settings = input || {};
  const reservationId = Number(settings.reservationId);
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    throw new Error('轨迹写入失败：预约 id 无效');
  }
  const stage = Object.keys(STAGES).some(function(key) { return STAGES[key] === settings.stage; })
    ? settings.stage
    : STAGES.FIRST;
  const action = Object.keys(ACTIONS).some(function(key) { return ACTIONS[key] === settings.action; })
    ? settings.action
    : ACTIONS.REMARK;
  const remark = settings.remark === undefined || settings.remark === null ? '' : String(settings.remark).slice(0, 500);

  const [result] = await db.query(
    'INSERT INTO reservation_audit_trail (reservation_id, stage, actor_id, actor_role, action, remark, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, NOW())',
    [reservationId, stage, toNullId(settings.actorId), normalizeRole(settings.actorRole) || 'system', action, remark]
  );
  return { id: Number(result && result.insertId ? result.insertId : 0) };
};

/**
 * 记录一次「通过」。
 * @returns {Promise<{id:number}>}
 */
const recordApprove = function(reservationId, actorId, actorRole, stage, remark) {
  return record({ reservationId: reservationId, actorId: actorId, actorRole: actorRole, stage: stage, action: ACTIONS.APPROVE, remark: remark });
};

/**
 * 记录一次「驳回」。
 * @returns {Promise<{id:number}>}
 */
const recordReject = function(reservationId, actorId, actorRole, stage, remark) {
  return record({ reservationId: reservationId, actorId: actorId, actorRole: actorRole, stage: stage, action: ACTIONS.REJECT, remark: remark });
};

/**
 * 记录一条「纯批注」（remark 动作）。供后续备注/沟通接口复用。
 * @returns {Promise<{id:number}>}
 */
const recordRemark = function(reservationId, actorId, actorRole, stage, remark) {
  return record({ reservationId: reservationId, actorId: actorId, actorRole: actorRole, stage: stage, action: ACTIONS.REMARK, remark: remark });
};

/**
 * 记录一次「审核转移」（transfer 动作）。预留给多级转派场景。
 * @returns {Promise<{id:number}>}
 */
const recordTransfer = function(reservationId, actorId, actorRole, stage, remark) {
  return record({ reservationId: reservationId, actorId: actorId, actorRole: actorRole, stage: stage, action: ACTIONS.TRANSFER, remark: remark });
};

/**
 * 查询某预约的全部轨迹（按时间正序）。
 * @param {number} reservationId 预约 id
 * @returns {Promise<Array<object>>} 原始行（含 actor_id / actor_role / action / remark / created_at）
 */
const listByReservation = async function(reservationId) {
  const id = Number(reservationId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const [rows] = await db.query(
    'SELECT ' + COLUMNS + ' FROM reservation_audit_trail WHERE reservation_id = ? ORDER BY id ASC',
    [id]
  );
  return rows || [];
};

/**
 * 把一行轨迹整理为对外的驼峰结构。
 * @param {object} row 原始行
 * @returns {{id:number, stage:string, action:string, actorId:(number|null), actorRole:string, remark:string, createdAt:(string|null)}}
 */
const present = function(row) {
  const source = row || {};
  return {
    id: Number(source.id) || 0,
    stage: source.stage || STAGES.FIRST,
    action: source.action || ACTIONS.REMARK,
    actorId: source.actor_id === undefined || source.actor_id === null ? null : Number(source.actor_id),
    actorRole: source.actor_role || '',
    remark: source.remark || '',
    createdAt: source.created_at === undefined || source.created_at === null ? null : source.created_at
  };
};

module.exports = {
  STAGES,
  ACTIONS,
  COLUMNS,
  stageForStatus,
  record,
  recordApprove,
  recordReject,
  recordRemark,
  recordTransfer,
  listByReservation,
  present
};
