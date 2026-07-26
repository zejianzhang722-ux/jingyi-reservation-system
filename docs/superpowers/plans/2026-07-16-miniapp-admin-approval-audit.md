# 管理员小程序审批与数据体验优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理员小程序改造成角色边界清晰、审批依据完整、统计口径一致且失败状态可信的移动审批工作台。

**Architecture:** 以 `admin-policy` 负责角色决策，以新增的审批展示转换器统一接口字段，以受管理员范围约束的统计接口作为首页和统计页唯一数据来源。普通预约保留确认后的快速处理，重点预约必须进入管理员专用详情；所有页面继续使用现有请求封装和版本号机制防止旧响应覆盖。

**Tech Stack:** 微信小程序原生 WXML/WXSS/JavaScript、Node.js、Express、现有模拟数据库、现有脚本式回归检查。

---

## 文件结构与职责

- `miniapp/utils/admin-policy.js`：角色能力、默认审核队列和可操作状态。
- `miniapp/utils/admin-approval-presenter.js`：新增；统一预约字段、房间类型、状态标签和卡片展示数据。
- `miniapp/pages/admin-home/*`：审批工作台、队列切换、状态反馈和普通快速审批。
- `miniapp/pages/admin-reservation-detail/*`：新增；管理员专用预约详情与重点审批入口。
- `miniapp/pages/admin-reservation/*`：全部预约列表，统一跳转管理员详情并限制快捷处理。
- `miniapp/pages/admin-stats/*`：显示可信的范围统计和使用排行。
- `miniapp/pages/admin-manage/*`：角色菜单及两类待办数量。
- `miniapp/pages/admin-profile/*`：账号与设置，使用管理员语言。
- `miniapp/components/admin-nav/*`：管理员底部导航，不重启页面栈。
- `server/src/controllers/scopedStatsController.js`：管理员范围内统计和模拟/数据库统一输出。
- `server/src/controllers/reservationController.js`：管理员详情所需的信用与账号状态字段。
- `scripts/admin-miniapp-regression-check.js`：页面逻辑、角色变化、错误状态和导航回归。
- `scripts/mobile-regression-check.js`：真实接口角色范围、统计字段和详情字段回归。
- `scripts/admin-cross-client-contract-check.mjs`：后台与管理员小程序共用字段和审批接口门禁。
- `docs/final-acceptance-checklist.md`：最终人工与自动验收项。

### Task 1: 锁定角色默认队列和审批展示契约

**Files:**
- Modify: `miniapp/utils/admin-policy.js`
- Create: `miniapp/utils/admin-approval-presenter.js`
- Modify: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: 先写角色与展示转换的失败检查**

在 `scripts/admin-miniapp-regression-check.js` 的策略检查后加入：

```js
assert(adminPolicy.defaultQueueType('admin') === 'admin', '导生管理员默认进入普通审核')
assert(adminPolicy.defaultQueueType('counselor') === 'counselor', '辅导员默认进入重点审核')
assert(adminPolicy.defaultQueueType('super_admin') === 'counselor', '超级管理员默认优先进入重点审核')
assert(adminPolicy.canQuickApprove('admin', 'pending'), '导生管理员可快速处理普通待审')
assert(!adminPolicy.canQuickApprove('counselor', 'counselor_pending'), '重点待审不得在卡片直接通过')

const approvalPresenter = require('../miniapp/utils/admin-approval-presenter')
const priorityCard = approvalPresenter.toCard({
  id: 5,
  user_name: '李四',
  student_id: '2024001002',
  room_name: 'C128影音室',
  room_type: 'media_room',
  building_id: 2,
  date: '2026-07-17',
  start_time: '14:00',
  end_time: '17:00',
  purpose: '观影活动',
  participants: 20,
  status: 'counselor_pending'
})
assert(priorityCard.userName === '李四' && priorityCard.studentId === '2024001002', '审批卡应统一姓名和学号')
assert(priorityCard.roomTypeLabel === '影音室' && priorityCard.buildingLabel === 'C座', '审批卡应显示空间类型和楼栋')
assert(priorityCard.queueLabel === '重点待审' && priorityCard.isPriority, '重点预约应有文字标签')
```

- [ ] **Step 2: 运行检查并确认红灯**

Run: `npm run check:admin-miniapp`

