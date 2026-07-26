# 管理后台时间线、账号与导航重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复空间监控时间线空白和账号管理数据混合问题，按三类管理员职责建立可折叠导航，并清理面向开发者的后台文案。

**Architecture:** 将时间线的数据归一化与展示模型集中在 `roomTimeline.js`，页面改用原生时间格，避免单行热力图渲染不稳定。账号查询在后端明确接收账号类型，前端只负责页签交互；导航由角色策略生成分组树，布局组件只负责折叠和记忆状态。文案通过静态检查和浏览器实际登录共同验收。

**Tech Stack:** Vue 3、Element Plus、Pinia、Vue Router、Express、Node.js 回归脚本、浏览器自动化

---

## 文件职责

- `admin/src/utils/roomTimeline.js`：把接口时间段转换为可展示的时间格、摘要和状态文案。
- `admin/src/views/Room/Monitor.vue`：空间监控卡片、时间线弹窗、空状态和失败重试。
- `server/src/controllers/accountController.js`：按宿生/管理账号类型查询，返回真实楼栋名称并保护当前超级管理员账号。
- `admin/src/views/Account/Index.vue`：分离账号页签、业务化列表列项、新增编辑和风险确认。
- `server/src/controllers/accountImportController.js`：批量导入时验证导生管理员的数据范围。
- `admin/src/router/adminRoutes.js`：定义角色可见路由和工作场景分组。
- `admin/src/components/Layout.vue`：渲染工作区身份、折叠菜单并记忆展开状态。
- `admin/src/utils/adminRolePolicy.js`：角色名称、默认重点与快捷入口。
- `scripts/admin-monitor-account-navigation-check.mjs`：覆盖时间线、账号分离、导航结构和用户文案的静态与纯函数回归。
- `scripts/security-runtime-check.js`：覆盖账号接口权限、类型过滤、范围和自我停用保护。

### Task 1: 时间线展示模型与空白回归

**Files:**
- Create: `scripts/admin-monitor-account-navigation-check.mjs`
- Modify: `admin/src/utils/roomTimeline.js`
- Modify: `admin/src/views/Room/Monitor.vue`

- [ ] **Step 1: 写入失败的时间线模型测试**

在新脚本中导入时间线工具，并加入以下断言：

```js
import assert from 'node:assert/strict'
import { buildTimelineView } from '../admin/src/utils/roomTimeline.js'

const occupied = buildTimelineView({
  date: '2026-07-13',
  openStartTime: '08:00',
  openEndTime: '10:00',
  timeline: [
    { time: '08:00', endTime: '08:30', status: 'available', availableCount: 12, totalCount: 12 },
    { time: '08:30', endTime: '09:00', status: 'occupied', userName: '李四', purpose: '小组讨论', availableCount: 0, totalCount: 12 }
  ]
})
assert.equal(occupied.slots.length, 2)
assert.equal(occupied.slots[1].label, '已预约')
assert.match(occupied.slots[1].detail, /李四/)
assert.equal(occupied.summary.reservationCount, 1)

const empty = buildTimelineView({ date: '2026-07-13', openStartTime: '08:00', openEndTime: '10:00', timeline: [] })
assert.equal(empty.kind, 'empty')
assert.match(empty.message, /暂无预约/)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/admin-monitor-account-navigation-check.mjs`

Expected: FAIL，提示 `buildTimelineView` 尚未导出。

- [ ] **Step 3: 实现统一时间线展示模型**

在 `roomTimeline.js` 中增加：

```js
const statusCopy = {
  available: { key: 'available', label: '空闲' },
  occupied: { key: 'reserved', label: '已预约' },
  myReservation: { key: 'using', label: '使用中' },
  checked_in: { key: 'using', label: '使用中' },
  unavailable: { key: 'maintenance', label: '维护' }
}

export function buildTimelineView(data) {
  const slots = normalizeTimelineResponse(data).map(slot => {
    const copy = statusCopy[slot.status] || statusCopy.available
    const range = `${slot.time}${slot.endTime ? `-${slot.endTime}` : ''}`
    const people = slot.userName ? `，${slot.userName}` : ''
    const purpose = slot.purpose ? `，${slot.purpose}` : ''
    const seats = slot.totalCount > 0 ? `，剩余 ${slot.availableCount}/${slot.totalCount}` : ''
    return { ...slot, state: copy.key, label: copy.label, detail: `${range} ${copy.label}${people}${purpose}${seats}` }
  })
  const busy = slots.filter(slot => slot.state !== 'available')
  return {
    kind: slots.length ? 'ready' : 'empty',
    message: slots.length ? '' : '今日暂无预约，当前时段均可使用',
    slots,
    summary: {
      date: data?.date || '',
      openTime: [data?.openStartTime, data?.openEndTime].filter(Boolean).join('-'),
      reservationCount: busy.length
    }
  }
}
```

