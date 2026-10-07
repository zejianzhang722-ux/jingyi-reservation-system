# 小程序管理端权限修复与 UI 改造 —— 独立验证报告

- **验证人**：秦戈（QA）
- **验证方式**：独立实测。自行编写 2 个验证脚本（模型层 102 断言 + 页面守卫层 70 断言），真实 `require` 页面模块、注入 mock `wx`/`Page`，驱动 `ensureAdmin`/`onLoad`/`onScanCheckin`/`onItemTap`/`send`，记录真实跳转与请求。**未修改任何业务代码**（`git status` 前后一致，临时脚本已删除）。
- **被测对象**：分支 `feat-admin-ux-bugfix`，工作区未提交改动

---

## 一、验收结论

**有条件交付：需修复 P1-1、P1-2 后方可发布。**

用户三条诉求中，**诉求 1（核心 bug）已实测修复**，**诉求 3（UI）主体达标但有 3 处漏项**，**诉求 2（层级收口）只做了 4 处中的 2 处**。

宿管流程红线**未被破坏**，`isAdmin` 语义**未被收紧**，此项我独立验证通过。

---

## 二、A–F 逐项验证结果

### A. 核心 bug 是否真的修好 —— ✅ 通过（4/4）

| # | 结论 | 我怎么验的 |
|---|---|---|
| A-1 | ✅ | 读 `admin-manage.js:126` 确认 `verification: roleModel.scanPath(auth.getUserRole())`。**实测**：注入 4 种 role 驱动 `onItemTap({dataset:{key:'verification'}})`，记录 `wx.navigateTo` 实参。`super_admin/admin/counselor` → `/pages/admin-scan/admin-scan`；`dorm_manager` → `/pages/dorm-scan/dorm-scan`（4/4 与期望一致）。<br>**注意**：实施者对 `dorm_manager` 落点的解释是"不是 `/pages/verification/verification`"——**正确**，`scanPath` 确实直接给扫码页。 |
| A-2 | ✅ | `admin-home.js:346` 同样走 `roleModel.scanPath`。实测 `onScanCheckin` 4 角色，4/4 一致。 |
| A-3 | ✅ | 真实 `require` `admin-scan.js`，注入 `global.Page` 捕获定义。实测深链：<br>· `dorm_manager` → `reLaunch /pages/verification/verification`✅<br>· `student`/`undefined` → `reLaunch /pages/admin-home/admin-home`✅<br>· 未登录 → `reLaunch /pages/login/login`✅<br>· `super_admin/admin/counselor` 放行且**确实发起 `/verification/me` 请求**（证明未被静默拦截）✅<br>另额外验证复用工厂完整性：`scan/pass/exception/retry/send/resolve` 6 个方法均存在，`data.section==='scan'`、`sectionTitle==='扫码办理签到'`。 |
| A-4 | ✅ | `grep -rn "pages/verification/verification" miniapp/` 仅 2 处：`app.json:30`（页面注册，合法）+ `role-model.js:49`（唯一 `homePath`）。**无第二处硬编码**✅<br>`grep -rn "dorm-scan" miniapp/` 仅 `app.json`（注册）、`dorm-page.js:17`（宿管自己的 `openSection`）、`role-model.js:53`（唯一 `scanPath`）——**均为合法归属，无跨层硬编码**✅ |

### B. 层级权限是否收口 —— ⚠️ 部分通过（2/4 处有守卫，2 处缺失）

| # | 结论 | 证据 |
|---|---|---|
| B-5 | ❌ **不通过** | 四处守卫矩阵实测：<br>· `admin-manage.js:56` `isGuideRole` 守卫 ✅ → 宿管 `reLaunch` 到宿管工作台<br>· `admin-home.js:70` `isDormRole` 守卫 ✅ → 宿管 `reLaunch` 到宿管工作台<br>· `admin-profile.js:51` **无任何层级守卫** ❌ → 宿管**可直接进入**<br>· `profile.js:29,37` **无任何层级守卫** ❌ → 宿管点「我的」tab 被 `reLaunch` 到 `admin-profile`<br>**前两处正确做到了"回宿管工作台"而非登录页，后两处根本没做。** 详见 P1-1。 |
| B-6 | ✅ **红线守住** | `auth.js:155` `isAdmin()` → `roleModel.isAdminRole()`；`role-model.js:35-38` 返回 `guide \|\| dorm`，故 `dorm_manager` 仍为 `true`。实测 `auth.isAdmin()` 对 `dorm_manager` = `true`。**并实测 `dorm-page.js:11` 准入链路未破坏**：<br>· 宿管 5 页（verification/dorm-reservations/dorm-scan/dorm-records/dorm-spaces）全部放行且正常请求 `/verification/me`✅<br>· `super_admin/admin/counselor` 也可进（`isAdmin` 未收紧）✅<br>· `student/undefined/null/'ghost'` 4 种异常输入均被拦回登录页✅<br>· 宿管工作台点「扫码办理签到」→ `/pages/dorm-scan/dorm-scan`✅ |
| B-7 | ✅ | `git diff miniapp/utils/admin-policy.js` 逐行确认：`dorm_manager: ['scanCheckin'],` 为**上下文行**（无 `+`/`-` 标记），一字未改。脚本断言 `JSON.stringify(ROLE_CAPABILITIES.dorm_manager) === '["scanCheckin"]'` 通过。 |
| B-8 | ✅ **`admin` 缺 4 项是正确设计，不是 bug** | 逐条核对后端 `requireRole`：<br>· `credit.js:13,14` 黑名单 → `('counselor','super_admin')`<br>· `feedback.js:7,8` → `('counselor','super_admin')`<br>· `poster.js:23-26` 审核 → `('counselor','super_admin')`（`:19-22` 位置管理是 `('super_admin')`）<br>· `audit.js:9` 待审列表 → `('admin','counselor','super_admin')`<br>**结论**：4 项能力后端均只给 `counselor`/`super_admin`，前端 `admin` 缺这 4 项与后端**完全一致**。能力表可信。 |
| B-9 | ⚠️ **有 1 处不一致** | `admin-home.js` 已无 `ROLE_NAMES`，`roleName: roleModel.label(role)`✅。`admin-profile.js:21-27` `roleMap` 5 个值全部由 `roleModel.label()` 生成✅（我实测 4 个中文名 + 别名均正确）。<br>**但 `admin-profile.wxml:6` 用 `roleMap[adminInfo.role]` 原始值，未 normalize** → `superadmin` 别名在顶部标签显示「管理员」，而 `admin-profile.js:93` 弹窗用 `normalizeRole` 显示「导生会会长团」，**同页两处自相矛盾**。详见 P2-1。 |

### C. 宿管流程零影响 —— ✅ 通过（红线守住）

