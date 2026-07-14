import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { buildTimelineView, createLatestRequestGate, createTimelineRequestCoordinator } from '../admin/src/utils/roomTimeline.js'
import { createLatestRequest, createLatestRequestCoordinator } from '../admin/src/utils/latestRequest.js'
import { normalizeAccountImportRows, readAccountImportWorkbook } from '../admin/src/utils/accountImport.js'
import * as adminRoutes from '../admin/src/router/adminRoutes.js'

const require = createRequire(import.meta.url)
const adminRequire = createRequire(new URL('../admin/package.json', import.meta.url))
const XLSX = adminRequire('xlsx')
const { adminChildren, buildNavigation, getNavigationSectionForRoute } = adminRoutes
assert.equal(typeof getNavigationSectionForRoute, 'function')
assert.equal(typeof createLatestRequestCoordinator, 'function')

function collectVueFiles(directoryUrl) {
  return readdirSync(directoryUrl, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.vue'))
    .map(entry => pathToFileURL(`${entry.parentPath}/${entry.name}`))
}

function visibleCopyFromVue(source) {
  const template = source.split('<script setup>')[0] || ''
  const feedbackCalls = [...source.matchAll(/(?:ElMessage(?:\.\w+)?|ElMessageBox\.confirm)\(\s*(['"`])([\s\S]*?)\1/g)]
    .map(match => match[2])
    .join('\n')
  return `${template}\n${feedbackCalls}`
}

const visibleCopyFiles = collectVueFiles(new URL('../admin/src/', import.meta.url))
const prohibitedChineseCopy = /\u6570\u636e\u8868|\u63a5\u53e3|\u5b57\u6bb5|\u5185\u90e8ID|\u5185\u90e8\u7f16\u53f7|\u8d26\u53f7ID|\u89d2\u8272\u88c1\u526a|\u83dc\u5355\u88c1\u526a|\u89d2\u8272\u8fc7\u6ee4|\u83dc\u5355\u8fc7\u6ee4|\u6a21\u62df\u6570\u636e|\u6a21\u62df\u5185\u5bb9|\u7f13\u5b58|\u524d\u7aef|\u540e\u7aef|\u73af\u5883\u53d8\u91cf|\u672c\u5730\u914d\u7f6e|\u8bf7\u6c42\u63d0\u4ea4|\u6d4f\u89c8\u5668\u4f1a\u8bdd|\u4f1a\u8bdd\u4e34\u65f6|\u5f53\u524d\u8fd4\u56de/
const prohibitedEnglishCopy = /\b(?:WebSocket|Token|API|mock)\b/i
for (const fileUrl of visibleCopyFiles) {
  const source = readFileSync(fileUrl, 'utf8')
  const visibleCopy = visibleCopyFromVue(source)
  assert.doesNotMatch(visibleCopy, prohibitedChineseCopy, `${fileUrl.pathname} contains developer-facing Chinese copy`)
  assert.doesNotMatch(visibleCopy, prohibitedEnglishCopy, `${fileUrl.pathname} contains developer-facing English copy`)
  assert.doesNotMatch(visibleCopy, /label="ID"|>\u9884\u7ea6ID</, `${fileUrl.pathname} exposes an internal identifier as user-facing copy`)
  assert.doesNotMatch(visibleCopy, /\?\.label\s*\|\|\s*row\.(?:status|role|type|action|module)/, `${fileUrl.pathname} can expose an internal code as a label`)
}

const logsSource = readFileSync(new URL('../admin/src/views/System/Logs.vue', import.meta.url), 'utf8')
assert.match(logsSource, /prop="moduleLabel"/)
assert.match(logsSource, /row\.actionLabel/)
assert.match(logsSource, /row\.sourceRecorded/)
assert.match(logsSource, /category:\s*filters\.action/)

const requestSource = readFileSync(new URL('../admin/src/utils/request.js', import.meta.url), 'utf8')
const requestPolicySource = readFileSync(new URL('../admin/src/utils/requestErrorPolicy.js', import.meta.url), 'utf8')
const requestVisibleSource = `${requestSource}\n${requestPolicySource}`
for (const message of [
  '登录已失效，请重新登录',
  '当前账号没有权限执行此操作',
  '所需内容暂时无法找到，可能已调整',
  '服务暂时不可用，请稍后重试；持续出现请联系系统管理员',
  '网络连接失败，请检查网络后重试'
]) assert.match(requestVisibleSource, new RegExp(message))
assert.match(requestSource, /getErrorPresentation\(error\)/)
assert.match(requestSource, /presentation\.shouldNotify/)
assert.doesNotMatch(requestVisibleSource, /参数校验|接口地址|服务器内部错误|请求的资源不存在/)

const errorPolicy = await import('../admin/src/utils/requestErrorPolicy.js').catch(() => ({}))
assert.equal(typeof errorPolicy.getErrorPresentation, 'function')
assert.deepEqual(errorPolicy.getErrorPresentation({ response: { status: 422, data: { message: 'SQL column invalid' } }, config: {} }), {
  message: '提交内容不完整，请检查后重试', shouldNotify: true, clearSession: false, redirectTo: ''
})
assert.equal(errorPolicy.getErrorPresentation({ response: { status: 409, data: { message: '当前账号不能停用' } }, config: {} }).message, '当前账号不能停用')
assert.equal(errorPolicy.getErrorPresentation({ response: { status: 409, data: { message: '不能停用当前登录账号' } }, config: {} }).message, '不能停用当前登录账号')
assert.equal(errorPolicy.getErrorPresentation({ response: { status: 409, data: { message: '该预约已被其他管理员处理，请刷新后重试' } }, config: {} }).message, '该预约已被其他管理员处理，请刷新后重试')
assert.equal(errorPolicy.getErrorPresentation({ response: { status: 409, data: { message: 'duplicate key admins.id=7' } }, config: {} }).message, '数据已发生变化，请刷新后重试')
assert.equal(errorPolicy.getErrorPresentation({ response: { status: 429, data: { message: 'redis limit key=admin:7' } }, config: {} }).message, '操作过快，请稍后再试')
assert.equal(errorPolicy.getErrorPresentation({ response: { status: 500 }, config: { silentError: true } }).shouldNotify, false)
assert.equal(errorPolicy.getErrorPresentation({ config: { silentError: true } }).message, '网络连接失败，请检查网络后重试')
assert.equal(errorPolicy.getErrorPresentation({ config: { silentError: true } }).shouldNotify, false)

assert.equal(
  errorPolicy.getErrorPresentation({ response: { status: 400, data: { message: 'SELECT * FROM admins failed' } }, config: {} }).message,
  errorPolicy.getErrorPresentation({ response: { status: 422 }, config: {} }).message
)
assert.equal(
  errorPolicy.getErrorPresentation({ response: { status: 409, data: { message: '预约已被处理：92831' } }, config: {} }).message,
  '预约已被处理，请刷新后重试'
)
assert.equal(
  errorPolicy.getErrorPresentation({ response: { status: 409, data: { message: '该预约已被其他管理员处理： 382' } }, config: {} }).message,
  '预约已被处理，请刷新后重试'
)

let operationLogPresenter = {}
try { operationLogPresenter = require('../server/src/utils/operationLogPresenter.js') } catch (error) {}
assert.equal(typeof operationLogPresenter.presentOperationLog, 'function')
assert.equal(typeof operationLogPresenter.buildOperationLogFilters, 'function')
const presentedLegacyLog = operationLogPresenter.presentOperationLog({
  id: 91,
  username: 'guide_a',
  real_name: '张老师',
  action: 'create_room',
  target_table: 'rooms',
  target_id: 17,
  description: '创建功能房: 舞蹈室',
  ip_hash: 'do-not-expose-this-hash',
  created_at: '2026-07-13 17:00:00'
})
assert.deepEqual(presentedLegacyLog, {
  operatorName: '张老师', action: 'create_room', actionCategory: 'create', actionLabel: '新增功能房',
  moduleLabel: '功能房管理', targetDescription: '功能房管理中的指定记录', targetId: null,
  detail: '创建功能房: 舞蹈室', sourceRecorded: true, createdAt: '2026-07-13 17:00:00'
})
const presentedHttpLog = operationLogPresenter.presentOperationLog({
  username: 'superadmin', action: 'http.post.admin.rooms', target_table: 'rooms', description: 'POST /api/v1/admin/rooms', created_at: '2026-07-13 17:01:00'
})
assert.equal(presentedHttpLog.actionLabel, '新增功能房')
assert.equal(presentedHttpLog.detail, '新增功能房')
assert.equal(operationLogPresenter.presentOperationLog({ action: 'sync_roster', target_table: 'users' }).actionLabel, '处理宿生账号')
assert.equal(operationLogPresenter.presentOperationLog({ action: 'http.post.reservation.cancel', target_table: 'reservation' }).moduleLabel, '预约管理')
assert.equal(operationLogPresenter.presentOperationLog({ action: 'http.post.poster.approve', target_table: 'poster' }).moduleLabel, '海报审核')
const realOperationSamples = [
  ['http.put.reservation_id.approve', 'reservation', 'audit', '通过预约', '预约管理'],
  ['http.post.audit.batch', 'audit', 'audit', '批量审核预约', '预约审核'],
  ['http.post.poster_id.clean', 'poster', 'audit', '清理海报', '海报审核'],
  ['http.post.poster_id.violation', 'poster', 'audit', '标记海报违规', '海报审核'],
  ['http.post.poster_id.reject', 'poster', 'audit', '驳回海报', '海报审核'],
  ['http.post.credit.violation', 'credit', 'create', '新增违规记录', '违规与信用治理'],
  ['http.put.credit.blacklist_userId', 'credit', 'operate', '更新黑名单', '违规与信用治理'],
  ['http.post.checkin', 'checkin', 'operate', '预约签到', '签到核销'],
  ['http.post.checkin.checkout', 'checkin', 'operate', '预约核销', '签到核销'],
  ['http.post.checkin.manual', 'checkin', 'operate', '人工签到', '签到核销'],
  ['http.post.checkin.patrol', 'checkin', 'operate', '巡查预约', '签到核销'],
  ['http.post.reservation_id.rebook', 'reservation', 'operate', '重新预约', '预约管理'],
  ['http.post.reservation.waitlist', 'reservation', 'operate', '加入预约候补', '预约管理'],
  ['http.delete.reservation_id.waitlist', 'reservation', 'operate', '退出预约候补', '预约管理'],
  ['http.delete.reservation_id', 'reservation', 'operate', '取消预约', '预约管理'],
  ['http.put.feedback_id.resolve', 'feedback', 'operate', '处理反馈', '反馈管理'],
  ['http.post.admin.backups_fileName.verify', 'backups', 'operate', '校验数据备份', '数据备份'],
  ['http.post.admin.archive', 'archive', 'operate', '学期归档', '系统管理'],
  ['http.put.student-admin_id.credit', 'student-admin', 'operate', '调整信用分', '宿生账号'],
  ['http.put.student_admin_id.status', 'student_admin', 'operate', '调整账号状态', '宿生账号'],
  ['http.post.auth.logout', 'auth', 'login', '退出管理后台', '登录管理'],
  ['http.post.auth.refresh', 'auth', 'login', '刷新登录状态', '登录管理'],
  ['http.post.reading-room.enter', 'reading-room', 'operate', '登记进入阅览室', '阅览室记录'],
  ['http.post.reading-room.leave', 'reading-room', 'operate', '登记离开阅览室', '阅览室记录'],
  ['http.post.reservation.check-conflict', 'reservation', 'operate', '处理预约', '预约管理'],
  ['http.post.room.compare', 'room', 'operate', '对比功能房', '功能房管理'],
  ['http.put.notification_id.read', 'notification', 'operate', '标记消息已读', '消息管理'],
  ['http.put.notification.read-all', 'notification', 'operate', '标记全部消息已读', '消息管理'],
  ['http.post.admin.upload', 'upload', 'operate', '上传管理图片', '文件管理'],
  ['http.post.admin.rooms', 'rooms', 'create', '新增功能房', '功能房管理'],
  ['http.put.admin.config', 'config', 'update', '更新系统设置', '系统管理'],
  ['http.put.admin.managers_id', 'managers', 'update', '更新管理账号', '管理账号'],
  ['http.delete.admin.announcements_id', 'announcements', 'delete', '删除或停用公告', '公告管理'],
  ['http.post.admin.seats.batch', 'seats', 'create', '批量新增座位', '座位管理'],
  ['http.post.account-batch', 'account-batch', 'create', '批量新增账号', '批量账号导入'],
  ['http.post.admin.backup', 'backup', 'create', '创建数据备份', '数据备份'],
  ['batch_create_seats', 'seats', 'create', '批量新增座位', '座位管理']
]
for (const [action, targetTable, category, actionLabel, moduleLabel] of realOperationSamples) {
  const presented = operationLogPresenter.presentOperationLog({ action, target_table: targetTable })
  assert.equal(presented.actionCategory, category, action)
  assert.equal(presented.actionLabel, actionLabel, action)
  assert.equal(presented.moduleLabel, moduleLabel, action)
  assert.equal(operationLogPresenter.actionMatchesCategory(action, category), true, action)
  const categoryFilter = operationLogPresenter.buildOperationLogFilters({ category })
  assert.match(categoryFilter.clause, /o\.action LIKE \?/, action)
  assert.equal(operationLogPresenter.actionMatchesFilter(action, categoryFilter), true, action)
  const matchingRule = operationLogPresenter.ACTION_RULES.find(rule =>
    rule.patterns.some(pattern => operationLogPresenter.matchesLike(action, pattern)))
  assert.equal(matchingRule.category, category, action)
  assert.ok(matchingRule.patterns.some(pattern =>
    categoryFilter.params.includes(pattern) && operationLogPresenter.matchesLike(action, pattern)), action)
}
assert.equal(operationLogPresenter.presentOperationLog({ action: 'command.unknown', target_table: 'reading-room' }).actionLabel, '处理阅览记录')
assert.equal(operationLogPresenter.presentOperationLog({ action: 'command.unknown', target_table: 'reading_room' }).moduleLabel, '阅览室记录')
assert.equal(operationLogPresenter.presentOperationLog({ action: 'command.unknown', target_table: 'credit' }).moduleLabel, '违规与信用治理')
assert.equal(operationLogPresenter.presentOperationLog({ action: 'command.unknown', target_table: 'account-batch' }).moduleLabel, '批量账号导入')
assert.equal(operationLogPresenter.presentOperationLog({ action: 'command.unknown', target_table: 'account_batch' }).moduleLabel, '批量账号导入')
assert.match(logsSource, /label="业务处理"\s+value="operate"/)
assert.match(logsSource, /operate:\s*['"]warning['"]/)
const createFilter = operationLogPresenter.buildOperationLogFilters({ category: 'create', operator: '张' })
assert.match(createFilter.clause, /o\.action LIKE \?/)
assert.match(createFilter.clause, /a\.real_name LIKE \?/)
assert.ok(createFilter.params.includes('create_%'))
assert.ok(createFilter.params.includes('http.post.admin.rooms'))
assert.ok(!createFilter.params.includes('http.post.%'))
assert.ok(createFilter.params.includes('%张%'))
assert.match(createFilter.clause, /o\.action NOT LIKE \?/)
assert.ok(createFilter.params.includes('%approve%'))

const rawVisibleFallback = /(?:typeMap|typeLabels|statusMap|statusLabels|roleMap|actionMap)\[[^\]]+\]\?*\.?(?:label)?\s*\|\|\s*(?:row|currentFeedback|currentRow)\.(?:status|role|type|action|module)/
for (const fileUrl of visibleCopyFiles) {
  const source = readFileSync(fileUrl, 'utf8')
  assert.doesNotMatch(visibleCopyFromVue(source), rawVisibleFallback, `${fileUrl.pathname} can expose an internal value through a map fallback`)
  assert.doesNotMatch(source, /['"]\u9884\u7ea6ID['"]\s*:/, `${fileUrl.pathname} exports an internal identifier under a user-facing heading`)
}

const legacyAdminsSource = readFileSync(new URL('../admin/src/views/System/Admins.vue', import.meta.url), 'utf8')
assert.doesNotMatch(legacyAdminsSource, /label:\s*['"]\u7ba1\u7406\u5458['"]|<el-option label="\u7ba1\u7406\u5458"/)
assert.match(legacyAdminsSource, /\u5bfc\u751f\u7ba1\u7406\u5458/)

const loadStatePages = [
  ['FeedbackView.vue', 'feedbacks', 'loadFeedbacks'],
  ['System/Logs.vue', 'tableData', 'loadData'],
  ['Room/Manage.vue', 'tableData', 'loadData'],
  ['Reservation/AllList.vue', 'tableData', 'loadData']
]
for (const [relativePath, listName, retryName] of loadStatePages) {
  const source = readFileSync(new URL(`../admin/src/views/${relativePath}`, import.meta.url), 'utf8')
  const template = source.split('<script setup>')[0] || ''
  assert.match(source, /const loadError = ref\(''\)/, `${relativePath} needs explicit list load error state`)
  assert.match(template, new RegExp(`v-if="loadError"[\\s\\S]{0,240}@click="${retryName}"`), `${relativePath} needs a retryable error notice`)
  assert.match(template, new RegExp(`!loading && !loadError && !${listName}\\.length`), `${relativePath} needs an empty state distinct from load failure`)
  assert.match(source, /createLatestRequestCoordinator/, `${relativePath} must coordinate list requests`)
  assert.match(source, /\.run\(/, `${relativePath} must run list loads through the coordinator`)
  assert.match(source, /\.invalidate\(\)/, `${relativePath} must invalidate list loads when unmounted`)
  assert.match(source, /onBeforeUnmount/, `${relativePath} must invalidate on unmount`)
  assert.match(source, /silentError/, `${relativePath} must suppress the duplicate global toast while its error bar is active`)
}

const expectedNavigationGroups = {
  admin: ['今日工作', '预约与使用', '空间运行', '书院治理', '数据与报表'],
  counselor: ['今日工作', '预约与使用', '空间运行', '书院治理', '数据与报表', '内容审核'],
  super_admin: ['今日工作', '预约与使用', '空间运行', '书院治理', '数据与报表', '内容审核', '系统管理']
}

for (const [role, expectedGroups] of Object.entries(expectedNavigationGroups)) {
  const navigation = buildNavigation(role)
  assert.deepEqual(navigation.map(group => group.title), expectedGroups)
  assert.ok(navigation.every(group => group.key && group.icon && group.children.length), `${role} should not receive an empty group`)
  assert.equal(new Set(navigation.flatMap(group => group.children.map(item => item.name))).size, navigation.flatMap(group => group.children).length)
  for (const group of navigation) {
    for (const item of group.children) {
      assert.equal(getNavigationSectionForRoute(item.name), group.title, `${role}/${item.name} breadcrumb should match its navigation group`)
    }
  }
}
assert.ok(adminChildren.every(route => !Object.hasOwn(route.meta, 'parent')), 'route metadata should not duplicate navigation section titles')

const adminNavigation = buildNavigation('admin')
assert.ok(!adminNavigation.some(group => group.title === '系统管理'))
assert.ok(!adminNavigation.flatMap(group => group.children).some(item => item.name === 'AccountManage'))
const counselorNavigation = buildNavigation('counselor')
const counselorReservationNames = counselorNavigation.find(group => group.title === '预约与使用').children.map(item => item.name)
assert.ok(counselorReservationNames.indexOf('CounselorPending') < counselorReservationNames.indexOf('ReservationPending'))
assert.equal(counselorNavigation.find(group => group.title === '内容审核').children[0].name, 'PosterPending')
const superNavigation = buildNavigation('super_admin')
assert.ok(superNavigation.find(group => group.title === '系统管理').children.some(item => item.name === 'AccountManage'))
const superSystemNames = superNavigation.find(group => group.title === '系统管理').children.map(item => item.name)
assert.ok(superSystemNames.indexOf('AccountManage') < superSystemNames.indexOf('SystemLogs'))
assert.ok(superSystemNames.indexOf('RulesConfig') < superSystemNames.indexOf('SystemBackup'))

const navigationState = await import('../admin/src/utils/navigationState.js').catch(() => ({}))
assert.equal(typeof navigationState.getNavigationStorageKey, 'function')
assert.equal(typeof navigationState.loadOpenGroups, 'function')
assert.equal(typeof navigationState.saveOpenGroups, 'function')
assert.equal(typeof navigationState.ensureActiveGroup, 'function')
assert.equal(typeof navigationState.getWorkspaceLabel, 'function')
assert.equal(typeof navigationState.createNavigationMenuSync, 'function')
assert.equal(typeof navigationState.findActiveGroupKey, 'function')

const memory = new Map()
const storage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value)
}
const firstAdmin = { id: 11, username: 'guide-a', role: 'admin' }
const secondAdmin = { id: 12, username: 'guide-b', role: 'admin' }
assert.notEqual(navigationState.getNavigationStorageKey(firstAdmin), navigationState.getNavigationStorageKey(secondAdmin))
navigationState.saveOpenGroups(storage, firstAdmin, ['today', 'reservation'])
navigationState.saveOpenGroups(storage, secondAdmin, ['space'])
assert.deepEqual(navigationState.loadOpenGroups(storage, firstAdmin), ['today', 'reservation'])
assert.deepEqual(navigationState.loadOpenGroups(storage, secondAdmin), ['space'])
assert.ok(navigationState.loadOpenGroups(storage, { id: 13, role: 'counselor' }).includes('reservation'))
assert.deepEqual(
  navigationState.ensureActiveGroup(['today'], counselorNavigation, '/poster/pending'),
  ['today', 'content']
)
assert.equal(navigationState.getWorkspaceLabel('admin'), '导生工作区')
assert.equal(navigationState.getWorkspaceLabel('counselor'), '辅导员工作区')
assert.equal(navigationState.getWorkspaceLabel('super_admin'), '超级管理工作区')

const menuCalls = []
const menu = {
  open: key => menuCalls.push(['open', key]),
  close: key => menuCalls.push(['close', key])
}
const menuSync = navigationState.createNavigationMenuSync()
assert.equal(typeof menuSync.markClosed, 'function')
assert.equal(typeof menuSync.markOpen, 'function')
menuSync.sync(menu, ['today', 'reservation'], 'today')
assert.deepEqual(menuCalls, [['open', 'today'], ['open', 'reservation']])
menuCalls.length = 0
menuSync.sync(menu, ['today'], 'space')
assert.deepEqual(menuCalls, [['close', 'reservation'], ['open', 'space']])
menuCalls.length = 0
menuSync.sync(menu, ['today', 'space'], 'space', { force: true })
assert.deepEqual(menuCalls, [['open', 'today'], ['open', 'space']])
menuCalls.length = 0
menuSync.sync(menu, ['content'], 'content', { force: true })
assert.deepEqual(menuCalls, [['close', 'today'], ['close', 'space'], ['open', 'content']])
menuCalls.length = 0
menuSync.markClosed('content')
menuSync.sync(menu, ['today'], 'content')
assert.deepEqual(menuCalls, [['open', 'today'], ['open', 'content']])
assert.equal(navigationState.findActiveGroupKey(counselorNavigation, '/room/monitor'), 'space')
assert.equal(navigationState.findActiveGroupKey(counselorNavigation, '/not-found'), '')

const layoutSource = readFileSync(new URL('../admin/src/components/Layout.vue', import.meta.url), 'utf8')
assert.match(layoutSource, /<el-sub-menu/)
assert.match(layoutSource, /ref="menuRef"/)
assert.match(layoutSource, /:default-openeds="openGroups"/)
assert.match(layoutSource, /@open="handleGroupOpen"/)
assert.match(layoutSource, /@close="handleGroupClose"/)
assert.match(layoutSource, /workspaceLabel/)
assert.match(layoutSource, /ensureActiveGroup/)
assert.match(layoutSource, /navigationState/)
assert.match(layoutSource, /createNavigationMenuSync/)
assert.match(layoutSource, /menuSync\.sync/)
assert.match(layoutSource, /nextTick/)
assert.match(layoutSource, /watch\(\s*\(\) => isCollapse\.value/)
assert.match(layoutSource, /currentParent/)
assert.match(layoutSource, /getNavigationSectionForRoute/)
assert.match(layoutSource, /<el-button[^>]+class="collapse-btn"/)
assert.match(layoutSource, /:aria-label="collapseButtonLabel"/)
assert.match(layoutSource, /:title="collapseButtonLabel"/)

const importWorkbook = XLSX.utils.book_new()
const importSheet = XLSX.utils.aoa_to_sheet([
  ['\u8d26\u53f7', '\u59d3\u540d', '\u5bc6\u7801', '\u89d2\u8272', '\u7ba1\u7406\u8303\u56f4', '\u697c\u680b', '\u7535\u8bdd'],
  [123, ' \u5f20\u4e09 ', 45, ' \u5bfc\u751f\u7ba1\u7406\u5458 ', '', ' C\u5ea7 ', 678]
])
importSheet.A2.z = '000000'
importSheet.C2.z = '000000'
importSheet.G2.z = '00000000000'
XLSX.utils.book_append_sheet(importWorkbook, importSheet, '\u8d26\u53f7')
const importBuffer = XLSX.write(importWorkbook, { type: 'buffer', bookType: 'xlsx' })
const displayedImportRows = readAccountImportWorkbook(XLSX, importBuffer)
assert.equal(displayedImportRows.length, 1)
assert.equal(displayedImportRows[0]['\u8d26\u53f7'], '000123')
assert.equal(displayedImportRows[0]['\u5bc6\u7801'], '000045')
assert.equal(displayedImportRows[0]['\u7535\u8bdd'], '00000000678')
const normalizedImportRows = normalizeAccountImportRows(displayedImportRows, 'manager')
assert.deepEqual(normalizedImportRows[0], {
  accountType: 'manager', username: '000123', realName: '\u5f20\u4e09', password: '000045', role: 'admin',
  scopeType: '', buildingId: '', buildingName: 'C\u5ea7', phone: '00000000678'
})
assert.deepEqual(normalizeAccountImportRows([{
  '\u8d26\u53f7': 0, '\u59d3\u540d': ' \u674e\u56db ', '\u5bc6\u7801': 0, '\u697c\u680b': 0, '\u7535\u8bdd': 0
}], 'student')[0], {
  accountType: 'student', username: '0', realName: '\u674e\u56db', password: '0', role: 'student',
  scopeType: '', buildingId: '', buildingName: '0', phone: '0'
})

const timelineView = buildTimelineView({
  openStartTime: '08:00',
  openEndTime: '22:30',
  timeline: [
    { time: '08:00', endTime: '08:30', status: 'available' },
    { time: '08:30', endTime: '09:00', status: 'occupied', userName: '张三', purpose: '课题讨论', reservationId: 18 },
    { time: '09:00', endTime: '09:30', status: 'myReservation', reservationId: 19 },
    { time: '09:30', endTime: '10:00', status: 'checked_in', reservationId: 20 },
    { time: '10:00', endTime: '10:30', status: 'unavailable' },
    { time: '10:30', endTime: '11:00', status: 'unexpected' }
  ]
})

assert.deepEqual(timelineView.summary, { total: 6, reservationCount: 3, busySlotCount: 3, reservationCountReliable: true, isAllAvailable: false })
assert.deepEqual(timelineView.slots.map(slot => slot.label), ['空闲', '已预约', '使用中', '使用中', '维护', '状态未知'])
assert.equal(timelineView.slots[1].purpose, '课题讨论')
assert.equal(timelineView.slots[1].userName, '张三')
assert.equal(timelineView.slots[1].reservationId, 18)
assert.equal(timelineView.openStartTime, '08:00')
assert.equal(timelineView.openEndTime, '22:30')
assert.equal(timelineView.message, '')

const allAvailableView = buildTimelineView({
  open_start_time: '07:30',
  open_end_time: '21:00',
  slots: [
    { time: '07:30', endTime: '08:00', status: 'available' },
    { time: '08:00', endTime: '08:30', status: 'available' }
  ]
})
assert.equal(allAvailableView.message, '今日暂无预约，当前时段均可使用')
assert.equal(allAvailableView.slots.length, 2)
assert.equal(allAvailableView.openStartTime, '07:30')
assert.equal(allAvailableView.openEndTime, '21:00')

const monitorSource = readFileSync(new URL('../admin/src/views/Room/Monitor.vue', import.meta.url), 'utf8')
const monitorTemplate = monitorSource.match(/<template>[\s\S]*?<\/template>/)?.[0] || ''
assert.match(monitorSource, /timelineView\.message/)
assert.match(monitorSource, /timelineError/)
assert.match(monitorSource, /retryTimeline/)
assert.match(monitorSource, /\u91cd\u8bd5/)
assert.match(monitorSource, /createTimelineRequestCoordinator/)
assert.match(monitorSource, /timelineRequestCoordinator\.run/)
assert.match(monitorSource, /timelineRequestCoordinator\.invalidate/)
assert.doesNotMatch(monitorTemplate, /WebSocket|Token|\u4ee4\u724c/i)

const accountSource = readFileSync(new URL('../admin/src/views/Account/Index.vue', import.meta.url), 'utf8')
const accountTemplate = accountSource.split('<script setup>')[0] || ''
assert.match(accountSource, /accountType:\s*activeTab\.value === 'manager' \? 'manager' : 'student'/)
assert.doesNotMatch(accountTemplate, /label="\u8d26\u53f7ID"|prop="id"/)
assert.doesNotMatch(accountTemplate, /\u4e0d\u540c\u8d26\u53f7\u5199\u5165\u4e0d\u540c\u6570\u636e\u8868|users \u8868|admins \u8868|\u83dc\u5355\u548c\u64cd\u4f5c\u5df2\u6309\u89d2\u8272\u88c1\u526a/)
assert.match(accountTemplate, /\u6700\u8fd1\u767b\u5f55/)
assert.match(accountSource, /isCurrentAccount/)
assert.match(accountSource, /row\.scopeLabel/)
assert.match(accountTemplate, /activeTab === 'student'[\s\S]{0,300}v-model="form\.buildingId"/)
assert.match(accountSource, /createLatestRequest/)
assert.match(accountSource, /accountRequest\.run/)
assert.match(accountSource, /accountRequest\.invalidate/)
assert.match(accountSource, /onBeforeUnmount/)
assert.match(accountSource, /isEditingCurrentAccount/)
assert.match(accountSource, /buildingName/)
assert.match(accountSource, /scopeType/)
assert.match(accountTemplate, /\u7ba1\u7406\u8d26\u53f7\u6a21\u677f[\s\S]{0,260}\u7ba1\u7406\u8303\u56f4/)
assert.match(accountSource, /normalizeAccountImportRows/)
assert.match(accountSource, /readAccountImportWorkbook/)
assert.match(accountSource, /importResult/)
assert.match(accountTemplate, /\u6210\u529f\u9879\u5df2\u4fdd\u5b58\uff0c\u65e0\u9700\u91cd\u590d\u5bfc\u5165/)
assert.match(accountTemplate, /failure\.rowNumber/)
assert.match(accountTemplate, /failure\.username/)
assert.match(accountTemplate, /failure\.reason/)
assert.match(accountSource, /if\s*\(failures\.length\s*===\s*0\)[\s\S]{0,100}importDialogVisible\.value\s*=\s*false/)
assert.match(accountSource, /clearImportSelection/)
assert.match(accountTemplate, /:disabled="actionSubmitting\s*\|\|\s*!!importResult"/)

const importControllerSource = readFileSync(new URL('../server/src/controllers/accountImportController.js', import.meta.url), 'utf8')
const accountControllerSource = readFileSync(new URL('../server/src/controllers/accountController.js', import.meta.url), 'utf8')
assert.match(importControllerSource, /require\('\.\.\/utils\/adminScope'\)/)
assert.match(accountControllerSource, /require\('\.\.\/utils\/adminScope'\)/)
assert.match(importControllerSource, /scope_type/)
assert.match(importControllerSource, /FROM buildings/)
assert.doesNotMatch(importControllerSource, /SELECT id, name, code FROM buildings|building\.code/)
assert.doesNotMatch(importControllerSource, /req\.adminScope[\s\S]{0,160}createStudent|createStudent[\s\S]{0,500}req\.adminScope/)

const adminRoutesSource = readFileSync(new URL('../server/src/routes/admin.js', import.meta.url), 'utf8')
assert.match(adminRoutesSource, /router\.delete\('\/managers\/:id',[\s\S]*accountController\.deleteAccount/)

const controllerSource = readFileSync(new URL('../server/src/controllers/roomController.js', import.meta.url), 'utf8')
for (const field of ['reservationId', 'userName', 'purpose']) assert.match(controllerSource, new RegExp(field))

let studyMode = false
let accountImportMode = false
let operationLogMode = false
const operationLogQueries = []
let importedStudentInsert = null
const mockDb = {
  async query(sql, params) {
    if (operationLogMode && sql.startsWith('SELECT o.*')) {
      operationLogQueries.push({ sql, params })
      return [[{
        id: 202, username: 'guide_a', real_name: '张老师', action: 'http.post.admin.rooms', target_table: 'rooms', target_id: 17,
        description: 'POST /api/v1/admin/rooms', ip_hash: 'private-hash', created_at: '2026-07-13 17:05:00'
      }]]
    }
    if (operationLogMode && sql.startsWith('SELECT COUNT(*) as total FROM operation_logs')) {
      operationLogQueries.push({ sql, params })
      return [[{ total: 1 }]]
    }
    if (accountImportMode && sql.includes('FROM buildings')) return [[
      { id: 1, name: 'B\u5ea7' },
      { id: 2, name: 'C\u5ea7' }
    ]]
    if (accountImportMode && sql.includes('SELECT id FROM users')) return [[]]
    if (accountImportMode && sql.startsWith('INSERT INTO users')) {
      importedStudentInsert = { sql, params }
      return [{ insertId: 901 }]
    }
    if (studyMode && sql.includes('FROM rooms WHERE id')) return [[{ id: 8, name: '自习室', type: 'study_room', capacity: 1, open_start_time: '08:00', open_end_time: '08:30' }]]
    if (studyMode && sql.includes('FROM seats')) return [[{ id: 1, status: 'available', seat_number: 'A1', row_num: 1, col_num: 1 }]]
    if (studyMode && sql.includes('FROM reservations')) return [[{ id: 55, user_id: 5, seat_id: 1, start_time: '08:00', end_time: '08:30', status: 'approved' }]]
    if (sql.includes('FROM rooms WHERE id')) return [[{ id: 7, name: '讨论室', type: 'seminar_room', capacity: 6, open_start_time: '08:00', open_end_time: '09:00' }]]
    if (sql.includes('FROM seats')) return [[]]
    if (sql.includes('FROM reservations')) return [[{
      id: 42,
      user_id: 5,
      start_time: '08:00',
      end_time: '08:30',
      status: 'checked_in',
      real_name: '李四',
      purpose: '小组会议'
    }]]
    throw new Error(`unexpected query: ${sql}`)
  }
}
const databasePath = require.resolve('../server/src/config/database.js')
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: mockDb, children: [], paths: [] }
const roomController = require('../server/src/controllers/roomController.js')
let responseBody
const response = { status() { return this }, json(body) { responseBody = body; return body } }
await roomController.timeline({ params: { id: '7' }, query: { date: '2026-07-13' }, user: { id: 99, role: 'admin' } }, response)
assert.equal(responseBody.code, 200)
assert.deepEqual(responseBody.data.timeline[0], {
  time: '08:00', endTime: '08:30', status: 'checked_in', availableCount: 5, totalCount: 6,
  reservationId: 42, userName: '李四', purpose: '小组会议'
})
await roomController.timeline({ params: { id: '7' }, query: { date: '2026-07-13' }, user: { id: 99, role: 'student' } }, response)
assert.equal(responseBody.data.timeline[0].reservationId, null)
assert.equal(responseBody.data.timeline[0].userName, '')
assert.equal(responseBody.data.timeline[0].purpose, '')
studyMode = true
await roomController.timeline({ params: { id: '8' }, query: { date: '2026-07-13' }, user: { id: 99, role: 'admin' } }, response)
assert.deepEqual(responseBody.data.timeline[0].reservationIds, [55])

accountImportMode = true
const accountImportController = require('../server/src/controllers/accountImportController.js')
await accountImportController.importAccounts({
  body: { rows: [{
    accountType: 'student', username: '2024999099', password: '299099', realName: '\u697c\u680b\u8303\u56f4\u9a8c\u8bc1',
    role: 'student', scopeType: 'global', buildingName: 'C\u5ea7', phone: '13900009099'
  }] },
  user: { id: 2, role: 'super_admin' },
  adminScope: { isGlobal: false, buildingId: 1 }
}, response)
assert.equal(responseBody.code, 200)
assert.equal(responseBody.data.successCount, 1)
assert.ok(importedStudentInsert)
assert.equal(importedStudentInsert.params[6], 2)
assert.equal(importedStudentInsert.params[7], '13900009099')
accountImportMode = false

operationLogMode = true
const adminController = require('../server/src/controllers/adminController.js')
await adminController.operationLogs({ query: { page: 1, pageSize: 20, operator: '张', category: 'create' } }, response)
assert.equal(responseBody.code, 200)
assert.equal(responseBody.data.list[0].operatorName, '张老师')
assert.equal(responseBody.data.list[0].actionLabel, '新增功能房')
assert.equal(responseBody.data.list[0].moduleLabel, '功能房管理')
assert.equal(responseBody.data.list[0].sourceRecorded, true)
assert.equal(responseBody.data.list[0].targetId, null)
assert.doesNotMatch(JSON.stringify(responseBody.data.list[0]), /private-hash|target_id|ip_hash/)
assert.equal(operationLogQueries.length, 2)
assert.ok(operationLogQueries[0].params.includes('http.post.admin.rooms'))
assert.ok(operationLogQueries[1].params.includes('%张%'))
operationLogMode = false

const deduplicatedView = buildTimelineView({
  timeline: [
    { time: '13:00', status: 'occupied', reservationId: 77 },
    { time: '13:30', status: 'occupied', reservationId: 77 },
    { time: '14:00', status: 'checked_in', reservationIds: [77, 88] },
    { time: '14:30', status: 'occupied' }
  ]
})
assert.equal(deduplicatedView.summary.reservationCount, 2)
assert.equal(deduplicatedView.summary.busySlotCount, 4)
assert.equal(deduplicatedView.summary.reservationCountReliable, false)

const gate = createLatestRequestGate()
const firstRequest = gate.begin()
const secondRequest = gate.begin()
assert.equal(gate.isLatest(firstRequest), false)
assert.equal(gate.isLatest(secondRequest), true)
gate.invalidate()
assert.equal(gate.isLatest(secondRequest), false)

const orderingGate = createLatestRequestGate()
let visibleRoom = ''
let finishFirst
let finishSecond
const firstResult = new Promise(resolve => { finishFirst = resolve })
const secondResult = new Promise(resolve => { finishSecond = resolve })
async function applyLatest(resultPromise) {
  const requestId = orderingGate.begin()
  const roomName = await resultPromise
  if (orderingGate.isLatest(requestId)) visibleRoom = roomName
}
const pendingFirst = applyLatest(firstResult)
const pendingSecond = applyLatest(secondResult)
finishSecond('B')
await pendingSecond
finishFirst('A')
await pendingFirst
assert.equal(visibleRoom, 'B')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function latestCoordinatorHarness() {
  const requests = new Map()
  const state = { loading: false, value: '', error: '', writes: 0 }
  const coordinator = createLatestRequestCoordinator({
    load: key => requests.get(key).promise,
    onStart: () => { state.loading = true; state.error = ''; state.writes += 1 },
    onSuccess: value => { state.value = value; state.writes += 1 },
    onError: error => { state.error = error.message; state.writes += 1 },
    onFinish: () => { state.loading = false; state.writes += 1 }
  })
  return { requests, state, coordinator }
}

const latestSuccess = latestCoordinatorHarness()
latestSuccess.requests.set('old', deferred())
latestSuccess.requests.set('new', deferred())
const oldSuccess = latestSuccess.coordinator.run('old')
const newSuccess = latestSuccess.coordinator.run('new')
latestSuccess.requests.get('old').resolve('old value')
await oldSuccess
assert.deepEqual(latestSuccess.state, { loading: true, value: '', error: '', writes: 2 })
latestSuccess.requests.get('new').resolve('new value')
await newSuccess
assert.deepEqual(latestSuccess.state, { loading: false, value: 'new value', error: '', writes: 4 })

const latestFailure = latestCoordinatorHarness()
latestFailure.requests.set('old', deferred())
latestFailure.requests.set('new', deferred())
const oldFailure = latestFailure.coordinator.run('old')
const newAfterFailure = latestFailure.coordinator.run('new')
latestFailure.requests.get('old').reject(new Error('obsolete error'))
await oldFailure
assert.deepEqual(latestFailure.state, { loading: true, value: '', error: '', writes: 2 })
latestFailure.requests.get('new').resolve('new value')
await newAfterFailure
assert.deepEqual(latestFailure.state, { loading: false, value: 'new value', error: '', writes: 4 })

for (const outcome of ['success', 'failure']) {
  const invalidatedLatest = latestCoordinatorHarness()
  invalidatedLatest.requests.set('request', deferred())
  const pending = invalidatedLatest.coordinator.run('request')
  invalidatedLatest.coordinator.invalidate()
  const writesBeforeSettlement = invalidatedLatest.state.writes
  if (outcome === 'success') invalidatedLatest.requests.get('request').resolve('ignored')
  else invalidatedLatest.requests.get('request').reject(new Error('ignored'))
  await pending
  assert.equal(invalidatedLatest.state.writes, writesBeforeSettlement)
}

function coordinatorHarness() {
  const requests = new Map()
  const state = { loading: false, value: '', error: '', writes: 0 }
  const coordinator = createTimelineRequestCoordinator({
    load: key => requests.get(key).promise,
    onStart: () => { state.loading = true; state.error = ''; state.writes += 1 },
    onSuccess: value => { state.value = value; state.writes += 1 },
    onError: error => { state.error = error.message; state.writes += 1 },
    onFinish: () => { state.loading = false; state.writes += 1 }
  })
  return { requests, state, coordinator }
}

function accountCoordinatorHarness() {
  const requests = new Map()
  const notices = []
  const state = { loading: false, tab: '', rows: [], total: 0 }
  const accountRequest = createLatestRequest()
  function load(tab) {
    state.loading = true
    return accountRequest.run(requests.get(tab).promise, result => {
      state.tab = result.tab
      state.rows = result.rows
      state.total = result.total
      state.loading = false
    }, error => {
      notices.push(error.message)
      state.loading = false
    })
  }
  return { requests, notices, state, load, invalidate: () => accountRequest.invalidate() }
}

const accountOrdering = accountCoordinatorHarness()
accountOrdering.requests.set('student', deferred())
accountOrdering.requests.set('manager', deferred())
const oldStudentList = accountOrdering.load('student')
const newManagerList = accountOrdering.load('manager')
accountOrdering.requests.get('student').resolve({ tab: 'student', rows: ['old'], total: 1 })
await oldStudentList
assert.deepEqual(accountOrdering.state, { loading: true, tab: '', rows: [], total: 0 })
accountOrdering.requests.get('manager').resolve({ tab: 'manager', rows: ['new'], total: 1 })
await newManagerList
assert.deepEqual(accountOrdering.state, { loading: false, tab: 'manager', rows: ['new'], total: 1 })

const accountFailure = accountCoordinatorHarness()
accountFailure.requests.set('student', deferred())
accountFailure.requests.set('manager', deferred())
const obsoleteFailure = accountFailure.load('student')
const currentManager = accountFailure.load('manager')
accountFailure.requests.get('student').reject(new Error('obsolete failure'))
await obsoleteFailure
assert.deepEqual(accountFailure.notices, [])
assert.equal(accountFailure.state.loading, true)
accountFailure.requests.get('manager').resolve({ tab: 'manager', rows: ['manager'], total: 1 })
await currentManager
assert.deepEqual(accountFailure.state, { loading: false, tab: 'manager', rows: ['manager'], total: 1 })

const accountUnmounted = accountCoordinatorHarness()
accountUnmounted.requests.set('student', deferred())
const unmountedRequest = accountUnmounted.load('student')
accountUnmounted.invalidate()
accountUnmounted.requests.get('student').resolve({ tab: 'student', rows: ['stale'], total: 1 })
await unmountedRequest
assert.deepEqual(accountUnmounted.state, { loading: true, tab: '', rows: [], total: 0 })

const successOrder = coordinatorHarness()
successOrder.requests.set('A', deferred())
successOrder.requests.set('B', deferred())
const slowA = successOrder.coordinator.run('A')
const fastB = successOrder.coordinator.run('B')
successOrder.requests.get('A').resolve('A')
await slowA
assert.equal(successOrder.state.value, '')
assert.equal(successOrder.state.loading, true)
successOrder.requests.get('B').resolve('B')
await fastB
assert.deepEqual(successOrder.state, { loading: false, value: 'B', error: '', writes: 4 })

const staleFailure = coordinatorHarness()
staleFailure.requests.set('A', deferred())
staleFailure.requests.set('B', deferred())
const failingA = staleFailure.coordinator.run('A')
const succeedingB = staleFailure.coordinator.run('B')
staleFailure.requests.get('A').reject(new Error('A failed'))
await failingA
assert.equal(staleFailure.state.error, '')
assert.equal(staleFailure.state.loading, true)
staleFailure.requests.get('B').resolve('B')
await succeedingB
assert.deepEqual(staleFailure.state, { loading: false, value: 'B', error: '', writes: 4 })

for (const outcome of ['success', 'failure']) {
  const invalidated = coordinatorHarness()
  invalidated.requests.set('A', deferred())
  const pending = invalidated.coordinator.run('A')
  invalidated.coordinator.invalidate()
  const writesBeforeSettlement = invalidated.state.writes
  if (outcome === 'success') invalidated.requests.get('A').resolve('A')
  else invalidated.requests.get('A').reject(new Error('stale failure'))
  await pending
  assert.equal(invalidated.state.writes, writesBeforeSettlement)
}

console.log('admin monitor timeline checks passed')