Expected: FAIL，提示 `defaultQueueType`、`canQuickApprove` 或 `admin-approval-presenter` 尚不存在。

- [ ] **Step 3: 实现最小角色决策函数**

在 `miniapp/utils/admin-policy.js` 增加并导出：

```js
function defaultQueueType(role) {
  return role === 'counselor' || role === 'super_admin' ? 'counselor' : 'admin'
}

function canQuickApprove(role, status) {
  return status === 'pending' && can(role, 'ordinaryApproval')
}
```

保留 `queueType(role, preferred)` 的越权降级行为。

- [ ] **Step 4: 创建统一审批展示转换器**

在 `miniapp/utils/admin-approval-presenter.js` 定义 `ROOM_TYPE_LABELS`、`BUILDING_LABELS` 和 `toCard`：

```js
var ROOM_TYPE_LABELS = {
  study_room: '自习室', seminar_room: '共享空间', media_room: '影音室',
  competition_room: '备赛间', roadshow_space: '路演空间', dance_room: '舞蹈室',
  reading_room: '阅览室', multi_purpose_hall: '多功能厅', party_room: '党团活动室'
}
var BUILDING_LABELS = { 1: 'B座', 2: 'C座', 3: 'D座' }

function valueOf(row, keys) {
  for (var i = 0; i < keys.length; i += 1) {
    if (row && row[keys[i]] !== undefined && row[keys[i]] !== null) return row[keys[i]]
  }
  return ''
}

function toCard(row) {
  var status = valueOf(row, ['status'])
  var startTime = valueOf(row, ['startTime', 'start_time'])
  var endTime = valueOf(row, ['endTime', 'end_time'])
  var buildingId = Number(valueOf(row, ['buildingId', 'building_id']))
  return Object.assign({}, row, {
    id: Number(valueOf(row, ['id'])),
    userName: valueOf(row, ['userName', 'user_name', 'real_name', 'nickname']) || '姓名未提供',
    studentId: valueOf(row, ['studentId', 'student_id', 'student_no']) || '学号未提供',
    roomName: valueOf(row, ['roomName', 'room_name']) || '房间未提供',
    roomTypeLabel: ROOM_TYPE_LABELS[valueOf(row, ['roomType', 'room_type'])] || '其他空间',
    buildingLabel: BUILDING_LABELS[buildingId] || '全院',
    date: valueOf(row, ['date']),
    timeSlot: startTime && endTime ? startTime + '-' + endTime : valueOf(row, ['timeSlot']),
    purpose: valueOf(row, ['purpose']) || '用途未填写',
    participants: Number(valueOf(row, ['participants', 'participantCount', 'participant_count'])) || 0,
    status: status,
    isPriority: status === 'counselor_pending',
    queueLabel: status === 'counselor_pending' ? '重点待审' : '普通待审'
  })
}

module.exports = { ROOM_TYPE_LABELS: ROOM_TYPE_LABELS, toCard: toCard }
```

- [ ] **Step 5: 运行检查并提交**

Run: `npm run check:admin-miniapp && git diff --check`

Expected: PASS。

```bash
git add miniapp/utils/admin-policy.js miniapp/utils/admin-approval-presenter.js scripts/admin-miniapp-regression-check.js
git commit -m "feat: define mobile approval presentation rules"
```

### Task 2: 统一管理员范围统计与模拟数据结构

**Files:**
- Modify: `server/src/controllers/scopedStatsController.js`
- Modify: `scripts/mobile-regression-check.js`
- Modify: `scripts/admin-cross-client-contract-check.mjs`

- [ ] **Step 1: 为真实接口增加失败断言**

在 `scripts/mobile-regression-check.js` 登录导生、辅导员和超级管理员后请求 `/stats/dashboard` 与 `/stats/usage-rate`，加入：

```js
function assertDashboardContract(payload, label) {
  assert(Number.isInteger(payload.ordinaryPendingCount), label + ' 缺少普通待审数')
  assert(Number.isInteger(payload.counselorPendingCount), label + ' 缺少重点待审数')
  assert(Number.isInteger(payload.actionablePendingCount), label + ' 缺少可处理待审总数')
  assert(Number.isInteger(payload.activeRoomCount), label + ' 缺少开放房间数')
}

function assertUsageContract(rows, label) {
  assert(Array.isArray(rows), label + ' 使用排行应为数组')
  rows.forEach(function(row) {
    assert(row.room_id && row.room_name, label + ' 排行缺少房间标识或名称')
    assert(Number.isInteger(row.reservation_count), label + ' 预约次数必须为整数')
    assert(Number.isInteger(row.used_days), label + ' 使用天数必须为整数')
  })
}
```

