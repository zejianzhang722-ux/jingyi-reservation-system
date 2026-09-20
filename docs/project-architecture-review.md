# 敬一书院功能房预约系统 — 项目结构与实现全景分析

> 分析日期：2026-09-09
> 分析对象：`D:\敬一书院\jingyi-reservation-system`（版本 1.0.0）
> 分析方式：全量源码与文档通读（后端 15,281 行 JS / 26 控制器 / 19 路由 / 33 服务 / 11 中间件，管理端 38 个源文件，小程序 34 页面 + 6 组件，57 个校验脚本）

---

## 一、项目定位与总体架构

这是一个面向高校书院「功能房（自习室、研讨室、路演厅等）」的预约管理平台，采用**前后端分离 + 三端共存**架构：学生用微信小程序，管理人员用 Web 后台，两者共用同一套 Node.js API。

后端规模（精确统计）：`src/` 下共 15,281 行 JS —— 26 个控制器、19 个路由、33 个服务、11 个中间件、8 个 utils、5 个 config。

```
┌──────────────┐   ┌──────────────┐
│  微信小程序   │   │  管理后台     │      微信小程序（原生）    admin（Vue3+Vite）
│  miniapp/    │   │  admin/      │
└──────┬───────┘   └──────┬───────┘
       │  HTTPS/JSON      │  HTTPS/JSON
       └────────┬─────────┘
                ▼
        ┌────────────────┐        ┌──────────────┐
        │  Express API   │◄──────►│  Socket.IO   │  实时事件广播
        │  server/       │        │  (Redis 适配) │
        └────────┬───────┘        └──────────────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌──────────────┐
│ MySQL  │  │ Redis  │  │Scheduler     │  独立 Worker 进程
│  8.0   │  │   7    │  │Worker        │  定时任务 + Outbox + 备份
└────────┘  └────────┘  └──────────────┘
```

**关键架构决策**：

| 决策 | 说明 |
|---|---|
| API 进程与定时任务分离 | `ENABLE_SCHEDULER=true` 时 API 内置调度；生产推荐用独立 `scheduler-worker.js`，避免多实例重复执行 |
| 写路径双实现（MySQL / Mock） | 所有 Service 都以 `db.isMock()` 分支，开发环境可零依赖启动；生产强制禁用（`ALLOW_MOCK_DB` 在生产被忽略） |
| 时间槽预生成模型 | 预约时段被拆解为「每分钟一行」写入 `reservation_slots`，用数据库唯一约束而非应用层判断来防冲突 |
| 事务 Outbox | 通知先落 `notification_outbox` 表，由 Worker 异步投递，保证业务提交与消息可靠 |

---

## 二、目录结构

```
jingyi-reservation-system/
├── server/                     # 后端 API（Node.js + Express）
│   ├── src/
│   │   ├── app.js              # 入口：中间件装配、Socket.IO、优雅关闭
│   │   ├── scheduler-worker.js # 独立定时任务 Worker 入口
│   │   ├── config/             # 配置层：index/database/redis/logger/mock-db
│   │   ├── middleware/         # 中间件：认证、楼栋范围、限流、校验、审计
│   │   ├── routes/             # 19 个路由模块
│   │   ├── controllers/        # 26 个控制器（HTTP 层）
│   │   ├── services/           # 33 个服务（业务层，含事务）
│   │   └── utils/              # 响应封装、审计哈希、时间工具等
│   ├── sql/                    # schema.sql / seed.sql / migrations/ / backup-recovery.sql
│   ├── tests/                  # 集成测试
│   └── .env.example
├── admin/                      # 管理后台（Vue 3 + Vite + Element Plus）
│   └── src/{api,router,store,views,components,utils,styles}
├── miniapp/                    # 微信小程序（原生）
│   └── pages/(34)  components/(6)  utils/  services/  custom-tab-bar/
├── deploy/                     # 部署：compose / nginx / PM2 / 蓝绿脚本
├── scripts/                    # 57 个校验、迁移、备份脚本
├── docs/                       # 接口、数据字典、运维、验收等手册
├── Dockerfile                  # 多阶段构建，非 root 运行
└── .github/workflows/          # 9 个 CI 门禁
```