| # | 结论 | 我怎么验的 |
|---|---|---|
| C-10 | ✅ **认可实施者说法** | `git diff --stat`：`dorm-page.js` 9 行、`dorm-layout.wxml` 2 行。逐条审读：<br>· `statusLabels` 中 `pending_counselor` → `counselor_pending`（键名对齐后端）<br>· `onLoad(options)` 新增 `options.date` 且**有 `/^\d{4}-\d{2}-\d{2}$/` 正则校验**，非法值回落 `today()`<br>· `item.status` 兜底文案 → '状态待确认'<br>· dorm-layout 仅追加"开始前15分钟至开始后15分钟"提示文案<br>**判断：4 处改动全部属于「签到时间窗/状态键」范畴，与「管理端角色分层 + 按钮 UI」无任何交集。我认可这是会话前累积改动，非本任务产物。** 补充：签到时间窗语义是**放宽/明确**，不改变准入链路，风险可控。 |
| C-11 | ✅ | 逐页 `require` 5 个 dorm 页面，断言 `data.section` 分别为 `home/reservations/scan/records/spaces`，5/5 正确，且均正常发起 `/verification/me`。 |
| C-12 | ✅ | **隔离环境**（单独进程，排除 harness 污染）实测 `dorm-page.send()`：<br>· 导航调用 = **空**（仅 `showToast 已签到`）→ **留在本页**✅<br>· POST `/verification/confirm` 参数完整<br>· `result.checkedIn=true` 写入 data，wxml `wx:if="{{result}}"` 可渲染开门核对信息✅<br>· `uncertain` 复位 `false`、`busy` 复位 `false`、`_pending` 清空✅（可连续扫码）<br>**注：我第一版脚本曾误报 14 次 `reLaunch`，经隔离复现确认为脚本自身模块缓存污染导致的假阳性，已修正。此处特别说明以免误导。** |

### D. UI 改造是否达标 —— ⚠️ 部分通过（3 项达标，3 项有漏项）

| # | 结论 | 证据 |
|---|---|---|
| D-13 | ⚠️ **主体达标，3 处关键操作仍 < 44px** | 换算（750rpx=375px，1rpx=0.5px）：`lg` 96rpx=48px ✅、`md`/默认 88rpx=44px ✅、**`sm` 72rpx=36px ❌ 差 8px**。<br>规模：default 17 处 / lg 2 处 / md 2 处 / **sm 4 处**。<br>**3 处 `ui-btn-sm` 用在关键操作上**：<br>· `admin-feedback.wxml:25` 「回复」<br>· `admin-feedback.wxml:26` 「标记已处理」<br>· `admin-credit.wxml:37` 「解除」<br>**实施者声称的旧值我已独立核实为真**：`git show HEAD` 确认 `.btn-credit{padding:6rpx 16rpx;font-size:22rpx}`（≈17px）、`.btn-resolve{padding:8rpx 20rpx}`（≈20px）、`.btn-approve{padding:10rpx 28rpx}`（≈22px）——**说法成立**，这些确实被修好了。详见 P2-2。<br>**另发现**：`admin-users` 的调分/停用按钮被**整体删除**，实施者称"死代码"。我验证该说法**成立**：`git show HEAD:admin-users.js` 中 `canManageStudents` 仅在 `data` 初始化为 `false`，全文无任何 `setData` 置 `true`，故 `wx:if="{{canManageStudents}}"` 恒假、按钮从未渲染。**但这是功能删改，超出"UI 改造"授权范围**，详见 P3-1。 |
| D-14 | ✅ | `button.wxss:46-60` 定义 `.is-disabled`（真禁用视觉）+ `.is-loading`（压暗），且注释明确"不用 `[disabled]` 属性选择器，避免样式静默失效"——**这个设计判断是对的**。<br>**真禁用（非仅视觉）实测**：<br>· `admin-reservation-detail.js:88` `if (this.data.processing \|\| !this.ensureAccess()) return` ✅<br>· `admin-home.js:351,376` `if (!this.canQuickApproveItem(id) \|\| this.isProcessing(id)) return`（能力+并发双重守卫）✅<br>· `admin-poster.js:171` `if (!this.ensureAccess() \|\| this.isProcessing(id)) return` ✅<br>· `admin-poster.wxml:58`/`:51,50` 同时有 `disabled="{{loadingMore}}"` 原生属性 ✅ |
| D-15 | ❌ **未收敛** | 全量统计管理端 hex：`#52C41A` 仍 5 处、`#FF4D4F` 仍 5 处、`#FA8C16` 仍 4 处、`#1890FF` 仍 1 处。<br>**部分改善确已发生**：蓝色 `#0077FF` 6→0 ✅、`#0b63ce/#0077ff/#0877e8` 已收敛 ✅。<br>**残留集中在状态标签与公告页**：`admin-users.wxss:14,15`、`admin-rooms.wxss:15,16,17`、`admin-reservation.wxss:12,13,14`、`admin-feedback.wxss:13,14`、`admin-announcement.wxss:10,11,12,17`。详见 P2-3。 |
| D-16 | ✅ | 自写脚本扫**全部 53 个 wxss**：<br>· `*` 通配选择器 **0 处** ✅<br>· 花括号不配平 **0 个文件** ✅<br>· `backdrop-filter`：按**声明块**（非行）统计 81 个含该属性的块，**81 个前缀全部成对**，0 处裸用 ✅<br>（注：行级 grep 会误报 52 处，因项目写法是 `backdrop-filter` 与 `-webkit-backdrop-filter` 分两行；块级复核后确认合规。） |
| D-17 | ✅ | 扫 17 个新增/修改 js，14 类 ES6 语法模式。命中 3 处，逐一裁定：<br>· `admin-home.js:41`、`admin-stats.js:6` `Number.isFinite` → **`git show HEAD` 确认 HEAD 已存在，非本次引入**<br>· `profile.js:182` `...` → 误报，实为字符串 `'上传中...'` 字面量<br>**本次新增代码 ES5 合规 ✅** |
| D-18 | ✅ | `app.wxss` **零删除行**（656→676 行，纯新增 20 token + 1 行 `@import`）。<br>对 `.btn-primary/.btn-danger/.btn-outline/.btn-disabled` 逐个 `diff` 规则块：**4/4 未改动** ✅<br>`button.wxss` 注释亦明确"不修改 app.wxss 已有的 `.btn-*` 系列，避免波及 9 个学生端页面"——**约束被正确执行**。 |

### E. 两个 FAIL 的独立判断

#### E-19 `check:avatar-persistence` —— ✅ **实施者说法成立，我独立复现并证实**

```
$ npm run check:avatar-persistence
Error: 子进程执行失败   （stderr 为空 → 真实错误被吞掉）
```
我绕过脚本直接手动 `spawnSync` 打印真实错误：
```
status= null   signal= null   error= EBUSY   stdout= undefined   stderr= undefined
```
**两条反证**：
1. `spawnSync(node, ['-e','console.log(1+1)'])` —— 一个纯计算进程、零仓库代码 —— **同样 `EBUSY`**。证明是沙箱禁止 node 派生子进程，与本仓库任何代码无关。
2. 改用非 spawn 方式跑**完全相同的断言**（直接 `require` mock-db）：
```
写入值: /uploads/avatar-persistence-test.png
读回值: /uploads/avatar-persistence-test.png
✅ 断言通过：头像持久化逻辑本身是好的
```
**结论：业务逻辑健康，FAIL 纯属环境限制。实施者说法可信。**
**遗留问题（P3-2）**：脚本第 17 行 `throw new Error(result.stderr || result.stdout || ...)` 未带上 `result.error`，导致真实原因（EBUSY）被吞成空串，**这个错误处理本身有缺陷，会误导后续所有排障**。

#### E-20 `check:admin-data-sync` —— ❌ **实施者说法不成立（结论对，理由错）**

```
error: 事务创建预约异常: 该功能房仅接受组团预约，请从组团入口预约
  {"code":"GROUP_REQUIRED","httpStatus":400, ... roomBookingPolicy.js:24}
admin cross-client data sync failed: reservation creation failed
```

**实施者称"`/api/v1/admin/rooms` 对 student 返回 403"。我实测统计全部状态码**：
```
14 × "statusCode":200
 1 × "statusCode":400
403 出现次数：0        ← 声称的 403 从未发生
```
且日志中 `/api/v1/admin/rooms` 的两次调用 `actorRole` 均为 `super_admin`、`statusCode` 均为 `200`。