并断言导生管理员的 `activeRoomCount` 小于全院超级管理员，导生的 `counselorPendingCount === 0`。

- [ ] **Step 2: 运行移动端检查并确认红灯**

Run: `$env:AVATAR_TEST_IMAGE=(Resolve-Path 'miniapp/images/default-avatar.png').Path; npm run check:mobile`

Expected: FAIL，统计结果缺少四个新字段，模拟使用排行缺少统一字段。

- [ ] **Step 3: 扩展模拟统计结果**

在 `buildMockDashboard(req)` 中分别计算：

```js
var ordinaryPendingCount = reservations.filter(function(row) { return row.status === 'pending' }).length
var rawCounselorCount = reservations.filter(function(row) { return row.status === 'counselor_pending' }).length
var canSeeCounselor = req.adminScope && ['counselor', 'super_admin'].includes(req.adminScope.role)
var counselorPendingCount = canSeeCounselor ? rawCounselorCount : 0
```

返回：

```js
ordinaryPendingCount: ordinaryPendingCount,
counselorPendingCount: counselorPendingCount,
actionablePendingCount: ordinaryPendingCount + counselorPendingCount,
activeRoomCount: rooms.filter(function(room) { return room.status === 'open' }).length,
```

保留旧 `pendingCount`，其值等于 `actionablePendingCount`，用于后台兼容。

- [ ] **Step 4: 扩展 MySQL 统计结果**

复用现有 `count(condition, params)`，计算：

```js
const ordinaryPendingCount = await count("r.status = 'pending'", []);
const rawCounselorPendingCount = await count("r.status = 'counselor_pending'", []);
const canSeeCounselor = ['counselor', 'super_admin'].includes(req.adminScope.role);
const counselorPendingCount = canSeeCounselor ? rawCounselorPendingCount : 0;
const activeRoomCount = Number((await db.query(
  "SELECT COUNT(*) AS count FROM rooms rm WHERE rm.status = 'open'" + scope.sql,
  scope.params
))[0][0].count || 0);
```

返回与模拟模式相同的四个字段，并让 `pendingCount` 等于可操作总数。

- [ ] **Step 5: 为模拟使用排行提供显式实现**

在 `usageRate(req)` 的数据库查询前加入 `db.isMock()` 分支，从 `mock-db.__tables` 按角色楼栋范围过滤房间和预约，返回：

```js
{
  room_id: Number(room.id),
  room_name: room.name,
  room_type: room.type,
  reservation_count: matchingRows.length,
  used_days: new Set(matchingRows.map(function(row) { return row.date })).size
}
```

仅保留 `reservation_count > 0` 的房间，并按次数、名称排序。

- [ ] **Step 6: 增加跨端字段门禁并验证**

在 `scripts/admin-cross-client-contract-check.mjs` 断言后台与小程序只消费上述统一字段，禁止再次出现：

```js
reservation_count / 30
data.activeRooms || 12
item.room_name
```

其中 `item.room_name` 的禁用仅限定在 `admin-stats.js/wxml`，审批原始接口兼容字段不受影响。

Run: `$env:AVATAR_TEST_IMAGE=(Resolve-Path 'miniapp/images/default-avatar.png').Path; npm run check:mobile; npm run check:admin-cross-client`

Expected: PASS。

- [ ] **Step 7: 提交统计契约**

```bash
git add server/src/controllers/scopedStatsController.js scripts/mobile-regression-check.js scripts/admin-cross-client-contract-check.mjs
git commit -m "fix: unify scoped mobile admin statistics"
```

### Task 3: 重构审批工作台与错误状态

**Files:**
- Modify: `miniapp/pages/admin-home/admin-home.js`
- Modify: `miniapp/pages/admin-home/admin-home.wxml`
- Modify: `miniapp/pages/admin-home/admin-home.wxss`
- Modify: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: 写队列切换、重点限制和失败状态检查**

