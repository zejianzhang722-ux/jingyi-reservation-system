# 敬一书院预约系统 — 三端未授权出入口与暴露面安全审查报告

> **审查范围**：移动学生端（小程序学生页面）、移动管理端（小程序 admin-\* 页面）、管理后台端（admin/ Vue3）
> **审查维度**：网络端口、API 路由、服务接口、调试通道、隐藏入口
> **审查方式**：主理人逐文件核对源码取证 + 架构师系统级暴露面定级
> **审查日期**：2026-09-10
> **被审查代码基线**：`jingyi-reservation-system` 主仓库（4 个 worktree 为蓝绿开发分支，不在主审查范围）

---

## 一、系统三端架构事实（已核对）

| 端 | 代码位置 | 技术栈 | 对外暴露方式 |
|----|---------|--------|------------|
| 后端 Express | `server/src/app.js` | Express + Socket.IO + MySQL + Redis | 单端口 3000，HTTP + WebSocket 共用 |
| 管理后台 | `admin/` | Vue3 + Vite + Element Plus | 静态站点，路由守卫 beforeEach |
| 小程序（学生端+管理端） | `miniapp/` | 原生小程序 | 微信平台分发，动态 baseUrl |
| 调度 Worker | `server/src/scheduler-worker.js` | 独立后台进程 | **不监听端口，无网络接口** |

四层鉴权中间件：`auth`(JWT) / `roleAuth`(角色) / `adminScope`(楼栋数据域) / `reservationAccess`(资源归属)，另设 `opsAuth`(运维通道)。生产启动经 `productionConfigGuard.validate()` 强制校验关键配置。

---

## 二、暴露面总览

三端共识别 **29 项对外暴露入口**，按鉴权状态分类：

| 鉴权状态 | 入口数 | 说明 |
|---------|-------|------|
| 无鉴权（设计如此） | 5 | 探针 `/ops/live`、`/ops/ready`、`/ops/version`、`/health`、`/ready`；静态规则 `/rules` |
| optionalAuth（匿名可读） | 1 组 | `/room` 全路由（列表/详情/座位/时间线/统计） |
| 运维 token 鉴权但 fail-open | 3 | `/ops/status`、`/ops/metrics`、`/ops/audit-integrity` |
| 路由级 auth + roleAuth | 6 | `/audit`、`/credit`、`/stats`、`/admin`、`/student-ops`、`/account-batch` |
| 路由级无兜底、内部逐 endpoint 挂 auth | 9 | `/user`、`/room`、`/reservation`、`/groups`、`/checkin`、`/reading-room`、`/poster`、`/notification`、`/feedback` |
| 静态文件无鉴权 + 严格防护 | 1 | `/uploads/:filename`（仅 png/jpg + 路径穿越防护） |
| 登录入口（合理无鉴权 + 限流） | 6 | `/auth/login/*`、`/auth/refresh` |
| WebSocket 实时通道 | 1 | Socket.IO（JWT + 黑名单 + 60s 会话守卫 + 房间 scope） |
| 移动端调试/隐藏入口 | 4 | mockMode、mockLogin、network-settings、mock-db |

---

## 三、问题清单（按优先级排序）

### P1 严重（1 项）

#### P1-C1 refreshToken 鉴权绕过
- **维度**：API 路由 / 鉴权机制
- **证据**：`server/src/controllers/authController.js` line 342-378（`refreshToken`）；line 351 `jwt.verify(oldAccessToken, config.jwt.secret, { ignoreExpiration: true })`；line 364 `if (currentRefreshToken && providedRefreshToken && currentRefreshToken !== providedRefreshToken)`
- **问题**：允许仅凭**过期的 access token** 刷新新 token（`ignoreExpiration:true`）。当攻击者只提供过期 access token、不提供 refreshToken 时，`providedRefreshToken=null`，line 364 三条件与逻辑不满足 → 跳过 Redis 一致性校验 → 直接签发新 token。line 380-407 为 dead code（永不执行）。
- **影响**：access token 泄露（日志/中间人/前端存储）即可持久接管账户，refresh token 机制被架空。
- **当前缓解**：access token 短时（2h）；logout 时 access token 进黑名单 2 小时。
- **修复建议**：
  1. 刷新必须要求**有效 refresh token**，删除"过期 access token 单独刷新"路径；
  2. Redis 一致性校验改 fail-closed（无 storedRefreshToken 即拒绝，而非跳过）；
  3. refresh token rotation（签发新 refresh 时作废旧的，检测旧 token 复用即撤销整条会话链）；
  4. 删除 line 380-407 dead code。

