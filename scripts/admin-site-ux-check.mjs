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