**真实根因**：`admin-cross-client-data-sync-check.js:123` 建临时房间用 `type: 'seminar_room'`，而新增的 `server/src/services/roomBookingPolicy.js:7,24` 将 `seminar_room` 列入 `groupOnly`，要求 `input.groupBooking` 为真；而脚本第 296 行建预约时**未传 `groupBooking`** → 400 `GROUP_REQUIRED`。

**归属判断**：`roomBookingPolicy.js` 与 `reservationDailyPolicy.js` 均为 **untracked 新增文件**，属 server 侧预约域，**与本次小程序管理端权限/UI 任务无关**；检查脚本 `admin-cross-client-data-sync-check.js` 本身 `git status` 无改动。
→ **是既有问题（他人累积改动），不是本次引入。结论正确，但给出的理由是编造的。**

### F. 独立验证脚本结果

**我读了两个实施者脚本**：`miniapp-role-gate-check.js`（23 断言）质量尚可——真实注入 `global.Page` 并驱动 `onLoad`/`ensureAdmin`/`onItemTap`，**不是纯字符串 grep**。但存在**致命覆盖盲区**：
```
$ grep -c "admin-profile|pages/profile" scripts/miniapp-role-gate-check.js scripts/miniapp-role-model-check.js
scripts/miniapp-role-gate-check.js:0
scripts/miniapp-role-model-check.js:0
```
**两个脚本对 `admin-profile` / `profile.js` 的覆盖率为 0** —— 这正好是我发现 P1-1/P1-2 的位置。**"23+38 全 PASS"因此不构成层级收口已完成的证据。**

#### F-1 模型层脚本（102 断言，外部调用真实模块）

覆盖 `homePath`/`scanPath`/`isGuideRole`/`isDormRole`/`isAdminRole`/`label`/`can`/`queueType`/`defaultQueueType`/`canQuickApprove`，含 `undefined`/`null`/`''`/`'ghost'`/`{}`/数字/`superadmin` 别名等异常输入，并经**真实 `wx.setStorageSync` 存储**驱动 `auth.js`：

```
PASS=102  FAIL=0     全部通过
```

#### F-2 页面守卫层脚本（70 断言，真实加载页面模块）

```
PASS=70  FAIL=0
```
关键断言（节选）：
```
admin-manage 点扫码核验 role=super_admin → navigateTo /pages/admin-scan/admin-scan
admin-manage 点扫码核验 role=dorm_manager → navigateTo /pages/dorm-scan/dorm-scan
admin-home onScanCheckin role=counselor → navigateTo /pages/admin-scan/admin-scan
admin-scan 深链 role=dorm_manager 被拦回 /pages/verification/verification
admin-scan 拦截后不请求 /verification/me
admin-profile roleMap = 导生会会长团/导生管理员/书院辅导员/宿管
宿管工作台点「扫码办理签到」→ /pages/dorm-scan/dorm-scan
verification role=ghost 被拦回登录页
```
（脚本跑完即删，`git status` 已确认工作区无遗留。）

---

## 三、缺陷清单

### P1-1　宿管可进入 `admin-profile`，且被「我的」tab 主动送往该页 —— 层级收口漏 2 处

- **文件**：`miniapp/pages/admin-profile/admin-profile.js:50-56`；`miniapp/pages/profile/profile.js:29-32, 36-40`
- **复现步骤**：
  1. 以 `dorm_manager` 身份登录
  2. 点击底部「我的」tab（`pages/profile/profile`）
  3. 观察跳转
- **实际结果**：`profile.js:29` 判 `auth.isLoggedIn() && auth.isAdmin()`；`isAdmin()` 对 `dorm_manager` 返回 `true`（B-6 已证）→ `wx.reLaunch('/pages/admin-profile/admin-profile')`。落地后 `admin-profile.js:51` 的 `ensureAdmin` 同样只判 `isLoggedIn() && isAdmin()`，**宿管被完整放行**，看到导生会层级外壳（账号信息/连接检查/账号安全/关于系统）。
- **预期结果**：宿管点「我的」应留在宿管侧（或至少不被送进导生会层级外壳）；`admin-profile` 需与 `admin-manage`/`admin-home` 一致地加 `isGuideRole` 守卫，`reLaunch` 到 `roleModel.homePath(role)`（宿管工作台），**不是登录页**。
- **影响范围**：全体宿管。诉求 2「明确区分层级、统一权限校验」未达成；宿管会在导生会外壳内看到「账号安全 / 请联系导生会会长团」等不适用于自己的文案。
- **证据**：实测 `reLaunch /pages/admin-profile/admin-profile`（role=`dorm_manager`）；`admin-profile` `onShow` 对宿管产生 **0 次跳转**。
- **修法**：
  ```js
  // admin-profile.js
  ensureAdmin: function () {
    var role = auth.getUserRole()
    if (!auth.isLoggedIn()) { wx.reLaunch({ url: '/pages/login/login' }); return false }
    if (!roleModel.isGuideRole(role)) { wx.reLaunch({ url: roleModel.homePath(role) }); return false }
    return true
  }
  ```
  ```js
  // profile.js onLoad/onShow：把「管理员」判定由 isAdmin 改为 isGuideRole
  if (auth.isLoggedIn() && roleModel.isGuideRole(auth.getUserRole())) { ... }
  ```

### P1-2　实施者自测对上述两处零覆盖，`23+38 全 PASS` 不构成层级收口证据

- **文件**：`scripts/miniapp-role-gate-check.js`、`scripts/miniapp-role-model-check.js`
- **复现**：`grep -c "admin-profile\|pages/profile"` → 两个脚本均为 `0`
- **实际**：断言集完整跳过 `admin-profile`/`profile.js`，因此 P1-1 存在时仍全绿。
- **预期**：门禁脚本须覆盖全部 4 个管理端外壳 + `profile.js` tab 分流。
- **修法**：补 `admin-profile.ensureAdmin`、`profile.onShow` 在 `dorm_manager` 下必须产生 `reLaunch /pages/verification/verification` 的断言。

### P2-1　`admin-profile.wxml` 未 normalizeRole，`superadmin` 别名同页两处显示不一致

- **文件**：`miniapp/pages/admin-profile/admin-profile.wxml:6`
- **复现**：以 `role='superadmin'` 登录 → 进 admin-profile → 顶部标签 vs 点「账号信息」弹窗
- **实际**：顶部显示「**管理员**」（`roleMap['superadmin']` 未命中）；弹窗显示「**导生会会长团**」（`js:93` 有 `normalizeRole`）。同一页面自相矛盾。
- **预期**：两处均应显示「导生会会长团」。
- **修法**：JS 侧预计算 `roleLabel: roleModel.label(userInfo.role)` 存入 data，wxml 改用 `{{roleLabel}}`（WXML 无法调 `normalizeRole`）。

### P2-2　3 处关键操作按钮仍为 36px，未达 44px 触控区

- **文件**：`miniapp/pages/admin-feedback/admin-feedback.wxml:25,26`；`miniapp/pages/admin-credit/admin-credit.wxml:37`
- **复现**：管理端 → 反馈/信用 → 点「回复」「标记已处理」「解除」
- **实际**：`ui-btn-sm` = `--btn-h-sm: 72rpx` = **36px**，低于 44px 标准 8px。
- **预期**：需求指定「通过/拒绝/审核/开关/重试」等关键按钮 ≥ 88rpx。「回复」「标记已处理」「解除」属同类操作，应至少 `ui-btn`（md）。
- **修法**：三处去掉 `ui-btn-sm`；或把 `--btn-h-sm` 提到 88rpx（但会连带影响 4 处 sm 用法，需一并评估）。

