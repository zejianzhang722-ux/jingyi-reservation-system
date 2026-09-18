/**
 * 管理员岗位交接服务（R-06）。
 *
 * 事务化流程（accept）：
 *   1) 校验交接记录为 pending 且调用方有权限（离任方 / 新任方 / 超级管理员）；
 *   2) 结束旧任职：`admins.status = 'disabled'`（离任方）；
 *   3) 启用新任职：把离任方的 role / scope_type / building_id 转移给新任方，并置 `status = 'active'`；
 *   4) 置交接记录 `status = 'accepted'`（用 affectedRows 做乐观并发保护）；
 *   5) 撤销离任方旧会话：删除 Redis 中的刷新令牌（键规则见 middleware/auth.getRefreshTokenKey）。
 *   任一步失败整体回滚；Redis 删除属外部副作用，失败/回滚时会尽力恢复原刷新令牌。
 *   完成后写审计（auditTrailService.record）。
 *
 * 语义约定（重要）：
 *  - `admin_handover.admin_id = from_user`：本系统没有独立的「岗位表」，因此以「离任方的管理员账号」
 *    作为交接标的（账号即岗位）。
 *  - 「结束旧任职」= 把离任方的 `admins.status` 置为 `disabled`。这是**管理员账号**层面的禁用，
 *    与宿生身份无关：`admins`（管理端账号）与 `users`（宿生账号）是**两张完全独立的表**，
 *    二者无外键关联、也无代码做状态同步（见 server/sql/schema.sql；authController 中管理端登录查
 *    admins、宿生登录查 users）。因此禁用 admin 账号**不会**影响该人在小程序的宿生端登录与预约。
 *
 * 已知限制：本仓库 access token 是无状态 JWT，删除刷新令牌只能阻止其**续期**，已签发且未过期的
 *   access token 在其 TTL 内仍有效（与既有 logout 的能力一致）。如需即时吊销，需引入 token 版本号/黑名单。
 *
 * 实现说明：曾因 mock-db 聚合误判（列名 `admin_id` 含子串 min）被迫使用 `SELECT *`；
 *   该 mock-db 缺陷已在 Batch0+Batch1 第 5 次提交修复，故此处恢复为明确列查询。
 */

const db = require('../config/database');
const logger = require('../config/logger');
const redis = require('../config/redis');
const errorCodes = require('../config/errorCodes');
const permissions = require('../config/permissions');
const auditTrailService = require('./auditTrailService');

const HANDOVER_COLUMNS =
  'id, admin_id, from_user, to_user, status, initiated_by, accepted_at, created_at';

const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

const buildError = function(message, businessCode, httpStatus) {
  const err = new Error(message);
  err.businessCode = businessCode || null;
  err.httpStatus = httpStatus || 400;
  return err;
};

const normalizeRole = function(role) {
  return role === 'superadmin' ? 'super_admin' : role;
};

/**
 * 管理端刷新令牌的 Redis 键（与 middleware/auth.getRefreshTokenKey 保持一致）。
 * @param {number} adminId 管理员 id
 * @returns {string}
 */
const refreshTokenKeyForAdmin = function(adminId) {
  return 'token:admin:' + Number(adminId);
};