> **【P1-C1 核实修正】** 实际 `/auth/refresh` 路由调用 `tokenController.refresh`（`routes/auth.js:13`），**非** `authController.refreshToken`（后者经 Grep 确认在 server/src 无调用点，属死代码）。`tokenController.refresh`（`tokenController.js:35-76`）已正确实现：强制 refresh token、jwt.verify 默认验过期、拒非 refresh 类型、`storedRefreshToken !== providedRefreshToken` fail-closed、loadCurrentPrincipal 校验、rotation。**P1-C1 漏洞存在于死代码中，实际路由不可利用**，降为 P4（死代码清理）。死代码 authController.refreshToken 已改为安全实现，建议从 exports 移除并删除。此系审查未先确认路由实际调用点的判断失误，核实纠正。

### P2 高危（4 项）

#### P2-B4 opsAuth 非生产环境全放行
- **维度**：API 路由 / 运维通道
- **证据**：`server/src/middleware/opsAuth.js` line 17 `if (!configured && process.env.NODE_ENV !== 'production') return next();`；`server/src/routes/ops.js` line 56 `router.use(opsAuth.middleware)` 后挂 `/status`、`/metrics`、`/audit-integrity`
- **问题**：NODE_ENV 留空或设为非 production 且 `OPS_MONITOR_TOKEN` 未配时，运维接口 `/status`（运行状态）、`/metrics`（Prometheus 指标）、`/audit-integrity`（审计链）**完全开放**。
- **当前缓解**：生产守卫要求生产必配 OPS_MONITOR_TOKEN≥32；Dockerfile 设 `NODE_ENV=production`。
- **修复建议**：改 fail-closed（未配 token 一律拒绝敏感接口，与探针 `live`/`ready` 物理分离路由）；生产守卫扩展：非生产对外暴露时也强制要求 OPS_MONITOR_TOKEN。

> **【已修复 · 2026-09-11】** `opsAuth.middleware` 已改为 fail-closed：未配置 `OPS_MONITOR_TOKEN` 时一律 401，仅「非生产 且 显式 `OPS_ALLOW_ANONYMOUS=true`」才放行（该开关在生产被强制忽略）。`/live`、`/ready`、`/version` 仍在 `router.use(opsAuth.middleware)` 之前，保持匿名，未受影响。
> **验证**：`security-runtime-check.js` 实测仅探测 `/health`，并不匿名访问 `/ops/status`，故 fail-closed 无回归；QA 独立边界矩阵 10/10 通过，含「生产 + 匿名开关 + 无 token → 401」「空串/纯空白 token 视为未配置 → 401」「已配 token 时匿名开关不兜底 → 401」。
> **残余**：任何依赖旧「非生产免 token」行为的本地脚本/调试页需显式设 `OPS_ALLOW_ANONYMOUS=true`（当前仓库内无此依赖）。