同时让 `normalizeSlot` 保留 `purpose` 和 `reservationId`。

- [ ] **Step 4: 用原生时间格替换热力图**

在 `Monitor.vue` 移除 ECharts 实例和 `timelineDetailRef`，新增状态：

```js
const timelineLoading = ref(false)
const timelineError = ref('')
const timelineView = ref(buildTimelineView(null))

async function showTimeline(room) {
  currentRoom.value = room
  timelineDialogVisible.value = true
  timelineLoading.value = true
  timelineError.value = ''
  try {
    const res = await getTimeline(room.id, { date: localDate() })
    timelineView.value = buildTimelineView(res.data)
  } catch {
    timelineError.value = '时间线暂时未能加载，请稍后重试'
  } finally {
    timelineLoading.value = false
  }
}
```

弹窗主体使用 `.timeline-slot-grid` 渲染 `timelineView.slots`，每格包含时间、状态和详情；加载失败显示重试按钮，空结果显示业务化空状态。删除 `echarts` 导入和窗口图表释放逻辑。

- [ ] **Step 5: 运行时间线测试和后台构建**

Run: `node scripts/admin-monitor-account-navigation-check.mjs && cd admin && npm run build`

Expected: 测试通过，Vite 构建退出码为 0。

- [ ] **Step 6: 提交时间线修复**

```bash
git add scripts/admin-monitor-account-navigation-check.mjs admin/src/utils/roomTimeline.js admin/src/views/Room/Monitor.vue
git commit -m "fix: render room timeline without blank chart"
```

### Task 2: 账号类型分离、楼栋名称与账号保护

**Files:**
- Modify: `scripts/admin-monitor-account-navigation-check.mjs`
- Modify: `scripts/security-runtime-check.js`
- Modify: `server/src/controllers/accountController.js`
- Modify: `server/src/routes/admin.js`
- Modify: `admin/src/views/Account/Index.vue`

- [ ] **Step 1: 写入失败的账号页面与运行时测试**

静态测试加入：

```js
const accountSource = read('admin/src/views/Account/Index.vue')
assert(!/账号ID/.test(accountSource))
assert(!/不同账号写入不同数据表/.test(accountSource))
assert(/最近登录/.test(accountSource))
assert(/buildingName/.test(accountSource))
```

运行时测试加入：

```js
const managers = await api('/admin/accounts?accountType=manager&pageSize=100', { headers: authHeaders(superAdmin.token) })
expectStatus(managers, 200, 'manager account list')
assert(managers.json.data.list.every(item => item.accountType === 'admin'), 'manager list must exclude students')

const students = await api('/admin/accounts?accountType=student&pageSize=100', { headers: authHeaders(superAdmin.token) })
expectStatus(students, 200, 'student account list')
assert(students.json.data.list.every(item => item.accountType === 'student'), 'student list must exclude managers')

expectStatus(await api('/admin/accounts/admin-' + superAdmin.userInfo.id, {
  method: 'DELETE', headers: authHeaders(superAdmin.token)
}), 409, 'super administrator cannot disable current account')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/admin-monitor-account-navigation-check.mjs && npm run check:security`

Expected: 至少一项因账号类型未过滤或当前账号可停用而失败。

- [ ] **Step 3: 后端按账号类型查询并返回楼栋名称**

在 `getAccounts` 读取 `accountType`，只加载对应来源：

```js
const accountType = String(req.query.accountType || '').trim()
const shouldLoadAdmins = accountType === 'manager' || (!accountType && requestedRole !== 'student')
const shouldLoadStudents = accountType === 'student' || (!accountType && requestedRole === 'student')
```

管理员和宿生查询均关联 `buildings`，返回：

```js
buildingId: row.building_id,
buildingName: row.building_name || '',
scopeLabel: row.scope_type === 'global' ? '全院' : (row.building_name || '范围待设置')
```

- [ ] **Step 4: 阻止当前超级管理员停用自己**

在 `deleteAccount` 解析账号后加入：

```js
if (account.source === 'admin' && Number(account.id) === Number(req.user.id)) {
  return response.error(res, '当前登录账号不能停用自己', 409)
}
```

确认 `/admin/managers/:id` 的停用入口也复用同一控制器，避免旧入口绕过保护。

- [ ] **Step 5: 重构账号页面的业务字段**

查询参数明确发送：

```js
accountType: activeTab.value === 'student' ? 'student' : 'manager'
```

