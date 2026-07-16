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

function assertSetEqual(actual, expected, message) {
  assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort(), message)
}

function extractCall(source, marker, message) {
  const start = source.indexOf(marker)
  assert.ok(start >= 0, message)
  const open = source.indexOf('(', start + marker.length)
  assert.ok(open >= 0, message)
  let depth = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1 }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue }
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  assert.fail(message)
}

function routeCall(source, method, path) {
  const markerPattern = new RegExp(`router\\.${method}\\s*\\(\\s*['"]${escapeRegex(path)}['"]`)
  const match = markerPattern.exec(source)
  assert.ok(match, `${method.toUpperCase()} ${path} must remain registered`)
  return extractCall(source.slice(match.index), `router.${method}`, `${method.toUpperCase()} ${path} route must remain inspectable`)
}

function assertRouteRoles(source, method, path, expectedRoles, message) {
  const markerPattern = new RegExp(`router\\.${method}\\s*\\(\\s*['"]${escapeRegex(path)}['"]`)
  const match = markerPattern.exec(source)
  assert.ok(match, `${method.toUpperCase()} ${path} must remain registered`)
  const call = extractCall(source.slice(match.index), `router.${method}`, `${method.toUpperCase()} ${path} route must remain inspectable`)
  const roleCall = extractCall(call, 'requireRole', `${method.toUpperCase()} ${path} must enforce roles`)
  const roles = [...roleCall.matchAll(/['"](super_admin|counselor|admin)['"]/g)].map(item => item[1])
  assertSetEqual(roles, expectedRoles, message)
}

assertSetEqual(['counselor', 'admin'], ['admin', 'counselor'], 'set comparisons must ignore declaration order')
assertRouteRoles(
  "router.post(\n  '/sample',\n  auth,\n  requireRole(\n    'counselor',\n    'admin'\n  ),\n  handler\n)",
  'post', '/sample', ['admin', 'counselor'], 'role checks must allow order and line-break changes'
)

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
  assertSetEqual(adminPolicy.ROLE_CAPABILITIES[role], allowlist, `${role} mobile capability allowlist drifted`)
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
assertRouteRoles(serverIndex, 'use', '/audit', ['admin', 'counselor', 'super_admin'], 'the mounted audit service must allow all three admin roles')
for (const endpoint of ['/pending', '/:id/approve', '/:id/reject', '/batch']) {
  assertRouteRoles(auditRoutes, endpoint === '/pending' ? 'get' : 'post', endpoint, ['admin', 'counselor', 'super_admin'], `${endpoint} must enforce all three audit roles at the service route`)
}
for (const endpoint of ['/:id/approve', '/:id/reject']) {
  assertRouteRoles(posterRoutes, 'post', endpoint, ['counselor', 'super_admin'], `${endpoint} poster review must be counselor/super only`)
}

function assertSuperRoute(method, path) {
  assertRouteRoles(adminRoutesSource, method, path, ['super_admin'], `${method.toUpperCase()} ${path} must be super-admin only at the service route`)
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
for (const [functionName, method] of [['getAnnouncements', 'get'], ['createAnnouncement', 'post'], ['updateAnnouncement', 'put'], ['deleteAnnouncement', 'delete']]) {
  const functionSource = extractFunction(adminApi, functionName)
  assert.match(functionSource, new RegExp(`request\\.${method}\\([\\s\\S]*\\/admin\\/announcements`), `${functionName} must use the shared web announcement API`)
}
assert.match(miniIndex, /request\.get\(['"]\/room\/announcements['"]/, 'student and room announcement reads must use /room/announcements')
for (const [method, path, controller] of [['get', '/announcements', 'getAnnouncements'], ['post', '/announcements', 'createAnnouncement'], ['put', '/announcements/:id', 'updateAnnouncement'], ['delete', '/announcements/:id', 'deleteAnnouncement']]) {
  assert.match(routeCall(adminRoutesSource, method, path), new RegExp(`adminController\\.${controller}\\b`), `${method.toUpperCase()} ${path} must use ${controller}`)
}
assert.match(roomRoutes, /router\.get\(['"]\/announcements['"][^\n]*roomController\.listAnnouncements/, 'room announcement reads must use the exported room controller chain')

function extractFunction(source, functionName) {
  const startPattern = new RegExp(`(?:const\\s+${functionName}\\s*=\\s*async\\s+function|export\\s+function\\s+${functionName})\\s*\\([^)]*\\)\\s*\\{`)
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
const announcementFunctions = [
  ['getAnnouncements', adminController],
  ['createAnnouncement', adminController],
  ['updateAnnouncement', adminController],
  ['deleteAnnouncement', adminController],
  ['listAnnouncements', roomController]
]
for (const [functionName, source] of announcementFunctions) {
  assertSetEqual(sqlTables(extractFunction(source, functionName)), ['announcements'], `${functionName} must use only the announcements table`)
  assert.match(source, /const\s+db\s*=\s*require\(['"]\.\.\/config\/database['"]\)/, `${functionName} must use the shared database module`)
}
assert.match(adminController, /module\.exports\s*=\s*\{[\s\S]*createAnnouncement[\s\S]*\}/, 'the admin announcement writer must be exported')
assert.match(roomController, /module\.exports\s*=\s*\{[\s\S]*listAnnouncements[\s\S]*\}/, 'the room announcement reader must be exported')

const [appJson, adminManage] = await Promise.all([
  read('../miniapp/app.json'),
  read('../miniapp/pages/admin-manage/admin-manage.js')
])
assert.ok(JSON.parse(appJson).pages.includes('pages/admin-poster/admin-poster'), 'app.json must register admin-poster')
assert.match(adminManage, /key:\s*['"]poster['"][\s\S]{0,250}capability:\s*['"]posterReview['"]/, 'admin-manage poster entry must be protected by posterReview')

const registeredPages = new Set(JSON.parse(appJson).pages)
const navigationCalls = []
globalThis.wx = {
  navigateTo(options) { navigationCalls.push(options.url) },
  reLaunch(options) { navigationCalls.push(options.url) },
  getStorageSync(key) {
    if (key === 'token') return 'contract-token'
    if (key === 'userInfo') return { id: 1, role: 'super_admin' }
    return undefined
  }
}
globalThis.getApp = () => ({ globalData: {} })
let managePage
globalThis.Page = config => { managePage = config }
require('../miniapp/pages/admin-manage/admin-manage.js')
assert.ok(managePage, 'the real admin-manage page must load')
managePage.data = structuredClone(managePage.data || {})
managePage.setData = next => Object.assign(managePage.data, next)
managePage.onLoad.call(managePage)
const realCatalogKeys = managePage.data.groups.flatMap(group => group.items.map(item => item.key))
const forbiddenMobileKeys = ['roomManage', 'buildingManage', 'seatManage', 'rulesConfig', 'accounts', 'account', 'creditConfig', 'announcement', 'announcements', 'logs', 'backup']
for (const key of forbiddenMobileKeys) assert.equal(realCatalogKeys.includes(key), false, `desktop-only ${key} must not appear in the real mobile catalog`)
for (const key of realCatalogKeys) managePage.onItemTap.call(managePage, { currentTarget: { dataset: { key } } })
for (const [name, handler] of Object.entries(managePage)) {
  if (/^goTo/.test(name) && typeof handler === 'function') handler.call(managePage)
}
const realDestinations = navigationCalls.map(url => url.replace(/^\//, '').split('?')[0])
for (const destination of realDestinations) assert.ok(registeredPages.has(destination), `${destination} from the real admin route map must be registered in app.json`)
const forbiddenMobilePages = [
  'pages/admin-announcement/admin-announcement', 'pages/admin-building/admin-building',
  'pages/admin-seats/admin-seats', 'pages/admin-rules/admin-rules', 'pages/admin-accounts/admin-accounts',
  'pages/admin-credit-config/admin-credit-config', 'pages/admin-logs/admin-logs', 'pages/admin-backup/admin-backup'
]
for (const page of forbiddenMobilePages) {
  assert.equal(registeredPages.has(page), false, `desktop-only page ${page} must not be registered by app.json`)
  assert.equal(realDestinations.includes(page), false, `desktop-only page ${page} must not be reachable from the real admin route map`)
}
for (const allowedPage of ['pages/admin-rooms/admin-rooms', 'pages/admin-users/admin-users', 'pages/admin-credit/admin-credit']) {
  assert.ok(realDestinations.includes(allowedPage), `${allowedPage} read-only mobile entry must remain available`)
}
const [mobileRoomsSource, mobileUsersSource] = await Promise.all([
  read('../miniapp/pages/admin-rooms/admin-rooms.js'),
  read('../miniapp/pages/admin-users/admin-users.js')
])
for (const [name, source] of [['rooms', mobileRoomsSource], ['users', mobileUsersSource]]) {
  assert.doesNotMatch(source, /request\.(?:post|put|delete)\s*\(/, `${name} mobile entry must remain read-only`)
}
assert.ok(navigationCalls.some(url => /\/pages\/admin-credit\/admin-credit\?tab=violations$/.test(url)), 'the mobile violations entry must remain explicit')

const [scopedStatsController, webStatsFormatter, mobileStatsPage, mobileStatsTemplate] = await Promise.all([
  read('../server/src/controllers/scopedStatsController.js'),
  read('../admin/src/utils/statsFormatters.js'),
  read('../miniapp/pages/admin-stats/admin-stats.js'),
  read('../miniapp/pages/admin-stats/admin-stats.wxml')
])
for (const field of ['ordinaryPendingCount', 'counselorPendingCount', 'actionablePendingCount', 'activeRoomCount']) {
  assert.match(scopedStatsController, new RegExp(`\\b${field}\\b`), `scoped dashboard must expose ${field}`)
}
for (const field of ['room_id', 'room_name', 'room_type', 'reservation_count', 'used_days']) {
  assert.match(scopedStatsController, new RegExp(`\\b${field}\\b`), `scoped usage ranking must expose ${field}`)
}
for (const source of [webStatsFormatter, mobileStatsPage + mobileStatsTemplate]) {
  assert.match(source, /room_name/, 'both admin clients must consume the shared room_name usage field')
  assert.match(source, /reservation_count/, 'both admin clients must consume the shared reservation_count usage field')
}
assert.match(mobileStatsPage + mobileStatsTemplate, /used_days/, 'mobile stats must consume the shared used_days usage field')

assert.equal(packageJson.scripts['check:admin-cross-client'], 'node scripts/admin-cross-client-contract-check.mjs', 'root package must expose the cross-client admin contract check')
assert.match(packageJson.scripts['check:all'], /check:admin-miniapp\s*&&\s*npm run check:admin-cross-client/, 'check:all must run the cross-client check immediately after admin-miniapp')

console.log('admin-cross-client-contract-check passed')