#### P2-C3 + P2-F4 mock 登录逃生阀 + mock-db 后门
- **维度**：调试通道 / 隐藏入口 / 鉴权机制
- **证据**：`authController.js` line 67-88（`mock_code_` 分支）；`config/index.js` line 39 `allowMockLogin = NODE_ENV==='test' && ALLOW_MOCK_WECHAT_LOGIN==='true'`；`productionConfigGuard.js`（未检查 ALLOW_MOCK_WECHAT_LOGIN）；`config/mock-db.js`（硬编码 admin/admin123、superadmin/super123、counselor/counselor123）
- **问题**：wechatLogin 的 mock 分支受 allowMockLogin 双重条件保护，生产 NODE_ENV=production 不触发；但 productionConfigGuard **未检查 ALLOW_MOCK_WECHAT_LOGIN 逃生阀**。mock-db 含硬编码凭据，守卫未显式禁止生产加载。若误配 `NODE_ENV=test` + `ALLOW_MOCK_WECHAT_LOGIN=true`（或误用 mock-db），mock 登录后门开启（`mock_code_` + 任意学号绕过微信认证）。
- **修复建议**：
  1. 生产守卫扩展：拒绝 `ALLOW_MOCK_WECHAT_LOGIN=true`；启动时检测 db.isMock() 为真则拒绝启动；
  2. mock 代码生产构建编译期排除（tree-shaking / 条件编译），而非运行时靠环境变量；
  3. mock-db 凭据移出源码，改 env 注入。

> **【已修复 · 2026-09-11】**（后端路径已闭环，小程序侧见 P2-F2/F3）
> 1. `productionConfigGuard` 新增 `assertNoDangerousSwitches(production)`：`ALLOW_MOCK_WECHAT_LOGIN=true` 时生产硬拒（`MOCK_LOGIN_FORBIDDEN`）、非 test 环境亦拒、**仅 test 放行**（保住配置层唯一合法的 mock 登录场景）。
> 2. 新增导出 `assertNoMockDatabase(isMock, env)`；`validate(options)` 增可选 `dbMock` 入参。`app.js` 改为 `validate({ dbMock: db.isMock() })`，并在 `checkDataReadiness()` 后二次复核 `assertNoMockDatabase(db.isMock())`。
> 3. `mock-db.js` 顶部 + `query()` 入口双兜底：生产加载/查询一律 `MOCK_DB_FORBIDDEN`；种子口令改 `MOCK_ADMIN_PASSWORD` / `MOCK_SUPERADMIN_PASSWORD` / `MOCK_COUNSELOR_PASSWORD` env 注入（保留原值作非生产默认）。
> **关键兼容性约束（已满足）**：`validate()` 必须保持零参可调用且返回 `{valid, production}`——`backup-recovery-check.js:76-87` 与 `observability-audit-check.js:164-181` 均在生产模式下断言 `validate().valid === true`；`observability-audit-check.js:201` 还断言守卫源码含 `OPS_MONITOR_TOKEN_REQUIRED` / `AUDIT_IP_HASH_SALT_REQUIRED`。
> **验证**：守卫边界矩阵 9/9（含反向用例 G2「test + 开关=true 必须不抛」、G6「零参在生产配齐 env 仍 valid:true」、G9「原有 11 条规则未被短路」）；mock-db 5/5（含 M3 env 覆盖真实生效）；14 个回归脚本全绿。
> **残余**：种子口令的**非生产默认值仍为源码字面量**（`admin123` 等），env 注入提供的是覆盖能力而非物理移除；真正的控制点是「生产禁止加载 mock-db / 禁止 mock 登录」，已闭环。生产仍在 `NODE_ENV=production` 下不加载 mock-db，故非生产默认值不可达。

#### P2-F2 小程序 mockLogin 本地假登录
- **维度**：移动端隐藏入口
- **证据**：`miniapp/utils/auth.js` line 69-112（`mockLogin`）、line 165（导出）；`miniapp/app.js` line 6 `mockMode: true`
- **问题**：mockLogin 向后端发 `mock_code_<学号>`；当后端拒绝或网络失败时，catch 分支在本地 storage 写入 fallbackUser（`id=Date.now()`、`credit_score:100`、`status:active`），`token=null` 但 `userInfo` 已设。app.js 默认 `mockMode:true`。
- **核实后影响范围（下调）**：`auth.isLoggedIn()`（`utils/auth.js:127`）= `!!token && !!userInfo`，admin-\* 页面普遍双查 `!isLoggedIn()||!isAdmin()`，入口 index 亦先 isLoggedIn 兜底 → token=null 假用户会被拦截、无法进入管理页面执行操作。实际危害仅限纯展示性逻辑（头像/昵称）误导，**无越权操作能力**。但 mockLogin/mockMode 仍是调试残留应剔除。
- **修复建议**：
  1. 生产构建物理剔除 mockLogin / mockMode；
  2. catch 分支绝不写伪造用户，失败即登出跳转；
  3. 前端统一基线：任何需鉴权操作先校验 token 有效性，不信任无 token 的 userInfo。