/**
 * 在一个（可能存在的）数据库事务内执行工作单元。
 * mock 模式不支持事务，退化为顺序执行（与 controllers/checkinController.js 的既有做法一致）。
 * @param {(runner: {transactional: boolean, query: Function}) => Promise<any>} work 工作单元
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
        logger.error('岗位交接事务回滚失败:', rollbackErr);
      }
    }
    throw err;
  } finally {
    if (connection && typeof connection.release === 'function') connection.release();
  }
};

const loadAdmin = async function(query, adminId) {
  const [rows] = await query(
    'SELECT id, username, real_name, role, building_id, scope_type, status FROM admins WHERE id = ?',
    [Number(adminId)]
  );
  return rows && rows.length ? rows[0] : null;
};

const loadHandover = async function(query, id) {
  const [rows] = await query(
    'SELECT ' + HANDOVER_COLUMNS + ' FROM admin_handover WHERE id = ?',
    [Number(id)]
  );
  return rows && rows.length ? rows[0] : null;
};

const findPendingForAdmin = async function(query, adminId) {
  const [rows] = await query(
    'SELECT ' + HANDOVER_COLUMNS + " FROM admin_handover WHERE admin_id = ? AND status = 'pending'",
    [Number(adminId)]
  );
  return rows && rows.length ? rows[0] : null;
};

/**
 * 发起岗位交接（当前持有人或超级管理员发起）。
 * @param {object} input
 * @param {number} input.fromAdminId 离任方（当前持有人）
 * @param {number} input.toAdminId 新任持有人
 * @param {number} [input.initiatedBy] 发起人管理员 id（默认等于 fromAdminId）
 * @returns {Promise<{id: number, adminId: number, fromUser: number, toUser: number}>}
 */
const initiate = async function(input) {
  const settings = input || {};
  const fromAdminId = Number(settings.fromAdminId);
  const toAdminId = Number(settings.toAdminId);
  const initiatedBy = settings.initiatedBy === undefined || settings.initiatedBy === null
    ? fromAdminId
    : Number(settings.initiatedBy);

  if (!Number.isInteger(fromAdminId) || fromAdminId <= 0) {
    throw buildError('离任管理员无效', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 400);
  }
  if (!Number.isInteger(toAdminId) || toAdminId <= 0) {
    throw buildError('新任管理员无效', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 400);
  }
  if (fromAdminId === toAdminId) {
    throw buildError('离任人与新任职人不能是同一账号', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 400);
  }

  const fromAdmin = await loadAdmin(db.query, fromAdminId);
  if (!fromAdmin) throw buildError('离任管理员不存在', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 404);
  if (fromAdmin.status !== 'active') {
    throw buildError('离任管理员账号非启用状态，无法发起交接', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 409);
  }
  const toAdmin = await loadAdmin(db.query, toAdminId);
  if (!toAdmin) throw buildError('新任管理员不存在，请先创建账号', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 404);

  const existing = await findPendingForAdmin(db.query, fromAdminId);
  if (existing) {
    throw buildError('该岗位已有进行中的交接，请先完成或撤销', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 409);
  }

  const [result] = await db.query(
    'INSERT INTO admin_handover (admin_id, from_user, to_user, status, initiated_by) VALUES (?, ?, ?, ?, ?)',
    [fromAdminId, fromAdminId, toAdminId, permissions.HANDOVER_STATUSES.PENDING, initiatedBy]
  );

  return {
    id: Number(result && result.insertId ? result.insertId : 0),
    adminId: fromAdminId,
    fromUser: fromAdminId,
    toUser: toAdminId
  };
};

/**
 * 接受岗位交接（事务化）。
 * @param {object} input
 * @param {number} input.handoverId 交接记录 id
 * @param {number} input.actorId 操作人（须为离任方 / 新任方 / 超级管理员）
 * @param {string} [input.actorRole] 操作人角色
 * @param {object} [input.requestContext] 请求上下文，用于写审计（可选）
 * @returns {Promise<object>} 交接结果摘要
 */