---

## 三、后端模块划分与职责

### 3.1 分层职责

| 层 | 目录 | 职责 | 约束 |
|---|---|---|---|
| 配置 | `config/` | 环境变量、MySQL 连接池、Redis、Winston 日志 | 连接池参数带边界钳制（2~100） |
| 中间件 | `middleware/` | 请求上下文、认证、角色、楼栋范围、限流、参数校验、审计链 | 链式组合，路由级挂载 |
| 路由 | `routes/` | 路径与中间件编排，不含业务逻辑 | 权限在路由层声明式表达 |
| 控制器 | `controllers/` | 参数归一化、调 Service、发通知、返响应 | 不做 SQL |
| 服务 | `services/` | 业务规则、事务、外部集成 | 唯一允许持有事务的层 |

### 3.2 核心服务模块

| 服务 | 职责 |
|---|---|
| `reservationCommandService` | **预约写入唯一入口**（MySQL）。严格事务、幂等、冲突检测 |
| `reservationLifecycleService` | 预约释放（取消/拒绝/爽约）+ 候补自动转正的原子流程 |
| `reservationMutationService` | 改签、续约等变更 |
| `waitlistService` | 候补入队校验 |
| `creditService` | 信用分增减、阈值触发限制/封禁、到期自动解封 |
| `checkinCredentialService` | 动态签到凭证（HMAC 签名 + nonce 防重放 + Redis） |
| `notificationService` / `notificationOutbox*` | 站内信 + 微信订阅消息，Outbox 可靠投递 |
| `realtimeEventService` / `socket*` | Socket.IO 广播、连接鉴权、Redis 多实例适配 |
| `schedulerService` | 定时任务定义 + Redis 分布式锁去重 |
| `auditTrailService` | 操作审计，SHA 哈希链防篡改 |
| `backupService` | 加密备份、第二副本、校验与恢复 |
| `metricsService` / `operationalHealthService` | Prometheus 指标、就绪/存活/状态快照 |
| `productionConfigGuard` | 生产环境配置强校验（弱密钥/默认账号直接拒绝启动） |

---

## 四、核心业务流程：预约全链路

### 4.1 创建预约

```
POST /api/v1/reservation
  → 限流 reservationLimiter(60s/5次)
  → auth（JWT + 黑名单 + 主体状态复查）
  → createReservationRules（参数校验）
  → reservationCommandService.createReservation()
       ├─ normalizeInput（时间补零、日期归一、幂等键 ≤128 字符）
       ├─ beginTransaction
       ├─ SELECT users ... FOR UPDATE        ← 行锁，防并发重复预约
       ├─ 幂等键命中且 request_hash 一致 → 直接返回（idempotent=true）
       ├─ SELECT rooms / seats FOR UPDATE
       ├─ validateReservationInput（12 项规则校验）
       ├─ 当日有效预约数 ≥3 → 拒绝
       ├─ INSERT reservations
       ├─ INSERT reservation_slots（逐分钟）
       └─ commit
  → 通知 + 实时广播（失败不影响主流程）
```

**12 项创建校验**（`validateReservationInput`）：
用户存在且未封禁/受限 → 信用分 ≥ 60（restrictThreshold）→ 日期在 3 天窗口内 → 房间存在且 `open` → 自习室必须选座 → 座位属于该房间且可用 → 不早于开放时间 → 不晚于关闭时间 → 结束 > 开始 → 不超过 `max_duration` → 特定房型必填用途 → 参与人数 ≤ 容量。

**冲突控制的双重保险**：
1. 应用层：事务内 `FOR UPDATE` 串行化同一用户/房间/座位；
2. 数据库层：`reservation_slots` 唯一键 `uk_room_seat_date_minute (room_id, seat_scope, date, slot_minute)`，即使应用层判断被绕过也会触发 `ER_DUP_ENTRY` → 转换为 409 `SLOT_CONFLICT`。