#### P2-F3 network-settings 自定义后端地址（定级上调至 P3 见下，此处归入移动端入口组）
> 见 P3-F3。

### P3 中高危（2 项）

#### P3-F3 network-settings 自定义后端地址
- **维度**：移动端隐藏入口 / 中间人风险
- **证据**：`miniapp/pages/network-settings/`（生产小程序保留）；`miniapp/utils/request.js` line 25-28（`setBaseUrl` 存 customBaseUrl）、line 34-41（`setNetworkConfig`）；`miniapp/utils/network-config.js` line 1 `DEFAULT_LOCAL_HOST='127.0.0.1'`
- **问题**：允许用户在小程序内自定义后端服务地址，存入 `customBaseUrl` storage，默认 `127.0.0.1`。可诱导用户改地址到恶意服务器，窃取 token / 数据（钓鱼 / 中间人）。`project.config.json` `urlCheck:false` 关闭微信域名校验（仅影响开发者工具）。
- **修复建议**：
  1. 生产小程序移除 network-settings 页面，后端地址编译期锁定；
  2. 兜底：运行时若 customBaseUrl 非生产白名单域名则忽略；
  3. 待复核：customBaseUrl 是否绕过微信 request 合法域名校验（见待复核 3）。

> **【本轮新增核实发现 · 2026-09-11】** `miniapp/pages/login/login.js:28-57` 存在一处**比 network-settings 更前置**的任意后端地址入口：登录页自带 `showServerConfig` 面板，`selectServer()` 与 `useCustomServer()` 均直接调用 `request.setBaseUrl(url)`，可把后端指向任意地址（钓鱼 / 中间人）。**登录页是人人可达的第一入口**，而 network-settings 需登录后才可达。此项在原审查中遗漏，本轮修后端时核实发现。
> **下一轮小程序治理必须一并纳入**，涉及：`login.js` 的 `selectServer` / `useCustomServer` / `toggleServerConfig` / `refreshCurrentServer`，`login.wxml` 对应面板，以及 `data.showServerConfig` / `serverOptions` / `customServerUrl`。

#### P3-C2 studentLogin 弱认证
- **维度**：鉴权机制
- **证据**：`authController.js` line 291-340（`studentLogin`）；`routes/auth.js` line 11 `studentLoginIpLimiter + studentLoginAccountLimiter`
- **问题**：仅凭学号（9-10 位数字）+ 一卡通卡号（6 位数字）登录，无密码。卡号仅 100 万组合，可暴力枚举。靠 IP / 账号限流兜底。
- **修复建议**：加图形验证码 / 短信二次因子；收紧限流阈值与锁定策略；长期增设独立密码或绑定微信 OpenID 强认证。

### P4 中危（4 项）

#### P4-B optionalAuth 信息泄露（/room 全路由）
- **维度**：API 路由 / 信息泄露
- **证据**：`routes/room.js` line 7-15 全部 `optionalAuth`（列表/类型/楼栋/公告/统计/详情/座位/时间线）
- **问题**：未登录可读取房间列表、详情、座位布局、时间线（占用情况）、统计。属设计如此（浏览体验），但座位/时间线暴露占用情况，信息泄露风险中等。
- **修复建议**：评估子接口分级鉴权（列表/详情可匿名，座位/时间线改 auth 或脱敏）。

#### P4-B 未授权路由定性
- `/rules`（`rulesController.getRules` 返回静态使用规则文本，无敏感信息，设计如此，低风险）；
- `/ops/live`、`/ops/ready`、`/health`、`/ready`（探针，设计如此）；
- `/ops/version`（返回版本快照，生产下 details 被裁剪，待复核覆盖范围见待复核 2）。

#### P4-F1 app.js mockMode 默认开启
- 与 P2-F2 联动，生产应默认 false。修复：生产构建置 `mockMode:false`。

