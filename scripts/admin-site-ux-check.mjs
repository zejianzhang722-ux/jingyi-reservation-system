import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

import {
  beginLoad,
  createAsyncState,
  failLoad,
  finishLoad
} from '../admin/src/utils/asyncState.js'
import { mergeDashboardPayload } from '../admin/src/utils/adminRolePolicy.js'
import { createLatestRequest } from '../admin/src/utils/latestRequest.js'
import { createActionLock, isConfirmationCancel, normalizeRejectionReason, runLockedConfirmedAction } from '../admin/src/utils/approvalState.js'
import { deriveStatsSummary, formatNoshowRate, getRecentDateRange } from '../admin/src/utils/statsFormatters.js'
import { createChartRenderScheduler } from '../admin/src/utils/chartRenderScheduler.js'

const fixedToday = new Date('2026-07-12T12:00:00+08:00')
assert.deepEqual(getRecentDateRange(fixedToday), ['2026-07-06', '2026-07-12'], 'statistics should default to the inclusive recent seven days')
assert.deepEqual(deriveStatsSummary({
  trend: { total: [3, 5], used: [2, 4], cancelled: [0, 1] },
  usage: { rooms: ['琴房', '舞蹈房'], rates: [50, 70] },
  peak: { hours: ['09:00', '14:00'], counts: [2, 6] },
  noshow: { labels: ['琴房', '舞蹈房'], rates: [10, 20] }
}), { reservationCount: 8, averageUsageRate: 60, busiestHour: '14:00', noshowRate: null })
assert.deepEqual(formatNoshowRate({ roomNoshowStats: [
  { name: '琴房', noshow_count: 1, reservation_count: 1 },
  { name: '舞蹈房', noshow_count: 9, reservation_count: 99 }
] }).rates, [100, 9], 'room no-show rate must use each room reservation count, not its share of no-shows')
assert.deepEqual(formatNoshowRate({ roomNoshowStats: [{ name: '琴房', noshow_count: 1 }] }).rates, [], 'no-show rates without denominators must be unavailable')
assert.equal(deriveStatsSummary({ trend: { total: [1, 9], noshow: [1, 0] } }).noshowRate, 10, 'overall no-show rate must be total no-shows divided by total reservations')
assert.equal(deriveStatsSummary({ trend: { total: [1, 9] } }).noshowRate, null, 'missing no-show totals must remain unavailable')

function createFakeRaf() {
  let nextId = 0
  const callbacks = new Map()
  return {
    request(callback) { callbacks.set(++nextId, callback); return nextId },
    cancel(id) { callbacks.delete(id) },
    flush() { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback()) }
  }
}
const fakeRaf = createFakeRaf()
const scheduler = createChartRenderScheduler(fakeRaf.request, fakeRaf.cancel)
const rendered = []
scheduler.schedule(() => rendered.push('old'))
scheduler.cancelAll()
fakeRaf.flush()
assert.deepEqual(rendered, [], 'refresh must cancel queued chart renders')
scheduler.schedule(() => rendered.push('unmounted'))
scheduler.destroy()
fakeRaf.flush()
assert.deepEqual(rendered, [], 'unmount must prevent queued chart renders')

assert.equal(normalizeRejectionReason('  申请信息不完整，请补充后重新提交  '), '申请信息不完整，请补充后重新提交')
assert.throws(() => normalizeRejectionReason(''), /退回原因/)
assert.throws(() => normalizeRejectionReason('   '), /退回原因/)
assert.throws(() => normalizeRejectionReason('批量退回'), /具体/)
const actionLock = createActionLock()
const firstToken = actionLock.acquire()
assert.ok(firstToken, 'first action must acquire the lock')
assert.equal(actionLock.locked, true)
assert.equal(actionLock.acquire(), null, 'a concurrent action must not acquire the lock')
assert.equal(actionLock.release(Symbol('not-owner')), false, 'a non-owner must not release the active action')
assert.equal(actionLock.locked, true, 'the first request must remain locked')
assert.equal(actionLock.release(firstToken), true)
assert.equal(actionLock.locked, false)
let finishFirstAction
const pendingConfirmation = new Promise(resolve => { finishFirstAction = resolve })
async function runLockedAction(lock, confirmation) {
  const token = lock.acquire()
  if (!token) return false
  try {
    await confirmation
    return true
  } finally {
    lock.release(token)
  }
}
const concurrentLock = createActionLock()
const firstAction = runLockedAction(concurrentLock, pendingConfirmation)
assert.equal(await runLockedAction(concurrentLock, Promise.resolve()), false, 'second confirmation must be rejected while the first is unfinished')
assert.equal(concurrentLock.release(Symbol('second-action')), false, 'rejected action cannot unlock the unfinished request')
assert.equal(concurrentLock.locked, true)
finishFirstAction()
assert.equal(await firstAction, true)
assert.equal(concurrentLock.locked, false)
assert.equal(isConfirmationCancel('cancel'), true)
assert.equal(isConfirmationCancel('close'), true)
assert.equal(isConfirmationCancel(new Error('network')), false)

