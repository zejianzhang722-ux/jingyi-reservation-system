import assert from 'node:assert/strict'

import {
  ROLE_DASHBOARD_COPY,
  ROLE_LABELS,
  ROLE_NAV_PRIORITY,
  ROLE_SHORTCUTS,
  resolveRoleDestination,
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
  assert.ok(ROLE_DASHBOARD_COPY[role].title?.trim(), `${role} should have an independent dashboard title`)
  assert.ok(ROLE_DASHBOARD_COPY[role].description?.trim(), `${role} should have an independent dashboard description`)
  assert.equal(ROLE_DASHBOARD_COPY[role].metrics?.length, 4, `${role} should have four tailored metric labels`)
}

assert.equal(resolveRoleDestination('/system/logs', 'counselor'), '/reservation/counselor')
assert.equal(resolveRoleDestination('/reservation/all', 'counselor'), '/reservation/all')
assert.equal(resolveRoleDestination('https://example.com', 'admin'), '/reservation/pending')

assert.equal(new Set(roles.map(role => ROLE_DASHBOARD_COPY[role].title)).size, roles.length, 'dashboard titles should differ by role')
assert.equal(new Set(roles.map(role => ROLE_SHORTCUTS[role].map(item => item.name).join(','))).size, roles.length, 'shortcut sets should differ by role')

const navigationFor = role => buildNavigation(role)
const navigationNamesFor = role => navigationFor(role).flatMap(section => section.children.map(item => item.name))

for (const role of roles) {
  const navigation = navigationFor(role)
  const expectedSections = role === 'admin'
    ? ['今日工作', '预约与使用', '空间管理', '宿生与信用', '数据与报表']
    : role === 'counselor'
      ? ['今日工作', '预约与使用', '空间管理', '宿生与信用', '数据与报表', '内容与沟通']
      : ['今日工作', '预约与使用', '空间管理', '宿生与信用', '数据与报表', '内容与沟通', '系统运维']
  assert.deepEqual(navigation.map(section => section.title), expectedSections)
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
assert.deepEqual(adminNavigationNames.slice(0, 5), ['Dashboard', 'ReservationPending', 'CheckinManage', 'ReservationAll', 'ReadingRoomLogs'])

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
for (const inherited of ['ReservationPending', 'CheckinManage', 'ReservationAll', 'ReadingRoomLogs', 'CreditViolations', 'StatsOverview']) {
  assert.ok(counselorNames.has(inherited), `counselor should inherit ${inherited}`)
}
for (const forbidden of ['RoomManage', 'BuildingManage', 'SeatManage', 'RulesConfig', 'CreditConfig', 'SystemLogs', 'SystemBackup']) {
  assert.ok(!counselorNames.has(forbidden), `counselor must not receive ${forbidden}`)
  assert.ok(!counselorNavigationNames.includes(forbidden), `counselor navigation must not contain ${forbidden}`)
}

const adminNames = new Set(sortedNamesFor('admin'))
for (const allowed of ['ReservationPending', 'CheckinManage', 'ReservationAll', 'ReadingRoomLogs', 'RoomMonitor', 'CreditViolations', 'StatsOverview']) {
  assert.ok(adminNames.has(allowed), `admin should receive ${allowed}`)
}
for (const forbidden of ['CounselorPending', 'RoomManage', 'BuildingManage', 'SeatManage', 'RulesConfig', 'AccountManage', 'CreditBlacklist', 'StatsExport', 'PosterPending', 'PosterPosition', 'Feedback', 'SystemAnnouncements', 'CreditConfig', 'SystemLogs', 'SystemBackup']) {
  assert.ok(!adminNames.has(forbidden), `admin must not receive ${forbidden}`)
  assert.ok(!adminNavigationNames.includes(forbidden), `admin navigation must not contain ${forbidden}`)
}

for (const role of roles) {
  assert.ok(ROLE_SHORTCUTS[role]?.length, `${role} should have shortcuts`)
  for (const shortcut of ROLE_SHORTCUTS[role]) {
    const route = routeByName.get(shortcut.name)
    assert.ok(route, `${role} shortcut ${shortcut.name} should point to a route`)
    assert.ok(hasRouteRole(route, role), `${role} shortcut ${shortcut.name} should be allowed`)
    assert.equal(shortcut.destination, `/${route.path}`, `${role} shortcut ${shortcut.name} should expose a valid destination`)
  }
}

console.log('admin-site-role-policy-check passed')
