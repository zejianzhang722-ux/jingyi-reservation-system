/**
 * 管理员临时能力授权服务（R-06）。
 *
 * 语义：给某管理员授予某个能力（audit/checkin/data_export/rule_config），并带有效期。
 * 过期即“自动失效”——不依赖后台定时任务，读取时按 now ∈ [valid_from, valid_to] 判定。
 *
 * 实现说明（务必注意）：
 *  1) 查询刻意**不使用 SQL BETWEEN**：仓库的 mock-db（server/src/config/mock-db.js）按 ` AND ` 切分条件，
 *     不支持 BETWEEN 语法。因此 SQL 只按 admin_id + status 过滤，有效期在 JS 侧判定，
 *     这样 MySQL 与 mock 两种模式行为一致。
 *  2) 查询刻意使用 `SELECT *` 而非显式列名：mock-db 的聚合判定用 `/COUNT|SUM|AVG|MIN|MAX/i` 且**无词边界**，
 *     列名 `admin_id` 含子串 `min` 会被误判为聚合查询并返回 `[{__count__:n}]`（丢失字段）。
 *     `SELECT *` 不含 `min`，可同时兼容 MySQL 与 mock。根因见交付报告。
 */

const db = require('../config/database');
const errorCodes = require('../config/errorCodes');
const permissions = require('../config/permissions');

const buildError = function(message, businessCode, httpStatus) {
  const err = new Error(message);
  err.businessCode = businessCode || null;
  err.httpStatus = httpStatus || 400;
  return err;
};