### P2-3　管理端配色未完全收敛

- **文件**：`admin-users.wxss:14,15`；`admin-rooms.wxss:15,16,17`；`admin-reservation.wxss:12,13,14`；`admin-feedback.wxss:13,14`；`admin-announcement.wxss:10,11,12,17`
- **实际**：`#52C41A`(绿) 5 处、`#FF4D4F`(红) 5 处、`#FA8C16`(橙) 4 处、`#1890FF`(蓝) 1 处，与 `button.wxss` 定义的 `#2F8A3B`/`#D94841` 并存。
- **预期**：诉求要求绿色只剩 `#2F8A3B`、红色只剩 `#D94841`。
- **说明**：蓝色已收敛干净（`#0077FF` 6→0），**确实做了但只做了一半**。
- **修法**：替换为 `var(--btn-success-bg)` / `var(--btn-danger-bg)`，橙色若保留需明确为"警示"第三色并写入注释。

### P2-4　`admin-users` 调分/停用按钮被删除，属功能改动混入 UI 改造

- **文件**：`miniapp/pages/admin-users/admin-users.wxml:18-21`（删 4 行）；`admin-users.js:75-80`（删 2 个 handler + `canManageStudents`）
- **实际**：入口消失。
- **预期**：诉求 3 是"统一按钮样式"，**不是删除功能入口**。
- **我的独立判断**：**"死代码"说法成立**（`canManageStudents` 恒 `false`，按钮从未渲染），所以**用户无任何功能损失**，风险为零。但这是隐性的功能删改，应让用户知情而非藏在 CSS 注释里。
- **修法**：无需回滚（无实际影响）；建议在交付说明中显式告知，或将入口对 `super_admin` 真正放开。

### P3-1　`.btn-toggle` / `.action-btns` 死 CSS 未清（实施者主动承认，确认属实）

- **文件**：`miniapp/pages/admin-rooms/admin-rooms.wxss:20-24`
- **实际**：`.room-actions`/`.btn-toggle` 在 wxml 中无任何引用，仅有注释说明。已带注释，不影响功能。
- **修法**：择期清理，避免误导后续维护。

### P3-2　`mock-avatar-persistence-check.js` 错误处理吞掉真实原因

- **文件**：`scripts/mock-avatar-persistence-check.js:17`
- **实际**：`new Error(result.stderr || result.stdout || '子进程执行失败')` 三者皆空时不带 `result.error`（真实为 `EBUSY`），输出 "子进程执行失败"，**把环境问题伪装成业务失败**——我第一次复现时就被误导。
- **修法**：`throw new Error(result.error ? result.error.code + ': ' + result.error.message : (result.stderr || result.stdout || '子进程执行失败'))`

---

## 四、实施者说法 vs 我的独立判断

| 实施者说法 | 我的判断 | 依据 |
|---|---|---|
| 核心 bug 已修 | ✅ **认可** | 4 角色实测落点全对 |
| 四处外壳都加了层级守卫 | ❌ **不认可** | 只有 `admin-manage`/`admin-home` 有；`admin-profile`/`profile.js` **零守卫**，宿管可进入 |
| `23+38` 断言即验证充分 | ❌ **不认可** | 两脚本对 `admin-profile`/`profile.js` 覆盖率为 0，P1-1 存在时仍全绿 |
| `isAdmin` 语义未收紧 | ✅ **认可** | `dorm-page.js` 5 页准入实测全通 |
| `dorm_manager: ['scanCheckin']` 未改 | ✅ **认可** | diff 为上下文行 |
| `admin` 缺 4 能力是 bug | ✅ **认可是正确设计** | 后端 `requireRole` 逐条比对一致 |
| 配色已收敛 | ⚠️ **部分认可** | 蓝已收敛；绿/红/橙仍残留 14 处 |
| 红线文件改动是"用户自己的" | ✅ **认可** | 4 处改动全属签到时间窗/状态键，与本任务无交集 |
| avatar FAIL 是 `spawnSync EBUSY` | ✅ **认可** | 连 `1+1` 都 spawn 不出；同断言换非 spawn 方式即通过 |
| admin-data-sync FAIL 是"student 403" | ❌ **不认可理由** | 实测 403 出现 **0 次**，真实是 `GROUP_REQUIRED` 400。结论（既有问题）成立，理由是编造的 |

**总体评价**：核心 bug 修复扎实、宿管红线守得住、红线文件归属诚实、ES5 与 WXSS 规范执行到位。**主要问题是"宣称完成"与"实际完成"存在系统性落差**——层级收口只做了 4 处中的 2 处，自测脚本恰好跳过了缺失的两处，形成"自证闭环"。另有一处对 FAIL 原因的编造，说明排障时未读到真实错误就归因。

---

## 五、上线前必须人工验证（工具无法覆盖）

1. **`admin-scan` 真机扫码**（实施者已承认未验）——相机权限授权、`wx.scanCode` 唤起、真实预约码识别，深链进入时 `reLaunch` 与相机权限弹窗的时序。
2. **按钮视觉与真机触控区**——rpx→px 换算基于 750rpx=375px 理论值，须真机确认 `ui-btn-sm` 36px 在实际机型上手感是否可接受。
3. **配色视觉一致性**——`admin-scan.wxss` 覆盖 `verification.wxss` 后的蓝/绿主题切换是否与 `admin-home` 协调；`backdrop-filter` 毛玻璃在 iOS/Android 真实渲染。
4. **宿管点「我的」tab 的真实体感**——修复 P1-1 后，须确认宿管不再被弹到导生会页面且不产生跳转闪烁。
5. **管理端全页面真机遍历**——重点 `admin-poster`/`admin-feedback`/`admin-credit` 的审核按钮禁用态在真机上是否阻止点击。
6. **回归学生端 9 个页面**——`app.wxss` 虽证零改动，仍建议真机过一遍 `room-list`/`study-room`/`my-reservations` 的 `.btn-*` 显示。

---

*报告结束。验证过程未修改任何业务代码，临时脚本已全部清理。*

---
---

# 第二轮复验：F8 四项修复 + 36px 按钮（秦戈，2026-10-07）

**验证人**：秦戈（QA）｜**方式**：独立实测，未参考任何他人结论
**手段**：自写 2 个脚本（页面守卫层 66 断言 + `homePath` 回归 33 断言）+ **4 次变异注入反证** + 自建 WXSS 层叠解析器
**代码改动**：0 处业务文件被最终修改（4 次变异全部备份还原，`diff` 验证与备份一致）

## 一、第二轮结论

**可以发布。** P1-1、P1-2、P2-1、P2-2 均已修复并实测通过；红线 5 项**全部守住**；防反弹断言经反证**确属有效**（非恒真断言）。

上一轮我提出的 6 条缺陷中，**4 条已修复并复验通过**，另2 条（`homePath` 三分支、P2-3 配色）在我本轮验证期间也已完成修复。

---

## 二、红线 5 项：✅ 全部守住

