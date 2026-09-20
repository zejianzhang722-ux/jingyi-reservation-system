# P2 安全加固修复记录（后端两项）

- 日期：2026-09-11
- 范围：**仅后端两项** —— P2-B4（opsAuth fail-open）、P2-C3 + P2-F4（逃生阀 + mock-db 后门）
- 不在本轮范围：P2-F2 / P3-F3 / P4-F1（小程序调试入口物理剔除）——用户决定另开一轮
- 提交状态：**未 git commit**，待确认后统一提交
- 关联文档：`docs/security-audit-report.md`

---

## 1. 决策记录

| 决策点 | 结论 |
|---|---|
| 小程序端（mockLogin / network-settings / 登录页面板） | 本轮不动，另开一轮 |
| `OPS_ALLOW_ANONYMOUS` 匿名运维开关 | 保留，但**仅非生产生效**，生产强制忽略 |
| 变化前基线 | 6 个安全相关脚本全绿，已记录作为回归对照 |

---

## 2. 改动清单（4 个源文件 + 1 个示例配置）

### 2.1 `server/src/middleware/opsAuth.js` —— 去 fail-open

```js
// 前（fail-open：环境变量漏配即全网放行）
if (!configured && process.env.NODE_ENV !== 'production') return next();

// 后（fail-closed）
const anonymousAllowed = function() {
  return process.env.NODE_ENV !== 'production' && process.env.OPS_ALLOW_ANONYMOUS === 'true';
};

const middleware = function(req, res, next) {
  const configured = String(process.env.OPS_MONITOR_TOKEN || '').trim();
  if (!configured) {
    if (anonymousAllowed()) return next();
    return response.error(res, '运维接口认证失败', 401);
  }
  if (!secureEqual(tokenFromRequest(req), configured)) {
    return response.error(res, '运维接口认证失败', 401);
  }
  next();
};
```

- 受影响接口（`routes/ops.js:56` 之后）：`GET /status`、`GET /metrics`、`GET /audit-integrity`
- 未受影响（仍在 `router.use(opsAuth.middleware)` 之前，保持匿名）：`GET /live`、`GET /ready`、`GET /version`
- 导出：`secureEqual` / `tokenFromRequest` / `middleware` 原样保留，仅新增 `anonymousAllowed`

### 2.2 `server/src/services/productionConfigGuard.js` —— 守卫扩展

新增 `assertNoDangerousSwitches(production)`：`ALLOW_MOCK_WECHAT_LOGIN === 'true'` 时

| NODE_ENV | 行为 |
|---|---|
| production | 抛 `MOCK_LOGIN_FORBIDDEN`（硬拒） |
| test | 放行（配置层唯一合法开启 mock 登录的场景） |
| 其它（dev / 未设 / staging） | 抛 `MOCK_LOGIN_FORBIDDEN`（fail-closed） |

新增导出 `assertNoMockDatabase(isMock, env)`：`production && isMock` → 抛 `MOCK_DB_FORBIDDEN`。

`validate` 签名改为 `validate(options)`（**向后兼容，可零参调用**），函数体开头顺序：

```js
const production = process.env.NODE_ENV === 'production';
assertNoDangerousSwitches(production);
if (production && options && options.dbMock === true) {
  fail('生产环境禁止使用模拟数据库', 'MOCK_DB_FORBIDDEN');
}
if (!production) return { valid: true, production: false };
// 其后原有 11 条生产规则一字未改，结尾仍 return { valid: true, production: true };
```

导出：`{ validate, assertNoMockDatabase }`

### 2.3 `server/src/app.js` —— 启动期接入

```js
// line 100
productionConfigGuard.validate({ dbMock: db.isMock() });
const readiness = await dataReadinessService.checkDataReadiness();
// line 102（新增：读取就绪后二次复核）
productionConfigGuard.assertNoMockDatabase(db.isMock());
```

失败路径沿用既有 `startServer` catch：生产下 `process.exit(1)`，即**拒绝启动**。

### 2.4 `server/src/config/mock-db.js` —— 生产禁载 + 口令 env 化

```js
// 顶部（require 之后）：生产加载即抛
if (process.env.NODE_ENV === 'production') {
  const err = new Error('生产环境禁止加载模拟数据库');
  err.code = 'MOCK_DB_FORBIDDEN';
  throw err;
}

// query() 入口：生产查询即 reject（兜底）
if (process.env.NODE_ENV === 'production') {
  const err = new Error('生产环境禁止使用模拟数据库');
  err.code = 'MOCK_DB_FORBIDDEN';
  return Promise.reject(err);
}

// 种子口令 env 注入（保留原值作非生产默认）
const adminPassword = process.env.MOCK_ADMIN_PASSWORD || 'admin123';
const superAdminPassword = process.env.MOCK_SUPERADMIN_PASSWORD || 'super123';
const counselorPassword = process.env.MOCK_COUNSELOR_PASSWORD || 'counselor123';
```

账号名 / 角色 / scope 结构未改动；`building_admin` 复用 `adminPassword`。

### 2.5 `server/.env.example`
新增 `OPS_ALLOW_ANONYMOUS=false`（注明仅非生产生效、默认关）、三个 `MOCK_*_PASSWORD`（注明仅非生产 mock 使用），并注释说明 `ALLOW_MOCK_WECHAT_LOGIN` 仅 `NODE_ENV=test` 合法（未写入 `true`）。

---

## 3. 关键兼容性约束（CI 硬断言）

这些是方案的边界，改动时**不可违反**：

