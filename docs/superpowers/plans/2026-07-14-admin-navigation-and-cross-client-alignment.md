# Admin Navigation and Cross-Client Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate interrupted admin navigation, reorganize the super-admin sidebar, and keep web admin, administrator miniapp, and server role/data contracts aligned.

**Architecture:** Keep the server as the authority for roles, building scope, and mutations. The web client keeps its existing route policy, while the miniapp gains one centralized mobile capability policy; a cross-client contract check compares both clients with the protected server routes and explicitly records desktop-only operations. Element Plus remains globally registered, while redundant per-page style discovery is disabled so lazy routes no longer trigger development-server reloads.

**Tech Stack:** Vue 3, Vue Router, Element Plus, Vite 5, Vitest, WeChat Mini Program JavaScript/WXML, Express, Node.js assertion scripts.

---

## File structure

- `admin/vite.config.js`: prevent redundant Element Plus per-page style discovery.
- `admin/src/router/index.js`: report a failed lazy-page load without reloading or changing the current route.
- `admin/src/router/adminRoutes.js`: define the seven business-oriented sidebar groups.
- `admin/src/utils/navigationState.js`: update default expanded groups after regrouping.
- `admin/src/components/__tests__/Layout.spec.js`: protect menu grouping and route-state behavior.
- `miniapp/utils/admin-policy.js`: central mobile role/capability and approval-queue policy.
- `miniapp/pages/admin-manage/*`: render only mobile actions allowed for the current role.
- `miniapp/pages/admin-home/*`: use the shared audit queue contract and emphasize counselor work.
- `miniapp/pages/admin-reservation/*`: use the same approval mutations as the web client.
- `miniapp/pages/admin-credit/*`, `admin-users/*`, `admin-feedback/*`, `admin-announcement/*`, `admin-rooms/*`: enforce role-specific display and direct-entry guards.
- `miniapp/pages/admin-poster/*`: provide counselor/super-admin mobile poster review.
- `miniapp/app.json`: register the poster review page.
- `scripts/admin-navigation-runtime-config-check.mjs`: statically protect the no-reload Vite configuration.
- `scripts/admin-cross-client-contract-check.mjs`: verify web, miniapp, and server role/endpoint alignment.
- `scripts/admin-miniapp-regression-check.js`: exercise role-filtered miniapp menus and guards.
- `scripts/mobile-regression-check.js`: exercise role-specific server queue access and shared data contracts.
- `package.json`: expose the new checks.

### Task 1: Lock down the navigation reload root cause

**Files:**
- Create: `scripts/admin-navigation-runtime-config-check.mjs`
- Modify: `admin/vite.config.js`
- Modify: `admin/src/router/index.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing configuration check**

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync(new URL('../admin/vite.config.js', import.meta.url), 'utf8')
assert(!source.includes("unplugin-vue-components/vite"), 'Element Plus is globally registered; component rediscovery must be disabled')
assert(/ElementPlusResolver\(\{\s*importStyle:\s*false\s*\}\)/.test(source), 'auto-imported Element Plus APIs must reuse the global stylesheet')
const routerSource = fs.readFileSync(new URL('../admin/src/router/index.js', import.meta.url), 'utf8')
assert(routerSource.includes('router.onError'), 'lazy-page failures must be handled without a page reload')
assert(!routerSource.includes('location.reload'), 'route error handling must not reload the page')
console.log('admin-navigation-runtime-config-check passed')
```

- [ ] **Step 2: Run the check and confirm it fails for the current configuration**

Run: `node scripts/admin-navigation-runtime-config-check.mjs`

Expected: FAIL because `unplugin-vue-components/vite` is still configured and `importStyle: false` is absent.

- [ ] **Step 3: Remove redundant component discovery and disable generated styles**

Update `admin/vite.config.js` so the plugin section keeps Vue and API auto-imports only:

```js
import AutoImport from 'unplugin-auto-import/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

AutoImport({
  resolvers: [ElementPlusResolver({ importStyle: false })],
  imports: ['vue', 'vue-router', 'pinia']
})
```

