import assert from 'node:assert/strict'

import {
  ROLE_DASHBOARD_COPY,
  ROLE_LABELS,
  ROLE_NAV_PRIORITY,
  ROLE_SHORTCUTS,
  getRoleLabel,
  sortRoutesForRole
} from '../admin/src/utils/adminRolePolicy.js'
import { adminChildren, buildNavigation, hasRouteRole } from '../admin/src/router/adminRoutes.js'

const roles = ['super_admin', 'admin', 'counselor']
const routeByName = new Map(adminChildren.map(route => [route.name, route]))

for (const role of roles) {
  assert.equal(typeof ROLE_LABELS[role], 'string')
  assert.ok(ROLE_LABELS[role].trim(), `${role} should have a Chinese label`)
  assert.equal(getRoleLabel(role), ROLE_LABELS[role])
  assert.ok(ROLE_NAV_PRIORITY[role]?.length, `${role} should have navigation priorities`)
  assert.ok(ROLE_DASHBOARD_COPY[role], `${role} should have dashboard copy`)
}

const navigationFor = role => buildNavigation(role)
const navigationNamesFor = role => navigationFor(role).flatMap(section => section.children.map(item => item.name))

for (const role of roles) {
  const navigation = navigationFor(role)
  assert.deepEqual(navigation.map(section => section.title), ['总览', '预约运营', '空间管理', '用户与信用', '数据统计', '内容与系统'])
  assert.ok(navigation.every(section => section.children.length), `${role} should not receive empty navigation sections`)
  for (const name of navigationNamesFor(role)) {
    assert.ok(hasRouteRole(routeByName.get(name), role), `${role} navigation should only contain allowed route ${name}`)
  }
}

const counselorNavigationNames = navigationNamesFor('counselor')
assert.deepEqual(counselorNavigationNames.slice(0, 5), ['Dashboard', 'CounselorPending', 'ReservationPending', 'CheckinManage', 'ReservationAll'])
assert.ok(
  counselorNavigationNames.indexOf('CounselorPending') < counselorNavigationNames.indexOf('ReservationPending'),
  'counselor review should precede general reservation review in actual navigation'
)

const adminNavigationNames = navigationNamesFor('admin')
assert.deepEqual(adminNavigationNames.slice(0, 5), ['Dashboard', 'ReservationPending', 'CounselorPending', 'CheckinManage', 'ReservationAll'])
assert.ok(adminNavigationNames.indexOf('ReservationPending') < adminNavigationNames.indexOf('PosterPosition'))
assert.ok(adminNavigationNames.indexOf('RoomManage') < adminNavigationNames.indexOf('SystemAnnouncements'))

const superNavigationNames = navigationNamesFor('super_admin')
assert.deepEqual(superNavigationNames.slice(0, 4), ['Dashboard', 'ReservationPending', 'CounselorPending', 'ReservationAll'])
assert.ok(superNavigationNames.includes('SystemLogs'))
assert.ok(superNavigationNames.includes('SystemBackup'))

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
  assert.ok(!counselorNavigationNames.includes(forbidden), `counselor navigation must not contain ${forbidden}`)
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
