import assert from 'node:assert/strict'

import {
  ROLE_DASHBOARD_COPY,
  ROLE_LABELS,
  ROLE_NAV_PRIORITY,
  ROLE_SHORTCUTS,
  getRoleLabel,
  sortRoutesForRole
} from '../admin/src/utils/adminRolePolicy.js'
import { adminChildren, hasRouteRole } from '../admin/src/router/adminRoutes.js'

const roles = ['super_admin', 'admin', 'counselor']
const routeByName = new Map(adminChildren.map(route => [route.name, route]))

for (const role of roles) {
  assert.equal(typeof ROLE_LABELS[role], 'string')
  assert.ok(ROLE_LABELS[role].trim(), `${role} should have a Chinese label`)
  assert.equal(getRoleLabel(role), ROLE_LABELS[role])
  assert.ok(ROLE_NAV_PRIORITY[role]?.length, `${role} should have navigation priorities`)
  assert.ok(ROLE_DASHBOARD_COPY[role], `${role} should have dashboard copy`)
}

assert.match(ROLE_LABELS.super_admin, /超级|系统/)
assert.match(ROLE_LABELS.admin, /管理/)
assert.match(ROLE_LABELS.counselor, /辅导员/)

const allowedFor = role => adminChildren.filter(route => hasRouteRole(route, role))
const sortedNamesFor = role => sortRoutesForRole(allowedFor(role), role).map(route => route.name)

const superNames = sortedNamesFor('super_admin')
assert.ok(superNames.includes('SystemLogs'))
assert.ok(superNames.includes('SystemBackup'))

const counselorNames = new Set(sortedNamesFor('counselor'))
for (const forbidden of ['RoomManage', 'BuildingManage', 'SeatManage', 'RulesConfig', 'StatsExport', 'CreditConfig', 'ReadingRoomLogs', 'SystemLogs', 'SystemBackup']) {
  assert.ok(!counselorNames.has(forbidden), `counselor must not receive ${forbidden}`)
}

const adminNames = sortedNamesFor('admin')
for (const frequent of ['ReservationPending', 'RoomManage']) {
  for (const infrequent of ['PosterPosition', 'SystemAnnouncements']) {
    assert.ok(adminNames.indexOf(frequent) < adminNames.indexOf(infrequent), `${frequent} should precede ${infrequent}`)
  }
}

for (const role of roles) {
  assert.ok(ROLE_SHORTCUTS[role]?.length, `${role} should have shortcuts`)
  for (const shortcut of ROLE_SHORTCUTS[role]) {
    const route = routeByName.get(shortcut.name)
    assert.ok(route, `${role} shortcut ${shortcut.name} should point to a route`)
    assert.ok(hasRouteRole(route, role), `${role} shortcut ${shortcut.name} should be allowed`)
  }
}

console.log('admin-site-role-policy-check passed')