Remove the `Components` import and `Components(...)` plugin. Keep `app.use(ElementPlus)` and `element-plus/dist/index.css` unchanged in `admin/src/main.js`.

Add a router error handler that logs the diagnostic for developers and shows `页面暂时未能打开，请稍后重试` through an explicitly imported `ElMessage`. Do not call `location.reload`, `location.assign`, or redirect to the dashboard; Vue Router therefore retains the current successful page.

- [ ] **Step 4: Add and run the check plus a clean production build**

Add `"check:admin-navigation-runtime": "node scripts/admin-navigation-runtime-config-check.mjs"` to the root scripts.

Run: `npm run check:admin-navigation-runtime && npm --prefix admin run build`

Expected: the new check passes and Vite completes a production build.

- [ ] **Step 5: Commit the root-cause fix**

```bash
git add admin/vite.config.js admin/src/router/index.js scripts/admin-navigation-runtime-config-check.mjs package.json
git commit -m "fix: prevent admin route reloads"
```

### Task 2: Reorganize the super-admin sidebar

**Files:**
- Modify: `admin/src/router/adminRoutes.js`
- Modify: `admin/src/utils/navigationState.js`
- Modify: `admin/src/components/__tests__/Layout.spec.js`
- Modify: `scripts/admin-monitor-account-navigation-check.mjs`

- [ ] **Step 1: Write failing assertions for the seven groups**

Add assertions to `scripts/admin-monitor-account-navigation-check.mjs`:

```js
assert.deepEqual(navSections.map(section => section.title), [
  '今日工作', '预约与使用', '空间管理', '宿生与信用', '数据与报表', '内容与沟通', '系统运维'
])
assert.deepEqual(navSections.find(section => section.key === 'system').children, ['SystemLogs', 'SystemBackup'])
assert(navSections.find(section => section.key === 'space').children.includes('RoomManage'))
assert(navSections.find(section => section.key === 'governance').children.includes('AccountManage'))
assert(navSections.find(section => section.key === 'content').children.includes('SystemAnnouncements'))
```

Extend `Layout.spec.js` to navigate to `/room/monitor` and assert the breadcrumb contains `空间管理`.

- [ ] **Step 2: Run the focused checks and confirm the old grouping fails**

Run: `npm run check:admin-site:roles && npm --prefix admin run test:layout`

Expected: FAIL on the old section titles or children.

- [ ] **Step 3: Replace the old sections with the approved grouping**

Use these exact route memberships in `adminRoutes.js`:

```js
export const navSections = [
  { key: 'today', title: '今日工作', icon: 'DataBoard', children: ['Dashboard'] },
  { key: 'reservation', title: '预约与使用', icon: 'Calendar', children: ['CounselorPending', 'ReservationPending', 'ReservationAll', 'CheckinManage', 'ReadingRoomLogs'] },
  { key: 'space', title: '空间管理', icon: 'Monitor', children: ['RoomMonitor', 'RoomManage', 'BuildingManage', 'SeatManage', 'RulesConfig'] },
  { key: 'governance', title: '宿生与信用', icon: 'UserFilled', children: ['CreditViolations', 'CreditBlacklist', 'AccountManage', 'CreditConfig'] },
  { key: 'statistics', title: '数据与报表', icon: 'TrendCharts', children: ['StatsOverview', 'StatsExport'] },
  { key: 'content', title: '内容与沟通', icon: 'PictureFilled', children: ['PosterPending', 'PosterPosition', 'Feedback', 'SystemAnnouncements'] },
  { key: 'system', title: '系统运维', icon: 'Setting', children: ['SystemLogs', 'SystemBackup'] }
]
```

Change the super-admin defaults in `navigationState.js` to `['today', 'reservation', 'system']`; `ensureActiveGroup` continues to open the current route group.

- [ ] **Step 4: Run sidebar policy and component tests**

Run: `npm run check:admin-site:roles && node scripts/admin-monitor-account-navigation-check.mjs && npm --prefix admin run test:layout`

Expected: all checks pass; each role still sees only authorized routes.

