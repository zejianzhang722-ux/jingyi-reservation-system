# Miniapp Dashboard Card Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every visible administrator dashboard metric card open the correct complete list with a trustworthy preset filter, while preserving role and building scope.

**Architecture:** Reuse the existing reservation, room, and feedback pages. The dashboard emits a small whitelist of navigation targets; destination pages translate their query parameters into API filters. The server owns the combined “actionable” reservation meaning so pagination, role, and building scope remain correct.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, Node.js/Express, existing assertion-based regression scripts.

---

## File map

- `miniapp/pages/admin-home/admin-home.js`: validate metric-card taps, prevent duplicate navigation, and construct destination URLs.
- `miniapp/pages/admin-home/admin-home.wxml`: make trusted metric cards accessible tap targets without nesting the feedback retry action.
- `miniapp/pages/admin-home/admin-home.wxss`: add pressed, arrow, and unavailable states using the existing card style.
- `miniapp/pages/admin-reservation/admin-reservation.js`: whitelist and apply reservation presets.
- `miniapp/pages/admin-reservation/admin-reservation.wxml`: expose the active preset and allow returning to the full list.
- `miniapp/pages/admin-rooms/admin-rooms.js`: accept the open-room preset and pass it to `/room`.
- `miniapp/pages/admin-rooms/admin-rooms.wxml`: show and clear the active status preset.
- `miniapp/pages/admin-feedback/admin-feedback.js`: accept the pending-feedback preset.
- `server/src/controllers/reservationController.js`: implement server-side actionable status filtering under the existing administrator scope.
- `scripts/admin-miniapp-regression-check.js`: cover all card mappings, state guards, target-page presets, and duplicate taps.
- `scripts/mobile-regression-check.js`: cover actionable endpoint results for all administrator roles and building scopes.
- `scripts/admin-cross-client-contract-check.mjs`: lock status/filter semantics shared by the web admin and miniapp.

### Task 1: Lock dashboard metric navigation behavior with failing checks

**Files:**
- Modify: `scripts/admin-miniapp-regression-check.js:865-1112`
- Test: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: Add failing dashboard navigation assertions**

Add cases that load `admin-home.js`, set trusted statistics, tap each target, and assert the exact URL:

```js
const metricTargets = [
  ['ordinary', '/pages/admin-reservation/admin-reservation?preset=ordinary'],
  ['priority', '/pages/admin-reservation/admin-reservation?preset=priority'],
  ['actionable', '/pages/admin-reservation/admin-reservation?preset=actionable'],
  ['today', '/pages/admin-reservation/admin-reservation?preset=today'],
  ['inUse', '/pages/admin-reservation/admin-reservation?preset=in_use'],
  ['openRooms', '/pages/admin-rooms/admin-rooms?status=open'],
  ['feedback', '/pages/admin-feedback/admin-feedback?status=pending']
]
metricTargets.forEach(function(testCase) {
  navCalls.length = 0
  metricPage.onMetricTap.call(metricPage, { currentTarget: { dataset: { target: testCase[0] } } })
  assert(navCalls[0] && navCalls[0].type === 'navigateTo' && navCalls[0].url === testCase[1], testCase[0] + ' 指标应打开正确清单')
  metricPage.onMetricNavigationComplete.call(metricPage)
})
```

Also assert:

```js
metricPage.setData({ hasTrustedStats: false, statsStatus: 'loading' })
navCalls.length = 0
metricPage.onMetricTap.call(metricPage, { currentTarget: { dataset: { target: 'today' } } })
assert(navCalls.length === 0, '无可信统计时不得导航')

metricPage.setData({ hasTrustedStats: true, statsStatus: 'error' })
metricPage.onMetricTap.call(metricPage, { currentTarget: { dataset: { target: 'today' } } })
assert(navCalls.length === 1, '保留可信旧统计时仍可进入实时清单')
metricPage.onMetricTap.call(metricPage, { currentTarget: { dataset: { target: 'today' } } })
assert(navCalls.length === 1, '导航未完成时重复点击不得打开第二页')
```

Verify WXML contains `bindtap="onMetricTap"`, `aria-role="button"`, per-card `data-target`, and `catchtap="onRetryStats"` for the nested feedback retry.

- [ ] **Step 2: Run the check and verify it fails**

Run: `npm run check:admin-miniapp`

Expected: FAIL because `onMetricTap` and the card bindings do not exist.

- [ ] **Step 3: Commit the red test**

