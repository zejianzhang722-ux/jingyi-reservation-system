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

const [adminReservationApi, miniAdminHome, miniAdminReservation, miniAdminReservationDetail, reservationRoutes, reservationControllerSource] = await Promise.all([
  read('../admin/src/api/reservation.js'),
  read('../miniapp/pages/admin-home/admin-home.js'),
  read('../miniapp/pages/admin-reservation/admin-reservation.js'),
  read('../miniapp/pages/admin-reservation-detail/admin-reservation-detail.js'),
  read('../server/src/routes/reservation.js'),
  read('../server/src/controllers/reservationController.js')
])
for (const [name, source] of [['web admin', adminReservationApi], ['mini-program admin', miniAdminHome]]) {
  assert.match(source, /['"`]\/audit\/pending['"`]/, `${name} must list the shared pending audit endpoint`)
  assert.match(source, /\/audit\/(?:\$\{id\}\/|['"]\s*\+\s*id\s*\+\s*['"]\/)approve/, `${name} must use the shared approve endpoint`)
  assert.match(source, /\/audit\/(?:\$\{id\}\/|['"]\s*\+\s*id\s*\+\s*['"]\/)reject/, `${name} must use the shared reject endpoint`)
}
assert.match(miniAdminHome, /type:\s*this\.data\.queueType/, 'mini-program pending requests must send an explicit queue type')
assert.match(miniAdminHome, /queueType:\s*['"]admin['"]/, 'mini-program must expose the ordinary queue')
assert.match(miniAdminHome, /['"]counselor['"]/, 'mini-program must expose the counselor queue')
assert.match(miniAdminReservation, /params\.actionable\s*=\s*1/, 'mini-program actionable preset must request the authoritative server filter')
assert.match(reservationControllerSource, /actionableOnly/, 'reservation service must recognize the actionable filter')
assert.match(reservationControllerSource, /\[['"]pending['"]\]/, 'ordinary administrators must retain pending as their actionable status')
assert.match(reservationControllerSource, /\[['"]pending['"],\s*['"]counselor_pending['"]\]/, 'counselors and super administrators must retain both actionable statuses')
assert.match(miniAdminReservationDetail, /request\.get\(['"]\/reservation\/['"]\s*\+\s*this\._reservationId/, 'mobile admin detail must use the shared reservation detail endpoint')
assert.match(reservationRoutes, /router\.get\(['"]\/:id['"],[\s\S]{0,220}optionalAdminReservationScope\(['"]id['"]\)[\s\S]{0,220}reservationController\.detail/, 'shared reservation detail must retain the unified admin scope guard')
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
  redirectTo(options) { navigationCalls.push(options.url) },
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

const [scopedStatsControllerSource, webStatsFormatter, mobileStatsPage, mobileStatsTemplate] = await Promise.all([
  read('../server/src/controllers/scopedStatsController.js'),
  read('../admin/src/utils/statsFormatters.js'),
  read('../miniapp/pages/admin-stats/admin-stats.js'),
  read('../miniapp/pages/admin-stats/admin-stats.wxml')
])
for (const field of ['ordinaryPendingCount', 'counselorPendingCount', 'actionablePendingCount', 'activeRoomCount']) {
  assert.match(scopedStatsControllerSource, new RegExp(`\\b${field}\\b`), `scoped dashboard must expose ${field}`)
}
for (const field of ['room_id', 'room_name', 'room_type', 'reservation_count', 'used_days']) {
  assert.match(scopedStatsControllerSource, new RegExp(`\\b${field}\\b`), `scoped usage ranking must expose ${field}`)
}
for (const source of [webStatsFormatter, mobileStatsPage + mobileStatsTemplate]) {
  assert.match(source, /room_name/, 'both admin clients must consume the shared room_name usage field')
  assert.match(source, /reservation_count/, 'both admin clients must consume the shared reservation_count usage field')
}
assert.match(mobileStatsPage + mobileStatsTemplate, /used_days/, 'mobile stats must consume the shared used_days usage field')

function createControllerResponse() {
  const state = { statusCode: null, payload: null }
  return {
    state,
    status(code) { state.statusCode = code; return this },
    json(payload) { state.payload = payload; return this }
  }
}

const scopedStatsController = require('../server/src/controllers/scopedStatsController.js')
const reservationController = require('../server/src/controllers/reservationController.js')
const sharedDb = require('../server/src/config/database.js')
const originalIsMock = sharedDb.isMock
const originalQuery = sharedDb.query
const mysqlCalls = []
sharedDb.isMock = () => false
sharedDb.query = async (sql, params = []) => {
  mysqlCalls.push({ sql, params: [...params] })
  if (/^SELECT r\.\*, rm\.name AS room_name/.test(sql)) {
    const statuses = params.filter(value => value === 'pending' || value === 'counselor_pending')
    return [statuses.map(function(status, index) {
      return {
        id: index + 1,
        status,
        date: '2026-07-16',
        start_time: '09:00',
        end_time: '10:00',
        room_id: 9,
        room_name: 'Room 9',
        room_type: 'study_room',
        building_id: 7,
        user_id: 3,
        real_name: 'Tester'
      }
    })]
  }
  if (/^SELECT COUNT\(\*\) AS total FROM reservations r JOIN rooms rm ON rm\.id = r\.room_id/.test(sql)) {
    return [[{ total: String(params.filter(value => value === 'pending' || value === 'counselor_pending').length) }]]
  }
  if (/^SELECT COUNT\(\*\) AS count FROM reservations/.test(sql)) {
    if (sql.includes("r.status = 'pending'")) return [[{ count: '2' }]]
    if (sql.includes("r.status = 'counselor_pending'")) return [[{ count: '1' }]]
    return [[{ count: '0' }]]
  }
  if (/^SELECT COUNT\(\*\) AS count FROM rooms/.test(sql)) return [[{ count: '4' }]]
  if (/^SELECT COUNT\(\*\) AS total/.test(sql)) return [[{ total: '0', used: '0', noshow: '0' }]]
  if (/^SELECT rm\.type, COUNT/.test(sql)) return [[]]
  if (/^SELECT rm\.name, COUNT/.test(sql)) return [[]]
  if (/^SELECT r\.id, r\.status/.test(sql)) {
    const rows = [{ id: 1, status: 'pending', purpose: '', date: '2026-07-16', start_time: '09:00', real_name: 'A', room_name: 'Room A' }]
    if (sql.includes('counselor_pending')) rows.push({ id: 2, status: 'counselor_pending', purpose: '', date: '2026-07-16', start_time: '10:00', real_name: 'B', room_name: 'Room B' })
    return [rows]
  }
  if (/^SELECT rm\.id AS room_id/.test(sql)) {
    return [[{ room_id: '9', room_name: 'Room 9', room_type: 'study_room', reservation_count: '3', used_days: '2' }]]
  }
  assert.fail(`unexpected scoped stats SQL: ${sql}`)
}

try {
  for (const role of ['admin', 'counselor', 'super_admin']) {
    mysqlCalls.length = 0
    const isBuildingAdmin = role === 'admin'
    const res = createControllerResponse()
    await scopedStatsController.dashboard({
      query: {},
      adminScope: { role, isGlobal: !isBuildingAdmin, buildingId: isBuildingAdmin ? 7 : null }
    }, res)
    assert.equal(res.state.statusCode, 200, `${role} MySQL dashboard must succeed`)
    assert.equal(res.state.payload.data.pendingCount, res.state.payload.data.actionablePendingCount, `${role} pending totals must align`)
    const pendingCall = mysqlCalls.find(call => /^SELECT r\.id, r\.status/.test(call.sql))
    assert.ok(pendingCall, `${role} dashboard must query pending details`)
    if (isBuildingAdmin) {
      assert.match(pendingCall.sql, /WHERE r\.status = 'pending'/, 'admin pending details must allow only ordinary pending rows')
      assert.doesNotMatch(pendingCall.sql, /counselor_pending/, 'admin pending details must exclude counselor pending rows')
      assert.match(pendingCall.sql, /AND rm\.building_id = \?/, 'building admin pending details must retain room scope SQL')
      assert.deepEqual(pendingCall.params, [7], 'building admin pending details must bind its building scope')
      assert.deepEqual(res.state.payload.data.pendingItems.map(item => item.tag), ['待审核'], 'admin pending detail response must exclude counselor rows')
    } else {
      assert.match(pendingCall.sql, /r\.status IN \('pending','counselor_pending'\)/, `${role} pending details must allow both review queues`)
      assert.deepEqual(res.state.payload.data.pendingItems.map(item => item.tag), ['待审核', '辅导员审核'], `${role} pending detail response must include both queues`)
    }
  }

  mysqlCalls.length = 0
  const usageRes = createControllerResponse()
  await scopedStatsController.usageRate({
    query: { startDate: '2026-07-01', endDate: '2026-07-16', roomId: '9' },
    adminScope: { role: 'admin', isGlobal: false, buildingId: 7 }
  }, usageRes)
  assert.equal(usageRes.state.statusCode, 200, 'validated MySQL usage request must succeed')
  const usageCall = mysqlCalls.find(call => /^SELECT rm\.id AS room_id/.test(call.sql))
  assert.ok(usageCall, 'MySQL usage must execute its scoped query')
  assert.match(usageCall.sql, /AND rm\.building_id = \? AND rm\.id = \?/, 'MySQL usage must retain building and validated room filters')
  assert.deepEqual(usageCall.params, ['2026-07-01', '2026-07-16', 7, 9], 'MySQL usage must bind only finite validated numeric ids')
  assert.deepEqual(usageRes.state.payload.data, [{
    room_id: 9,
    room_name: 'Room 9',
    room_type: 'study_room',
    reservation_count: 3,
    used_days: 2
  }], 'MySQL usage response must normalize shared fields and integer counts')

  for (const roomId of ['abc', '0', '-2', '1.5']) {
    mysqlCalls.length = 0
    const invalidRes = createControllerResponse()
    await scopedStatsController.usageRate({
      query: { roomId },
      adminScope: { role: 'admin', isGlobal: false, buildingId: 7 }
    }, invalidRes)
    assert.equal(invalidRes.state.statusCode, 400, `invalid roomId ${roomId} must return 400 before MySQL`)
    assert.equal(mysqlCalls.length, 0, `invalid roomId ${roomId} must not reach MySQL`)
  }

  for (const testCase of [
    {
      role: 'admin',
      scope: { role: 'admin', isGlobal: false, buildingId: 7 },
      statuses: ['pending'],
      prefixParams: [7, 'pending']
    },
    {
      role: 'counselor',
      scope: { role: 'counselor', isGlobal: true, buildingId: null },
      statuses: ['pending', 'counselor_pending'],
      prefixParams: ['pending', 'counselor_pending']
    },
    {
      role: 'super_admin',
      scope: { role: 'super_admin', isGlobal: true, buildingId: null },
      statuses: ['pending', 'counselor_pending'],
      prefixParams: ['pending', 'counselor_pending']
    }
  ]) {
    mysqlCalls.length = 0
    const res = createControllerResponse()
    await reservationController.list({
      query: { actionable: '1', status: 'rejected', page: '1', pageSize: '2' },
      user: { id: 41, role: testCase.role },
      adminScope: testCase.scope
    }, res)
    assert.equal(res.state.statusCode, 200, `${testCase.role} actionable reservation list must succeed`)
    assert.deepEqual(res.state.payload.data.list.map(row => row.status), testCase.statuses, `${testCase.role} actionable list must override a single status filter`)

    const rowCall = mysqlCalls.find(call => /^SELECT r\.\*, rm\.name AS room_name/.test(call.sql))
    const countCall = mysqlCalls.find(call => /^SELECT COUNT\(\*\) AS total FROM reservations r JOIN rooms/.test(call.sql))
    assert.ok(rowCall && countCall, `${testCase.role} actionable list must run both row and count queries`)
    assert.match(rowCall.sql, /r\.status IN \((?:\?,?)+\)/, `${testCase.role} actionable rows must use a parameterized status set`)
    assert.doesNotMatch(rowCall.sql, /r\.status = \?/, `${testCase.role} actionable rows must not also apply the single status`)
    assert.deepEqual(rowCall.params, testCase.prefixParams.concat([2, 0]), `${testCase.role} row query must bind scope and actionable statuses before pagination`)
    assert.deepEqual(countCall.params, testCase.prefixParams, `${testCase.role} count query must reuse the same scope and actionable parameters`)
    const rowWhere = rowCall.sql.match(/ WHERE 1=1[\s\S]+? ORDER BY/)[0].replace(/ ORDER BY$/, '')
    const countWhere = countCall.sql.match(/ WHERE 1=1[\s\S]+$/)[0]
    assert.equal(countWhere, rowWhere, `${testCase.role} row and count queries must use the same actionable condition`)
  }

  mysqlCalls.length = 0
  const studentActionableRes = createControllerResponse()
  await reservationController.list({
    query: { actionable: '1', page: '1', pageSize: '20' },
    user: { id: 7, role: 'student' }
  }, studentActionableRes)
  assert.equal(studentActionableRes.state.statusCode, 403, 'students must not access the administrator actionable filter')
  assert.equal(mysqlCalls.length, 0, 'student actionable requests must be rejected before querying MySQL')
} finally {
  sharedDb.isMock = originalIsMock
  sharedDb.query = originalQuery
}

assert.equal(packageJson.scripts['check:admin-cross-client'], 'node scripts/admin-cross-client-contract-check.mjs', 'root package must expose the cross-client admin contract check')
assert.match(packageJson.scripts['check:all'], /check:admin-miniapp\s*&&\s*npm run check:admin-cross-client/, 'check:all must run the cross-client check immediately after admin-miniapp')

console.log('admin-cross-client-contract-check passed')