- [ ] **Step 5: Commit the regrouping**

```bash
git add admin/src/router/adminRoutes.js admin/src/utils/navigationState.js admin/src/components/__tests__/Layout.spec.js scripts/admin-monitor-account-navigation-check.mjs
git commit -m "feat: regroup super admin navigation"
```

### Task 3: Centralize the administrator miniapp capability policy

**Files:**
- Create: `miniapp/utils/admin-policy.js`
- Modify: `miniapp/pages/admin-manage/admin-manage.js`
- Modify: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: Add failing role-menu tests**

In `scripts/admin-miniapp-regression-check.js`, load the manage page separately with `admin`, `counselor`, and `super_admin` user data. Flatten `page.data.groups` and assert:

```js
assert(adminKeys.includes('pending') && adminKeys.includes('violations'))
assert(!adminKeys.includes('blacklist') && !adminKeys.includes('feedback') && !adminKeys.includes('announcement'))
assert(counselorKeys.includes('counselorPending') && counselorKeys.includes('poster'))
assert(counselorKeys.includes('blacklist') && counselorKeys.includes('feedback'))
assert(!counselorKeys.includes('announcement'))
assert(superKeys.includes('pending') && superKeys.includes('counselorPending'))
```

- [ ] **Step 2: Run the regression check and confirm the static menu fails**

Run: `npm run check:admin-miniapp`

Expected: FAIL because every role currently receives the same groups.

- [ ] **Step 3: Implement one mobile capability map**

Create `miniapp/utils/admin-policy.js` with explicit capabilities:

```js
var ROLE_CAPABILITIES = {
  admin: ['ordinaryApproval', 'reservationView', 'roomView', 'residentView', 'violationView', 'statsView', 'scanCheckin'],
  counselor: ['ordinaryApproval', 'counselorApproval', 'reservationView', 'roomView', 'residentView', 'violationView', 'blacklistManage', 'feedbackManage', 'posterReview', 'statsView', 'scanCheckin'],
  super_admin: ['ordinaryApproval', 'counselorApproval', 'reservationView', 'roomView', 'residentView', 'violationView', 'blacklistManage', 'feedbackManage', 'posterReview', 'statsView', 'scanCheckin']
}

function can(role, capability) {
  return (ROLE_CAPABILITIES[role] || []).indexOf(capability) !== -1
}

function queueType(role, preferred) {
  if (preferred === 'counselor' && can(role, 'counselorApproval')) return 'counselor'
  return 'admin'
}

module.exports = { ROLE_CAPABILITIES: ROLE_CAPABILITIES, can: can, queueType: queueType }
```

Update `admin-manage.js` to build its groups during `onLoad` from a complete item catalog filtered by `policy.can(role, item.capability)`. Route `poster` to `/pages/admin-poster/admin-poster`.

- [ ] **Step 4: Run miniapp policy tests**

Run: `npm run check:admin-miniapp`

Expected: role-specific menu assertions pass.

- [ ] **Step 5: Commit the centralized policy**

```bash
git add miniapp/utils/admin-policy.js miniapp/pages/admin-manage/admin-manage.js scripts/admin-miniapp-regression-check.js
git commit -m "feat: align miniapp menus by admin role"
```

### Task 4: Unify web and miniapp approval contracts

**Files:**
- Modify: `miniapp/pages/admin-home/admin-home.js`
- Modify: `miniapp/pages/admin-home/admin-home.wxml`
- Modify: `miniapp/pages/admin-reservation/admin-reservation.js`
- Modify: `miniapp/pages/admin-reservation/admin-reservation.wxml`
- Modify: `scripts/admin-miniapp-regression-check.js`
- Modify: `scripts/mobile-regression-check.js`

- [ ] **Step 1: Write failing request-contract tests**

Mock `request.get` and `request.post` in `scripts/admin-miniapp-regression-check.js` and assert:

```js
assert.equal(homeCalls[0].url, '/audit/pending')
assert.equal(homeCalls[0].params.type, 'admin')
assert.equal(counselorCalls[0].params.type, 'counselor')
assert.equal(approveCall.url, '/audit/101/approve')
assert.equal(rejectCall.url, '/audit/101/reject')
```