| # | 红线 | 实测方式与证据 |
|---|---|---|
| R1 | `profile.js:45` `var isAdmin = auth.isAdmin()` 仍在 | 逐行读确认在位。**并实测 tabBar 实际取值**（注入 mock getTabBar 记录 setData）：`dorm_manager→2`、`admin/super_admin/counselor→2`、`student→3`。**宿管仍选中 2，未被改成 3** ✅ |
| R2 | `auth.isAdmin()` 对 `dorm_manager` 仍 true | 7 种输入实测：`dorm_manager/super_admin/admin/counselor/superadmin` 全为 `true`，`student/undefined` 为 `false` ✅<br>**连带验证 `dorm-page.js:11` 未被破坏**：宿管 5 页（verification / dorm-reservations / dorm-scan / dorm-records / dorm-spaces）全部放行且 `section` 传参正确；`student/undefined/ghost` 3 种异常输入均拦回登录页；宿管工作台点「扫码办理签到」→ `/pages/dorm-scan/dorm-scan` ✅ |
| R3 | `admin-policy.js` `dorm_manager: ['scanCheckin']` 一字未改 | `git show a3e412f` 与当前逐字比对一致；脚本断言 `JSON.stringify(...)==='["scanCheckin"]'` 通过 ✅ |
| R4 | `admin-profile.js` `data.roleMap` 仍在 | 5 个 key（`super_admin/admin/counselor/dorm_manager/student`）全部在位，中文值全部来自 `roleModel.label()`。`:112 showAccountInfo` 依赖它，实测弹窗正常渲染 ✅ |
| R5 | `dorm-page.js` 相对 `a3e412f` 仍只有那 5 处改动 | `git diff --numstat a3e412f -- miniapp/utils/dorm-page.js` → **`5 insertions / 4 deletions`**，2 个 hunk。改动内容逐条核对为：`statusLabels` 的 `pending_counselor→counselor_pending`、`onLoad(options)` 接收 date 且带 `/^\d{4}-\d{2}-\d{2}$/` 正则校验、`statusLabels[item.status]` 兜底改为「状态待确认」——**仍是那 5 处，未增未删** ✅<br>另用 `git -c core.autocrlf=false diff --ignore-cr-at-eol` 复算，排除 CRLF 干扰后数字不变，确认非行尾差异导致 |

---

## 三、复验项 1：P1-1 是否真修好 —— ✅ 通过（逐行 + 实测）

我**逐行读完 4 处代码后**，再用脚本驱动真实行为验证，不以「断言通过」代替「代码正确」。

| 位置 | 代码事实 | 实测结果 |
|---|---|---|
| `admin-profile.js:53-66` `ensureAdmin` | `:55` 未登录→登录页；`:61` `if (!roleModel.isGuideRole(role))` → `:62` `reLaunch({url: roleModel.homePath(role)})` | `dorm_manager` → `reLaunch /pages/verification/verification`（**宿管工作台，非登录页**）✅<br>`student`/`ghost`/`undefined` → 登录页 ✅<br>`super_admin/admin/counselor/superadmin` 放行、**0 次跳转** ✅<br>未登录 → 登录页 ✅ |
| `admin-profile.js:68-86` `loadAdminInfo` | `:72` `normalizeRole(userInfo.role)` → `:73` `label(currentRole)` → `:74` student 层回落「管理员」→ `:84` 写入 `roleLabel` | 放行角色实测：`super_admin→导生会会长团`、`admin→导生管理员`、`counselor→书院辅导员`、**`superadmin→导生会会长团`（别名归一化生效）** ✅ |
| `admin-profile.wxml:6` | 已由 `{{roleMap[adminInfo.role] \|\| '管理员'}}` 改为 **`{{roleLabel}}`** | 读值实测：页头显示与弹窗显示**完全一致** ✅ |
| `profile.js:29-40` | `onLoad:31` 与 `onShow:39` **两处**均为 `auth.isLoggedIn() && roleModel.isGuideRole(auth.getUserRole())` | `dorm_manager`/`student`/`ghost`：`onLoad` 与 `onShow` **都不进 admin-profile** ✅<br>`super_admin/admin/counselor/superadmin`：两处均 `reLaunch /pages/admin-profile/admin-profile` ✅ |

### P2-1 页头/弹窗一致性（独立验证，非仅看代码）

我抓取 `wx.showModal` 的真实 `content` 参数，逐角色比对页头 `roleLabel` 与弹窗「角色：」行：

```
role=super_admin  页头=导生会会长团   弹窗=角色：导生会会长团   ✅一致
role=admin        页头=导生管理员      弹窗=角色：导生管理员      ✅一致
role=counselor    页头=书院辅导员      弹窗=角色：书院辅导员      ✅一致
role=superadmin   页头=导生会会长团   弹窗=角色：导生会会长团   ✅一致 ← 上一轮P2-1 的 bug 已修
```

### 一处需要说明的自查纠错

我第一版脚本对 `dorm_manager`/`student` 断言「页头应显示宿管/管理员」，**报了 3 条 FAIL**。经查证：这是**我脚本的错误**——我直接调用了 `onMenuTap` 绕过守卫。真实运行时序是 `onLoad → ensureAdmin拦下 → return`，`loadAdminInfo` 从不执行、`adminInfo` 恒为 `{}`，因此 `onMenuTap` 对非 guide 角色**不可达**。我补测了可达性（见 R3b断言：`adminInfo==='{}'` 且未请求后端），确认**非缺陷**，已修正断言。**这属于我的测试缺陷，不是产品缺陷，据实记录。**

---

## 四、复验项 3：防反弹断言是否真有效 —— ✅ 反证有效（非恒真断言）

这是我本轮**重点验证**的一项。用 `backup → 注入变异 → 跑断言 → 还原` 的方式，检验断言是否真的能捕获回归。

### 反证 1：制造无限 reLaunch 循环（把 `:62` 改成 reLaunch 自身）

```js
// 变异：wx.reLaunch({ url: roleModel.homePath(role) })
//    → wx.reLaunch({ url: '/pages/admin-profile/admin-profile' })
```
```
$ node scripts/miniapp-role-gate-check.js
FAIL admin-profile dorm_manager 回宿管工作台 got "/pages/admin-profile/admin-profile"
FAIL admin-profile dorm_manager 未被弹回自身（防循环） got 1
FAIL admin-profile student 交给 admin-home 兜底 got "/pages/admin-profile/admin-profile"
3 项失败（共 65 项）
```
✅ **防循环断言立即变红**，`got 1` 正是它捕获了自循环。**断言有效。**

### 反证 2：整段删除 `isGuideRole` 守卫（还原P1-1 原始 bug）

```
FAIL admin-profile 拒绝 dorm_manager got true
FAIL admin-profile dorm_manager 回宿管工作台 got undefined
FAIL admin-profile 拒绝 student got true
FAIL admin-profile student 交给 admin-home 兜底 got undefined
4 项失败（共 65 项）
```
✅ 守卫被删即刻被捕获。

### 反证 3：`profile.js` 把 `isGuideRole` 改回 `isAdmin`（还原宿管越权）

```
FAIL profile 宿管不被弹去 admin-profile got 1
FAIL profile 宿管未发生任何 reLaunch got 1
FAIL profile 宿管正常加载本页数据 got 0
FAIL profile onShow 宿管不被弹走 got 1
FAIL profile onShow 宿管正常渲染 got 0
FAIL profile tabBar 宿管仍选中 index 2 got undefined
6 项失败（共 65 项）
```
✅ 6 条断言同时变红。

### 反证 4：`profile.js:45` 的 `isAdmin` 被误改成 `isGuideRole`（模拟红线被破坏）

```
4. tabBar selected role=dorm_manager 应=2 | 实际=3      ← 我的脚本捕获
```
✅ **这条是实施者脚本没覆盖的红线，我的脚本抓住了**。若只看 `miniapp-role-gate-check.js`，这次变异是漏网的。

### 反证后还原验证