| 脚本 | 断言 | 约束 |
|---|---|---|
| `backup-recovery-check.js:76-87` | 生产下 `validate().valid === true` | `validate()` 必须保持**零参可调用**、返回结构不变 |
| `observability-audit-check.js:164-181` | 生产下 `validate().valid === true` | 同上 |
| `observability-audit-check.js:201` | 源码含 `OPS_MONITOR_TOKEN_REQUIRED` + `AUDIT_IP_HASH_SALT_REQUIRED` | 两个字面量不可删 |
| `observability-audit-check.js:199` | 源码含 `router.use(opsAuth.middleware)` | 挂载语句不可改 |
| `observability-audit-check.js:122-123` | `opsAuth.secureEqual(...)` 存在 | 导出不可删 |
| `security-hardening-check.js:1-2` | 自身以 `NODE_ENV=test` + `ALLOW_MOCK_DB=true` 运行 | 守卫**不得无条件拒绝 mock**，必须限定 production 分支 |

---

## 4. 验证证据

### 4.1 回归基线（14 个脚本，全部 exit 0）

`security-critical` · `security-hardening` · `backup-recovery` · `observability-audit` · `network-config` · `security-runtime` · `admin-cross-client-data-sync` · `notification-outbox` · `realtime-event` · `socket-auth` · `performance-observability` · `reservation-consistency` · `release-preflight` · `final-acceptance`

> `security-runtime-check.js` 实测**仅探测 `/health`**，并不匿名访问 `/ops/status`，故 fail-closed 改动无回归（此前该项被列为最大未知风险）。

### 4.2 行为矩阵（QA 独立构造，38/38 PASS）

**opsAuth 10/10** —— 含关键边界：

| 场景 | 期望 | 结果 |
|---|---|---|
| 非生产 + 无 token + 无开关 | 401，next 未调用 | PASS |
| 非生产 + `OPS_ALLOW_ANONYMOUS=true` | next 调用 | PASS |
| **生产 + 匿名开关 + 无 token** | **401**（开关在生产失效） | PASS |
| token 为空串 / 纯空白 | 401（空配置=未配置） | PASS |
| production + 已配 token + 匿名开关 + 正确头 | next（正常路径不被破坏） | PASS |
| 已配 token + 匿名开关 + 错误头 | 401（开关不兜底绕过） | PASS |

**守卫 9/9** —— 含反向用例：

| 场景 | 期望 | 结果 |
|---|---|---|
| **test + `ALLOW_MOCK_WECHAT_LOGIN=true`** | **不抛**（mock 登录未被回归） | PASS |
| 未设 NODE_ENV + 该开关 | 抛 `MOCK_LOGIN_FORBIDDEN` | PASS |
| production + `validate({dbMock:true})` | 抛 `MOCK_DB_FORBIDDEN` | PASS |
| production + 配齐 env + **零参** `validate()` | `{valid:true, production:true}` | PASS |
| production 缺 `JWT_SECRET` + 零参 | 仍抛 `JWT_SECRET_REQUIRED`（原规则未被短路） | PASS |

**mock-db 5/5** —— 含：production require 抛错、test 下默认口令 `bcrypt` 校验通过（非生产行为未变）、`MOCK_ADMIN_PASSWORD` 覆盖真实生效、test 下 `query()` 正常、production 下 `query()` reject。

### 4.3 对抗探针（QA 额外补充，全部符合预期）
header 前后空格（已 trim）、配置值前后空格（已 trim）、重复 header 成数组（仍 401）、`secureEqual('','')` = false（空值拒绝）、关闭旗标大写 `TRUE`（守卫不触发但 `config.wechat.allowMockLogin` 同为严格 `==='true'` 亦为 false → mock 登录仍关闭，不可利用）。

---

## 5. 残余风险

| # | 风险 | 等级 | 说明 |
|---|---|---|---|
| 1 | opsAuth fail-closed 属行为变更 | 低 | 依赖旧「非生产免 token 访问 `/ops/status`」的本地脚本/调试页需显式设 `OPS_ALLOW_ANONYMOUS=true`。已 Grep 确认仓库内无此依赖 |
| 2 | mock-db 生产加载即抛 | 低 | 属设计意图；全仓库 13 处 `require('mock-db')` 均在函数体内且仅在 mock 模式可达，生产 `allowMock=false` 不会触发 |
| 3 | 种子口令非生产默认值仍为源码字面量 | 低 | env 注入提供**覆盖能力**而非物理移除；真正的控制点是「生产禁止加载 mock-db / 禁止 mock 登录」，已闭环且生产不可达 |

---

## 6. 下一轮待办（小程序端，P2-F2 / P3-F3 / P4-F1）

1. **`miniapp/pages/login/login.js:28-57`（本轮新增核实发现，优先级最高）** —— 登录页自带 `showServerConfig` 面板，`selectServer()` / `useCustomServer()` 可直接 `setBaseUrl` 指向任意后端。**登录页人人可达**，风险面大于 network-settings。
2. `miniapp/utils/auth.js:69-112` `mockLogin` + `:165` 导出（经 Grep 无页面调用点）。
3. `miniapp/app.js:6` `mockMode: true`（经 Grep 无消费者）。
4. `miniapp/pages/network-settings/**` + `app.json:20` 注册 + `profile.js:95` / `admin-profile.js:64` 两处入口。
5. `miniapp/utils/network-config.js:8` `productionBaseUrl` 目前为空——**需用户提供正式 https 域名**才能落地编译期锁定；仓库内仅有 `example.edu.cn` 占位符。
6. 新增 `scripts/miniapp-release-check.js` 做发布前断言（app.json 无 network-settings、auth.js 无 mockLogin、mockMode 不为 true、productionBaseUrl 命中 `^https://`）。

**已确认的下一轮约束**：`network-config-check.js` 锁死了 `getDefaultBaseUrl` 的 devtools / lanHost 分支语义与 `project.config.json` 的 `urlCheck:false`，生产锁定只能在 `request.js` **新增一层**实现，不能改原函数。