```bash
git add scripts/admin-miniapp-regression-check.js
git commit -m "test: define dashboard metric navigation"
```

### Task 2: Make dashboard cards safe, accessible navigation targets

**Files:**
- Modify: `miniapp/pages/admin-home/admin-home.js:8-349`
- Modify: `miniapp/pages/admin-home/admin-home.wxml:31-71`
- Modify: `miniapp/pages/admin-home/admin-home.wxss:25-36`
- Test: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: Add a whitelist and guarded navigation handler**

Add the mapping outside `Page`:

```js
var METRIC_TARGETS = {
  ordinary: '/pages/admin-reservation/admin-reservation?preset=ordinary',
  priority: '/pages/admin-reservation/admin-reservation?preset=priority',
  actionable: '/pages/admin-reservation/admin-reservation?preset=actionable',
  today: '/pages/admin-reservation/admin-reservation?preset=today',
  inUse: '/pages/admin-reservation/admin-reservation?preset=in_use',
  openRooms: '/pages/admin-rooms/admin-rooms?status=open',
  feedback: '/pages/admin-feedback/admin-feedback?status=pending'
}
```

Add methods that re-check login, role, target capability, and trusted statistics immediately before navigation:

```js
onMetricTap: function(event) {
  var target = event && event.currentTarget && event.currentTarget.dataset.target
  var url = METRIC_TARGETS[target]
  var role = auth.getUserRole()
  if (!url || this._metricNavigating || !this.ensureAdmin()) return
  if (!this.data.hasTrustedStats) {
    wx.showToast({ title: '统计尚未加载，请稍后重试', icon: 'none' })
    return
  }
  if (target === 'priority' && !adminPolicy.can(role, 'counselorApproval')) return
  if (target === 'feedback' && !adminPolicy.can(role, 'feedbackManage')) return
  this._metricNavigating = true
  wx.navigateTo({
    url: url,
    fail: this.onMetricNavigationComplete.bind(this),
    complete: this.onMetricNavigationComplete.bind(this)
  })
},
onMetricNavigationComplete: function() {
  this._metricNavigating = false
}
```

- [ ] **Step 2: Bind each card and keep retry isolated**

Give every visible card `class="stat-card metric-card {{hasTrustedStats ? '' : 'unavailable'}}"`, its `data-target`, `bindtap`, `hover-class="metric-card-pressed"`, `aria-role="button"`, and a descriptive `aria-label`. Add a shared visual arrow:

```xml
<text class="metric-card-arrow" aria-hidden="true">›</text>
```

Change the feedback retry to `catchtap="onRetryStats"` so it never bubbles into navigation.

- [ ] **Step 3: Add restrained interaction styles**

```css
.metric-card { position: relative; padding-right: 44rpx; text-align: left; }
.metric-card-pressed { transform: scale(0.985); background: #f7faff; }
.metric-card.unavailable { opacity: .68; }
.metric-card-arrow { position: absolute; right: 20rpx; top: 50%; transform: translateY(-50%); color: #98a2b3; font-size: 38rpx; }
```

- [ ] **Step 4: Run the dashboard check and verify it passes**

