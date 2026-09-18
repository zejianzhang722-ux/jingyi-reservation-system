/**
 * 隐私脱敏（架构设计 R-14）。
 *
 * 产品已拍板的分级脱敏策略：
 *  1) 本人查看自己的信息        -> 明文
 *  2) 他人信息（学生之间互看）  -> 一律掩码（学号 / 手机号 / 姓名部分遮罩）
 *  3) 管理员                    -> 依据 `admins.role` + `scope_type` 数据域决定是否可见全量
 *  4) 管理员查看明文            -> 由调用方落审计（见 services/privacyAuditService.js）
 *
 * 重要兼容约定：**只有当调用方传入 viewer 时才做脱敏**；viewer 为空时本模块不改变任何数据，
 * 保证既有调用点（未改造前）行为完全不变。
 *
 * 本模块只依赖纯函数 utils/adminScope.js，不引入任何服务依赖，避免循环引用。
 */

const adminScopeUtils = require('./adminScope');

const MASK_CHAR = '*';
const ADMIN_ROLES = Object.freeze(['admin', 'super_admin', 'counselor']);

const normalizeValue = function(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const normalizeRole = function(role) {
  return role === 'superadmin' ? 'super_admin' : role;
};

/**
 * 保留首尾、掩码中段。
 * 当字符串长度不足以保留首尾时，只保留首个字符，其余全部掩码，避免泄露完整值。
 * @param {string} value 原始值
 * @param {number} headLength 保留的首部长度
 * @param {number} tailLength 保留的尾部长度
 * @returns {string}
 */
const maskMiddle = function(value, headLength, tailLength) {
  const text = normalizeValue(value);
  if (!text) return '';
  if (text.length <= headLength + tailLength) {
    return text.slice(0, 1) + MASK_CHAR.repeat(Math.max(text.length - 1, 0));
  }
  return text.slice(0, headLength) +
    MASK_CHAR.repeat(text.length - headLength - tailLength) +
    text.slice(text.length - tailLength);
};

/**
 * 学号脱敏：`2021123456` -> `2021****56`（保留前 4 位与后 2 位）。
 * @param {string} value 学号
 * @returns {string}
 */
const maskStudentId = function(value) {
  return maskMiddle(value, 4, 2);
};

/**
 * 手机号脱敏：`13800008000` -> `138****8000`（保留前 3 位与后 4 位）。
 * @param {string} value 手机号
 * @returns {string}
 */
const maskPhone = function(value) {
  const text = normalizeValue(value);
  if (!text) return '';
  if (text.length <= 4) return MASK_CHAR.repeat(text.length);
  return maskMiddle(text, 3, 4);
};

/**
 * 姓名脱敏：`张三` -> `张*`；复姓同样只保留首字，如 `欧阳娜` -> `欧**`。
 * @param {string} value 姓名
 * @returns {string}
 */
const maskName = function(value) {
  const text = normalizeValue(value);
  if (!text) return '';
  if (text.length <= 1) return text;
  return text.slice(0, 1) + MASK_CHAR.repeat(text.length - 1);
};

const STUDENT_ID_KEYS = ['studentId', 'student_id', 'student_no'];
const NAME_KEYS = ['userName', 'user_name', 'real_name', 'nickname'];
const PHONE_KEYS = ['phone', 'mobile', 'contact_phone', 'contactPhone'];

/**
 * 将调用方身份标准化为内部结构。
 * 支持两种来源：
 *  - 请求上下文：`viewerFromRequest(req)`，其中 req.adminScope 来自 middleware/adminScope.loadAdminScope
 *  - 直接构造：`{ id, role, scopeType, buildingId }`，将复用 utils/adminScope.normalizeAdminScope 推导数据域
 * @param {object} viewer 调用方身份
 * @returns {{id: (number|null), role: string, scope: object}|null}
 */
const normalizeViewer = function(viewer) {
  if (!viewer) return null;
  const role = normalizeRole(viewer.role) || 'student';
  // 幂等：viewer 可能已是本函数产出的「标准化对象」（其数据域在 `scope` 字段上），
  // 若不识别 `viewer.scope`，二次标准化会把楼栋域信息丢掉，导致管理员被误判为明文不可见。
  let scope = viewer.adminScope || viewer.scope || null;
  if (!scope) {
    scope = adminScopeUtils.normalizeAdminScope(
      role,
      viewer.scopeType !== undefined ? viewer.scopeType : viewer.scope_type,
      viewer.buildingId !== undefined ? viewer.buildingId : viewer.building_id
    );
  }
  return {
    id: viewer.id === undefined || viewer.id === null || viewer.id === '' ? null : Number(viewer.id),
    role: role,
    scope: scope || { scopeType: null, buildingId: null }
  };
};

/**
 * 从 Express 请求构造 viewer。管理员请求需已挂载 req.adminScope（loadAdminScope）。
 * @param {import('express').Request} req 请求对象
 * @returns {object|null}
 */
const viewerFromRequest = function(req) {
  if (!req || !req.user) return null;
  const adminScope = req.adminScope || null;
  return {
    id: req.user.id,
    role: req.user.role,
    adminScope: adminScope || undefined,
    scopeType: adminScope ? undefined : req.user.scopeType,
    buildingId: adminScope ? undefined : req.user.buildingId
  };
};

const rowOwnerId = function(row) {
  if (!row) return null;
  const raw = row.user_id !== undefined && row.user_id !== null ? row.user_id : row.userId;
  if (raw === undefined || raw === null || raw === '') return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
};

const rowBuildingId = function(row) {
  if (!row) return null;
  const raw = row.building_id !== undefined && row.building_id !== null ? row.building_id : row.buildingId;
  if (raw === undefined || raw === null || raw === '') return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * 计算某行对某查看者的可见性判定。
 * @param {object} row 数据行
 * @param {object} viewer 调用方身份（未标准化也可）
 * @returns {{plaintext: boolean, scope: string, masked: boolean}}
 */
const resolveVisibility = function(row, viewer) {
  const normalized = normalizeViewer(viewer);
  if (!normalized) {
    // 未提供身份：保持既有行为（不脱敏）。调用方未改造时不受影响。
    return { plaintext: true, scope: 'anonymous', masked: false };
  }

  const ownerId = rowOwnerId(row);
  const isSelf = ownerId !== null && normalized.id !== null && ownerId === normalized.id;

  if (normalized.role === 'student') {
    return isSelf
      ? { plaintext: true, scope: 'self', masked: false }
      : { plaintext: false, scope: 'peer', masked: true };
  }

  if (ADMIN_ROLES.indexOf(normalized.role) === -1) {
    return { plaintext: false, scope: 'unknown_role', masked: true };
  }

  const scope = normalized.scope || {};
  const isGlobal = scope.isGlobal === true || scope.scopeType === 'global';
  if (isGlobal) {
    return { plaintext: true, scope: 'admin_global', masked: false };
  }

  const buildingId = rowBuildingId(row);
  if (
    scope.buildingId !== null && scope.buildingId !== undefined &&
    buildingId !== null && Number(scope.buildingId) === buildingId
  ) {
    return { plaintext: true, scope: 'admin_building', masked: false };
  }

  // 管理员数据域不覆盖该行：降级为掩码，而不是放行明文。
  return { plaintext: false, scope: 'admin_out_of_scope', masked: true };
};

/**
 * 统一脱敏入口：按 viewer 身份对一行数据做分级脱敏。
 * @param {object} row 数据行（不会被就地修改）
 * @param {object} viewer 调用方身份
 * @returns {object} 可能被掩码的新对象（viewer 为空时原样返回）
 */
const applyViewerMask = function(row, viewer) {
  const normalized = normalizeViewer(viewer);
  if (!normalized || !row) return row;

  const decision = resolveVisibility(row, normalized);
  if (decision.plaintext) return row;

  const masked = Object.assign({}, row);

  STUDENT_ID_KEYS.forEach(function(key) {
    if (masked[key] !== undefined && masked[key] !== null && masked[key] !== '') {
      masked[key] = maskStudentId(masked[key]);
    }
  });

  NAME_KEYS.forEach(function(key) {
    if (masked[key] !== undefined && masked[key] !== null && masked[key] !== '') {
      masked[key] = maskName(masked[key]);
    }
  });

  // 通用 `name` 字段只在行确实指向用户（带学号或 user_id）时才脱敏，避免误掩房间名等非人员字段。
  if (masked.name !== undefined && masked.name !== null && masked.name !== '') {
    const looksLikeUser = STUDENT_ID_KEYS.some(function(key) {
      return masked[key] !== undefined && masked[key] !== null && masked[key] !== '';
    }) || rowOwnerId(row) !== null;
    if (looksLikeUser) masked.name = maskName(masked.name);
  }

  PHONE_KEYS.forEach(function(key) {
    if (masked[key] !== undefined && masked[key] !== null && masked[key] !== '') {
      masked[key] = maskPhone(masked[key]);
    }
  });

  return masked;
};

/**
 * 判断这次「查看明文」是否属于必须落审计的行为：
 * 管理员 + 看到了明文 + 不是自己的记录。学生查看自己（scope=self）不需要审计。
 * @param {object} row 数据行
 * @param {object} viewer 调用方身份
 * @returns {boolean}
 */
const shouldAuditPlaintext = function(row, viewer) {
  const normalized = normalizeViewer(viewer);
  if (!normalized) return false;
  if (ADMIN_ROLES.indexOf(normalized.role) === -1) return false;
  const decision = resolveVisibility(row, normalized);
  if (!decision.plaintext) return false;
  if (decision.scope !== 'admin_global' && decision.scope !== 'admin_building') return false;
  const ownerId = rowOwnerId(row);
  const isSelf = ownerId !== null && normalized.id !== null && ownerId === normalized.id;
  return !isSelf;
};

/**
 * 对一组行批量脱敏，并返回是否需要落审计（任一行命中即 true）。
 * @param {Array<object>} rows 数据行数组
 * @param {object} viewer 调用方身份
 * @returns {{rows: Array<object>, requiresAudit: boolean, plaintextCount: number}}
 */
const maskRows = function(rows, viewer) {
  const list = Array.isArray(rows) ? rows : [];
  if (!viewer) return { rows: list, requiresAudit: false, plaintextCount: 0 };
  let requiresAudit = false;
  let plaintextCount = 0;
  const maskedRows = list.map(function(row) {
    if (shouldAuditPlaintext(row, viewer)) {
      requiresAudit = true;
      plaintextCount++;
    }
    return applyViewerMask(row, viewer);
  });
  return { rows: maskedRows, requiresAudit, plaintextCount };
};

module.exports = {
  MASK_CHAR,
  ADMIN_ROLES,
  maskStudentId,
  maskPhone,
  maskName,
  normalizeViewer,
  viewerFromRequest,
  resolveVisibility,
  applyViewerMask,
  shouldAuditPlaintext,
  maskRows
};