#### P4-C5 CORS 无 Origin 放行
- `app.js` line 45-47 `if (!origin || corsOrigins.includes(origin))`——无 Origin 头请求放行。属浏览器策略限制（服务器端/curl 本就不受 CORS 约束），风险有限。生产守卫已禁止 CORS 含通配符/本机。

#### P4-V1 `/ops/version` 生产暴露完整构建元信息（核实后新增）
- **维度**：API 路由 / 信息泄露
- **证据**：`routes/ops.js` line 51-54 无条件 `res.json(versionService.snapshot())`；`services/versionService.js:13-24` snapshot 返回 gitSha/buildTime/releaseId/deploymentSlot/nodeVersion/environment
- **问题**：`/api/v1/ops/version` 无鉴权且生产不裁剪，暴露 gitSha + buildTime + deploymentSlot，攻击者可关联代码版本查找对应漏洞。此前报告误以为生产裁剪 details，核实后纠正。
- **修复建议**：加 opsAuth 鉴权，或生产裁剪 gitSha/buildTime/deploymentSlot。

### P5 低中危（2 项）

#### P5-G1 管理后台 hasRouteRole 默认放行
- **维度**：管理后台路由守卫
- **证据**：`admin/src/router/adminRoutes.js` line 53-56 `if (!roles.length) return true`
- **问题**：路由无 `meta.roles` 时默认放行所有角色。当前所有路由均配 roles，但未来新增路由忘配则裸奔。属前端守卫，后端 API 有独立鉴权兜底。
- **修复建议**：改 default-deny（无 roles 即拒绝）。

#### P5-H1 CI 硬编码弱密码
- **证据**：`.github/workflows/*.yml` 均硬编码 `MYSQL_PASSWORD: ci_password`
- **问题**：明文弱密码用于 CI service container。CI 隔离环境风险低，但属硬编码凭据。
- **修复建议**：改用 GitHub Actions Secrets。

### P6 低危（6 项，设计如此或已充分缓解）
- **C4 JWT_SECRET 默认随机**：生产守卫已强制 ≥32 字符；
- **D1 上传文件**：`secureUploadService` PNG/JPEG 签名校验 + 危险双扩展名过滤 + 尺寸限制 + `safePublicFilename` 正则 + 路径穿越防护 + dotfiles:deny，安全；
- **D2 备份文件**：super_admin 鉴权 + `safeBackupPath` 正则防穿越，安全；
- **E1 WebSocket**：authenticateSocket 验 JWT + 拒 refresh token + 黑名单 + 60s 会话守卫 + 房间 scope 校验 + 30 次/60s 限流，完善；
- **A1 Dockerfile**：非 root（10001）+ 仅 EXPOSE 3000 + uploads/backups 目录 0700，规范；
- **scheduler-worker.js**：不监听端口，无网络接口，安全。

---

## 四、架构层面加固建议

1. **路由级默认鉴权（fail-secure）**：在 `/api/v1` 挂全局 `auth` + 显式无鉴权白名单（探针 / rules / uploads）。新增 endpoint 忘挂鉴权时全局兜底拦截，从"开发者记得挂"转为"开发者记得豁免"，遗漏后果更可控。

2. **生产配置逃生阀治理**：扩展 `productionConfigGuard` 覆盖 `ALLOW_MOCK_WECHAT_LOGIN`、mock-db 加载检测、非生产对外暴露时强制 OPS_MONITOR_TOKEN；建立逃生阀登记表统一校验。

3. **移动端调试入口下线策略**：mockMode、mockLogin、network-settings、mock-db 统一收口到 dev-only 构建变体，生产包物理剔除（编译期排除而非运行时关闭）；后端地址编译期锁定；前端统一 token 校验基线。

4. **refresh token 机制加固**：刷新凭证回归 refresh token + Redis 一致性 + fail-closed + refresh token rotation + 删除 dead code。

---

## 五、待复核事项核实结论（主理人补充取证）