Run: `npm run check:admin-miniapp`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add miniapp/pages/admin-home/admin-home.js miniapp/pages/admin-home/admin-home.wxml miniapp/pages/admin-home/admin-home.wxss
git commit -m "feat: link dashboard metrics to workflows"
```

### Task 3: Add reservation-page preset filters

**Files:**
- Modify: `scripts/admin-miniapp-regression-check.js:1113-1462`
- Modify: `miniapp/pages/admin-reservation/admin-reservation.js:1-151`
- Modify: `miniapp/pages/admin-reservation/admin-reservation.wxml:1-15`
- Test: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: Write failing preset tests**

For each preset, create a fresh page, call `onLoad`, then `onShow`, and inspect the `/reservation` request:

```js
const presetCases = [
  ['ordinary', { status: 'pending' }, '普通待审'],
  ['priority', { status: 'counselor_pending' }, '重点待审'],
  ['actionable', { actionable: 1 }, '全部可处理'],
  ['in_use', { status: 'checked_in' }, '使用中']
]
```

Stub the page date helper to `2026-07-22` and assert `preset=today` requests `{ date: '2026-07-22' }`. Assert an unknown preset sends neither `status`, `actionable`, nor `date`. Assert an `admin` role opening `priority` falls back to `ordinary` before requesting data.

- [ ] **Step 2: Run the check and verify it fails**

Run: `npm run check:admin-miniapp`

Expected: FAIL because `onLoad` ignores presets.

- [ ] **Step 3: Implement the preset whitelist**

Add:

```js
var PRESETS = {
  ordinary: { label: '普通待审', status: 'pending' },
  priority: { label: '重点待审', status: 'counselor_pending', capability: 'counselorApproval' },
  actionable: { label: '全部可处理', actionable: 1 },
  today: { label: '今日预约', today: true },
  in_use: { label: '使用中', status: 'checked_in' }
}
```

Store `filterPreset`, `filterLabel`, and `filterDate`. In `onLoad(options)`, select only a known preset, downgrade unauthorized `priority` to `ordinary`, and generate the local `YYYY-MM-DD` date through a small `todayString()` helper. In `loadData`, build params exclusively from the normalized page state:

```js
if (this.data.filterStatus) params.status = this.data.filterStatus
if (this.data.filterPreset === 'actionable') params.actionable = 1
if (this.data.filterDate) params.date = this.data.filterDate
```

- [ ] **Step 4: Make the active preset visible and clearable**

Add a context row above the existing tabs:

```xml
<view class="preset-context" wx:if="{{filterLabel}}">
  <text>当前查看：{{filterLabel}}</text>
  <view bindtap="onClearPreset" aria-role="button" aria-label="清除当前筛选">查看全部</view>
</view>
```

`onClearPreset` clears `filterPreset`, `filterLabel`, `filterStatus`, and `filterDate`, resets the page, and reloads.

- [ ] **Step 5: Run the check and commit**

Run: `npm run check:admin-miniapp`

Expected: PASS.

```bash
git add scripts/admin-miniapp-regression-check.js miniapp/pages/admin-reservation/admin-reservation.js miniapp/pages/admin-reservation/admin-reservation.wxml
git commit -m "feat: support reservation list presets"
```

### Task 4: Make actionable filtering authoritative on the server

**Files:**
- Modify: `server/src/controllers/reservationController.js:8-66`
- Modify: `scripts/mobile-regression-check.js:100-180`
- Modify: `scripts/admin-cross-client-contract-check.mjs:300-390`
- Test: `scripts/mobile-regression-check.js`
- Test: `scripts/admin-cross-client-contract-check.mjs`

- [ ] **Step 1: Add failing API checks**

After logging in as each administrator role, request `/reservation?actionable=1&page=1&pageSize=100` and assert:

```js
assert(adminRows.every((row) => row.status === 'pending'), '导生可处理列表只能包含普通待审')
assert(counselorRows.every((row) => ['pending', 'counselor_pending'].includes(row.status)), '辅导员可处理列表只能包含其两级待审')
assert(superRows.every((row) => ['pending', 'counselor_pending'].includes(row.status)), '超级管理员可处理列表只能包含其两级待审')
assert(buildingRows.every((row) => Number(row.buildingId || row.building_id) === 1), '楼栋导生可处理列表不得越过楼栋范围')
```

Add a contract assertion that the miniapp uses `actionable=1`, the server recognizes it, and the web/mobile status meanings remain `pending` and `counselor_pending`.

- [ ] **Step 2: Run tests and verify the new assertions fail**

Run:

```powershell
$env:AVATAR_TEST_IMAGE=(Resolve-Path 'miniapp/images/default-avatar.png').Path
npm run check:mobile
npm run check:admin-cross-client
```

Expected: FAIL because `/reservation` currently ignores `actionable`.

- [ ] **Step 3: Add actionable status filtering before pagination**

In `reservationController.list`:

```js
const actionableOnly = String(req.query.actionable || '') === '1'
const actionableStatuses = userRole === 'admin'
  ? ['pending']
  : ['pending', 'counselor_pending']