const toDate = function(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const pad2 = function(value) {
  return String(value).padStart(2, '0');
};

/**
 * 转成 MySQL DATETIME 字面量（**本地时间**，无时区）。
 *
 * 必须与 `toDate` 的解析口径一致：`toDate` 把 'YYYY-MM-DD HH:mm:ss' 按本地时间解析，
 * 因此这里也必须输出本地时间。若改用 toISOString()（UTC），会与解析口径差一个时区偏移，
 * 导致刚授予的授权被判定为“未生效/已过期”。列类型为 DATETIME（无时区），本地时间也与 NOW() 对齐。
 * @param {string|Date} value 时间
 * @returns {string|null}
 */
const toDbTimestamp = function(value) {
  const date = toDate(value);
  if (!date) return null;
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
    ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
};

const isWithinValidity = function(record, now) {
  const from = toDate(record.valid_from);
  const to = toDate(record.valid_to);
  if (!from || !to) return false;
  return now.getTime() >= from.getTime() && now.getTime() <= to.getTime();
};

const normalizeNow = function(now) {
  const date = toDate(now);
  return date || new Date();
};

/**
 * 授予一项临时能力。
 * @param {object} input
 * @param {number} input.adminId 被授权管理员 id
 * @param {string} input.capability 能力值（见 config/permissions.js）
 * @param {number} [input.grantedBy] 授权操作者管理员 id
 * @param {string|Date} input.validFrom 生效时间
 * @param {string|Date} input.validTo 失效时间
 * @returns {Promise<{id: number, adminId: number, capability: string, validFrom: string, validTo: string}>}
 */
const grant = async function(input) {
  const settings = input || {};
  const adminId = Number(settings.adminId);
  if (!Number.isInteger(adminId) || adminId <= 0) {
    throw buildError('被授权管理员无效', errorCodes.ERROR_CODES.PERMISSION_DENIED, 400);
  }
  if (!permissions.isCapability(settings.capability)) {
    throw buildError('能力项无效', errorCodes.ERROR_CODES.PERMISSION_DENIED, 400);
  }
  const validFrom = toDate(settings.validFrom);
  const validTo = toDate(settings.validTo);
  if (!validFrom || !validTo) {
    throw buildError('授权有效期不合法', errorCodes.ERROR_CODES.PERMISSION_DENIED, 400);
  }
  if (validTo.getTime() <= validFrom.getTime()) {
    throw buildError('授权失效时间必须晚于生效时间', errorCodes.ERROR_CODES.PERMISSION_DENIED, 400);
  }
  const grantedBy = settings.grantedBy === undefined || settings.grantedBy === null
    ? null
    : Number(settings.grantedBy);

  const [result] = await db.query(
    'INSERT INTO admin_capability_grants (admin_id, capability, granted_by, valid_from, valid_to, status) VALUES (?, ?, ?, ?, ?, ?)',
    [
      adminId,
      settings.capability,
      Number.isInteger(grantedBy) && grantedBy > 0 ? grantedBy : null,
      toDbTimestamp(validFrom),
      toDbTimestamp(validTo),
      permissions.GRANT_STATUSES.ACTIVE
    ]
  );

  return {
    id: Number(result && result.insertId ? result.insertId : 0),
    adminId: adminId,
    capability: settings.capability,
    validFrom: toDbTimestamp(validFrom),
    validTo: toDbTimestamp(validTo)
  };
};

/**
 * 撤销一项临时能力（仅作用于 active 记录）。
 * @param {object} input
 * @param {number} input.grantId 授权记录 id
 * @returns {Promise<boolean>} 是否撤销成功
 */
const revoke = async function(input) {
  const settings = input || {};
  const grantId = Number(settings.grantId);
  if (!Number.isInteger(grantId) || grantId <= 0) {
    throw buildError('授权记录无效', errorCodes.ERROR_CODES.PERMISSION_DENIED, 400);
  }
  const [result] = await db.query(
    "UPDATE admin_capability_grants SET status = 'revoked' WHERE id = ? AND status = 'active'",
    [grantId]
  );
  return !!(result && Number(result.affectedRows) > 0);
};

/**
 * 查询某管理员当前生效（active 且在有效期内）的授权记录。
 * @param {number} adminId 管理员 id
 * @param {string|Date} [now] 判定基准时间，默认当前时间
 * @returns {Promise<Array<object>>}
 */
const listActive = async function(adminId, now) {
  const id = Number(adminId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const current = normalizeNow(now);
  const [rows] = await db.query(
    "SELECT * FROM admin_capability_grants WHERE admin_id = ? AND status = 'active'",
    [id]
  );
  return (rows || []).filter(function(record) {
    return isWithinValidity(record, current);
  });
};

/**
 * 查询某管理员当前生效的能力值列表（去重）。
 * @param {number} adminId 管理员 id
 * @param {string|Date} [now] 判定基准时间
 * @returns {Promise<string[]>}
 */
const listActiveCapabilities = async function(adminId, now) {
  const records = await listActive(adminId, now);
  const values = [];
  records.forEach(function(record) {
    if (permissions.isCapability(record.capability) && values.indexOf(record.capability) === -1) {
      values.push(record.capability);
    }
  });
  return values;
};

/**
 * 判断某管理员在某时刻是否持有某能力。
 * @param {number} adminId 管理员 id
 * @param {string} capability 能力值
 * @param {string|Date} [now] 判定基准时间
 * @returns {Promise<boolean>}
 */
const hasCapability = async function(adminId, capability, now) {
  if (!permissions.isCapability(capability)) return false;
  const values = await listActiveCapabilities(adminId, now);
  return values.indexOf(capability) !== -1;
};

/**
 * 查询某管理员的全部授权记录（含历史），供管理端展示。
 * @param {number} adminId 管理员 id
 * @returns {Promise<Array<object>>}
 */
const listByAdmin = async function(adminId) {
  const id = Number(adminId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const [rows] = await db.query(
    'SELECT * FROM admin_capability_grants WHERE admin_id = ? ORDER BY id DESC',
    [id]
  );
  return rows || [];
};

module.exports = {
  toDate,
  toDbTimestamp,
  isWithinValidity,
  grant,
  revoke,
  listActive,
  listActiveCapabilities,
  hasCapability,
  listByAdmin
};