1. **小程序页面鉴权基线（决定 P2-F2 危害范围）**：已核实。`auth.isLoggedIn()`（`utils/auth.js:127`）= `!!token && !!userInfo`，**同时校验 token**。admin-\* 页面普遍 `if(!auth.isLoggedIn() || !auth.isAdmin())` 双查，index 入口亦先 isLoggedIn 兜底。→ **mockLogin 写入的 token=null 假用户会被 isLoggedIn() 拦截，无法进入管理页面执行操作**。P2-F2 实际危害下调：仅可能在纯展示性逻辑（头像/昵称）造成误导，无越权操作能力。但 mockLogin/mockMode 仍属调试残留，应剔除。

2. **`/api/v1/ops/version` 生产暴露范围**：已核实并**修正报告**。`versionService.snapshot()`（`services/versionService.js:13-24`）返回 service/version/gitSha/buildTime/releaseId/deploymentSlot/nodeVersion/environment；`routes/ops.js:51-54` **无条件**返回完整 snapshot（**生产不裁剪**，此前报告表述有误）。→ 生产暴露 gitSha + buildTime + deploymentSlot，有助于攻击者关联代码版本、查找对应 CVE。建议加 opsAuth 鉴权或裁剪 gitSha/buildTime。**新增问题 P4-V1**。

3. **customBaseUrl 与微信域名校验**：已核实。`network-config.js` 构造完整 URL，`request.js` 用 `wx.request`。线上生产小程序受微信平台「服务器域名」白名单**硬约束**——customBaseUrl 指向非白名单域名会被平台拦截，钓鱼实际不可行。但 `project.config.json` `urlCheck:false` + 真机「不校验域名」可绕过（仅开发/调试）。→ P3-F3 线上危害有限，但 network-settings 页面仍是调试残留，且与 P1-C1 联动（一旦 token 经任何途径泄露即被持久接管）。

4. **P1-C1 access token 泄露途径**：已核实。token 存 `wx.getStorageSync`（小程序 storage 隔离，相对安全）；后端未见明文记录 token；`normalizeErrorMessage` 把含 token 的消息转义。主要泄露途径：① P3-F3 customBaseUrl 钓鱼（线上受平台限制，devtools/真机可绕过）；② 网络抓包（HTTPS 保护）。→ P1-C1 与 P3-F3 联动：一旦某种途径泄露 access token（哪怕过期），即可持久接管。修复 P1-C1 仍为最高优先级。

5. **studentLogin 限流阈值（`middleware/rateLimit.js`）**：已核实。`studentLoginAccountLimiter`：15 分钟窗口、max:10、skipSuccessfulRequests（成功不计）、key=ip+studentNo；`studentLoginIpLimiter`：15 分钟、max:60、skipSuccessfulRequests、key=ip。→ 单 IP 每 15 分钟可对 60 个学号各试 10 次（共 600 次失败）。卡号 6 位 = 100 万组合，单学号 10 次/15min 暴力不完，但分散慢速暴力仍可行。限流降低效率但未根除弱认证风险，仍需二次因子。

6. **scheduler-worker.js 额外通道**：已核实。仅 require 服务、init scheduler/outbox/backup、监听 SIGTERM/SIGINT；无 http.listen、无 net/socket、无 child_process、无额外 fs 通道。**确认无额外暴露面**。

---

## 六、总体评价

本系统在**生产配置守卫、WebSocket 鉴权、上传/备份防护、Dockerfile 规范、四层鉴权中间件体系**方面工程意识扎实，安全基线较高。**最需优先处理**：

- **P1-C1**（refresh 绕过）——鉴权链路实质漏洞，access 泄露即持久接管；
- **P2-B4**（opsAuth fail-open）——运维接口在配置不当时裸奔；
- **P2-C3+F4**（逃生阀未治理）——mock 登录/mock-db 在误配时成后门；
- **P2-F2 + P3-F3**（移动端调试入口）——应作为一组统一治理，生产构建物理剔除。

移动端调试入口（mockMode / mockLogin / network-settings / mock-db）是本系统最成体系的暴露面，建议统一收口到 dev-only 构建变体，生产包物理剔除。

---

*审查执行人：主理人齐活林（Qi）取证 + 架构师高见远定级*