const accept = async function(input) {
  const settings = input || {};
  const handoverId = Number(settings.handoverId);
  const actorId = Number(settings.actorId);
  if (!Number.isInteger(handoverId) || handoverId <= 0) {
    throw buildError('交接记录无效', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 400);
  }

  // 用于在失败/回滚时恢复被删除的刷新令牌
  let sessionBackup = null;

  let result;
  try {
    result = await runAtomically(async function(runner) {
      const handover = await loadHandover(runner.query, handoverId);
      if (!handover) throw buildError('交接记录不存在', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 404);
      if (handover.status !== permissions.HANDOVER_STATUSES.PENDING) {
        throw buildError('交接已完成或已撤销，无法重复接受', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 409);
      }

      const actorRole = normalizeRole(settings.actorRole);
      const isSuperAdmin = actorRole === 'super_admin';
      const isParty = actorId === Number(handover.from_user) || actorId === Number(handover.to_user);
      if (!isSuperAdmin && !isParty) {
        throw buildError('无权接受该岗位交接', errorCodes.ERROR_CODES.PERMISSION_DENIED, 403);
      }

      const fromAdmin = await loadAdmin(runner.query, handover.from_user);
      if (!fromAdmin) throw buildError('离任管理员不存在', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 404);
      const toAdmin = await loadAdmin(runner.query, handover.to_user);
      if (!toAdmin) throw buildError('新任管理员不存在', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 404);

      // 1) 结束旧任职：仅当仍为 active 时置为 disabled（管理员账号层面，不影响宿生端 users 账号）
      if (fromAdmin.status === 'active') {
        await runner.query(
          "UPDATE admins SET status = 'disabled' WHERE id = ? AND status = 'active'",
          [Number(handover.from_user)]
        );
      }

      // 2) 启用新任职：接续离任方的角色与数据域
      const inheritedRole = normalizeRole(fromAdmin.role);
      if (permissions.ADMIN_ROLES.indexOf(inheritedRole) === -1) {
        throw buildError('离任管理员角色无效，无法交接', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 409);
      }
      const inheritedScopeType = inheritedRole === 'admin' ? (fromAdmin.scope_type || null) : 'global';
      const inheritedBuildingId = inheritedRole === 'admin' ? fromAdmin.building_id : null;
      await runner.query(
        "UPDATE admins SET role = ?, scope_type = ?, building_id = ?, status = 'active' WHERE id = ?",
        [inheritedRole, inheritedScopeType, inheritedBuildingId, Number(handover.to_user)]
      );

      // 3) 置交接记录为 accepted（乐观并发保护：只有 pending -> accepted 才算成功）
      const [updateResult] = await runner.query(
        "UPDATE admin_handover SET status = 'accepted', accepted_at = NOW() WHERE id = ? AND status = 'pending'",
        [handoverId]
      );
      if (updateResult && updateResult.affectedRows !== undefined && Number(updateResult.affectedRows) !== 1) {
        throw buildError('交接状态已变化，请刷新后重试', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 409);
      }

      // 4) 撤销离任方旧会话（刷新令牌）；在同一工作单元内执行，失败则整体回滚
      const adminRefreshKey = refreshTokenKeyForAdmin(handover.from_user);
      const studentLikeKey = 'token:' + Number(handover.from_user);
      let storedToken = null;
      try {
        storedToken = await redis.get(adminRefreshKey);
      } catch (readErr) {
        storedToken = null;
      }
      sessionBackup = { key: adminRefreshKey, token: storedToken };
      try {
        await redis.del(adminRefreshKey);
        await redis.del(studentLikeKey);
      } catch (delErr) {
        const err = buildError('撤销离任方会话失败', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 503);
        err.cause = delErr;
        throw err;
      }

      return {
        handoverId: handoverId,
        fromUser: Number(handover.from_user),
        toUser: Number(handover.to_user),
        fromUsername: fromAdmin.username,
        toUsername: toAdmin.username,
        inheritedRole: inheritedRole,
        inheritedScopeType: inheritedScopeType,
        inheritedBuildingId: inheritedBuildingId,
        sessionRevoked: true
      };
    });
  } catch (err) {
    // 尽力恢复：若整体回滚，把此前删除的刷新令牌写回，避免“已回滚但会话已失效”的不一致。
    if (sessionBackup && sessionBackup.token) {
      try {
        await redis.set(sessionBackup.key, sessionBackup.token, 'EX', REFRESH_TOKEN_TTL_SECONDS);
      } catch (restoreErr) {
        logger.error('恢复离任方刷新令牌失败:', restoreErr && restoreErr.message ? restoreErr.message : restoreErr);
      }
    }
    throw err;
  }

  // 审计（best-effort：审计失败不影响已提交的交接结果，但会记录错误日志）
  try {
    await auditTrailService.record({
      operatorId: Number.isInteger(actorId) && actorId > 0 ? actorId : null,
      requestId: settings.requestContext && settings.requestContext.requestId,
      actorRole: normalizeRole(settings.actorRole) || 'system',
      action: 'admin.handover.accept',
      targetTable: 'admin_handover',
      targetId: handoverId,
      description: '岗位交接完成：' + result.fromUsername + ' -> ' + result.toUsername,
      method: settings.requestContext ? settings.requestContext.method : '',
      path: settings.requestContext ? settings.requestContext.path : '',
      statusCode: 200,
      metadata: {
        handoverId: handoverId,
        fromUser: result.fromUser,
        toUser: result.toUser,
        inheritedRole: result.inheritedRole,
        inheritedScopeType: result.inheritedScopeType,
        inheritedBuildingId: result.inheritedBuildingId
      }
    });
  } catch (auditErr) {
    logger.error('岗位交接审计写入失败:', auditErr && auditErr.message ? auditErr.message : auditErr);
  }

  return result;
};

