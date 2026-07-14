import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

import { adminChildren, hasRouteRole, navSections } from '../admin/src/router/adminRoutes.js'

const require = createRequire(import.meta.url)
const adminPolicy = require('../miniapp/utils/admin-policy.js')
const roleAuth = require('../server/src/middleware/roleAuth.js')

const read = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8')
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const routeByName = new Map(adminChildren.map(route => [route.name, route]))
const packageJson = JSON.parse(await read('../package.json'))

function assertRoles(routeName, expectedRoles) {
  const route = routeByName.get(routeName)
  assert.ok(route, `${routeName} must remain a registered admin route`)
  for (const role of ['admin', 'counselor', 'super_admin']) {
    assert.equal(hasRouteRole(route, role), expectedRoles.includes(role), `${routeName} role policy drifted for ${role}`)
  }
}

assertRoles('ReservationPending', ['admin', 'counselor', 'super_admin'])
assertRoles('CounselorPending', ['counselor', 'super_admin'])
assertRoles('AccountManage', ['super_admin'])

assert.equal(navSections.length, 7, 'admin navigation must retain seven operational sections')
assert.deepEqual(
  navSections.find(section => section.key === 'system')?.children,
  ['SystemLogs', 'SystemBackup'],
  'system operations must contain only logs and backup'
)

const desktopOnlyRoutes = [
  'RoomManage',
  'BuildingManage',
  'SeatManage',
  'RulesConfig',
  'AccountManage',
  'CreditConfig',
  'PosterPosition',
  'SystemAnnouncements',
  'SystemLogs',
  'SystemBackup'
]
assert.deepEqual(
  adminChildren.filter(route => route.meta.roles.length === 1 && route.meta.roles[0] === 'super_admin').map(route => route.name),
  desktopOnlyRoutes,
  'the desktop-only exception list must remain exact and explicit'
)

const mobileCapabilityAllowlist = {
  admin: ['ordinaryApproval', 'reservationView', 'roomView', 'residentView', 'violationView', 'statsView', 'scanCheckin'],
  counselor: ['ordinaryApproval', 'reservationView', 'roomView', 'residentView', 'violationView', 'statsView', 'scanCheckin', 'counselorApproval', 'blacklistManage', 'feedbackManage', 'posterReview'],
  super_admin: ['ordinaryApproval', 'reservationView', 'roomView', 'residentView', 'violationView', 'statsView', 'scanCheckin', 'counselorApproval', 'blacklistManage', 'feedbackManage', 'posterReview']
}
for (const [role, allowlist] of Object.entries(mobileCapabilityAllowlist)) {
  assert.deepEqual(adminPolicy.ROLE_CAPABILITIES[role], allowlist, `${role} mobile capability allowlist drifted`)
}
assert.equal(adminPolicy.can('admin', 'ordinaryApproval'), true)
assert.equal(adminPolicy.can('admin', 'counselorApproval'), false)
assert.equal(adminPolicy.can('admin', 'posterReview'), false)
for (const role of ['counselor', 'super_admin']) {
  assert.equal(adminPolicy.can(role, 'counselorApproval'), true)
  assert.equal(adminPolicy.can(role, 'posterReview'), true)
}
const desktopOnlyCapabilities = [
  'roomManage', 'buildingManage', 'seatManage', 'rulesConfig', 'accountManage',
  'creditConfig', 'posterPositionManage', 'announcementManage', 'operationLogs', 'backupManage'
]
for (const [role, allowlist] of Object.entries(mobileCapabilityAllowlist)) {
  assert.deepEqual(allowlist.filter(capability => desktopOnlyCapabilities.includes(capability)), [], `${role} must not inherit desktop-only capabilities`)
}