const previousDashboard = {
  metrics: [1, 2, 3, 4],
  pending: [{ id: 1, destination: '/reservation/pending' }],
  trend: { dates: ['昨天'], reservations: [1], used: [1], noshow: [0] },
  roomTypes: [{ name: '琴房', value: 1 }],
  ranking: { rooms: ['琴房'], rates: [50] }
}
const partialDashboard = mergeDashboardPayload(previousDashboard, {
  todayReservations: 8,
  pendingCount: 3,
  usingCount: 2,
  noshowCount: 1,
  pendingItems: [{ id: 2, destination: '/system/logs' }]
}, 'counselor')
assert.deepEqual(partialDashboard.metrics.value, [8, 3, 2, 1])
assert.equal(partialDashboard.metrics.status, 'success')
assert.equal(partialDashboard.pending.value[0].destination, '/reservation/counselor')
assert.equal(partialDashboard.pending.status, 'success')
assert.deepEqual(partialDashboard.trend.value, previousDashboard.trend)
assert.equal(partialDashboard.trend.status, 'error')
assert.deepEqual(partialDashboard.roomTypes.value, previousDashboard.roomTypes)
assert.equal(partialDashboard.roomTypes.status, 'error')
assert.deepEqual(partialDashboard.ranking.value, previousDashboard.ranking)
assert.equal(partialDashboard.ranking.status, 'error')

for (const invalidPayload of [
  { todayReservations: -1, pendingCount: 1, usingCount: 1, noshowCount: 0 },
  { todayReservations: 1, pendingCount: Number.NaN, usingCount: 1, noshowCount: 0 }
]) {
  assert.equal(mergeDashboardPayload(previousDashboard, invalidPayload, 'admin').metrics.status, 'error')
}
assert.equal(mergeDashboardPayload(previousDashboard, { trend: { dates: ['a'], reservations: [1, 2], used: [1], noshow: [0] } }, 'admin').trend.status, 'error')
assert.equal(mergeDashboardPayload(previousDashboard, { trend: { dates: ['a'], reservations: [1], used: [Infinity], noshow: [0] } }, 'admin').trend.status, 'error')
assert.equal(mergeDashboardPayload(previousDashboard, { trend: { dates: [''], reservations: [1], used: [1], noshow: [0] } }, 'admin').trend.status, 'error')
assert.equal(mergeDashboardPayload(previousDashboard, { trend: { dates: [42], reservations: [1], used: [1], noshow: [0] } }, 'admin').trend.status, 'error')
assert.equal(mergeDashboardPayload(previousDashboard, { usageRanking: { rooms: ['A'], rates: [101] } }, 'admin').ranking.status, 'error')
assert.equal(mergeDashboardPayload(previousDashboard, { usageRanking: { rooms: ['A'], rates: [] } }, 'admin').ranking.status, 'error')
assert.equal(mergeDashboardPayload(previousDashboard, { roomTypeStats: [{ name: '', value: 1 }] }, 'admin').roomTypes.status, 'error')
assert.equal(mergeDashboardPayload(previousDashboard, { roomTypeStats: [{ name: '琴房', value: -1 }] }, 'admin').roomTypes.status, 'error')

const state = createAsyncState([])
assert.equal(state.status, 'idle')
assert.deepEqual(state.value, [])

beginLoad(state)
assert.equal(state.status, 'loading')

finishLoad(state, [{ id: 1 }], false)
assert.equal(state.status, 'success')
assert.deepEqual(state.value, [{ id: 1 }])

beginLoad(state)
finishLoad(state, [], true)
assert.equal(state.status, 'empty')
assert.deepEqual(state.value, [])

finishLoad(state, [{ id: 2 }], false)
failLoad(state, new Error('网络连接失败'))
assert.equal(state.status, 'error')
assert.deepEqual(state.value, [{ id: 2 }])
assert.match(state.errorMessage, /网络连接失败/)