扩展页面测试，要求：

```js
assert(homePage.data.queueType === 'admin', '导生管理员默认普通队列')
assert(counselorHome.data.queueType === 'counselor', '辅导员默认重点队列')
assert(superHome.data.queueType === 'counselor', '超级管理员默认重点队列')
assert(typeof superHome.onQueueChange === 'function', '工作台应在页内切换队列')
assert(homeWxml.indexOf('<navigator class="tab') === -1, '队列切换不得重复导航到当前页面')
assert(homeWxml.indexOf('加载失败') !== -1 && homeWxml.indexOf('重新加载') !== -1, '工作台应有失败重试状态')
assert(homeWxml.indexOf('item.purpose') !== -1 && homeWxml.indexOf('item.participants') !== -1, '卡片应显示用途和人数')
assert(homeWxml.indexOf("queueType === 'admin'") !== -1, '只有普通队列可显示卡片快捷操作')
```

模拟 `/audit/pending` 失败后断言 `listStatus === 'error'`，不得断言空列表就是空状态。

- [ ] **Step 2: 运行页面检查并确认红灯**

Run: `npm run check:admin-miniapp`

Expected: FAIL，缺少页内切换、错误状态和卡片字段。

- [ ] **Step 3: 重构工作台状态**

将首页数据改为：

```js
queueType: 'admin',
ordinaryPendingCount: 0,
counselorPendingCount: 0,
actionablePendingCount: 0,
activeRoomCount: 0,
listStatus: 'loading',
listError: '',
pendingList: []
```

`onLoad` 使用 `adminPolicy.defaultQueueType(role)`，只有 URL 明确传入且角色有权时才覆盖默认值。

- [ ] **Step 4: 用统一统计接口替换混合数据源**

`loadStats` 只请求 `/stats/dashboard`，将四个待办/房间字段和今日预约、使用中写入页面；反馈数量仍按权限独立请求。删除 `/room/stats` 和固定数字回退。

- [ ] **Step 5: 实现页内队列切换和可信状态**

新增：

```js
onQueueChange: function(e) {
  var requested = e.currentTarget.dataset.type
  var next = adminPolicy.queueType(auth.getUserRole(), requested)
  if (next === this.data.queueType) return
  this.setData({ queueType: next, listStatus: 'loading', pendingList: [] })
  this.loadPendingList()
},
onRetryList: function() {
  this.setData({ listStatus: 'loading', listError: '' })
  this.loadPendingList()
}
```

成功时用 `approvalPresenter.toCard` 转换列表并设置 `ready` 或 `empty`；失败时保留错误文案并设置 `error`。

- [ ] **Step 6: 重写工作台结构与触控尺寸**

WXML 顺序固定为：角色头部、分段队列、重点说明、扫码签到、指标卡、列表状态、审批卡片。重点队列卡片仅提供“查看并审核”；普通队列提供“查看详情、通过、拒绝”。

WXSS 要求：

```css
.queue-tabs { display: flex; padding: 8rpx; background: #e9eef5; border-radius: 16rpx; }
.queue-tab { flex: 1; min-height: 72rpx; display: flex; align-items: center; justify-content: center; }
.btn-approve, .btn-reject, .btn-detail { min-height: 88rpx; display: flex; align-items: center; justify-content: center; }
.container { padding-bottom: calc(180rpx + env(safe-area-inset-bottom)); }
.state-card { background: #fff; border-radius: 16rpx; padding: 44rpx 28rpx; text-align: center; }
```

- [ ] **Step 7: 验证并提交**

Run: `npm run check:admin-miniapp && npm run check:miniapp-ui && git diff --check`

Expected: PASS。

```bash
git add miniapp/pages/admin-home scripts/admin-miniapp-regression-check.js
git commit -m "feat: redesign mobile approval workbench"
```

### Task 4: 新增管理员专用预约详情

**Files:**
- Modify: `server/src/controllers/reservationController.js`
- Create: `miniapp/pages/admin-reservation-detail/admin-reservation-detail.js`
- Create: `miniapp/pages/admin-reservation-detail/admin-reservation-detail.json`
- Create: `miniapp/pages/admin-reservation-detail/admin-reservation-detail.wxml`
- Create: `miniapp/pages/admin-reservation-detail/admin-reservation-detail.wxss`
- Modify: `miniapp/app.json`
- Modify: `miniapp/pages/admin-home/admin-home.js`
- Modify: `miniapp/pages/admin-reservation/admin-reservation.js`
- Modify: `scripts/admin-miniapp-regression-check.js`
- Modify: `scripts/mobile-regression-check.js`