删除账号 ID 列和三张开发说明指标卡。管理账号页显示账号、姓名、身份、管理范围、状态、最近登录、创建时间；宿生页显示学号、姓名、楼栋、信用分、状态和创建时间。停用当前账号的按钮隐藏，并在确认框中说明停用影响。

- [ ] **Step 6: 运行账号测试**

Run: `node scripts/admin-monitor-account-navigation-check.mjs && npm run check:security && npm run check:security-hardening`

Expected: 全部通过。

- [ ] **Step 7: 提交账号修复**

```bash
git add scripts/admin-monitor-account-navigation-check.mjs scripts/security-runtime-check.js server/src/controllers/accountController.js server/src/routes/admin.js admin/src/views/Account/Index.vue
git commit -m "fix: separate account types and protect current admin"
```

### Task 3: 批量导入的数据范围校验

**Files:**
- Modify: `scripts/security-runtime-check.js`
- Modify: `server/src/controllers/accountImportController.js`
- Modify: `admin/src/views/Account/Index.vue`

- [ ] **Step 1: 写入失败的导入范围测试**

为超级管理员批量导入接口加入两条记录：缺少范围的导生管理员应失败，指定全院的导生管理员应成功，并断言返回的逐行结果包含明确原因。

```js
const importResult = await api('/account-batch', {
  method: 'POST',
  headers: jsonAuthHeaders(superAdmin.token),
  body: JSON.stringify({ rows: [
    { username: 'import_missing_scope', password: 'test1234', realName: '未设置范围', role: 'admin' },
    { username: 'import_global_scope', password: 'test1234', realName: '全院导生', role: 'admin', scopeType: 'global' }
  ] })
})
expectStatus(importResult, 200, 'account import scope validation')
assert(importResult.json.data.failCount === 1)
assert(importResult.json.data.results.some(item => /数据范围/.test(item.message)))
```

- [ ] **Step 2: 运行安全测试确认失败**

Run: `npm run check:security`

Expected: FAIL，旧导入逻辑未验证 `scopeType`。

- [ ] **Step 3: 在导入控制器复用账号范围规则**

将 `normalizeAdminScope` 移至可复用的 `server/src/utils/adminAccountScope.js`，账号创建与批量导入共同调用。导生管理员缺少范围时返回“请选择全院或具体楼栋”，辅导员和超级管理员强制保存为全院。

- [ ] **Step 4: 前端导入模板加入范围字段**

管理账号导入读取“数据范围”和“楼栋”列：

```js
scopeType: row['数据范围'] === '全院' ? 'global' : (row['数据范围'] === '指定楼栋' ? 'building' : ''),
buildingId: resolveBuildingId(row['楼栋'], buildingOptions.value)
```

模板说明明确导生管理员必须填写范围，辅导员和超级管理员无需填写。

- [ ] **Step 5: 运行安全测试和构建**

Run: `npm run check:security && cd admin && npm run build`

Expected: 全部通过。

- [ ] **Step 6: 提交导入修复**

```bash
git add scripts/security-runtime-check.js server/src/utils/adminAccountScope.js server/src/controllers/accountController.js server/src/controllers/accountImportController.js admin/src/views/Account/Index.vue
git commit -m "fix: validate account scopes during import"
```

### Task 4: 角色工作区与折叠导航

**Files:**
- Modify: `scripts/admin-site-role-policy-check.mjs`
- Modify: `scripts/admin-monitor-account-navigation-check.mjs`
- Modify: `admin/src/router/adminRoutes.js`
- Modify: `admin/src/utils/adminRolePolicy.js`
- Modify: `admin/src/components/Layout.vue`

- [ ] **Step 1: 写入失败的分组与角色重点测试**

断言 `buildNavigation` 返回带 `collapsible` 和 `defaultOpen` 的工作场景分组：

```js
const guide = buildNavigation('admin')
assert.deepEqual(guide.map(item => item.title), ['今日工作', '预约与使用', '空间运行', '书院治理', '数据与报表'])
assert(!guide.flatMap(item => item.children).some(item => item.name === 'CounselorPending'))

const counselor = buildNavigation('counselor')
assert.equal(counselor.find(item => item.title === '预约与使用').children[0].name, 'CounselorPending')

const superAdmin = buildNavigation('super_admin')
assert(superAdmin.some(item => item.title === '系统管理'))
assert(superAdmin.every(item => item.collapsible === true))
```

- [ ] **Step 2: 运行角色测试确认失败**

Run: `npm run check:admin-site:roles`

Expected: FAIL，现有分组名称和返回结构不符合设计。

- [ ] **Step 3: 重组路由元信息和导航策略**

将导航分组改为：今日工作、预约与使用、空间运行、书院治理、数据与报表、内容审核、系统管理。为路由增加 `navGroup`，并在 `buildNavigation` 中按角色排序后返回：