```

Reject `actionable=1` for non-admin users with 403. For mock data, omit the single `status` option and filter the scoped rows by `actionableStatuses` before sorting and pagination. For MySQL, add a parameterized `IN` clause before the single-status branch:

```js
if (actionableOnly) {
  where += ' AND r.status IN (' + actionableStatuses.map(function() { return '?' }).join(',') + ')'
  Array.prototype.push.apply(params, actionableStatuses)
} else if (status) {
  where += ' AND r.status = ?'
  params.push(status)
}
```

Use the same `where` and parameters for rows and count.

- [ ] **Step 4: Run API and contract checks**

Run:

```powershell
$env:AVATAR_TEST_IMAGE=(Resolve-Path 'miniapp/images/default-avatar.png').Path
npm run check:mobile
npm run check:admin-cross-client
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/reservationController.js scripts/mobile-regression-check.js scripts/admin-cross-client-contract-check.mjs
git commit -m "feat: filter actionable reservations by role"
```

### Task 5: Add open-room and pending-feedback presets

**Files:**
- Modify: `scripts/admin-miniapp-regression-check.js`
- Modify: `miniapp/pages/admin-rooms/admin-rooms.js:1-103`
- Modify: `miniapp/pages/admin-rooms/admin-rooms.wxml:1-25`
- Modify: `miniapp/pages/admin-feedback/admin-feedback.js:1-45`
- Test: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: Write failing target-page tests**

Assert `admin-rooms.onLoad({ status: 'open' })` causes the next `/room` request to include `{ status: 'open' }`, an unknown status is ignored, and clearing the status reloads all rooms. Assert `admin-feedback.onLoad({ status: 'pending' })` sets `filterStatus` before its `onShow` request. Assert an unauthorized admin is redirected before a feedback request.

- [ ] **Step 2: Run the check and verify it fails**

Run: `npm run check:admin-miniapp`

Expected: FAIL because both `onLoad` methods ignore query options.

- [ ] **Step 3: Implement the room preset**

Add `filterStatus` to room data, whitelist only `open`, `closed`, and `maintenance`, pass it to `/room`, and add `onClearStatus`:

```js
if (this.data.filterStatus) params.status = this.data.filterStatus
```

Show the active “开放中” preset above the room type tabs with a “查看全部” action. Keep type filtering compatible with the status preset.

- [ ] **Step 4: Implement the feedback preset**

Change `onLoad` to accept options only after `ensureFeedbackAccess()` succeeds:

```js
onLoad: function(options) {
  if (!this.ensureFeedbackAccess()) return
  var status = options && options.status
  this.setData({ filterStatus: status === 'pending' || status === 'resolved' ? status : '' })
}
```

- [ ] **Step 5: Run the check and commit**

Run: `npm run check:admin-miniapp`

Expected: PASS.

```bash
git add scripts/admin-miniapp-regression-check.js miniapp/pages/admin-rooms/admin-rooms.js miniapp/pages/admin-rooms/admin-rooms.wxml miniapp/pages/admin-feedback/admin-feedback.js
git commit -m "feat: preset room and feedback lists"
```

### Task 6: Verify login recovery, runtime speed, and the complete workflow

**Files:**
- Modify only if a failing check identifies a repository defect.
- Test: `scripts/admin-miniapp-regression-check.js`
- Test: `scripts/mobile-regression-check.js`
- Test: `scripts/admin-cross-client-contract-check.mjs`

- [ ] **Step 1: Confirm the backend dependency before opening the miniapp**

Run:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health -TimeoutSec 5
```

Expected: `code=200` within one second. If port 3000 is not listening, start `npm --prefix server start`, measure the time to health, and inspect MySQL/Redis fallback output before proceeding.

- [ ] **Step 2: Run focused checks**

```powershell
npm run check:admin-miniapp
$env:AVATAR_TEST_IMAGE=(Resolve-Path 'miniapp/images/default-avatar.png').Path
npm run check:mobile
npm run check:admin-cross-client
npm run check:miniapp-ui
```

Expected: all commands PASS.

- [ ] **Step 3: Run the complete regression suite**

Run:

```powershell
$env:AVATAR_TEST_IMAGE=(Resolve-Path 'miniapp/images/default-avatar.png').Path
npm run check:all
```

Expected: PASS; the MySQL-only concurrency check may explicitly skip when no safe test database is configured.

- [ ] **Step 4: Verify WeChat DevTools locally**

Use the official CLI `open` command against `miniapp` and the live IDE HTTP port. Do not run `preview` or `upload` without separate authorization. Confirm the login route opens, the backend remains healthy, and at least one test administrator login reaches `pages/admin-home/admin-home`. If automation waits longer than 15 seconds, stop it and inspect the actual automation port and the latest DevTools log instead of waiting indefinitely.

- [ ] **Step 5: Review and commit any acceptance-only changes**

Run:

```bash
git diff --check
git status --short
```

Expected: no uncommitted source changes. If a focused acceptance note is updated, commit only that note with `docs: record dashboard navigation acceptance`.