- [ ] **Step 1: 写管理员详情接口和页面失败检查**

在真实接口检查中用导生、辅导员分别读取范围内预约详情，断言：

```js
assert(detail.json.data.credit_score !== undefined, '管理员详情缺少信用分')
assert(detail.json.data.user_status, '管理员详情缺少账号状态')
```

页面回归断言：

```js
assert(appJson.pages.indexOf('pages/admin-reservation-detail/admin-reservation-detail') !== -1, '应注册管理员详情页')
assert(adminDetailWxml.indexOf('我的预约') === -1, '管理员详情不得出现宿生入口')
assert(adminDetailWxml.indexOf('取消预约') === -1, '管理员详情不得取消宿生预约')
assert(adminDetailWxml.indexOf('信用分') !== -1, '管理员详情应显示信用状态')
```

- [ ] **Step 2: 运行检查并确认红灯**

Run: `npm run check:admin-miniapp`

Expected: FAIL，详情页尚不存在。

- [ ] **Step 3: 扩展预约详情安全字段**

在 `reservationController.detail` 查询中加入：

```sql
u.credit_score, u.status AS user_status
```

返回数据中保留 `credit_score` 和 `user_status`，不返回宿生密码、卡号或其他敏感字段。现有 `optionalAdminReservationScope` 继续负责楼栋边界。

- [ ] **Step 4: 实现管理员详情页面状态和角色保护**

页面数据包含：

```js
reservation: null,
pageStatus: 'loading',
errorMessage: '',
canApprove: false,
canReject: false,
processing: false
```

`ensureAccess` 要求管理员登录和 `reservationView`；请求 `/reservation/:id` 后用 `approvalPresenter.toCard` 转换，并用 `adminPolicy.can(role, 'ordinaryApproval')`、`adminPolicy.can(role, 'counselorApproval')` 与预约状态共同决定按钮。

重点预约只在此页显示通过/拒绝。接口失败设置 `pageStatus: 'error'`，不得构造备用预约。

- [ ] **Step 5: 实现详情结构和审批操作**

WXML 包含状态、预约信息、申请人信息、信用信息、审批说明和底部操作区。通过使用二次确认；拒绝使用可编辑弹窗且理由必填；提交成功后刷新详情并通过 `getOpenerEventChannel` 可用时通知来源页刷新。

- [ ] **Step 6: 修改列表跳转**

`admin-home.js` 和 `admin-reservation.js` 的详情跳转统一为：

```js
wx.navigateTo({
  url: '/pages/admin-reservation-detail/admin-reservation-detail?id=' + id
})
```

全部预约列表的 `canQuickAudit` 仅对 `pending` 为真；`counselor_pending` 只显示“查看并审核”。

- [ ] **Step 7: 运行接口与页面检查并提交**

Run: `$env:AVATAR_TEST_IMAGE=(Resolve-Path 'miniapp/images/default-avatar.png').Path; npm run check:mobile; npm run check:admin-miniapp`

Expected: PASS。

```bash
git add server/src/controllers/reservationController.js miniapp/pages/admin-reservation-detail miniapp/app.json miniapp/pages/admin-home/admin-home.js miniapp/pages/admin-reservation/admin-reservation.js scripts/admin-miniapp-regression-check.js scripts/mobile-regression-check.js
git commit -m "feat: add mobile admin reservation detail"
```

### Task 5: 修复统计页面显示语义

**Files:**
- Modify: `miniapp/pages/admin-stats/admin-stats.js`
- Modify: `miniapp/pages/admin-stats/admin-stats.wxml`
- Modify: `miniapp/pages/admin-stats/admin-stats.wxss`
- Modify: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: 写字段、空状态和伪百分比失败检查**

加入：