failLoad(state, {})
assert.match(state.errorMessage, /加载失败|稍后重试/)

const requireFromAdmin = createRequire(new URL('../admin/package.json', import.meta.url))
const { compileTemplate, parse } = requireFromAdmin('@vue/compiler-sfc')
const { compile } = requireFromAdmin('@vue/compiler-dom')
const { createSSRApp, h } = requireFromAdmin('vue')
const { renderToString } = requireFromAdmin('@vue/server-renderer')
const component = await readFile(new URL('../admin/src/components/admin/AsyncState.vue', import.meta.url), 'utf8')

function verifyAsyncState(source) {
  const { descriptor, errors } = parse(source, { filename: 'AsyncState.vue' })
  assert.deepEqual(errors, [], 'AsyncState should be valid Vue SFC source')
  assert.ok(descriptor.template, 'AsyncState should have a template')
  assert.ok(descriptor.scriptSetup, 'AsyncState should use script setup')

  const template = descriptor.template.content
  const script = descriptor.scriptSetup.content
  const compiled = compileTemplate({ source: template, filename: 'AsyncState.vue', id: 'async-state-check' })
  assert.deepEqual(compiled.errors, [], 'AsyncState template should compile')

  assert.match(template, /v-if="loading"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(template, /v-else-if="error"[^>]*role="alert"[^>]*aria-live="assertive"/)
  assert.match(template, /v-else-if="empty"[^>]*aria-live="polite"/)
  assert.match(template, /<slot v-else\s*\/>/)
  assert.match(template, /@click="\$emit\('retry'\)"/)
  assert.match(script, /defineEmits\(\['retry'\]\)/)
}

verifyAsyncState(component)

const asyncTemplate = parse(component, { filename: 'AsyncState.vue' }).descriptor.template.content
const asyncRender = new Function('Vue', compile(asyncTemplate, { mode: 'function', prefixIdentifiers: true }).code)(requireFromAdmin('vue'))
const AsyncState = {
  props: {
    loading: Boolean,
    error: Boolean,
    empty: Boolean,
    errorMessage: { type: String, default: '加载失败，请稍后重试' }
  },
  emits: ['retry'],
  render: asyncRender
}

async function renderAsyncState(props) {
  const app = createSSRApp({
    render: () => h(AsyncState, props, { default: () => h('div', { class: 'success-content' }, '加载完成') })
  })
  app.component('el-skeleton', { render: () => h('div', { class: 'skeleton-stub' }) })
  app.component('el-result', { setup: (_, { attrs, slots }) => () => h('section', attrs, slots.extra?.()) })
  app.component('el-button', { setup: (_, { attrs, slots }) => () => h('button', attrs, slots.default?.()) })
  app.component('el-empty', { setup: (_, { attrs }) => () => h('div', attrs) })
  return renderToString(app)
}

const loadingHtml = await renderAsyncState({ loading: true })
assert.match(loadingHtml, /role="status"/)
assert.doesNotMatch(loadingHtml, /success-content/)

const errorHtml = await renderAsyncState({ error: true, errorMessage: '服务暂不可用' })
assert.match(errorHtml, /role="alert"/)
assert.match(errorHtml, /aria-live="assertive"/)
assert.match(errorHtml, /<button[^>]*>重新加载<\/button>/)

const emptyHtml = await renderAsyncState({ empty: true })
assert.match(emptyHtml, /aria-live="polite"/)
assert.doesNotMatch(emptyHtml, /success-content/)

const successHtml = await renderAsyncState({})
assert.match(successHtml, /success-content/)

for (const [label, mutation] of [
  ['loading branch', source => source.replace('v-if="loading"', '')],
  ['error branch', source => source.replace('v-else-if="error"', '')],
  ['empty branch', source => source.replace('v-else-if="empty"', '')],
  ['success slot', source => source.replace('<slot v-else />', '<slot />')],
  ['retry emit', source => source.replace("$emit('retry')", "$emit('ignored')")],
  ['error announcement', source => source.replace('role="alert"', '')]
]) {
  assert.throws(() => verifyAsyncState(mutation(component)), undefined, `${label} removal should fail the UX check`)
}

const pageShell = await readFile(new URL('../admin/src/components/admin/PageShell.vue', import.meta.url), 'utf8')
assert.doesNotMatch(pageShell, /page-shell-header:hover[\s\S]*?translateY/)
assert.doesNotMatch(pageShell, /animation:\s*jy-soft-float/)

const globalCss = await readFile(new URL('../admin/src/styles/global.css', import.meta.url), 'utf8')
assert.match(globalCss, /:focus-visible/)
assert.match(globalCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)

const layout = await readFile(new URL('../admin/src/components/Layout.vue', import.meta.url), 'utf8')
const dashboard = await readFile(new URL('../admin/src/views/Dashboard/Index.vue', import.meta.url), 'utf8')
const reservationApi = await readFile(new URL('../admin/src/api/reservation.js', import.meta.url), 'utf8')
const reviewQueue = await readFile(new URL('../admin/src/views/Reservation/ReviewQueue.vue', import.meta.url), 'utf8')
const pendingList = await readFile(new URL('../admin/src/views/Reservation/PendingList.vue', import.meta.url), 'utf8')
const counselorPending = await readFile(new URL('../admin/src/views/Reservation/CounselorPending.vue', import.meta.url), 'utf8')
const statsOverview = await readFile(new URL('../admin/src/views/Stats/Overview.vue', import.meta.url), 'utf8')
const statsExport = await readFile(new URL('../admin/src/views/Stats/Export.vue', import.meta.url), 'utf8')
const scopedStatsController = await readFile(new URL('../server/src/controllers/scopedStatsController.js', import.meta.url), 'utf8')
const statsController = await readFile(new URL('../server/src/controllers/statsController.js', import.meta.url), 'utf8')

for (const [name, source] of [['scoped stats', scopedStatsController], ['global stats', statsController]]) {
  assert.match(source, /SUM\(CASE WHEN r\.status = ['"]noshow['"] THEN 1 ELSE 0 END\)\s+AS\s+noshow_count/i, `${name} room no-show query must count no-shows without filtering other reservations out`)
  assert.match(source, /COUNT\(\*\)\s+AS\s+reservation_count/i, `${name} room no-show response must provide the room reservation denominator`)
}

// Task 7 management-page evidence table (load failure / write guard / danger confirmation / primary action):
// Room/BuildingManage: preserve rows / guarded submit / named delete confirmation / add button reachable.
// Room/Manage: preserve rows / guarded submit and seat save / named close confirmation / add and seat-save buttons reachable.
// Room/Monitor: preserve rooms and buildings / read-only / no dangerous write / refresh and room cards reachable.
// Room/RulesConfig: preserve current rules / guarded save / no destructive action / save button reachable.
// Room/SeatManage: preserve seats and room choices / guarded create and mutations / named single and batch delete confirmations / add button reachable.
// Account/Index: preserve rows / guarded submit and import / named disable confirmation / add and import buttons reachable.
// Credit/Blacklist: preserve rows / guarded ban and restore / named ban form and restore confirmation / ban button reachable.
// Credit/ScoreConfig: preserve current config / guarded save / no destructive action / save button reachable.
// Credit/Violations: preserve rows / guarded create / explicit violation form / create button reachable.
// System/Admins: preserve rows / guarded submit and delete / named delete confirmation / add button reachable.
// System/Announcements: preserve rows / guarded publish/archive/delete/submit / archive and named delete confirmations / add button reachable.
// System/Backup: preserve records / guarded create and verify / no destructive restore exposed / backup and verify buttons reachable.
// System/Logs: preserve rows / read-only / no dangerous write / search and reset buttons reachable.
const managementPages = Object.fromEntries(await Promise.all([
  ['Room/Manage', '../admin/src/views/Room/Manage.vue'],
  ['Room/Monitor', '../admin/src/views/Room/Monitor.vue'],
  ['Account/Index', '../admin/src/views/Account/Index.vue'],
  ['Credit/Blacklist', '../admin/src/views/Credit/Blacklist.vue'],
  ['System/Announcements', '../admin/src/views/System/Announcements.vue'],
  ['System/Backup', '../admin/src/views/System/Backup.vue']
].map(async ([name, path]) => [name, await readFile(new URL(path, import.meta.url), 'utf8')])))
for (const [name, source] of Object.entries(managementPages)) {
  assert.doesNotMatch(source, /catch\s*\([^)]*\)\s*\{[\s\S]{0,120}?(?:tableData|rooms|buildingOptions|backupList)\.value\s*=\s*\[\]/, `${name} must preserve successfully loaded data when refresh fails`)
}
for (const [name, source, guard] of [
  ['Room/RulesConfig', await readFile(new URL('../admin/src/views/Room/RulesConfig.vue', import.meta.url), 'utf8'), /async function handleSave\(\)\s*\{\s*if \(saveLoading\.value\) return/],
  ['Credit/ScoreConfig', await readFile(new URL('../admin/src/views/Credit/ScoreConfig.vue', import.meta.url), 'utf8'), /async function handleSave\(\)\s*\{\s*if \(saveLoading\.value\) return/],
  ['System/Backup', managementPages['System/Backup'], /async function handleCreateBackup\(\)\s*\{\s*const token = actionLock\.acquire\(\)/]
]) assert.match(source, guard, `${name} must reject duplicate primary writes`)

for (const name of ['Account/Index', 'Room/Manage', 'Credit/Blacklist', 'System/Announcements']) {
  assert.doesNotMatch(managementPages[name], /catch\s*\([^)]*\)\s*\{[\s\S]{0,160}?pagination\.total\s*=\s*0/, `${name} must preserve the successful total when refresh fails`)
}

const guardedManagementActions = {
  'Account/Index': ['handleSubmit', 'doImport'],
  'Credit/Blacklist': ['confirmBan', 'handleUnban'],
  'System/Announcements': ['handlePublish', 'handleArchive', 'handleDelete', 'handleSubmit'],
  'System/Backup': ['handleCreateBackup', 'handleVerify']
}
for (const [name, handlers] of Object.entries(guardedManagementActions)) {
  const source = managementPages[name]
  assert.match(source, /createActionLock/, `${name} must use the owned-token action lock`)
  for (const handler of handlers) {
    assert.match(source, new RegExp(`async function ${handler}\\([^)]*\\)\\s*\\{[\\s\\S]{0,180}?actionLock\\.acquire\\(\\)`), `${name} ${handler} must acquire the shared write lock at entry`)
  }
  assert.match(source, /actionLock\.release\(token\)/, `${name} must release only its own write token`)
}
assert.match(managementPages['Account/Index'], /:disabled="actionSubmitting"[\s\S]*@click="doImport"|@click="doImport"[\s\S]*:disabled="actionSubmitting"/, 'account import button must bind the shared lock state')
assert.match(managementPages['Account/Index'], /async function handleDelete\([^)]*\)\s*\{[\s\S]{0,180}?runLockedConfirmedAction\(actionLock,/, 'account disable must use the tested shared confirmed-action executor')
assert.match(managementPages['Account/Index'], /@click="handleDelete\(row\)"[\s\S]{0,120}:disabled="actionSubmitting[^\"]*"|:disabled="actionSubmitting[^\"]*"[\s\S]{0,120}@click="handleDelete\(row\)"/, 'account disable button must bind the shared lock state')
assert.match(managementPages['Credit/Blacklist'], /@click="handleUnban\(row\)"[^>]*:disabled="actionSubmitting"|:disabled="actionSubmitting"[^>]*@click="handleUnban\(row\)"/, 'unban button must bind the shared lock state')
assert.equal((managementPages['System/Announcements'].match(/:disabled="actionSubmitting"/g) || []).length >= 3, true, 'announcement row actions must bind the shared lock state')
assert.match(managementPages['System/Backup'], /@click="handleVerify\(row\)"[^>]*:loading="actionSubmitting"|:loading="actionSubmitting"[^>]*@click="handleVerify\(row\)"/, 'backup verify button must show the shared action state')

const executablePageEvidence = [
  ['Room/BuildingManage', '../admin/src/views/Room/BuildingManage.vue', /async function loadData/, /async function handleSubmit/, /ElMessageBox\.confirm/, /@click="handleAdd"/],
  ['Room/SeatManage', '../admin/src/views/Room/SeatManage.vue', /async function loadSeats/, /async function confirmBatchAdd/, /ElMessageBox\.confirm/, /@click="handleBatchAdd"/],
  ['Credit/Violations', '../admin/src/views/Credit/Violations.vue', /async function loadData/, /async function confirmCreate/, /function confirmCreate/, /@click="handleCreate"/],
  ['System/Admins', '../admin/src/views/System/Admins.vue', /async function loadData/, /async function handleSubmit/, /ElMessageBox\.confirm/, /@click="handleAdd"/],
  ['System/Logs', '../admin/src/views/System/Logs.vue', /async function loadData/, /getLogs/, /does-not-exist/, /@click="loadData"/]
]
for (const [name, path, loadEvidence, writeEvidence, dangerEvidence, primaryEvidence] of executablePageEvidence) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  assert.match(source, loadEvidence, `${name} must expose its load path`)
  assert.match(source, writeEvidence, `${name} must expose its write or read-only API evidence`)
  if (name === 'System/Logs') assert.doesNotMatch(source, /async function handle(?:Submit|Delete|Save|Create)/, `${name} is read-only and has no dangerous write`)
  else assert.match(source, dangerEvidence, `${name} dangerous operation must be explicit or confirmed`)
  assert.match(source, primaryEvidence, `${name} primary operation must be reachable`)
}
for (const [name, source, loadEvidence, primaryEvidence] of [
  ['Room/Manage', managementPages['Room/Manage'], /async function loadData/, /@click="handleAdd"/],
  ['Room/Monitor', managementPages['Room/Monitor'], /async function loadRooms/, /@click="loadRooms"/],
  ['Room/RulesConfig', await readFile(new URL('../admin/src/views/Room/RulesConfig.vue', import.meta.url), 'utf8'), /async function loadRules/, /@click="handleSave"/],
  ['Account/Index', managementPages['Account/Index'], /async function loadData/, /@click="handleAdd"/],
  ['Credit/Blacklist', managementPages['Credit/Blacklist'], /async function loadData/, /@click="handleManualBan"/],
  ['Credit/ScoreConfig', await readFile(new URL('../admin/src/views/Credit/ScoreConfig.vue', import.meta.url), 'utf8'), /async function loadConfig/, /@click="handleSave"/],
  ['System/Announcements', managementPages['System/Announcements'], /async function loadData/, /@click="handleAdd"/],
  ['System/Backup', managementPages['System/Backup'], /async function loadData/, /@click="handleCreateBackup"/]
]) {
  assert.match(source, loadEvidence, `${name} load evidence must be executable`)
  assert.match(source, primaryEvidence, `${name} primary operation must be reachable`)
}
assert.doesNotMatch(managementPages['Room/Monitor'], /(?:create|update|delete|remove)(?:Room|Seat|Rules)\(/, 'Room/Monitor is read-only, so write guard and danger confirmation are N/A')
for (const name of ['Room/Manage', 'Account/Index', 'Credit/Blacklist', 'System/Announcements']) assert.match(managementPages[name], /ElMessageBox\.confirm/, `${name} dangerous operation must require confirmation`)

const accountWriteLock = createActionLock()
const accountDisableToken = accountWriteLock.acquire()
assert.ok(accountDisableToken, 'first account disable action must acquire the shared lock')
assert.equal(accountWriteLock.acquire(), null, 'a repeated account disable trigger must be rejected while confirmation or request is pending')
assert.equal(accountWriteLock.release(Symbol('duplicate-account-disable')), false, 'a rejected account disable trigger must not release the owner lock')
assert.equal(accountWriteLock.locked, true)
assert.equal(accountWriteLock.release(accountDisableToken), true)

async function verifyAccountDisableFlow() {
  const lock = createActionLock()
  const states = []
  let resolveConfirm
  let resolveRequest
  const first = runLockedConfirmedAction(lock, {
    confirm: () => new Promise(resolve => { resolveConfirm = resolve }),
    action: () => new Promise(resolve => { resolveRequest = resolve }),
    onStateChange: value => states.push(value)
  })
  await Promise.resolve()
  assert.equal(await runLockedConfirmedAction(lock, { confirm: async () => {}, action: async () => {} }), false, 'second account disable must be rejected while confirmation is pending')
  resolveConfirm()
  await Promise.resolve()
  assert.equal(await runLockedConfirmedAction(lock, { confirm: async () => {}, action: async () => {} }), false, 'second account disable must be rejected while request is pending')
  resolveRequest()
  assert.equal(await first, true)
  assert.deepEqual(states, [true, false])
  assert.equal(await runLockedConfirmedAction(lock, { confirm: async () => {}, action: async () => {} }), true, 'lock must recover after success')

  let cancelErrors = 0
  assert.equal(await runLockedConfirmedAction(lock, { confirm: async () => { throw 'cancel' }, action: async () => assert.fail('cancelled action must not run'), onError: () => { cancelErrors += 1 } }), false)
  assert.equal(cancelErrors, 0, 'confirmation cancellation must not be reported as an action failure')
  assert.equal(await runLockedConfirmedAction(lock, { confirm: async () => {}, action: async () => {} }), true, 'lock must recover after cancellation')

  const failure = new Error('disable failed')
  let reported
  assert.equal(await runLockedConfirmedAction(lock, { confirm: async () => {}, action: async () => { throw failure }, onError: error => { reported = error } }), false)
  assert.equal(reported, failure)
  assert.equal(await runLockedConfirmedAction(lock, { confirm: async () => {}, action: async () => {} }), true, 'lock must recover after request failure')
}
await verifyAccountDisableFlow()

assert.match(statsOverview, /getRecentDateRange/, 'statistics must initialize an explicit recent-seven-day range')
assert.match(statsOverview, /Promise\.allSettled/, 'statistics regions must settle independently')
assert.match(statsOverview, /createLatestRequest/, 'statistics must coordinate overlapping refreshes')
assert.match(statsOverview, /statsRequest\.run/, 'statistics must apply only the newest refresh')
assert.match(statsOverview, /chartStates/, 'each statistics chart must expose its own state')
assert.equal((statsOverview.match(/<AsyncState/g) || []).length, 5, 'each statistics chart must render loading, error, empty, and success independently')
assert.match(statsOverview, /deriveStatsSummary/, 'summary cards must be derived from normalized chart data')
assert.match(statsOverview, /onBeforeUnmount\([\s\S]*statsRequest\.invalidate\(\)/, 'unmount must invalidate statistics requests')
assert.doesNotMatch(statsOverview, /formatReservationTrend\(reservations\.status === 'fulfilled' \? reservations\.value\.data : null\)/, 'failed regions must not be formatted as empty data')
assert.match(statsExport, /if \(exporting\.value\) return/, 'export must reject duplicate clicks')
assert.match(statsExport, /:disabled="exporting"/, 'export action must be disabled while running')
assert.match(statsExport, /currentRangeLabel/, 'export page must show the currently selected range')
assert.match(statsExport, /exportResult/, 'export page must show the latest export result')

assert.match(pendingList, /<ReviewQueue\s*\/>/, 'pending list should inherit the safe review queue')
for (const [name, source] of [['review queue', reviewQueue], ['counselor pending', counselorPending]]) {
  assert.match(source, /actionSubmitting/, `${name} must guard approval submissions`)
  assert.match(source, /actionLock\.acquire\(\)/, `${name} must allow only one approval request in flight`)
  assert.match(source, /actionLock\.release\(token\)/, `${name} must release only the owned action`)
  assert.match(source, /:loading="actionSubmitting"/, `${name} must show submission progress`)
  assert.match(source, /:disabled="actionSubmitting/, `${name} must disable related actions while submitting`)
  assert.doesNotMatch(source, /catch\s*\([^)]*\)\s*\{\s*tableData\.value\s*=\s*\[\]/, `${name} must preserve rows when loading fails`)
  assert.match(source, /loadError/, `${name} must expose a retryable loading failure`)
  assert.match(source, /@click="loadData"/, `${name} must offer retry`)
}
assert.match(reviewQueue, /batchReject/, 'batch rejection must collect a reason before submission')
assert.match(reviewQueue, /const ids = \[\.\.\.selectedIds\.value\]/, 'batch approval must snapshot selected ids before confirmation')
assert.match(reviewQueue, /ids\.length[\s\S]*batchAudit\(\{ ids, action/, 'batch confirmation and request must use the same snapshot')
assert.match(reviewQueue, /normalizeRejectionReason/, 'batch and single rejection must share reason validation')
assert.match(reviewQueue, /isConfirmationCancel/, 'confirmation cancellation must be distinguished from real failures')
assert.doesNotMatch(reviewQueue, /reason:\s*action\s*===\s*['"]reject['"]\s*\?\s*['"]批量退回['"]/, 'batch rejection must not use a generic reason')
assert.match(reviewQueue, /selectedIds\.value\s*=\s*\[\][\s\S]*await\s+loadData|await\s+loadData\([\s\S]*selectedIds\.value\s*=\s*\[\]/, 'selection may clear only after a successful action')

assert.doesNotMatch(layout, /\.notify-btn::after/, 'notification button must not show an unconditional red dot')
assert.match(layout, /v-if="pendingCount > 0"[^>]*class="pending-badge"[^>]*role="status"[^>]*aria-label=/)
assert.match(layout, /\{\{\s*pendingCount\s*\}\}/, 'notification badge must show the actionable count')
assert.match(reservationApi, /request\.get\(['"]\/reservation\/pending-count['"]\)/, 'reminders must use the role-scoped pending count endpoint')
assert.doesNotMatch(layout, /getPendingReminderCount|@\/api\/stats/, 'layout must not load the full dashboard for one reminder')
assert.match(layout, /getPendingCount/, 'layout must use the reservation count API')
assert.match(layout, /userStore\.token[\s\S]*loadPendingCount/, 'reminders must load after authentication')
assert.match(layout, /watch\(\s*\(\)\s*=>\s*route\.fullPath[\s\S]*loadPendingCount/, 'route changes must refresh reminders')
assert.match(layout, /pendingCount\.value\s*=\s*0[\s\S]*catch/, 'failed reminder loads must not leave a false badge')
assert.match(layout, /role\s*===\s*'counselor'[\s\S]*['"]\/reservation\/counselor['"][\s\S]*['"]\/reservation\/pending['"]/, 'notification target must follow the reviewer role')
assert.match(layout, /<el-button[^>]*notify-btn[^>]*:aria-label=/, 'notification button itself must have an accessible name')
assert.match(layout, /let\s+pendingRequestVersion\s*=\s*0/, 'reminder loader must track request generations')
assert.match(layout, /onBeforeUnmount\(\(\)\s*=>\s*\{?\s*pendingRequestVersion\s*\+=\s*1/, 'unmount must invalidate pending requests')
assert.match(layout, /requestVersion\s*===\s*pendingRequestVersion/, 'only the newest reminder request may update state')

assert.match(dashboard, /ROLE_DASHBOARD_COPY/, 'dashboard should use role-specific copy')
assert.match(dashboard, /ROLE_SHORTCUTS/, 'dashboard should render role-specific shortcuts')
assert.match(dashboard, /:title="dashboardCopy\.title"/, 'dashboard title should follow the current role')
assert.match(dashboard, /router\.push\(item\.destination\)/, 'dashboard shortcuts should be navigable')
assert.match(dashboard, /<button[^>]*v-for="item in pendingItems"[^>]*@click="router\.push\(item\.destination\)"/, 'pending items should navigate to their destination')
assert.match(dashboard, /dashboardRegions\[key\]\.value\s*=\s*merged\[key\]\.value/, 'successful dashboard regions should update independently')
assert.doesNotMatch(dashboard, /catch\s*\([^)]*\)\s*\{\s*pendingItems\.value\s*=\s*\[\]/, 'failed dashboard loads must preserve previous pending items')
assert.match(dashboard, /@click="loadData"[^>]*>\s*重试/, 'dashboard failure should offer retry')
assert.match(dashboard, /regionErrors/, 'dashboard should expose independent region errors')
assert.match(dashboard, /mergeDashboardPayload/, 'dashboard should merge valid regions without clearing failed regions')
assert.match(dashboard, /createLatestRequest/, 'dashboard should use the tested latest-request coordinator')
assert.match(dashboard, /dashboardRequest\.run/, 'dashboard loads should run through the latest-request coordinator')
assert.match(dashboard, /onBeforeUnmount\([\s\S]*dashboardRequest\.invalidate\(\)/, 'unmount should invalidate dashboard requests')

async function verifyLatestDashboardRequestWins() {
  let visible = 'initial'
  let chart = 'initial'
  const coordinator = createLatestRequest()
  const apply = promise => coordinator.run(promise, value => {
    visible = value
    chart = value
  })
  let resolveOld
  const old = apply(new Promise(resolve => { resolveOld = resolve }))
  await apply(Promise.resolve('new'))
  resolveOld('old')
  await old
  assert.equal(visible, 'new')
  assert.equal(chart, 'new')
  const late = apply(Promise.resolve('after-unmount'))
  coordinator.invalidate()
  await late
  assert.equal(visible, 'new')
  assert.equal(chart, 'new')
}

await verifyLatestDashboardRequestWins()

async function verifyLatestRequestWins() {
  let version = 0
  let visibleCount = 0
  let active = true
  const apply = async promise => {
    const requestVersion = ++version
    try {
      const count = await promise
      if (active && requestVersion === version) visibleCount = count
    } catch {
      if (active && requestVersion === version) visibleCount = 0
    }
  }
  let resolveOld
  const oldRequest = new Promise(resolve => { resolveOld = resolve })
  const oldRun = apply(oldRequest)
  await apply(Promise.resolve(2))
  resolveOld(9)
  await oldRun
  assert.equal(visibleCount, 2, 'an older response must not overwrite the latest count')
  const unmountedRun = apply(Promise.resolve(7))
  active = false
  version += 1
  await unmountedRun
  assert.equal(visibleCount, 2, 'an unmounted layout must ignore late responses')
}

await verifyLatestRequestWins()

console.log('admin-site-ux-check passed')