**初始状态由房间配置决定**：

| 房间标志 | 初始状态 |
|---|---|
| `need_counselor_audit = 1` | `counselor_pending`（需辅导员） |
| `need_audit = 1` | `pending`（需管理员） |
| 均为 0 | `approved`（免审直接通过） |

### 4.2 状态机

```
                    ┌──────────► rejected（拒绝，释放槽位）
                    │
[pending / counselor_pending] ──审批通过──► approved ──签到──► checked_in ──► completed
                    │                          │
                    │                          ├── 超时未签到 ──► noshow（扣 20 分）
                    │                          └── 用户取消 ────► cancelled（开始前 3 小时内禁止）
                    └── 用户取消 ──► cancelled
```

活跃状态（占用时间槽）：`approved` / `pending` / `counselor_pending` / `checked_in`。

### 4.3 取消 / 拒绝 → 候补自动转正

`releaseAndPromote` 是这套系统最精巧的一段：**在同一个事务内**完成「释放原预约槽位」+「取队首候补并为其创建预约」。

- 队列查询带 `FOR UPDATE`，按 `created_at, id` 升序取 1 条；
- 转正失败（400/403/404 或幂等冲突）则把该候补标记 `expired` 并继续尝试下一个，最多 20 次，防止脏记录堵塞队列；
- 转正复用 `createReservationWithinTransaction`，幂等键固定为 `waitlist:{entryId}`，保证重复执行不会双写；
- 提交后才发通知与广播，避免"通知了但回滚了"。

### 4.4 签到

学生端出示**动态二维码**（`JY1` 前缀 + HMAC-SHA256 签名，60 秒有效期，到期前 15 秒自动刷新），工作人员扫码核销。凭证含 nonce，Redis 记录已用 nonce 防重放；生产环境若 Redis 为 Mock 或未配置独立签名密钥，直接返回 503。

### 4.5 爽约与信用

`detect-noshow` 每 5 分钟扫描：已过开始时间 15 分钟仍未签到且状态为 `approved` → 标记 `noshow` 并扣 20 分。

信用分阈值联动账号状态：

| 分数 | 状态 | 后果 |
|---|---|---|
| < 30 | `banned` | 封禁 30 天 |
| < 60 | `restricted` | 限制预约 7 天 |
| < 80 | 警告 | 仅通知 |
| ≥ 80 | 正常 | — |

`checkAndRestoreUsers` 到期自动恢复为 `active`。

---

## 五、数据模型

`server/sql/schema.sql` 共 18 张表，分四组：

### 空间域
| 表 | 关键字段 | 说明 |
|---|---|---|
| `buildings` | id, name, floors | 楼栋，是权限范围的锚点 |
| `rooms` | type(18 种枚举), building_id, capacity, open_start/end_time, max_duration(默认240), need_audit, need_counselor_audit, status | 功能房，审批策略在此配置 |
| `seats` | room_id, seat_number, row_num, col_num, status, has_power | 座位，级联房间删除 |

### 预约域
| 表 | 关键字段 / 约束 |
|---|---|
| `reservations` | status(8 态枚举), reservation_code(唯一), **uk_reservation_user_idempotency (user_id, idempotency_key)**, request_hash |
| `reservation_slots` | **uk_room_seat_date_minute (room_id, seat_scope, date, slot_minute)** — 并发防冲突的核心 |
| `reservation_waitlist` | 生成列 `waiting_seat_scope` + **uk_waitlist_user_slot** 防重复候补 |
| `reservation_groups` / `_members` | 团队预约（表已建，当前未见活跃写入） |
| `checkins` | checkin_type(qrcode/manual/admin_manual/auto) |