```js
assert(statsSource.indexOf('reservation_count / 30') === -1, '统计页不得用预约次数伪造使用率')
assert(statsWxml.indexOf('item.roomName') !== -1, '排行应使用统一展示字段')
assert(statsWxml.indexOf('item.displayRate') === -1, '排行不得显示伪百分比')
assert(statsWxml.indexOf('加载失败') !== -1 && statsWxml.indexOf('重新加载') !== -1, '统计页应提供失败重试')
```

- [ ] **Step 2: 运行检查并确认红灯**

Run: `npm run check:admin-miniapp`

Expected: FAIL，旧百分比和旧字段仍存在。

- [ ] **Step 3: 统一统计页面数据模型**

删除 `formatPercent`。把使用排行转换为：

```js
var usageRows = (results[1] || []).map(function(item) {
  return {
    roomId: Number(item.room_id),
    roomName: item.room_name,
    reservationCount: Number(item.reservation_count || 0),
    usedDays: Number(item.used_days || 0)
  }
})
```

增加 `pageStatus` 和 `errorMessage`，失败时显示重试而不是保留全零卡片。

- [ ] **Step 4: 更新统计页面结构**

顶部指标显示今日预约、普通待审、重点待审、使用中；导生管理员隐藏重点待审卡并显示开放房间数。排行每行显示：

```text
房间名称
N 次有效预约 · N 天有使用
```

删除右侧百分比。没有有效记录时显示“近 30 天暂无已通过或已使用预约”。

- [ ] **Step 5: 验证并提交**

Run: `npm run check:admin-miniapp && npm run check:miniapp-ui && npm run check:admin-cross-client`

Expected: PASS。

```bash
git add miniapp/pages/admin-stats scripts/admin-miniapp-regression-check.js
git commit -m "fix: present trustworthy mobile usage statistics"
```

### Task 6: 对齐管理中心、账号设置和底部导航

**Files:**
- Modify: `miniapp/pages/admin-manage/admin-manage.js`
- Modify: `miniapp/pages/admin-manage/admin-manage.wxml`
- Modify: `miniapp/pages/admin-manage/admin-manage.wxss`
- Modify: `miniapp/pages/admin-profile/admin-profile.js`
- Modify: `miniapp/pages/admin-profile/admin-profile.json`
- Modify: `miniapp/pages/admin-profile/admin-profile.wxml`
- Modify: `miniapp/components/admin-nav/admin-nav.js`
- Modify: `miniapp/components/admin-nav/admin-nav.wxml`
- Modify: `miniapp/components/admin-nav/admin-nav.wxss`
- Modify: `miniapp/custom-tab-bar/index.js`
- Modify: `scripts/admin-miniapp-regression-check.js`

- [ ] **Step 1: 写导航、文案和待办数量失败检查**

加入：

```js
assert(manageSource.indexOf("name: '普通预约审核'") !== -1, '管理中心应明确普通审核')
assert(manageSource.indexOf("name: '重点预约审核'") !== -1, '管理中心应明确重点审核')
assert(profileJson.navigationBarTitleText === '账号与设置', '我的页标题应为账号与设置')
assert(profileSource.indexOf("name: '连接检查'") !== -1, '网络诊断应改为管理员语言')
assert(navSource.indexOf('wx.reLaunch') === -1, '管理员底部导航不得重新启动页面栈')
assert(navWxml.indexOf('admin-nav-icon">⌂') === -1, '底部导航不得使用字符图标')
```

- [ ] **Step 2: 运行检查并确认红灯**

Run: `npm run check:admin-miniapp`

Expected: FAIL，旧文案、重新启动和字符图标仍存在。

- [ ] **Step 3: 为管理中心加载待办数量**

`admin-manage.js` 在 `onShow` 请求 `/stats/dashboard`，把 `ordinaryPendingCount` 和 `counselorPendingCount` 写入对应菜单项的 `badge`。请求失败时保留入口但隐藏数量，不阻止其他菜单使用。

名称改为“普通预约审核”“重点预约审核”，说明分别写为“处理共享空间等普通待审预约”和“处理需辅导员把关的特殊空间预约”。

- [ ] **Step 4: 调整账号设置内容**

把 `admin-profile.json` 标题改为“账号与设置”；菜单键 `network` 保留，显示名称改为“连接检查”，说明改为“检查当前是否能正常连接预约服务”。账号安全说明根据角色显示“请联系超级管理员处理”或“请在电脑后台管理账号安全”。

- [ ] **Step 5: 修改管理员底部导航**

