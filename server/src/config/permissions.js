/**
 * 能力（capability）枚举与说明（R-06 临时授权）。
 *
 * 产品已拍板：不细分固定分工，沿用现有 `admins.role` + `admins.scope_type`；
 * 临时授权只做「带有效期的能力授予」这一层。
 *
 * 取值必须与迁移 admin_capability_grants.capability 的 ENUM 完全一致。
 */

const CAPABILITIES = Object.freeze({
  AUDIT: 'audit',
  CHECKIN: 'checkin',
  DATA_EXPORT: 'data_export',
  RULE_CONFIG: 'rule_config'
});

const CAPABILITY_VALUES = Object.freeze([
  CAPABILITIES.AUDIT,
  CAPABILITIES.CHECKIN,
  CAPABILITIES.DATA_EXPORT,
  CAPABILITIES.RULE_CONFIG
]);

/** 能力 -> 中文说明。 */
const CAPABILITY_LABELS = Object.freeze({
  audit: '审核预约',
  checkin: '现场签到核验',
  data_export: '数据导出',
  rule_config: '预约规则配置'
});

/** 授权记录状态。 */
const GRANT_STATUSES = Object.freeze({
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked'
});

/** 交接记录状态。 */
const HANDOVER_STATUSES = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REVOKED: 'revoked'
});

/** 管理员角色（与 admins.role 一致）。 */
const ADMIN_ROLES = Object.freeze(['admin', 'super_admin', 'counselor', 'dorm_manager']);

/**
 * 校验是否为合法能力值。
 * @param {string} value 待校验值
 * @returns {boolean}
 */
const isCapability = function(value) {
  return CAPABILITY_VALUES.indexOf(value) !== -1;
};

/**
 * 校验是否为合法管理员角色（含历史别名 superadmin）。
 * @param {string} role 角色
 * @returns {boolean}
 */
const isAdminRole = function(role) {
  const normalized = role === 'superadmin' ? 'super_admin' : role;
  return ADMIN_ROLES.indexOf(normalized) !== -1;
};

module.exports = {
  CAPABILITIES,
  CAPABILITY_VALUES,
  CAPABILITY_LABELS,
  GRANT_STATUSES,
  HANDOVER_STATUSES,
  ADMIN_ROLES,
  isCapability,
  isAdminRole
};