In `mobile-regression-check.js`, assert guide access to `?type=admin`, counselor access to `?type=counselor`, and guide denial for `?type=counselor`.

- [ ] **Step 2: Run both checks and confirm legacy reservation endpoints fail**

Run: `npm run check:admin-miniapp && npm run check:mobile`

Expected: miniapp source/request assertions fail before implementation.

- [ ] **Step 3: Use the audit list and mutation endpoints everywhere in the mobile admin flow**

In both pages:

```js
var policy = require('../../utils/admin-policy')
var role = auth.getUserRole()
var type = policy.queueType(role, this.data.queueType)
request.get('/audit/pending', { type: type, page: 1, pageSize: 20 })
request.post('/audit/' + id + '/approve', {})
request.post('/audit/' + id + '/reject', { reason: reason })
```

Normalize list data with `(data && data.list) || []`. Add a visible queue label: `普通预约审核` or `辅导员重点审核`. For super admin, provide a small queue switch; for counselor, default to counselor review and retain access to ordinary review.

- [ ] **Step 4: Reload server data after every mutation**

Keep local cards unchanged until the request succeeds, then call both `loadPendingList()` and `loadStats()`. Do not manually decrement counters or rewrite reservation status.

- [ ] **Step 5: Run miniapp and server contract checks**

Run: `npm run check:admin-miniapp && npm run check:mobile && npm run check:reservation-consistency`

Expected: all pass; the same server audit flow now backs web and mobile approval.

- [ ] **Step 6: Commit the approval alignment**

```bash
git add miniapp/pages/admin-home miniapp/pages/admin-reservation scripts/admin-miniapp-regression-check.js scripts/mobile-regression-check.js
git commit -m "fix: unify mobile and web approval flows"
```

### Task 5: Guard miniapp pages and actions by role

**Files:**
- Modify: `miniapp/pages/admin-credit/admin-credit.js`
- Modify: `miniapp/pages/admin-credit/admin-credit.wxml`
- Modify: `miniapp/pages/admin-users/admin-users.js`
- Modify: `miniapp/pages/admin-users/admin-users.wxml`
- Modify: `miniapp/pages/admin-feedback/admin-feedback.js`
- Modify: `miniapp/pages/admin-announcement/admin-announcement.js`
- Modify: `miniapp/pages/admin-rooms/admin-rooms.js`
- Modify: `miniapp/pages/admin-rooms/admin-rooms.wxml`
- Modify: `miniapp/pages/admin-home/admin-home.js`
- Modify: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: Add failing page-guard and request tests**

Assert the following behavior in `admin-miniapp-regression-check.js`:

```js
assert.deepEqual(guideCreditTabs, ['violations'])
assert.deepEqual(counselorCreditTabs, ['violations', 'blacklist'])
assert.equal(guideHomeCalls.some(call => call.url === '/feedback'), false)
assert.equal(guideUsers.data.canManageStudents, false)
assert.equal(superUsers.data.canManageStudents, true)
assert.equal(guideRooms.data.canConfigureRooms, false)
```

Direct entry to feedback or announcement with an unauthorized role must call `wx.showToast` and `wx.redirectTo`/`wx.reLaunch` before making a request.

- [ ] **Step 2: Run and confirm the current pages expose forbidden actions**

Run: `npm run check:admin-miniapp`

Expected: FAIL on unfiltered tabs, unconditional feedback request, or exposed action flags.

- [ ] **Step 3: Apply centralized capability checks**

Use `admin-policy.can(role, capability)` to:

- show only `violations` to guides and add `blacklist` to counselor/super-admin;
- remove `config` from the mobile credit page;
- keep student lists readable but show credit/status mutation buttons only when an explicit `studentAccountManage` capability is present (none in the mobile matrix);
- allow feedback processing only for counselor/super-admin;
- prevent all roles from using the legacy mobile announcement configuration page and direct them to the computer admin;
- keep room lists readable but remove room mutation controls from the miniapp;
- request the feedback count on the home page only for roles with `feedbackManage`.