### 治理域
| 表 | 说明 |
|---|---|
| `users` | 学生，含 credit_score、status、noshow_count、building_id、openid |
| `admins` | 管理员，含 role + **scope_type(global/building) + building_id** |
| `credits_log` / `violations` | 信用流水与违规记录 |
| `operation_logs` | 操作审计 |

### 内容与通知域
`notifications`（含 dedupe_key 唯一键防重复推送）、`notification_outbox`（状态机 pending→processing→sent/failed/dead，8 次重试，带 `available_at` 退避与 `locked_by` 抢占）、`feedbacks`、`posters`、`announcements`、`reading_room_logs`、`system_config`。

> 注意：`PROJECT_CONTEXT.md` 列出的表清单缺少 `reservation_slots`、`notification_outbox`、`violations`、`buildings`、`operation_logs` 等，且未体现楼栋范围字段，该文档已滞后于代码。

### 迁移（`server/sql/migrations/`）
`20260623_reservation_consistency` → `20260624_waitlist_consistency` → `20260625_notification_outbox` → `20260712_admin_scope_type`，按日期递进，由 `scripts/apply-*-migration.js` 幂等应用。

---

## 六、接口设计

### 6.1 约定
- 统一前缀 `/api/v1`，RESTful 语义；
- 统一响应 `{ code, message, data }`，分页为 `{ list, total, page, pageSize, totalPages }`；
- 认证：`Authorization: Bearer <jwt>`；
- 幂等：`Idempotency-Key` / `X-Idempotency-Key` 请求头；
- 追踪：`X-Request-Id`，响应回写，贯穿日志；
- 错误码复用 HTTP 语义，业务细分用 `err.code`（如 `SLOT_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`SEAT_REQUIRED`、`MAX_DURATION_EXCEEDED`、`CONCURRENT_WRITE_CONFLICT`）。

### 6.2 主要模块

| 模块 | 代表端点 |
|---|---|
| 认证 | `POST /auth/login/wechat`、`/login/student`、`/login/admin`、`/refresh`、`/logout` |
| 用户 | `GET/PUT /user/profile`、`POST /user/avatar`、`/user/bind`、`GET /user/list` |
| 房间 | `GET /room`、`/:id`、`/:id/seats`、`/:id/timeline`、`/announcements`、`POST /room/compare` |
| 预约 | `POST /reservation`、`GET /reservation`、`/:id`、`DELETE /:id`、`PUT /:id`、`/:id/qrcode`、`/:id/rebook`、`POST /check-conflict`、`POST /waitlist` |
| 审批 | `PUT /reservation/:id/approve`、`/:id/reject`、`GET /reservation/pending[-count]`、`/audit/*`（含 `/audit/batch`） |
| 签到 | `POST /checkin`、`/checkout`、`/manual`、`/patrol`、`GET /current/:roomId`、`/status/:id` |
| 信用 | `GET /credit/violations`、`POST /credit/violation`、`GET|PUT /credit/blacklist` |
| 统计 | `GET /stats/{dashboard,reservations,usage-rate,peak-hours,noshow,users,export}` |
| 管理 | `/admin/{rooms,seats,buildings,managers,announcements,config,operation-logs,archive,backups,upload}` |
| 运维 | `/ops/{live,ready,version,status,metrics,audit-integrity}`（后四个需 `X-Ops-Token`） |

---

## 七、权限机制（四层防线）

### 第 1 层 — 令牌有效性
`auth` 中间件：验签 → 查 Redis 黑名单 → **拒绝把 refresh token 当 access token 用**（旧版无 `tokenType` 声明的令牌必须与 Redis 中存储的当前 refresh token 严格比对，Redis 无状态时直接拒绝，而非放行）→ 回库复查主体状态（学生禁 `banned`，管理员必须 `active`）。

### 第 2 层 — 角色
`requireRole(...roles)` / `requireAdmin`，角色枚举：`student`、`admin`、`super_admin`、`counselor`。注意 `superadmin` 会在加载时被规范化为 `super_admin`。

**角色与可审批状态强绑定**（`allowedStatusesForRole`）：

| 角色 | 可处理状态 |
|---|---|
| `admin` | 仅 `pending` |
| `counselor` | `pending` + `counselor_pending` |
| `super_admin` | `pending` + `counselor_pending` |

### 第 3 层 — 楼栋数据范围（本项目最具特色的一层）
`adminScope.loadAdminScope` 从 `admins` 表重新读取 `role` / `scope_type` / `building_id`，并且**校验库内角色与令牌内角色一致**，不一致即强制重新登录（防止提权后旧令牌继续生效）。
- `super_admin` / `counselor` → 强制 `global`；
- `admin` → 依 `scope_type` 决定 `global` 或绑定单一 `building_id`；
- 范围未明确时直接 403，要求超管先设置。

配套守卫：
- `forceBuildingQuery`：非全局管理员的查询参数 `buildingId` 被强制改写为自身楼栋，越权请求 403；
- `enforceBodyBuilding`：写操作 body 中的 `buildingId` 越权即 403，缺省则注入自身楼栋；
- `roomFromParam` / `reservationFromParam` / `seatFromParam` / `posterFromParam` / `reservationBatchFromBody`：通过 JOIN 溯源到 `building_id` 再比对，杜绝「改 ID 访问别栋数据」。

### 第 4 层 — 资源归属
学生侧：`studentOnly` 禁止管理员访问学生个人资料接口；预约详情/删除/改签经 `optionalAdminReservationScope` 判定——学生只能操作自己的预约，管理员走楼栋范围。

### 前端联动
管理端 `adminRoutes.js` 用 `meta.roles` 声明路由角色，`router.beforeEach` 中 `hasRouteRole` 拦截并跳转 `/403`；`buildNavigation` 按角色动态生成菜单（7 个分组）。**但注意：前端路由守卫只是 UX 层，真实约束全在后端中间件。**

---

## 八、技术栈

### 后端
| 类别 | 选型 |
|---|---|
| 运行时 | Node.js（Docker 镜像 node:24-bookworm-slim） |
| 框架 | Express 4 |
| 数据库 | MySQL 8.0 + mysql2（连接池，参数带边界钳制） |
| 缓存/协调 | Redis 7 + ioredis（会话、黑名单、分布式锁、动态凭证 nonce、Socket 适配） |
| 实时 | Socket.IO 4 + Redis Adapter（多实例广播） |
| 认证 | jsonwebtoken（access 2h / refresh 7d）+ bcryptjs |
| 校验 | express-validator |
| 安全 | helmet、cors（白名单）、express-rate-limit（7 种粒度） |
| 日志 | winston + morgan |
| 其他 | node-schedule（定时）、multer + 自研 secureUploadService（上传）、qrcode、dayjs、axios |

### 管理端
Vue 3.4 + Vite 5 + Vue Router 4 + Pinia + Element Plus 2.6（中文语言包、图标全量注册）+ ECharts 5（图表）+ socket.io-client（实时）+ xlsx（导出）+ Vitest（组件测试）。
构建优化：`unplugin-auto-import` + `unplugin-vue-components` 自动按需引入（test 模式下禁用），`@` 别名指向 src。

### 小程序
原生框架（`app.json` 声明 34 页面），自定义 TabBar（`custom: true`，按角色差异化），`lazyCodeLoading: requiredComponents`，6 个自定义组件（room-card / reservation-card / date-picker / timeline / tab-bar / admin-nav）。

---

## 九、环境配置

### 关键环境变量（`server/.env.example`）
| 变量 | 说明 |
|---|---|
| `NODE_ENV` | development / test / production |
| `ALLOW_MOCK_DB` / `ALLOW_MOCK_REDIS` | 仅非生产可启用模拟数据 |
| `JWT_SECRET` | 未提供时随机生成（重启即失效，生产必须显式配置） |
| `CHECKIN_CREDENTIAL_SECRET` | 签到凭证独立密钥，生产必须独立强随机 |
| `CHECKIN_CREDENTIAL_TTL_SECONDS` | 服务端钳制 30~90 秒 |
| `MYSQL_*` / `REDIS_*` | 连接信息与密码 |
| `WECHAT_APPID` / `WECHAT_APPSECRET` | 微信登录与订阅消息 |
| `CORS_ORIGINS` / `ADMIN_ORIGIN` / `BASE_URL` | 跨域白名单与站点地址 |

**生产护栏**：`productionConfigGuard.validate()` 在启动时执行，配置不合规（弱密钥、默认账号、生产启用 Mock 等）直接拒绝启动。

### 业务参数（`config/index.js`，当前为代码常量）
- 预约：可提前 3 天、开放时段 08:00–23:00、开始前 3 小时内不可取消、迟到 15 分钟判爽约、爽约 3 次限制、暂停 7 天；
- 信用：初始 100、上限 120、爽约 −20、违规 −10、表扬 +5、反馈 +3。

> 这些参数目前硬编码在 config 中，未走 `system_config` 表；管理端已有「信用配置」页面（`Credit/ScoreConfig.vue`），后续若要运行时可调，需打通。

---

## 十、部署方式

### 10.1 容器化（推荐路径）
`Dockerfile` 多阶段构建：node 镜像装依赖 → ubuntu:24.04 运行镜像 → 创建 uid 10001 非 root 用户 → `tini` 作为 PID 1 → `HEALTHCHECK` 命中 `/api/v1/ops/live`。镜像内预置 mysql-client 便于备份。

`deploy/docker-compose.production.yml` 编排 7 个服务：

| 服务 | 说明 |
|---|---|
| `mysql` / `redis` | 带 healthcheck，数据卷持久化；Redis 强制 requirepass；MySQL 开启 binlog 保留 7 天 |
| `api-blue` / `api-green` | **蓝绿双槽**，同一镜像，`DEPLOYMENT_SLOT` 区分 |
| `scheduler` | 独立 Worker，运行 `scheduler-worker.js` |
| `migrate` | `profiles: ["migration"]`，按需手动触发 |
| `admin` | 管理端静态资源 |
| `gateway` | nginx-unprivileged 反向代理，挂载 `active-upstream.conf` 切换蓝/绿 |

安全基线（全局）：`read_only: true` + `tmpfs` 可写区 + `no-new-privileges` + `cap_drop: ALL`；`backend` 网络 `internal: true`，数据库不直接暴露。

蓝绿发布脚本：`deploy/scripts/deploy-blue-green.sh` → `migrate.sh` → `wait-ready.sh`（等 `/ops/ready`）→ 切换 `active-upstream.conf` → 失败用 `rollback-blue-green.sh` 回滚；`release-gate.sh` 做发布前门禁。

### 10.2 传统部署（备选）
`deploy/nginx.conf` + `deploy/ecosystem.config.js`（PM2，2 实例 cluster 模式，512M 内存上限，日志落 `/var/log/jingyi`）+ `deploy/deploy.sh` 一键脚本。

### 10.3 本地开发
```bash
npm run install:all
npm run db:init          # schema.sql + seed.sql
npm run db:migrate:{reservation,notification,observability,backup,performance}
npm run server           # API :3000
npm run admin            # 管理端 :5173（Vite 代理 /api → 3000）
# 微信开发者工具导入 miniapp/，真机按 docs/network-setup.md 配后端地址
cd server && npm run start:scheduler   # 独立 Worker
```

### 10.4 质量门禁
9 个 GitHub Actions 工作流：security-pr / security-hardening / runtime-coordination / notification-outbox / observability-audit / performance-capacity / backup-recovery / reservation-mutation / release-gate。
57 个 `scripts/` 检查脚本覆盖跨端契约、数据同步、并发一致性、安全加固、密钥扫描、灾备演练、性能索引、最终验收等，可通过 `npm run check:all` 串行执行。

---

## 十一、可靠性与可观测性设计

| 能力 | 实现 |
|---|---|
| 请求追踪 | `requestContext` 中间件生成 `X-Request-Id`，贯穿日志与错误响应 |
| 结构化日志 | winston，按事件名记录（如 `unhandled_request_error`），含 requestId |
| 审计防篡改 | `auditTrailService` + `auditHash` 构建 SHA 哈希链，`/ops/audit-integrity` 可校验 |
| 指标 | `/ops/metrics` 输出 Prometheus 文本格式，基于 `operationalHealthService` 快照 |
| 就绪/存活分离 | `/ops/live` 仅进程存活；`/ops/ready` 校验依赖与迁移是否完成，生产失败即 503 |
| 优雅关闭 | SIGTERM/SIGINT 依次停止监控 → Outbox → 调度 → Socket → MySQL → Redis，5 秒超时兜底 |
| 并发协调 | `distributedLockService`（Redis 锁）+ 任务去重键，避免多实例重复执行定时任务 |
| 备份与灾备 | `backupService` 加密备份 + 第二副本 + `verify-backup` + `restore-backup` + `disaster-recovery-drill` |
| 数据留存 | `dataRetentionService` + `run-data-retention` |

---

## 十二、值得注意的实现细节与风险提示

1. **文档滞后于代码（已于 2026-09-09 修复）。** `PROJECT_CONTEXT.md` 旧版（2026-05-30）描述"15 个控制器/路由"（实际 26/19）、API 表缺 `/ops/*` 与候补/动态签到等端点、数据表清单缺 `reservation_slots` 等 8 张表、管理员密码写错（实际种子哈希明文不可知，既非 `password` 也非 admin123）、学生种子人数写错（实际仅张三/李四 2 人）、其"残余问题"P1–P5、P7 在现行代码中均已解决。本次已按源码全部校正重写。

2. **写操作集中在 Service，控制器保持薄。** 但存在两套实现并存的风险：`reservationService.createReservation` 与 `reservationCommandService.createReservation` 均有创建逻辑，前者在 MySQL 模式下已明确转发给后者（注释写明"禁止保留第二套写入实现"），新增入口务必走 Command 服务。

3. **Mock 模式分支遍及所有 Service。** 这是开发便利的来源，也是最容易引入"测试通过、生产失败"的地方；生产由 `productionConfigGuard` + `ALLOW_MOCK_DB` 双重拦截。

4. **时间槽表会随预约时长膨胀。** 4 小时预约 = 240 行；`reservation_slots` 是防冲突核心，但需依赖 `performance-indexes` 迁移与定期归档（`adminController.archiveSemester`）。

5. **`reservation_groups` / `_members`（团队预约）表已建，后端未见活跃写入路径**，小程序有 `group-reserve` 页面——疑似未完成或走独立流程，接入前需确认。

6. **信用与预约参数硬编码。** 管理端已有配置页面但服务端读的是 `config/index.js` 常量，若要运营期可调需打通 `system_config`。

7. **`system_config` 表已建**，目前由 `adminController.getConfig/updateConfig`（仅 super_admin）使用。

8. **前端权限仅为 UX。** 真正的越权防线是 `adminScope` 系列中间件；新增管理端接口时**必须**挂载 `loadAdminScope` + 对应的范围守卫，否则会造成跨楼栋数据泄露。

---

## 十三、一句话总结

这是一个**工程完成度相当高**的校园预约系统：后端以「事务 + 唯一约束 + 分布式锁」三重手段保证预约一致性，以「楼栋数据范围」中间件实现多管理员分级治理，以「Outbox + 独立 Worker」解耦可靠通知，并配套了完整的容器化蓝绿发布、备份灾备、审计哈希链与 Prometheus 可观测性；三端（小程序 / 管理后台 / API）共用同一套 `/api/v1` 契约，57 个校验脚本与 9 个 CI 工作流构成质量门禁。主要短板在于**项目文档已滞后于代码**，以及少量业务参数尚未运行时可配。
