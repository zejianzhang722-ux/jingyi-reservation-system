/**
 * 管理员岗位交接服务（R-06 · 一步式）。
 *
 * 设计变更（用户确认）：岗位交接**不再采用自主两步交接**（initiate -> pending -> accept），
 * 而改为由「会长团」（super_admin 角色）在管理后台**一步式**将管理员账号的归属人改为新任方：
 *   reassign({ operatorId, fromAdminId, toAdminId, note? })
 *   1) 校验操作人(operatorId)为 super_admin；
 *   2) 校验离任方存在且为 active（被交接的「账号即岗位」标的）；
 *   3) 校验新任方存在；
 *   4) 事务内：禁用离任方 admins.status='disabled' + 启用新任方并接续离任方的 role/scope_type/building_id(status='active')；
 *   5) 写入 admin_handover 记录(status='accepted', initiated_by=operatorId, accepted_at=NOW())；
 *   6) 撤销离任方管理端刷新令牌(token:admin:<fromAdminId>)，绝不删 token:<id>(宿生端)。
 *   任一步失败整体回滚；Redis 删除属外部副作用，失败/回滚时尽力恢复原刷新令牌。
 *   完成后写审计(auditTrailService.record)。
 *
 * 语义约定（重要）：
 *  - admin_handover.admin_id = from_user：本系统没有独立的「岗位表」，因此以「离任方的管理员账号」作为交接标的（账号即岗位）。
 *  - 「结束旧任职」= 把离任方的 admins.status 置为 disabled。这是管理员账号层面的禁用，与宿生身份无关：
 *    admins（管理端账号）与 users（宿生账号）是两张完全独立的表，二者无外键关联、亦无代码做状态同步
 *     （见 server/sql/schema.sql；authController 中管理端登录查 admins、宿生登录查 users）。
 *    因此禁用 admin 账号不会影响该人在小程序的宿生端登录与预约。
 *
 * 已知限制：本仓库 access token 是无状态 JWT，删除刷新令牌只能阻止其续期，已签发且未过期的 access token 在其 TTL 内仍有效
 *   （与既有 logout 的能力一致）。如需即时吊销，需引入 token 版本号/黑名单。
 *
 * 实现说明：曾因 mock-db 聚合误判（列名 admin_id 含子串 min）被迫使用 SELECT *；
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

/**
 * 一步式岗位交接（由超级管理员/会长团在后台操作）。
 * 将「离任方管理员账号」的归属人改为「新任方管理员账号」。
 * @param {object} input
 * @param {number} input.operatorId 操作人管理员 id（须为 super_admin）
 * @param {number} input.fromAdminId 离任方（被交接的账号）
 * @param {number} input.toAdminId 新任方
 * @param {string} [input.note] 操作备注（记入审计）
 * @param {object} [input.requestContext] 请求上下文，用于写审计（可选）
 * @returns {Promise<object>} 交接结果摘要
 */