```js
{
  key: section.key,
  title: section.title,
  collapsible: true,
  defaultOpen: section.defaultOpenRoles.includes(role),
  children
}
```

辅导员的 `CounselorPending` 在预约组首位；导生管理员不显示重点预约、黑名单、反馈和海报审核；超级管理员显示全部分组。

- [ ] **Step 4: 实现折叠菜单和账号级记忆**

在 `Layout.vue` 使用 `el-sub-menu` 渲染分组，并用以下存储键保存展开项：

```js
const menuStorageKey = computed(() => `jy-admin-menu:${userStore.userInfo.id || userStore.userInfo.username || 'current'}`)
const openedGroups = ref(readOpenedGroups(menuStorageKey.value, navigation.value))
watch(openedGroups, value => localStorage.setItem(menuStorageKey.value, JSON.stringify(value)), { deep: true })
```

侧栏 Logo 下增加工作区身份，例如“辅导员工作区”，折叠状态仅保留图标与提示。

- [ ] **Step 5: 运行导航测试和构建**

Run: `npm run check:admin-site:roles && node scripts/admin-monitor-account-navigation-check.mjs && cd admin && npm run build`

Expected: 全部通过。

- [ ] **Step 6: 提交导航重构**

```bash
git add scripts/admin-site-role-policy-check.mjs scripts/admin-monitor-account-navigation-check.mjs admin/src/router/adminRoutes.js admin/src/utils/adminRolePolicy.js admin/src/components/Layout.vue
git commit -m "feat: group admin navigation by work context"
```

### Task 5: 管理员文案清理与最终浏览器验收

**Files:**
- Modify: `scripts/admin-monitor-account-navigation-check.mjs`
- Modify: `admin/src/views/Room/Monitor.vue`
- Modify: `admin/src/views/Account/Index.vue`
- Modify: `admin/src/components/Layout.vue`
- Modify: `admin/src/views/Dashboard/Index.vue`
- Modify: other `admin/src/**/*.vue` files only where the audit finds prohibited developer wording

- [ ] **Step 1: 写入失败的开发术语扫描**

递归扫描后台用户可见模板文本，禁止以下词语：

```js
const prohibited = [
  'WebSocket', 'Token', '访问令牌', 'API', '数据表', 'Mock', 'mock',
  '角色裁剪', '缓存结果', '实时统计'
]
for (const file of vueFiles) {
  const template = readTemplate(file)
  for (const word of prohibited) assert(!template.includes(word), `${file} exposes developer wording: ${word}`)
}
```

- [ ] **Step 2: 运行文案扫描确认失败**

Run: `node scripts/admin-monitor-account-navigation-check.mjs`

Expected: FAIL，至少检测到空间监控和账号管理的开发术语。

- [ ] **Step 3: 替换为管理员业务文案**

统一替换：

```text
WebSocket 已连接 -> 实时更新正常
WebSocket 未连接 -> 实时更新暂时中断
缺少管理员访问令牌 -> 登录状态已失效，请重新登录
不同账号写入不同数据表 -> 分别管理宿生与工作人员账号
菜单和操作已按角色裁剪 -> 已按当前身份显示可用功能
实时统计 -> 今日变化
已保留上次结果 -> 当前显示最近一次成功数据
```

错误提示必须包含管理员可执行的下一步，例如“请重试”“可手动刷新”或“请重新登录”。

- [ ] **Step 4: 运行全部自动验证**

Run:

```bash
node scripts/admin-monitor-account-navigation-check.mjs
npm run check:admin-site:roles
npm run check:admin-site:ux
npm run check:security
npm run check:security-hardening
npm run check:runtime-coordination
cd admin && npm run build
cd ../server && npm run test:integration
```

Expected: 所有命令退出码为 0。

- [ ] **Step 5: 启动合并后的后台并执行三角色浏览器检查**

依次登录：

```text
导生管理员：admin / admin123
辅导员：counselor / counselor123
超级管理员：superadmin / super123
```

逐一确认：导航分组、默认展开、无权菜单隐藏、普通/重点审批顺序。使用超级管理员检查账号页签分离、楼栋名称、自我停用保护；使用任意管理员打开 B102 和自习室时间线，确认状态格、空结果和重试状态可见。检查浏览器控制台无新增错误。

- [ ] **Step 6: 提交文案与验收修复**

```bash
git add scripts/admin-monitor-account-navigation-check.mjs admin/src
git commit -m "refactor: use administrator-facing navigation copy"
```

- [ ] **Step 7: 检查工作区和提交记录**

Run: `git status --short && git log --oneline -8`

Expected: 工作区干净，包含时间线、账号、导入、导航和文案提交。