/**
 * 撤销一个进行中的交接（仅 pending）。
 * @param {object} input
 * @param {number} input.handoverId 交接记录 id
 * @param {number} [input.actorId] 操作人
 * @param {string} [input.actorRole] 操作人角色
 * @returns {Promise<boolean>}
 */
const revoke = async function(input) {
  const settings = input || {};
  const handoverId = Number(settings.handoverId);
  if (!Number.isInteger(handoverId) || handoverId <= 0) {
    throw buildError('交接记录无效', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 400);
  }
  const [result] = await db.query(
    "UPDATE admin_handover SET status = 'revoked' WHERE id = ? AND status = 'pending'",
    [handoverId]
  );
  const revoked = !!(result && Number(result.affectedRows) > 0);
  if (revoked) {
    try {
      await auditTrailService.record({
        operatorId: Number.isInteger(Number(settings.actorId)) && Number(settings.actorId) > 0 ? Number(settings.actorId) : null,
        actorRole: normalizeRole(settings.actorRole) || 'system',
        action: 'admin.handover.revoke',
        targetTable: 'admin_handover',
        targetId: handoverId,
        description: '撤销岗位交接',
        statusCode: 200,
        metadata: { handoverId: handoverId }
      });
    } catch (auditErr) {
      logger.error('撤销岗位交接审计写入失败:', auditErr && auditErr.message ? auditErr.message : auditErr);
    }
  }
  return revoked;
};

/**
 * 查询交接记录列表（可按状态 / 管理员过滤）。
 * @param {object} [options]
 * @param {string} [options.status] 交接状态
 * @param {number} [options.adminId] 交接标的
 * @returns {Promise<Array<object>>}
 */
const list = async function(options) {
  const settings = options || {};
  let sql = 'SELECT ' + HANDOVER_COLUMNS + ' FROM admin_handover WHERE 1=1';
  const params = [];
  if (settings.status) {
    sql += ' AND status = ?';
    params.push(String(settings.status));
  }
  if (settings.adminId) {
    sql += ' AND admin_id = ?';
    params.push(Number(settings.adminId));
  }
  sql += ' ORDER BY id DESC';
  const [rows] = await db.query(sql, params);
  return rows || [];
};

module.exports = {
  HANDOVER_COLUMNS,
  REFRESH_TOKEN_TTL_SECONDS,
  refreshTokenKeyForAdmin,
  runAtomically,
  initiate,
  accept,
  revoke,
  list
};