const reassign = async function(input) {
  const settings = input || {};
  const operatorId = Number(settings.operatorId);
  const fromAdminId = Number(settings.fromAdminId);
  const toAdminId = Number(settings.toAdminId);
  const note = settings.note === undefined || settings.note === null ? null : String(settings.note);
  const requestContext = settings.requestContext;

  if (!Number.isInteger(operatorId) || operatorId <= 0) {
    throw buildError('操作人无效', errorCodes.ERROR_CODES.PERMISSION_DENIED, 400);
  }
  if (!Number.isInteger(fromAdminId) || fromAdminId <= 0) {
    throw buildError('离任管理员无效', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 400);
  }
  if (!Number.isInteger(toAdminId) || toAdminId <= 0) {
    throw buildError('新任管理员无效', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 400);
  }
  if (fromAdminId === toAdminId) {
    throw buildError('离任人与新任职人不能是同一账号', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 400);
  }

  // 操作人必须是 super_admin（会长团）
  const operator = await loadAdmin(db.query, operatorId);
  if (!operator) throw buildError('操作人不存在', errorCodes.ERROR_CODES.PERMISSION_DENIED, 404);
  if (normalizeRole(operator.role) !== 'super_admin') {
    throw buildError('仅超级管理员（会长团）可操作岗位交接', errorCodes.ERROR_CODES.PERMISSION_DENIED, 403);
  }

  const fromAdmin = await loadAdmin(db.query, fromAdminId);
  if (!fromAdmin) throw buildError('离任管理员不存在', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 404);
  if (fromAdmin.status !== 'active') {
    throw buildError('离任管理员账号非启用状态，无法交接', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 409);
  }
  const toAdmin = await loadAdmin(db.query, toAdminId);
  if (!toAdmin) throw buildError('新任管理员不存在，请先创建账号', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 404);

  // 一步式设计下不再使用 pending；离任方一旦被交接即置 disabled，故不允许对同一离任方重复交接。
  let sessionBackup = null;
  let result;
  try {
    result = await runAtomically(async function(runner) {
      // 1) 结束旧任职：仅当仍为 active 时置为 disabled（管理员账号层面，不影响宿生端 users 账号）
      await runner.query(
        "UPDATE admins SET status = 'disabled' WHERE id = ? AND status = 'active'",
        [fromAdminId]
      );

      // 2) 启用新任职：接续离任方的角色与数据域
      const inheritedRole = normalizeRole(fromAdmin.role);
      if (permissions.ADMIN_ROLES.indexOf(inheritedRole) === -1) {
        throw buildError('离任管理员角色无效，无法交接', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 409);
      }
      const inheritedScopeType = ['admin', 'dorm_manager'].includes(inheritedRole) ? (fromAdmin.scope_type || null) : 'global';
      const inheritedBuildingId = ['admin', 'dorm_manager'].includes(inheritedRole) ? fromAdmin.building_id : null;
      await runner.query(
        "UPDATE admins SET role = ?, scope_type = ?, building_id = ?, status = 'active' WHERE id = ?",
        [inheritedRole, inheritedScopeType, inheritedBuildingId, toAdminId]
      );

      // 3) 写入交接记录（一步式直接 accepted）
      const [insertResult] = await runner.query(
        "INSERT INTO admin_handover (admin_id, from_user, to_user, status, initiated_by, accepted_at) VALUES (?, ?, ?, 'accepted', ?, NOW())",
        [fromAdminId, fromAdminId, toAdminId, operatorId]
      );
      const handoverId = Number(insertResult && insertResult.insertId ? insertResult.insertId : 0);

      // 4) 撤销离任方旧会话（仅管理端刷新令牌）；在同一工作单元内执行，失败则整体回滚。
      //    只删 token:admin:<id>：这是管理端刷新令牌键（middleware/auth.getRefreshTokenKey）。
      //    绝不删 token:<id>（宿生端键）：admins 与 users 是两张独立表、id 空间无关联，
      //    且离任只是「管理员账号」层面的变更，不应影响该人在宿生端的登录与预约（见文件头语义约定）。
      const adminRefreshKey = refreshTokenKeyForAdmin(fromAdminId);
      let storedToken = null;
      try { storedToken = await redis.get(adminRefreshKey); } catch (readErr) { storedToken = null; }
      sessionBackup = { key: adminRefreshKey, token: storedToken };
      try {
        await redis.del(adminRefreshKey);
      } catch (delErr) {
        const err = buildError('撤销离任方会话失败', errorCodes.ERROR_CODES.HANDOVER_CONFLICT, 503);
        err.cause = delErr;
        throw err;
      }

      return {
        handoverId: handoverId,
        operatorId: operatorId,
        fromUser: fromAdminId,
        toUser: toAdminId,
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
      operatorId: Number.isInteger(operatorId) && operatorId > 0 ? operatorId : null,
      requestId: requestContext && requestContext.requestId,
      actorRole: 'super_admin',
      action: 'admin.handover.reassign',
      targetTable: 'admin_handover',
      targetId: result.handoverId,
      description: '岗位交接（一步式）：' + result.fromUsername + ' -> ' + result.toUsername + (note ? ('；备注：' + note) : ''),
      method: requestContext ? requestContext.method : '',
      path: requestContext ? requestContext.path : '',
      statusCode: 200,
      metadata: {
        handoverId: result.handoverId,
        operatorId: operatorId,
        fromUser: result.fromUser,
        toUser: result.toUser,
        inheritedRole: result.inheritedRole,
        inheritedScopeType: result.inheritedScopeType,
        inheritedBuildingId: result.inheritedBuildingId,
        note: note
      }
    });
  } catch (auditErr) {
    logger.error('岗位交接审计写入失败:', auditErr && auditErr.message ? auditErr.message : auditErr);
  }

  return result;
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
  reassign,
  loadHandover,
  list
};