Use this guard form before page requests:

```js
if (!policy.can(role, capability)) {
  wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
  wx.reLaunch({ url: '/pages/admin-manage/admin-manage' })
  return false
}
```

- [ ] **Step 4: Run role and security checks**

Run: `npm run check:admin-miniapp && npm run check:security && npm run check:security-hardening`

Expected: all pass; hidden controls do not replace server-side enforcement.

- [ ] **Step 5: Commit the role guards**

```bash
git add miniapp/pages/admin-credit miniapp/pages/admin-users miniapp/pages/admin-feedback miniapp/pages/admin-announcement miniapp/pages/admin-rooms miniapp/pages/admin-home scripts/admin-miniapp-regression-check.js
git commit -m "fix: enforce mobile admin capability boundaries"
```

### Task 6: Add counselor-focused poster review to the miniapp

**Files:**
- Create: `miniapp/pages/admin-poster/admin-poster.js`
- Create: `miniapp/pages/admin-poster/admin-poster.json`
- Create: `miniapp/pages/admin-poster/admin-poster.wxml`
- Create: `miniapp/pages/admin-poster/admin-poster.wxss`
- Modify: `miniapp/app.json`
- Modify: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: Write failing registration and request tests**

Assert the page is present in `app.json`, guide direct entry is blocked, and counselor loading/actions call:

```js
request.get('/poster', { status: 'pending', page: 1, pageSize: 20 })
request.post('/poster/' + id + '/approve', {})
request.post('/poster/' + id + '/reject', { reason: reason })
```

- [ ] **Step 2: Run the miniapp regression and confirm the page is missing**

Run: `npm run check:admin-miniapp`

Expected: FAIL because `pages/admin-poster/admin-poster` is not registered.

- [ ] **Step 3: Implement the focused review page**

The page must:

- call `ensureCapability('posterReview')` before requests;
- display applicant, placement, period, content summary, and current status;
- provide approve and reject actions only for pending records;
- require a non-empty rejection reason;
- reload the server list after success;
- show loading, empty, error, and retry states without local sample data.

Register it in `miniapp/app.json` and expose it through the role-filtered manage page created in Task 3.

- [ ] **Step 4: Run miniapp regression and UI checks**

Run: `npm run check:admin-miniapp && npm run check:miniapp-ui`

Expected: both pass.

- [ ] **Step 5: Commit poster review**

```bash
git add miniapp/pages/admin-poster miniapp/app.json scripts/admin-miniapp-regression-check.js
git commit -m "feat: add counselor poster review to miniapp"
```

### Task 7: Add a cross-client contract gate

**Files:**
- Create: `scripts/admin-cross-client-contract-check.mjs`
- Modify: `package.json`
- Modify: `docs/final-acceptance-checklist.md`

- [ ] **Step 1: Write the contract gate**

The new script imports `admin/src/router/adminRoutes.js` and `miniapp/utils/admin-policy.js`, and reads protected server route files. It must assert:

```js
assert(hasRouteRole(routeByName.get('ReservationPending'), 'admin'))
assert(hasRouteRole(routeByName.get('CounselorPending'), 'counselor'))
assert(!hasRouteRole(routeByName.get('AccountManage'), 'counselor'))
assert(miniPolicy.can('admin', 'ordinaryApproval'))
assert(!miniPolicy.can('admin', 'counselorApproval'))
assert(miniPolicy.can('counselor', 'posterReview'))
assert(serverAuditSource.includes("requireRole('admin', 'counselor', 'super_admin')"))
assert(serverPosterSource.includes("requireRole('counselor', 'super_admin')"))
```

Also read the miniapp approval pages and admin web reservation API to assert both contain `/audit/pending`, `/audit/`, `/approve`, and `/reject`. Record desktop-only route names and assert they do not appear as mobile capabilities.

Read the web announcement API and the miniapp student announcement request and assert both point to the server's announcement data rather than local samples.

