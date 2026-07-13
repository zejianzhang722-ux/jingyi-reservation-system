const STORAGE_PREFIX = 'jingyi-admin-navigation'

const WORKSPACE_LABELS = {
  admin: '导生工作区',
  counselor: '辅导员工作区',
  super_admin: '超级管理工作区'
}

const DEFAULT_OPEN_GROUPS = {
  admin: ['today', 'reservation'],
  counselor: ['today', 'reservation', 'content'],
  super_admin: ['today', 'system']
}

function accountIdentity(account = {}) {
  return account.id ?? account.adminId ?? account.username ?? `${account.role || 'admin'}-anonymous`
}

export function getNavigationStorageKey(account = {}) {
  return `${STORAGE_PREFIX}:${account.role || 'admin'}:${accountIdentity(account)}`
}

export function loadOpenGroups(storage, account = {}) {
  const defaults = DEFAULT_OPEN_GROUPS[account.role] || DEFAULT_OPEN_GROUPS.admin
  if (!storage?.getItem) return [...defaults]
  try {
    const value = JSON.parse(storage.getItem(getNavigationStorageKey(account)))
    return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : [...defaults]
  } catch {
    return [...defaults]
  }
}

export function saveOpenGroups(storage, account = {}, groups = []) {
  if (!storage?.setItem) return
  storage.setItem(getNavigationStorageKey(account), JSON.stringify([...new Set(groups)]))
}

export function ensureActiveGroup(groups = [], navigation = [], routePath = '') {
  const activeGroup = navigation.find(group => group.children.some(item => item.path === routePath))
  if (!activeGroup || groups.includes(activeGroup.key)) return [...groups]
  return [...groups, activeGroup.key]
}

export function getWorkspaceLabel(role) {
  return WORKSPACE_LABELS[role] || '管理工作区'
}