```
$ diff 备份 admin-profile.js   → 一致 ✅
$ diff 备份 profile.js         → 一致 ✅
$ node scripts/miniapp-role-gate-check.js → 全部通过（共 65 项）
```
**4 次变异全部捕获、全部还原，断言有效性确认。**

---

## 五、复验项 4：36px 按钮 —— ✅ 已修复（含 `<text>` 元素确认）

我不满足于「类名改成 `ui-btn-md` 了」，自建了**WXSS 层叠解析器**，按 class token 精确匹配、按 wxss 加载顺序解算最终生效值。

> 说明：我第一版解析器有匹配 bug（用子串包含判断选择器，导致 `.ui-btn-sm` 错误命中不含该 class 的元素，误报 36px 不达标）。已改为按 class token 精确匹配后重算，下列为修正后结果。

### token 实际解析值（去注释后从 `app.wxss` 解析）
```
--btn-h-md = 88rpx → 44px
--btn-h-sm = 72rpx → 36px
--btn-h-lg = 96rpx → 48px
```

### 三处逐个解算

| 元素 | 命中规则 | 最终 min-height | display | 判定 |
|---|---|---|---|---|
| `admin-credit.wxml:37`「解除」`<text class="ui-btn ui-btn-ghost ui-btn-md list-action">` | `.ui-btn`→`.ui-btn-md`→`.ui-btn-ghost`→`.list-action`（页面） | `var(--btn-h-md)` = **88rpx = 44px** | `flex` | ✅ |
| `admin-feedback.wxml:25`「回复」`<view>` | 同上+ `.item-actions .ui-btn` | **88rpx = 44px** | `flex` | ✅ |
| `admin-feedback.wxml:26`「标记已处理」`<view>` | 同上 | **88rpx = 44px** | `flex` | ✅ |

**逐条排查了所有可能覆盖项，确认无冲突**：
- `admin-credit.wxss` 的 `.list-action` 只设`flex-shrink`/`margin-left`，**不动高度** ✅
- `admin-feedback.wxss` 的 `.item-actions`/`.item-actions .ui-btn` 只设 `display:flex`/`gap`/`margin`，注释明确「高度/字号由 ui-btn 提供」 ✅
- `app.wxss` 的 `.stagger > view` 只设 `animation`，**不含 display/height** ✅
- `admin-home.wxss` 的 `.feedback-retry` 只设 `margin-top` ✅

### `<text>` 元素的 display:flex 与 min-height 是否生效 —— ✅ 生效

这是你点名要我确认的风险点，我的判断依据：

1. **`<text>` 在小程序默认是 `inline`，`min-height` 对 inline 元素不生效** —— 这是真实风险。
2. **但 `.ui-btn` 第 9 行显式声明 `display: flex`**，使元素脱离 inline 格式化流，成为 flex 容器 → **`min-height` 随即生效**。
3. **覆盖顺序安全**：`.ui-btn` 是 class 选择器，优先级高于 UA 样式表，不会被 `<text>` 的 UA 默认 `display:inline` 覆盖。
4. **历史先例佐证**：HEAD 版该按钮就是 `<text class="small-btn">`，同为 text 上做按钮化改造，项目内路径一致。
5. **`min-height` 而非 `height` 的额外好处**：字号 28rpx + `line-height:1.4` = 39.2rpx文案高度 < 88rpx，内容不会溢出裁切。

⚠️ **诚实标注边界**：以上是**样式层静态解算**。真机渲染（尤其 `<text>` 的 flex 表现、Android/iOS 差异）**仍须真机确认**，我已列入下方人工验证清单。`button.wxss` 提供了 `button.ui-btn::after{border:0}` 兜底，但**无 `text.ui-btn` 专项兜底**——当前不需要（text 无 UA 伪元素），若后续在 `<text>` 上加 border 需注意。

### 全管理端按钮高度复扫
```
<view>  88rpx=44px × 13   ✅
<button> 88rpx=44px × 7    ✅
<text>  88rpx=44px × 2✅
<button> 96rpx=48px × 2    ✅
<view>  72rpx=36px × 1    ← admin-home.wxml:59 feedback-retry「重新加载」
```
**剩余唯一 1 处 `ui-btn-sm`** 是 `admin-home.wxml:59` 的「重新加载反馈统计」——属**重试/辅助操作**（非「通过/拒绝/审核」类关键操作），且被 `wx:if="{{feedbackStatus==='error'}}"` 包裹仅在错误时出现。结合你上轮明确的范围（关键按钮：通过/拒绝/审核/开关/重试），**「重试」在范围内**——我按严格标准判为**遗留 P3**，不判P2，理由见下节。

---

## 六、`homePath` 三分支：✅ 已修，且无回归

你标注为「已知待修」，我复验时**已修复**（`role-model.js:48-53`）：
```js
function homePath(role) {
  if (isDormRole(role)) return '/pages/verification/verification'
  if (isGuideRole(role)) return '/pages/admin-home/admin-home'
  return '/pages/login/login'
}
```
代码注释也写明了理由（学生先进管理端外壳一帧再被踢出不好）。

**返回值实测（10 种输入）**：`dorm_manager`→宿管工作台；`super_admin/admin/counselor/superadmin`→admin-home；**`student/ghost/undefined/null/''`→`/pages/login/login`** 全部正确 ✅

**5 处调用点无回归（自写 33 断言全绿）**：
| 调用点 | dorm_manager | student | guide 三角色 |
|---|---|---|---|
| `admin-profile.js:62` | → 宿管工作台 ✅ | → 登录页 ✅ | 放行 ✅ |
| `admin-scan.js:17` | → 宿管工作台 ✅ | → 登录页 ✅ | 放行 ✅ |
| `admin-manage.js:57` | → 宿管工作台 ✅ | → 登录页 ✅ | 放行 ✅ |
| `admin-home.js:70` | → 宿管工作台 ✅ | → 登录页 ✅ | 放行 ✅ |
| `auth.js:164getAdminHome` | → 宿管工作台 ✅ | → 登录页 ✅ | → admin-home ✅ |

---

## 七、附带发现：P2-3 配色已在本轮修复

上轮我报的「配色只收敛了一半」，本轮已处理（实施者新增了 `--warning`/`--warning-light`/`--success`/`--danger` token）：
```
#52C41A 现在 = 0   ← 已清零
#FF4D4F 现在 = 2   ← 仅 admin-announcement
#FA8C16 现在 = 1   ← 仅 admin-announcement
#1890FF 现在 = 1   ← 仅 admin-announcement
```
**残留 4 处全部集中在 `admin-announcement/admin-announcement.wxss`（:10,:11,:12,:17），该目录 `git status` 无任何改动、且未在 `app.json` 注册**，属**本任务范围外的既有遗留**，非本轮引入。**本轮改动范围内配色已完全收口 ✅**

---

## 八、本轮遗留（1 条，P3）

### P3-3　`admin-home.wxml:59` 「重新加载」按钮仍为 36px

- **文件**：`miniapp/pages/admin-home/admin-home.wxml:59`
- **代码**：`<view class="ui-btn ui-btn-ghost ui-btn-sm feedback-retry" ... aria-label="重新加载反馈统计">重新加载</view>`
- **实测层叠结果**：`min-height: var(--btn-h-sm)` = 72rpx = **36px**，低于 44px
- **实际 vs 预期**：36px / 期望 ≥88rpx(44px)。你上轮把「重试」列入关键按钮范围，故据实上报
- **缓解事实**：`wx:if="{{feedbackStatus === 'error'}}"` 包裹，仅在统计加载失败时出现；属辅助恢复操作，非审批/核验类关键动作
- **定级说明**：我判 **P3 而非 P2** —— 它是唯一残留项、属辅助操作、且有错误态条件包裹。**若你认为「重试」必须严格 ≥44px，则移除 `ui-btn-sm` 即可**，一行改动
- **修法**：`class="ui-btn ui-btn-ghost feedback-retry"`（去掉 `ui-btn-sm`，继承 `.ui-btn` 的 88rpx）