`admin-nav.js` 使用现有真实图片资源：审批复用预约图标、管理复用首页图标、我的复用个人图标，并提供选中态路径：

```js
{ key: 'home', text: '审批', iconPath: '/images/tab-reservation.png', selectedIconPath: '/images/tab-reservation-active.png', url: '/pages/admin-home/admin-home' }
{ key: 'manage', text: '管理', iconPath: '/images/tab-home.png', selectedIconPath: '/images/tab-home-active.png', url: '/pages/admin-manage/admin-manage' }
{ key: 'profile', text: '我的', iconPath: '/images/tab-profile.png', selectedIconPath: '/images/tab-profile-active.png', url: '/pages/admin-profile/admin-profile' }
```

WXML 使用 `<image mode="aspectFit">`；页面切换用 `wx.redirectTo({ url: item.url })`。从 `custom-tab-bar/index.js` 删除未使用的 `adminList` 和管理员分支，学生原生标签栏逻辑保持不变。

- [ ] **Step 6: 修复底部遮挡和文字对比度**

管理中心、审批工作台和账号设置的底部间距至少为：

```css
padding-bottom: calc(180rpx + env(safe-area-inset-bottom));
```

说明文字颜色由 `#999`/过浅灰调整到不浅于 `#667085`，不改变品牌主色。

- [ ] **Step 7: 验证并提交**

Run: `npm run check:admin-miniapp && npm run check:miniapp-ui && git diff --check`

Expected: PASS。

```bash
git add miniapp/pages/admin-manage miniapp/pages/admin-profile miniapp/components/admin-nav miniapp/custom-tab-bar/index.js scripts/admin-miniapp-regression-check.js
git commit -m "fix: align mobile admin navigation and settings"
```

### Task 7: 强化失败、并发和角色变化回归

**Files:**
- Modify: `scripts/admin-miniapp-regression-check.js`
- Modify: `scripts/mobile-regression-check.js`
- Modify: `scripts/admin-cross-client-contract-check.mjs`
- Modify: `docs/final-acceptance-checklist.md`

- [ ] **Step 1: 增加失败状态与过期响应回归**

使用现有 `deferred()` 测试：

- 第一次普通队列请求晚于第二次返回时，旧数据不能覆盖新数据；
- 普通切重点后，普通队列的晚响应不能进入重点队列；
- 审批提交后角色从辅导员降级为导生时，不得继续刷新重点数据；
- 列表失败后 `listStatus === 'error'`，重试成功后恢复 `ready`；
- 详情失败不出现备用预约；
- 同一预约处理期间只产生一次 POST。

核心断言：

```js
assert(homePage.data.queueType === 'counselor' && homePage.data.pendingList[0].id === 202, '旧普通队列响应不得覆盖重点队列')
assert(homePage.data.listStatus === 'error', '审核接口失败必须显示失败状态')
assert(detailPage.data.reservation === null, '详情失败不得构造虚假预约')
assert(postCalls.filter(function(call) { return call.url === '/audit/5/approve' }).length === 1, '重复点击只能提交一次')
```

- [ ] **Step 2: 增加真实接口角色矩阵**

`mobile-regression-check.js` 验证：

- 导生请求重点队列为 403；
- 导生读取其他楼栋详情为 403；
- 辅导员和超级管理员可读重点详情；
- 导生统计不含重点待办；
- 辅导员/超级管理员统计含普通与重点待办；
- 三个角色使用排行均只包含其范围内房间。

- [ ] **Step 3: 更新跨端契约与最终清单**

跨端检查要求后台和小程序继续共用 `/audit/:id/approve`、`/audit/:id/reject`、`/stats/dashboard`、`/stats/usage-rate`，并验证管理员详情仍走 `/reservation/:id` 的统一安全范围。

在最终清单加入三角色、两类队列、错误重试、管理员详情、统计范围和导航不重启六项。

- [ ] **Step 4: 运行完整自动检查并提交**

Run:

```powershell
$env:AVATAR_TEST_IMAGE=(Resolve-Path 'miniapp/images/default-avatar.png').Path
npm run check:admin-miniapp
npm run check:mobile
npm run check:miniapp-ui
npm run check:admin-cross-client
npm run check:security
npm run check:security-hardening
npm run check:reservation-consistency
git diff --check
```

