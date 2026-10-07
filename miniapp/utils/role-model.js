/**
 * 角色模型：全端角色语义的单一事实来源。
 * 纯 ES5，不依赖 auth.js，避免与 auth.js 形成循环依赖。
 * 层级（tier）语义：
 *   guide   —— 导生会层级（super_admin / admin / counselor），工作台在 admin-home
 *   dorm    —— 宿管层级（dorm_manager），工作台在 verification
 *   student —— 学生
 */
var ROLE_META = {
  super_admin: { label: '导生会会长团', tier: 'guide' },
  admin: { label: '导生管理员', tier: 'guide' },
  counselor: { label: '书院辅导员', tier: 'guide' },
  dorm_manager: { label: '宿管', tier: 'dorm' },
  student: { label: '学生', tier: 'student' }
}

var GUIDE_ROLES = ['super_admin', 'admin', 'counselor']

function normalizeRole(role) {
  return role === 'superadmin' ? 'super_admin' : (role || 'student')
}

function meta(role) {
  return ROLE_META[normalizeRole(role)] || ROLE_META.student
}

function label(role) {
  return meta(role).label
}

function tier(role) {
  return meta(role).tier
}

function isAdminRole(role) {
  var current = tier(role)
  return current === 'guide' || current === 'dorm'
}

function isGuideRole(role) {
  return tier(role) === 'guide'
}

function isDormRole(role) {
  return tier(role) === 'dorm'
}

// homePath 的职责是「该角色的工作台在哪」，必须显式三分。
// 非 guide、非 dorm 的角色（学生等）没有管理端工作台，回登录页；
// 不能兜底到 admin-home，否则学生会先进管理端外壳一帧再被踢出。
function homePath(role) {
  if (isDormRole(role)) return '/pages/verification/verification'
  if (isGuideRole(role)) return '/pages/admin-home/admin-home'
  return '/pages/login/login'
}

function scanPath(role) {
  if (isDormRole(role)) return '/pages/dorm-scan/dorm-scan'
  if (isGuideRole(role)) return '/pages/admin-scan/admin-scan'
  return '/pages/login/login'
}

module.exports = {
  ROLE_META: ROLE_META,
  GUIDE_ROLES: GUIDE_ROLES,
  normalizeRole: normalizeRole,
  meta: meta,
  label: label,
  tier: tier,
  isAdminRole: isAdminRole,
  isGuideRole: isGuideRole,
  isDormRole: isDormRole,
  homePath: homePath,
  scanPath: scanPath
}