---

## 九、回归结果

```
miniapp-role-gate-check         PASS  (65 项)
miniapp-role-model-check        PASS  (38 项)
presentation-contract-check     PASS
admin-default-name-check        PASS
miniapp-verification-flow-check PASS   ← 宿管流程
我的页面守卫脚本 PASS=66 FAIL=0
我的 homePath 回归脚本 PASS=33 FAIL=0
```

---

## 十、需真机验证（工具无法覆盖）

1. **`<text class="ui-btn">` 真机渲染**（本轮新增）——「解除」按钮在 iOS/Android 上的 flex 表现与 44px 实际触控区。
2. `admin-scan` 真机扫码与相机权限（历次遗留，仍未验）。
3. `homePath` 新增的登录页回落分支真机验证（学生深链场景）。
4. 管理端全页面真机遍历，重点审核按钮禁用态真机是否阻止点击。

---

*第二轮复验结束。本轮共 4 次变异注入，全部捕获、全部还原，最终业务代码 0 改动。*

---

# 第三轮：收尾复验（自查纠错 + 反证复跑）

本轮不引入新结论，只做两件事：**重跑一遍上一轮的关键证据**（防止结论依赖记忆而非事实），以及**核实一处我自己记录的数字**。

## 一、R5 证据数字我自己记错，已更正 —— P4（我的缺陷，非产品缺陷）

| 项 | 内容 |
|---|---|
| **描述** | 上一轮报告 R5 行写的 `6 insertions / 5 deletions` 是**错的**，实测为 `5 insertions / 4 deletions` |
| **复现步骤** | `cd D:/敬一书院/jingyi-reservation-system && git diff --numstat a3e412f -- miniapp/utils/dorm-page.js` |
| **实际结果** | `5	4	miniapp/utils/dorm-page.js`（2 个 hunk，5 个 `+` 行、4 个 `-` 行） |
| **期望结果** | 我上一轮报告所写的数字 |
| **影响范围** | 仅影响我报告的证据表述，**不影响 R5 结论本身** |
| **根因** | 我上一轮写的是 `git diff a3e412f --stat` 的**跨文件汇总**输出（把 `dorm-layout.wxml` 的 2 行混算进去了），却把它当成了 `dorm-page.js` 单文件数字。这是一个**归因错误**：证据取自 A，结论却挂在 B 上 |
| **为何仍判定 R5 通过** | 结论不依赖那个数字。重新逐条核对 2 个 hunk 的实际改动内容，仍是原先认定的那 5 处：`statusLabels` 的 `pending_counselor→counselor_pending`、`onLoad(options)` 接收 date 且带正则校验、`statusLabels[item.status]` 兜底改为「状态待确认`。**未增未删，红线守住** |
| **补充排除** | 用 `git -c core.autocrlf=false diff --ignore-cr-at-eol --numstat` 复算仍为 `5/4`，排除 CRLF 行尾转换导致的数字漂移 |
| **修法** | 已更正报告 R5 行。教训：单文件结论必须配单文件证据，跨文件 `--stat` 不能当单文件证据用 |

## 二、反证复跑：4 次变异注入，全部被捕获

按 team-lead 要求「故意把 `admin-profile.js:62` 改成 reLaunch 自身，看断言是否会失败」重跑，并加测了另外 3 个变异点。**每次变异前对目标文件做 md5 备份，测完按备份还原并复核哈希。**

| # | 注入的变异 | 脚本反应 | 捕获它的断言 |
|---|---|---|---|
| 1 | `admin-profile.js:62` → `reLaunch({url:'/pages/admin-profile/admin-profile'})`（制造 reLaunch 自循环） | **3 项 FAIL** | `admin-profile dorm_manager 未被弹回自身（防循环）got 1` ← **正是 team-lead 指定验证的那条，精确捕获** |
| 2 | `profile.js` 两处守卫 `isGuideRole` → 改回 `isAdmin()`（P1-1 的原始缺陷形态） | **6 项 FAIL** | `profile 宿管不被弹去 admin-profile` / `宿管未发生任何 reLaunch` / `onShow 宿管不被弹走` 等 |
| 3 | `profile.js:45` `var isAdmin = auth.isAdmin()` → `isGuideRole(...)`（**破坏红线 R1**） | **1 项 FAIL** | `profile tabBar 宿管仍选中 index 2 got 3` ← **正是 team-lead 预警的「宿管 tabBar 错选 index 3」，被精确捕获** |
| 4 | `role-model.js` `homePath` 三分支 → 退回二元三元（待修项原始形态） | **14 项 FAIL** | `homePath(student)=登录页` 等，`student` 系全部落到 `admin-home` |

**结论：防反弹断言反证有效，4/4 变异全部被捕获，无恒真断言。**

**还原验证**：

```
$ md5sum miniapp/pages/admin-profile/admin-profile.js miniapp/pages/profile/profile.js miniapp/utils/role-model.js
4d86066c4aee2f05da431c4c3d226641 *miniapp/pages/admin-profile/admin-profile.js
f8d189c6e44ffc55acc8bf1d4533c28f *miniapp/pages/profile/profile.js
274c649f878753e57faeca2acbfdd65b *miniapp/utils/role-model.js
$ node scripts/miniapp-role-gate-check.js   → 全部通过（共 82 项）
$ node scripts/miniapp-role-model-check.js  → 全部通过（共 38 项）
$ git diff -- miniapp/pages/profile/profile.js
  → 仅剩实施者本轮修复内容（+roleModel import、onLoad/onShow 两处），无我注入的变异残留