Expected: 全部 PASS；MySQL 并发检查仅在数据库名不是安全测试库时按既有规则明确跳过。

```bash
git add scripts/admin-miniapp-regression-check.js scripts/mobile-regression-check.js scripts/admin-cross-client-contract-check.mjs docs/final-acceptance-checklist.md
git commit -m "test: cover mobile admin approval experience"
```

### Task 8: 三角色视觉与数据联动验收

**Files:**
- Inspect: `miniapp/pages/admin-home/*`
- Inspect: `miniapp/pages/admin-reservation-detail/*`
- Inspect: `miniapp/pages/admin-stats/*`
- Inspect: `miniapp/pages/admin-manage/*`
- Inspect: `miniapp/pages/admin-profile/*`
- Modify: `docs/final-acceptance-checklist.md`
- Create when the existing微信开发者工具命令行可用: `docs/audits/2026-07-16-miniapp-admin-fixed/01-super-priority.png`
- Create when the existing微信开发者工具命令行可用: `docs/audits/2026-07-16-miniapp-admin-fixed/02-counselor-priority.png`
- Create when the existing微信开发者工具命令行可用: `docs/audits/2026-07-16-miniapp-admin-fixed/03-guide-ordinary.png`
- Create when the existing微信开发者工具命令行可用: `docs/audits/2026-07-16-miniapp-admin-fixed/04-admin-stats.png`
- Create when the existing微信开发者工具命令行可用: `docs/audits/2026-07-16-miniapp-admin-fixed/05-admin-detail.png`

- [ ] **Step 1: 检测微信开发者工具现有命令行能力**

只检测现有安装，不下载大型工具。依次检查环境变量 `WECHAT_DEVTOOLS_CLI` 和 Windows 常见安装目录；找到后使用现有项目 `miniapp/project.config.json` 启动或连接自动化。

Expected: 记录“可用并已连接”或“未发现现有命令行能力”。后者不是跳过其余验收的理由。

- [ ] **Step 2: 若命令行可用，逐角色截图和交互**

按超级管理员、辅导员、导生管理员分别验证：

- 默认队列；
- 普通/重点切换；
- 普通快速通过确认；
- 重点必须进入详情；
- 错误和空状态；
- 管理中心数量；
- 数据统计排行；
- 账号与设置；
- 三项底部导航。

截图统一保存在 `docs/audits/2026-07-16-miniapp-admin-fixed/`，尺寸使用开发者工具默认手机视口并记录实际宽高。

- [ ] **Step 3: 若命令行不可用，执行替代验收**

运行页面结构检查、真实接口角色矩阵和全部自动检查；逐项对照 `docs/audits/2026-07-15-miniapp-admin/` 的五张问题截图，确认对应代码路径和字段已经更换。最终报告必须写明没有完成真实模拟器截图，禁止声称视觉回归已完成。

- [ ] **Step 4: 运行全套检查**

Run:

```powershell
$env:AVATAR_TEST_IMAGE=(Resolve-Path 'miniapp/images/default-avatar.png').Path
npm run check:all
npm run check:admin-site:roles
npm run check:admin-site:ux
npm run check:admin-navigation-runtime
npm --prefix admin run test:layout
npm --prefix admin run build
git diff --check
```

Expected: 所有命令退出码为 0；只允许既有的第三方注释和构建体积提示。

- [ ] **Step 5: 最终复核与提交**

重新核对设计规格第九节的每一条验收标准。在 `docs/final-acceptance-checklist.md` 记录实际完成项、模拟器能力和剩余限制。

```bash
git add miniapp server/src/controllers scripts docs/final-acceptance-checklist.md docs/audits/2026-07-16-miniapp-admin-fixed
git commit -m "fix: complete mobile admin approval experience"
```

如果没有生成新的截图目录，提交命令中不得包含该目录。

## 最终完成条件

- 每个任务均有红灯、最小修复、绿灯和独立提交；
- 工作树没有未说明的改动；
- 三类角色的队列、详情、统计和范围均有自动证据；
- 重点预约不能从卡片直接通过；
- 模拟与 MySQL 统计字段契约一致；
- 全套检查、后台构建和最终清单通过；
- 完成独立规格复核和代码质量复核后，才允许合并与推送。