const [adminReservationApi, miniAdminHome, miniAdminReservation] = await Promise.all([
  read('../admin/src/api/reservation.js'),
  read('../miniapp/pages/admin-home/admin-home.js'),
  read('../miniapp/pages/admin-reservation/admin-reservation.js')
])
for (const [name, source] of [['web admin', adminReservationApi], ['mini-program admin', miniAdminHome]]) {
  assert.match(source, /['"`]\/audit\/pending['"`]/, `${name} must list the shared pending audit endpoint`)
  assert.match(source, /\/audit\/(?:\$\{id\}\/|['"]\s*\+\s*id\s*\+\s*['"]\/)approve/, `${name} must use the shared approve endpoint`)
  assert.match(source, /\/audit\/(?:\$\{id\}\/|['"]\s*\+\s*id\s*\+\s*['"]\/)reject/, `${name} must use the shared reject endpoint`)
}
assert.match(miniAdminHome, /type:\s*this\.data\.queueType/, 'mini-program pending requests must send an explicit queue type')
assert.match(miniAdminHome, /queueType:\s*['"]admin['"]/, 'mini-program must expose the ordinary queue')
assert.match(miniAdminHome, /['"]counselor['"]/, 'mini-program must expose the counselor queue')
for (const [name, source] of [['web admin', adminReservationApi], ['mini-program home', miniAdminHome], ['mini-program reservation list', miniAdminReservation]]) {
  assert.doesNotMatch(source, /\/reservation\/(?:\$\{id\}\/|['"]\s*\+\s*id\s*\+\s*['"]\/)(?:approve|reject)/, `${name} must not restore legacy reservation mutation endpoints`)
}

const [serverIndex, auditRoutes, posterRoutes, adminRoutesSource] = await Promise.all([
  read('../server/src/routes/index.js'),
  read('../server/src/routes/audit.js'),
  read('../server/src/routes/poster.js'),
  read('../server/src/routes/admin.js')
])
assert.match(serverIndex, /router\.use\(['"]\/audit['"][\s\S]*requireRole\(['"]admin['"],\s*['"]super_admin['"],\s*['"]counselor['"]\)/, 'the mounted audit service must allow all three admin roles')
for (const endpoint of ['/pending', '/:id/approve', '/:id/reject', '/batch']) {
  const endpointPattern = new RegExp(`router\\.(?:get|post)\\(['"]${escapeRegex(endpoint)}['"][^\\n]*requireRole\\([^)]*['"]admin['"][^)]*['"]counselor['"][^)]*['"]super_admin['"]\\)`)
  assert.match(auditRoutes, endpointPattern, `${endpoint} must enforce all three audit roles at the service route`)
}
for (const endpoint of ['/:id/approve', '/:id/reject']) {
  const endpointPattern = new RegExp(`router\\.post\\(['"]${escapeRegex(endpoint)}['"][^\\n]*requireRole\\(['"]counselor['"],\\s*['"]super_admin['"]\\)`)
  assert.match(posterRoutes, endpointPattern, `${endpoint} poster review must be counselor/super only`)
}

function assertSuperRoute(method, path) {
  const pattern = new RegExp(`router\\.${method}\\(['"]${escapeRegex(path)}['"][^\\n]*requireRole\\(['"]super_admin['"]\\)`)
  assert.match(adminRoutesSource, pattern, `${method.toUpperCase()} ${path} must be super-admin only at the service route`)
}
for (const [method, path] of [
  ['get', '/accounts'], ['post', '/accounts'], ['put', '/accounts/:id'], ['delete', '/accounts/:id'],
  ['post', '/rooms'], ['put', '/rooms/:id'], ['delete', '/rooms/:id'],
  ['post', '/seats/batch'], ['put', '/seats/:id'], ['delete', '/seats/:id'],
  ['get', '/config'], ['put', '/config'], ['get', '/operation-logs'],
  ['post', '/buildings'], ['put', '/buildings/:id'], ['delete', '/buildings/:id'],
  ['get', '/managers'], ['post', '/managers'], ['put', '/managers/:id'], ['delete', '/managers/:id'],
  ['post', '/announcements'], ['put', '/announcements/:id'], ['delete', '/announcements/:id'],
  ['post', '/archive'],
  ['get', '/backups'], ['post', '/backup'], ['post', '/backups/:fileName/verify']
]) assertSuperRoute(method, path)

function runRoleGuard(allowedRoles, role) {
  let nextCalled = false
  let statusCode
  const res = {
    status(code) { statusCode = code; return this },
    json() { return this }
  }
  roleAuth.requireRole(...allowedRoles)({ user: { role } }, res, () => { nextCalled = true })
  return { nextCalled, statusCode }
}
assert.equal(runRoleGuard(['admin', 'counselor', 'super_admin'], 'admin').nextCalled, true)
assert.equal(runRoleGuard(['counselor', 'super_admin'], 'admin').statusCode, 403)
assert.equal(runRoleGuard(['super_admin'], 'counselor').statusCode, 403)

const [adminApi, miniIndex, roomRoutes, adminController, roomController] = await Promise.all([
  read('../admin/src/api/admin.js'),
  read('../miniapp/pages/index/index.js'),
  read('../server/src/routes/room.js'),
  read('../server/src/controllers/adminController.js'),
  read('../server/src/controllers/roomController.js')
])
assert.match(adminApi, /request\.(?:post|put|delete)\([^\n]*\/admin\/announcements/, 'web announcement writes must use /admin/announcements')
assert.match(miniIndex, /request\.get\(['"]\/room\/announcements['"]/, 'student and room announcement reads must use /room/announcements')
assert.match(adminRoutesSource, /router\.(?:get|post|put|delete)\(['"]\/announcements(?:\/:id)?['"][^\n]*adminController\.(?:get|create|update|delete)Announcement/, 'admin announcement routes must use the exported admin controller chain')
assert.match(roomRoutes, /router\.get\(['"]\/announcements['"][^\n]*roomController\.listAnnouncements/, 'room announcement reads must use the exported room controller chain')

function extractFunction(source, functionName) {
  const startPattern = new RegExp(`const\\s+${functionName}\\s*=\\s*async\\s+function\\s*\\([^)]*\\)\\s*\\{`)
  const match = startPattern.exec(source)
  assert.ok(match, `${functionName} must remain an exported controller function`)
  let depth = 0
  for (let index = match.index + match[0].lastIndexOf('{'); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(match.index, index + 1)
  }
  assert.fail(`could not read ${functionName} controller body`)
}
function sqlTables(functionSource) {
  return new Set([...functionSource.matchAll(/\b(?:FROM|INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi)].map(match => match[1].toLowerCase()))
}
const adminAnnouncementTables = sqlTables(extractFunction(adminController, 'createAnnouncement'))
const roomAnnouncementTables = sqlTables(extractFunction(roomController, 'listAnnouncements'))
assert.ok([...adminAnnouncementTables].some(table => roomAnnouncementTables.has(table)), 'web writes and mini-program reads must resolve to one announcement data source')
assert.match(adminController, /module\.exports\s*=\s*\{[\s\S]*createAnnouncement[\s\S]*\}/, 'the admin announcement writer must be exported')
assert.match(roomController, /module\.exports\s*=\s*\{[\s\S]*listAnnouncements[\s\S]*\}/, 'the room announcement reader must be exported')

const [appJson, adminManage] = await Promise.all([
  read('../miniapp/app.json'),
  read('../miniapp/pages/admin-manage/admin-manage.js')
])
assert.ok(JSON.parse(appJson).pages.includes('pages/admin-poster/admin-poster'), 'app.json must register admin-poster')
assert.match(adminManage, /key:\s*['"]poster['"][\s\S]{0,250}capability:\s*['"]posterReview['"]/, 'admin-manage poster entry must be protected by posterReview')

assert.equal(packageJson.scripts['check:admin-cross-client'], 'node scripts/admin-cross-client-contract-check.mjs', 'root package must expose the cross-client admin contract check')
assert.match(packageJson.scripts['check:all'], /check:admin-miniapp\s*&&\s*npm run check:admin-cross-client/, 'check:all must run the cross-client check immediately after admin-miniapp')

console.log('admin-cross-client-contract-check passed')