```

## 三、新发现：`miniapp-role-model-check.js` 存在覆盖盲区 —— P3

| 项 | 内容 |
|---|---|
| **描述** | 变异 4（把 `homePath` 退回二元三元）导致 gate-check 14 项 FAIL，但 **`miniapp-role-model-check.js` 38 项全部通过、零反应**。角色模型自己的专属检查脚本对 `homePath` 的 student 分支**零覆盖** |
| **复现步骤** | 1. `cp miniapp/utils/role-model.js .qa-tmp/rm.bak`<br>2. 把 `homePath` 三分支改为 `return isDormRole(role) ? '/pages/verification/verification' : '/pages/admin-home/admin-home'`<br>3. `node scripts/miniapp-role-model-check.js` → **全部通过（共 38 项）**<br>4. `node scripts/miniapp-role-gate-check.js` → **14 项失败**<br>5. `cp .qa-tmp/rm.bak miniapp/utils/role-model.js` 还原 |
| **实际结果** | 学生角色被 `homePath` 兜底到 `/pages/admin-home/admin-home`（学生先进管理端外壳一帧再被踢出），而模型层专属脚本**察觉不到** |
| **期望结果** | 角色模型的专属检查脚本应覆盖 `homePath` 全部分支（尤其 student → 登录页这条安全回落） |
| **影响范围** | 不影响当前产品行为（`homePath` 现值正确、gate-check 有守住）。风险在于：**若后续有人只跑 role-model-check 就判定「模型层没问题」，会漏掉这类回落缺陷**——这正是第一轮 P1-2（自证闭环）的同类风险 |
| **定位** | `scripts/miniapp-role-model-check.js`（缺 `homePath` 用例） |
| **修法建议** | 在 `miniapp-role-model-check.js` 中补 `homePath` 的分支断言，至少覆盖 `dorm_manager / super_admin / admin / counselor / superadmin / student / null / undefined / '' / 未知角色` 共 10 种输入，断言 `student/null/undefined/''/未知角色` 一律返回 `/pages/login/login`。**并明确该脚本与 gate-check 的分工**：模型层查纯函数，页面层查守卫，不可用其中一个替代另一个 |

## 四、本轮遗留缺陷汇总

| 编号 | 级别 | 归属 | 一句话 |
|---|---|---|---|
| **P4-1** | P4（记录） | **我的报告缺陷** | R5 证据数字取自跨文件 `--stat`，归因错误。已更正，结论不变 |
| **P3-4** | P3 | 脚本覆盖 | `miniapp-role-model-check.js` 对 `homePath` student 分支零覆盖，被变异 4 证明为盲区 |

**P0 / P1 / P2 均为 0。** 产品代码侧无新增缺陷。

## 五、验收结论（第三轮）

**可以发布。** 与第二轮一致，且经本轮反证复跑后置信度提升：

- 红线 5 项：**全部守住**（R5 证据已更正至准确数字，结论不变）
- 防反弹断言：**反证有效**，4/4 变异全被捕获，指定验证的「防循环」断言确认非恒真
- P1-1 / P1-2 / P2-1 / P2-2：**已修复并实测通过**
- 业务代码：**0 改动**（3 个文件 md5 与备份前一致，diff 无变异残留）

---

*第三轮收尾结束。本轮 4 次变异注入全部捕获并还原；业务代码 0 改动；临时文件 `.qa-tmp/` 已删除。*

---

# 第四轮：收尾时发现的脚本 P0（实施者在我验证窗口之后的改动导致）

## 一、`miniapp-role-gate-check.js` 当前**崩溃**，无法运行 —— P0（阻断 CI）

| 项 | 内容 |
|---|---|
| **描述** | 清理临时文件后复跑基线，`miniapp-role-gate-check.js` **崩溃退出（exit 1）**，第147 行起全部断言不执行 |
| **复现步骤** | `cd D:/敬一书院/jingyi-reservation-system && node scripts/miniapp-role-gate-check.js` |
| **实际结果** | ```<br>scripts/miniapp-role-gate-check.js:147<br>check('homePath(dorm_manager)=宿管工作台', roleModel.homePath('dorm_manager'), HOME_DORM)<br>                                                ^<br>TypeError: roleModel.homePath is not a function<br>    at Object.<anonymous> (scripts/miniapp-role-gate-check.js:147:49)<br>EXIT CODE: 1<br>``` |
| **期望结果** | 全部通过（共 82 项） |
| **影响范围** | **本轮唯一被公认的「防反弹回归门禁」当前完全跑不起来**。第 147 行之后的 **17 条断言（占82 项的 21%）全部不执行**——含`homePath` 三分支、`scanPath`、`isAdminRole` 红线、`superadmin` 别名一致性。CI 接入此脚本时会在第一道就红 |
| **根因** | `:55` 定义的是函数 `function roleModel () { return freshRequire(...) }`，但 `:147-164`、`:261`、`:323-325` **共 17 处漏写调用括号**，写成 `roleModel.homePath(...)` 而非 `roleModel().homePath(...)`。JS 中 `fn.prop` 是 `undefined`，故报 `is not a function`<br>**实测统计：`roleModel().`正确用法 0 处，`roleModel.` 漏括号 17 处** |
| **为何之前能通过** | **时间线证据**：`role-model.js` mtime `01:24:52`，`miniapp-role-gate-check.js` mtime `01:26:20`，当前 `01:27:21`。脚本在我完成变异测试**之后**被改动，漏括号是那次改动带入的。我此前的 4 次变异测试跑在 01:26 之前，**当时的 82 项通过是真实的**，不是被这个 bug 掩盖的 |
| **关键验证：断言本身是对的，不是「靠崩溃混过去」** | 我**只补调用括号、不改任何断言内容与预期值**，脚本立即 **82 项全部通过**。证明断言逻辑与预期值均正确，问题纯粹是调用写法 |
| **定位** | `scripts/miniapp-role-gate-check.js:147-164`、`:261`、`:323-325` |
| **修法建议** | 把 `:55` 的 `roleModel()` 改为**返回模块的常量**（避免"函数名像模块"的设计陷阱），例如：<br>`var roleModel = freshRequire('../miniapp/utils/role-model')`（需要每次刷新时重新赋值），或保留函数但**全量替换 17 处为 `roleModel().`**。前者更不易复发 |

**我未修改该脚本**：已按备份完整还原，`md5 = 3c4ef6f6ffad62ecce04d14409538660`，漏括号计数恢复为 17，与实施者版本一致。

## 二、这对既有结论的影响评估

| 问题 | 结论 |
|---|---|
| 是否动摇「红线 5 项全部守住」？ | **不动摇**。红线 5 项我都有**独立的、单文件级**实测证据（逐行读码+ tabBar 实际取值 + 7 种 isAdmin 输入 + roleMap 完整性 + dorm-page 逐 hunk 核对），不依赖该脚本 |
| 是否动摇「防反弹断言反证有效」？ | **不动摇**。4次变异捕获是在 01:26 前跑的，脚本当时可正常运行。且 `:177-187` 的防循环断言用的是 `launched` 数组（页面级），与`roleModel()` 这条错误调用链无关 |
| 是否存在「断言从未真正执行过」的风险？ | **已排除**。补括号后 82 项全通，含 17 处原本不执行的断言。说明这些断言的预期值是对的 |
| 实施者是否需要重新自证？ | **需要**。脚本现在跑不起来，CI 门禁处于失效状态。建议修完后重跑并贴出完整输出 |

## 三、缺陷汇总更新（累计）

| 编号 | 级别 | 归属 | 一句话 |
|---|---|---|---|
| **P0-1** | **P0** | **脚本** | `miniapp-role-gate-check.js` 因 17 处漏调用括号而崩溃，17 条断言（21%）不执行，门禁失效 |
| P4-1 | P4 | 我的报告 | R5 证据数字取自跨文件 `--stat`，归因错误。已更正，结论不变 |
| P3-4 | P3 | 脚本覆盖 | `miniapp-role-model-check.js` 对 `homePath` student 分支零覆盖（变异 4 证明为盲区） |
| P3-3 | P3 | 页面 UI | `admin-home.wxml:59` 「重新加载」仍 `ui-btn-sm`（36px） |

**产品代码（miniapp/ 业务文件）本轮 0 缺陷**，P0-1 属测试脚本缺陷，不影响小程序运行时行为，但会让 CI 门禁失效，**建议发布前修掉**。

## 四、第四轮验收结论

**产品代码：可以发布**（红线守住、P0/P1/P2 均为 0）。

**但有一个前置条件**：若团队打算把 `miniapp-role-gate-check.js` 作为 CI 门禁，**必须先修 P0-1**，否则该门禁形同虚设——它现在会在第一道断言就崩溃，且崩溃前的 145 项虽有效，但 147 行后的 17 条红线断言（`homePath` 三分支、`isAdminRole` 红线等）**从不执行**，等于无人看守。

---

*第四轮结束。业务代码 0 改动；`scripts/miniapp-role-gate-check.js` 已按备份还原（md5 一致）；临时文件 `.qa-tmp*` 已全部删除。*