- [ ] **Step 2: Run the gate and fix only real contract differences**

Run: `node scripts/admin-cross-client-contract-check.mjs`

Expected: PASS after Tasks 3-6; any failure must identify the role, feature, or endpoint that drifted.

- [ ] **Step 3: Add the gate to normal commands and acceptance documentation**

Add:

```json
"check:admin-cross-client": "node scripts/admin-cross-client-contract-check.mjs"
```

Include it in `check:all` after `check:admin-miniapp`. Add checklist items for role-visible entries, queue parity, and post-mutation refresh in `docs/final-acceptance-checklist.md`.

- [ ] **Step 4: Run the complete contract and build suite**

Run: `npm run check:admin-navigation-runtime && npm run check:admin-site:roles && npm run check:admin-site:ux && npm run check:admin-miniapp && npm run check:admin-cross-client && npm run check:mobile && npm run check:test-data && npm --prefix admin run test:layout && npm --prefix admin run build`

Expected: every command passes; build warnings may mention existing large chunks but no errors.

- [ ] **Step 5: Commit the drift prevention gate**

```bash
git add scripts/admin-cross-client-contract-check.mjs package.json docs/final-acceptance-checklist.md
git commit -m "test: prevent admin client contract drift"
```

### Task 8: Perform clean runtime and cross-role acceptance

**Files:**
- Modify only if a failing acceptance test exposes a defect in an already listed source file.

- [ ] **Step 1: Stop the old admin process and clear generated Vite dependency cache**

Resolve the listening process for port 5173, stop that exact process, verify the resolved admin cache path is under `D:\敬一书院\jingyi-reservation-system\admin`, and remove only `admin/node_modules/.vite`. Start the admin server again on port 5173 with logs under the ignored `.runlogs` directory.

Expected: backend port 3000 and admin port 5173 are listening.

- [ ] **Step 2: Browser-test super-admin navigation from a cold server**

Log in as the local test super-admin. Set a window marker, click every visible page once, and after each click assert:

```js
({ marker: window.__navAcceptanceMarker, path: location.pathname })
```

Expected: the marker survives, the path equals the selected menu route, the page title changes, browser errors are empty, and the network list contains no new `(Document)` request after login.

- [ ] **Step 3: Browser-test guide and counselor navigation**

Repeat with local guide and counselor test accounts. Confirm forbidden routes are absent, guide pages respect its global/single-building scope, and counselor review/content entries are highlighted and usable.

- [ ] **Step 4: Run miniapp static/runtime acceptance**

Before static checks, create one uniquely named test reservation through the student API, read it through the administrator audit list, approve it through the shared audit endpoint, and read the same reservation again through the student detail endpoint. Assert the final status is `approved`, the relevant pending count decreases by one, and then cancel or otherwise clean up the test record through the supported API.

This proves that a mutation made through the shared administrator contract is visible to the student/mobile data path, rather than only proving that source strings match.

Run:

```bash
npm run check:network
npm run check:admin-miniapp
npm run check:admin-cross-client
npm run check:mobile
npm run check:miniapp-ui
```

If WeChat DevTools CLI is available, compile/preview the project and confirm all registered administrator pages load without missing-component or missing-page errors.

- [ ] **Step 5: Run the full high-risk regression suite**

Run:

```bash
npm run check:reservation-consistency
npm run check:security
npm run check:security-hardening
npm run check:observability-audit
npm run check:acceptance
npm --prefix admin run test:layout
npm --prefix admin run build
```

Expected: all pass.

- [ ] **Step 6: Review the final diff and commit any acceptance-only correction**

Run: `git diff --check && git status --short && git log --oneline -10`

If acceptance required a correction, commit only the related files with `fix: complete admin cross-client acceptance`. Otherwise leave the already committed task history unchanged.

- [ ] **Step 7: Push and confirm the running result**

Push the current branch to its configured GitHub remote, verify local and remote commit hashes match, keep backend and admin running, and open `http://127.0.0.1:5173/`.

Expected: push succeeds, both services are listening, and the browser opens the corrected admin site.
