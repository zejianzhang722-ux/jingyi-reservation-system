# 敬一书院预约系统 — 项目全景上下文文档

> **生成日期**: 2026-09-09（本次为全量源码通读后的重写，替代 2026-05-30 旧版）
> **用途**: 跨会话上下文传递，供新会话快速理解项目全貌并继续工作
> **当前版本**: `1.0.0`
> **微信AppID**: wxa83f083ceb601977
> **项目路径**: `d:\敬一书院\jingyi-reservation-system\`
>
> ⚠️ **旧版本说明**：本文档 2026-05-30 版严重滞后于代码（控制器数量、API 表、数据表清单、管理员密码均有误）。本次已全部按源码校正。后续重大变更请同步更新本文件。

---

## 一、项目概述

**敬一书院功能房预约系统**：基于微信小程序的校园功能房预约管理平台，四端一体。

| 端 | 技术栈 | 路径 | 用途 |
|----|--------|------|------|
| 微信小程序 | 原生小程序 | `miniapp/` | 宿生预约、小程序端管理员审批 |
| 管理后台 | Vue 3 + Vite + Element Plus | `admin/` | Web 管理后台 |
| 后端 API | Node.js + Express | `server/` | RESTful API（`/api/v1`） |
| 定时任务 Worker | Node.js | `server/src/scheduler-worker.js` | 独立进程，生产必须单独部署 |

数据层：MySQL 8.0（主存储）+ Redis 7（会话/锁/实时适配）。

---

## 二、技术架构

### 2.1 后端 (server/)

```
server/src/
├── app.js                     # 入口：中间件装配、Socket.IO、优雅关闭
├── scheduler-worker.js        # 独立 Worker 入口
├── config/                    # index(含业务参数) / database(连接池) / redis / logger / mock-db
├── middleware/   11 个        # auth、adminScope、rateLimit、validator、requestContext、auditTrail、opsAuth…
├── routes/       19 个        # 路径与权限编排，不含业务逻辑
├── controllers/  26 个        # 参数归一化 → 调 Service → 通知 → 响应
├── services/     33 个        # 业务规则、事务、外部集成（唯一持有事务的层）
└── utils/         8 个        # response、auditHash、helpers、backupCrypto…
server/sql/                    # schema.sql(18表) / seed.sql / migrations/4个 / backup-recovery.sql
server/tests/                  # integration-check.js
```

**分层铁律**：控制器不做 SQL；所有写操作必须走 Service；预约创建必须走 `reservationCommandService`（禁止第二套写入实现）。

### 2.2 小程序 (miniapp/)

34 个页面，6 个自定义组件（`room-card` / `reservation-card` / `date-picker` / `timeline` / `tab-bar` / `admin-nav`），自定义 TabBar（`custom: true`，按角色差异化）。

- 宿生端：index、room-list、room-detail、room-timeline、reservation-confirm、my-reservations、qrcode、credit-detail、feedback、rules、study-room、reading-room、poster-apply、group-reserve、room-compare、profile(-edit)、notifications、subscribe-settings
- 管理员端：admin-home、admin-manage、admin-reservation(-detail)、admin-rooms、admin-users、admin-credit、admin-stats、admin-feedback、admin-poster、admin-announcement、admin-profile
- 工具类：login、network-settings（真机/局域网地址配置）

`utils/request.js` 关键能力：401 自动用 refreshToken 续期并重试一次，失败才跳登录；baseUrl 由 `network-config.js` 按平台（devtools/真机）自动解析，支持手动覆盖。

### 2.3 管理后台 (admin/)

Vue 3.4 + Vite 5 + Pinia + Element Plus 2.6 + ECharts 5 + socket.io-client + xlsx。

```
src/views/  27 个 .vue，其中 23 条接入 adminChildren 路由，分 7 组：
  今日工作   Dashboard
  预约与使用  Reservation/{PendingList, AllList, CounselorPending}、Checkin/Manage、ReadingRoom/Logs
  空间管理   Room/{Monitor, Manage, SeatManage, RulesConfig}、Room/BuildingManage
  宿生与信用  Credit/{Violations, Blacklist, ScoreConfig}、Account/Index
  数据与报表  Stats/{Overview, Export}
  内容与沟通  Poster/{PendingList, PositionManage}、FeedbackView、System/Announcements
  系统运维   System/{Logs, Backup}
src/api/    11 个模块（auth/room/reservation/checkin/credit/stats/admin/account/poster/readingRoom/notification）
src/router/ index.js(守卫) + adminRoutes.js(23 路由 + meta.roles + 7 分组导航)
src/store/  user.js（Pinia，token 与 userInfo 存 localStorage）
```

### 2.4 部署与工程

```
deploy/   docker-compose.production.yml（蓝绿）、nginx/（gateway + upstream 切换）
          ecosystem.config.js（PM2 备选）、deploy.sh、scripts/{deploy-blue-green,migrate,wait-ready,rollback-blue-green,release-gate}.sh
scripts/  57 个：校验（跨端契约/并发一致性/安全加固/密钥扫描/灾备演练/性能索引/验收）、迁移、备份
docs/     api-reference、data-dictionary、user-guide、各 runbook、final-acceptance-checklist
.github/workflows/  9 个：security-pr、security-hardening、runtime-coordination、notification-outbox、
                          observability-audit、performance-capacity、backup-recovery、reservation-mutation、release-gate
```

---

## 三、核心业务流程

### 3.1 预约创建（唯一入口）

```
POST /api/v1/reservation
  → reservationLimiter（60 秒 5 次）
  → auth（验签 + Redis 黑名单 + 令牌类型校验 + 回库复查主体状态）
  → createReservationRules
  → reservationCommandService.createReservation()
      ├─ 归一化（时间补零、日期归一、幂等键 ≤128 字符）
      ├─ BEGIN
      ├─ SELECT users … FOR UPDATE          ← 行锁，防并发重复预约
      ├─ 幂等键命中 + request_hash 一致 → 返回 idempotent=true
      ├─ SELECT rooms / seats … FOR UPDATE
      ├─ validateReservationInput（12 项校验）
      ├─ 当日有效预约 ≥ 3 次 → 拒绝
      ├─ INSERT reservations
      ├─ INSERT reservation_slots（逐分钟一行）
      └─ COMMIT
  → 站内通知 + 微信订阅消息 + Socket 广播（失败不影响主流程）
```

**12 项校验**：用户存在且未封禁/受限 → 信用分 ≥ 60 → 日期在 3 天窗口内 → 房间存在且 `open` → 自习室必须选座 → 座位属于该房且可用 → 不早于开放时间 → 不晚于关闭时间 → 结束 > 开始 → 不超 `max_duration`（默认 240 分钟）→ 特定房型必填用途 → 参与人数 ≤ 容量。

**冲突防双重保险**
1. 应用层：事务内 `FOR UPDATE` 串行化；
2. 数据库层：`reservation_slots` 唯一键 `uk_room_seat_date_minute(room_id, seat_scope, date, slot_minute)`；即使绕过应用层判断也会 `ER_DUP_ENTRY` → 409 `SLOT_CONFLICT`。死锁/锁等待 → 409 `CONCURRENT_WRITE_CONFLICT`。

**初始状态由房间配置决定**：`need_counselor_audit=1` → `counselor_pending`；`need_audit=1` → `pending`；否则 → `approved`（免审）。

### 3.2 状态机

```
pending / counselor_pending ──审批通过──► approved ──签到──► checked_in ──► completed
        │                                    │
        ├─拒绝─► rejected                     ├─取消(开始前3h外)─► cancelled
        └─取消─► cancelled                    └─超时15分钟未签到─► noshow（扣 20 分）
```

活跃状态（占用时间槽）：`approved` / `pending` / `counselor_pending` / `checked_in`。

### 3.3 释放 + 候补自动转正（同一事务）

`reservationLifecycleService.releaseAndPromote()` 在一个事务内完成「删除原预约槽位」+「取队首候补并创建预约」：

- 队列查询带 `FOR UPDATE`，按 `created_at, id` 升序取 1 条；
- 转正失败（400/403/404 或幂等冲突）→ 该候补标记 `expired`，继续下一个，最多 20 次，防脏记录堵死队列；
- 幂等键固定 `waitlist:{entryId}`，重复执行不会双写；
- 提交后才发通知与广播（避免"通知了但回滚了"）。

### 3.4 签到

学生出示**动态二维码**（`JY1` 前缀 + HMAC-SHA256 签名），TTL 60 秒（服务端钳制 30~90），到期前 15 秒自动刷新；Redis 记录 nonce 防重放。生产环境若未配置独立 `CHECKIN_CREDENTIAL_SECRET` 或 Redis 为 Mock，直接 503。

### 3.5 爽约与信用

`detect-noshow` 每 5 分钟扫描：已过开始时间 15 分钟 + 无签到 + `approved` → 标记 `noshow` 并扣 20 分。

| 信用分 | 账号状态 | 后果 |
|---|---|---|
| < 30 | `banned` | 封禁 30 天 |
| < 60 | `restricted` | 限制预约 7 天 |
| < 80 | 警告 | 仅通知 |
| ≥ 80 | 正常 | — |

`checkAndRestoreUsers()` 到期自动恢复 `active`。处罚项：爽约 −20、违规 −10；奖励：表扬 +5、反馈 +3；初始 100，上限 120。

### 3.6 定时任务（Scheduler Worker）

| 任务 | 频率 |
|---|---|
| `detect-noshow` | 每 5 分钟 |
| `reservation-start-reminders`（提前 30 分钟） | 每分钟 |
| `reservation-ending-reminders`（结束前 15 分钟） | 每分钟 |
| `expire-posters` | 每日 8:00 |
| `expire-waitlist` / 用户解封 / 自动备份 | 见 `schedulerService.js` |
| 通知 Outbox 泵（WebSocket / 微信投递，8 次重试 + 退避） | 常驻 |

多实例靠 `distributedLockService`（Redis 锁）+ 任务去重键防重复执行。

---

## 四、API 路由表

统一前缀 `/api/v1`，统一响应 `{ code, message, data }`，分页 `{ list, total, page, pageSize, totalPages }`。
认证：`Authorization: Bearer <jwt>`；幂等：`Idempotency-Key` 请求头；追踪：`X-Request-Id`。

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/auth/login/wechat` | 微信登录 | 否 |
| POST | `/auth/login/student` | 学号密码登录 | 否（IP+账号双重限流） |
| POST | `/auth/login/admin` `/login/admin-miniapp` | 管理员登录 | 否（15min/10次） |
| POST | `/auth/refresh` | 刷新令牌 | 否 |
| POST | `/auth/logout` | 登出（令牌入黑名单） | JWT |
| GET/PUT | `/user/profile` | 个人资料（仅学生） | JWT + studentOnly |
| POST | `/user/avatar` | 上传头像 | JWT |
| POST | `/user/bind` | 绑定学号 | JWT |
| GET | `/user/list` | 用户列表 | 管理员 + 楼栋范围 |
| GET | `/user/credit` `/user/stats` | 信用分 / 个人统计 | JWT |
| GET | `/room` `/room/type/:type` `/room/building/:building` | 房间列表 | 可选认证 |
| GET | `/room/:id` `/:id/seats` `/:id/timeline` | 详情 / 座位 / 时间轴 | 可选认证 |
| POST | `/room/compare` | 房间对比 | JWT |
| GET | `/room/announcements` `/room/stats` | 公告 / 统计 | 可选认证 |
| POST | `/reservation` | **创建预约**（幂等） | JWT + 限流 |
| GET | `/reservation` | 我的预约 / 管理端全部 | JWT |
| GET | `/reservation/:id` | 预约详情 | JWT（含归属校验） |
| DELETE | `/reservation/:id` | 取消（开始前 3h 外） | JWT |
| PUT | `/reservation/:id` | 改签 | JWT |
| GET | `/reservation/:id/qrcode` | 获取动态签到凭证 | JWT |
| POST | `/reservation/:id/rebook` | 再次预约 | JWT |
| POST | `/reservation/check-conflict` | 冲突检测 | JWT |
| POST/DELETE | `/reservation/waitlist` `/:id/waitlist` | 加入 / 退出候补 | JWT |
| GET | `/reservation/pending` `/pending-count` | 待审批列表 / 数量 | 管理员 + 范围 |
| PUT | `/reservation/:id/approve` `/:id/reject` | 审批通过 / 拒绝 | 管理员 + 范围 |
| GET | `/audit/pending` `/audit/counselor/pending` | 审核队列 | 管理员 + 范围 |
| POST | `/audit/:id/approve` `/:id/reject` `/audit/batch` | 单条 / 批量审核 | 管理员 + 范围 |
| POST | `/checkin` | 扫码签到 | 管理员 + 范围 |
| POST | `/checkin/manual` `/checkin/patrol` | 手动补签 / 巡查 | 管理员 + 范围 |
| POST | `/checkin/checkout` | 签退 | JWT（预约归属） |
| GET | `/checkin/status/:id` `/checkin/current/:roomId` | 签到状态 / 在场列表 | JWT |
| GET/POST | `/credit/violations` `/credit/violation` | 违规记录 | 管理员 |
| GET/PUT | `/credit/blacklist` `/blacklist/:userId` | 黑名单 | counselor / super_admin |
| GET | `/stats/dashboard` `/reservations` `/usage-rate` `/peak-hours` `/noshow` `/users` `/export` | 统计与导出 | 管理员（export 限 counselor+） |
| GET | `/admin/rooms` `/rooms/:id` `/rooms/:id/seats` | 房间管理（读） | 管理员 + 范围 |
| POST/PUT/DELETE | `/admin/rooms` `/rooms/:id` | 房间增删改 | super_admin |
| POST/PUT/DELETE | `/admin/seats/batch` `/seats/:id` | 座位管理 | super_admin |
| GET/POST/PUT/DELETE | `/admin/buildings` | 楼栋（读：管理员+范围；写：super_admin） | 见左 |
| GET/POST/PUT/DELETE | `/admin/accounts` `/admin/managers` | 账号与管理端用户管理 | super_admin |
| GET/PUT | `/admin/config` | 系统配置 | super_admin |
| GET | `/admin/operation-logs` | 操作日志 | super_admin |
| GET/POST/PUT/DELETE | `/admin/announcements` | 公告（读：管理员；写：super_admin） | 见左 |
| POST | `/admin/archive` | 学期归档 | super_admin |
| GET/POST | `/admin/backups` `/admin/backup` `/backups/:fileName/verify` | 备份与校验 | super_admin |
| POST | `/admin/upload` | 图片上传（安全上传服务） | 管理员 + 范围 |
| GET | `/notification` | 通知列表 | JWT |
| GET/POST | `/poster` | 海报申请与审核 | JWT |
| GET/POST | `/reading-room` | 阅览室记录 | JWT |
| GET | `/rules` | 规章制度 | 否 |
| GET/POST/PUT | `/feedback` | 反馈 | JWT / 管理员 |
| GET | `/ops/live` `/ops/ready` `/ops/version` | 存活 / 就绪 / 版本 | 公开 |
| GET | `/ops/status` `/ops/metrics` `/ops/audit-integrity` | 状态 / Prometheus 指标 / 审计链校验 | `X-Ops-Token` |

兼容探针：`/api/v1/health`、`/api/v1/ready` 指向 ops 实现。

---

## 五、数据库表结构（18 张，`server/sql/schema.sql`）

### 空间域
| 表 | 关键字段 |
|---|---|
| `buildings` | id, name, address, floors — **权限范围的锚点** |
| `rooms` | type(18 种枚举), building_id, floor, capacity, open_start_time, open_end_time, max_duration(默认240), **need_audit, need_counselor_audit**, status(open/closed/maintenance) |
| `seats` | room_id, seat_number, row_num, col_num, status, has_power |

### 预约域
| 表 | 关键约束 |
|---|---|
| `reservations` | status 8 态枚举、reservation_code 唯一、**uk(user_id, idempotency_key)**、request_hash |
| `reservation_slots` | **uk(room_id, seat_scope, date, slot_minute)** ← 并发防冲突核心 |
| `reservation_waitlist` | 生成列 `waiting_seat_scope` + **uk(user, room, scope, date, start, end)** 防重复候补 |
| `reservation_groups` / `_members` | 团队预约（**后端已于 2026-09-09 实现，见第十节**） |
| `checkins` | checkin_type(qrcode/manual/admin_manual/auto) |

### 治理域
| 表 | 说明 |
|---|---|
| `users` | 学生：openid, student_id, student_no, building_id, credit_score, status, noshow_count, restricted_until |
| `admins` | 管理员：role(admin/super_admin/counselor) + **scope_type(global/building) + building_id** |
| `credits_log` / `violations` | 信用流水 / 违规记录 |
| `operation_logs` | 操作审计 |

### 内容与通知域
| 表 | 说明 |
|---|---|
| `notifications` | **uk(user_id, dedupe_key)** 防重复推送 |
| `notification_outbox` | Outbox：status(pending→processing→sent/failed/dead)，max_attempts 8，available_at 退避，locked_by 抢占，**uk(event_key)** |
| `feedbacks` / `posters` / `announcements` / `reading_room_logs` / `system_config` | 内容与配置 |

### 迁移（`server/sql/migrations/`，按日期递进，幂等）
`20260623_reservation_consistency` → `20260624_waitlist_consistency` → `20260625_notification_outbox` → `20260712_admin_scope_type`
另有 observability-audit / backup-recovery / performance-indexes 由 `scripts/apply-*.js` 应用。

---

## 六、角色与权限体系（四层防线）

### 第 1 层 — 令牌有效性（`middleware/auth.js`）
验签 → Redis 黑名单 → **拒绝把 refresh token 当 access token 用**（无 `tokenType` 声明的旧令牌必须与 Redis 中当前 refresh token 严格比对；Redis 无状态时直接拒绝而非放行）→ 回库复查主体（学生禁 `banned`，管理员必须 `active`）。

### 第 2 层 — 角色
`student` / `admin` / `super_admin` / `counselor`（`superadmin` 会被规范化为 `super_admin`）。

**角色决定可审批状态**（`allowedStatusesForRole`）：

| 角色 | 可处理状态 |
|---|---|
| `admin` | 仅 `pending` |
| `counselor` | `pending` + `counselor_pending` |
| `super_admin` | `pending` + `counselor_pending` |

### 第 3 层 — 楼栋数据范围（`middleware/adminScope.js`）—— 本项目最具特色
`loadAdminScope` 回库重读 `role`/`scope_type`/`building_id`，**若库内角色与令牌角色不一致，强制重新登录**（防提权后旧令牌继续生效）。范围未明确 → 403，要求超管先设置。

- `super_admin` / `counselor` → 强制 `global`
- `admin` → `global` 或绑定单一 `building_id`

配套守卫（缺一不可）：

| 守卫 | 作用 |
|---|---|
| `forceBuildingQuery` | 非全局管理员的 `buildingId` 查询参数被强制改写为自身楼栋，越权 403 |
| `enforceBodyBuilding` | 写操作 body 中 `buildingId` 越权 403，缺省则注入自身楼栋 |
| `roomFromParam` / `reservationFromParam` / `seatFromParam` / `posterFromParam` | JOIN 溯源到 `building_id` 再比对 |
| `reservationBatchFromBody` | 批量操作逐条校验楼栋 |

> **新增管理端接口时必须挂载 `loadAdminScope` + 对应范围守卫**，否则会造成跨楼栋数据泄露。

### 第 4 层 — 资源归属
`studentOnly` 禁止管理员访问学生个人资料接口；预约详情/删除/改签经 `optionalAdminReservationScope` 判定——学生只能操作自己的预约，管理员走楼栋范围。

### 前端联动（仅 UX，非安全边界）
`adminRoutes.js` 用 `meta.roles` 声明，`router.beforeEach` 中 `hasRouteRole` 拦截跳转 `/403`，`buildNavigation` 按角色生成菜单。

---

## 七、技术栈与环境配置

### 依赖
- **后端**：Express 4、mysql2、ioredis、socket.io 4 + Redis Adapter、jsonwebtoken、bcryptjs、express-validator、express-rate-limit、helmet、cors、winston、morgan、node-schedule、multer、qrcode、dayjs、axios
- **管理端**：Vue 3.4、Vite 5、Vue Router 4、Pinia、Element Plus 2.6、ECharts 5、socket.io-client、xlsx、Vitest
- **运行时**：Docker 镜像 `node:24-bookworm-slim` + `ubuntu:24.04`；MySQL 8.0；Redis 7

### 关键环境变量（`server/.env.example`）
| 变量 | 说明 |
|---|---|
| `NODE_ENV` | development / test / production |
| `PORT` | 默认 3000 |
| `JWT_SECRET` | 未提供时随机生成（重启失效，**生产必须显式配置**） |
| `CHECKIN_CREDENTIAL_SECRET` | 签到凭证独立密钥，生产必须独立强随机 |
| `CHECKIN_CREDENTIAL_TTL_SECONDS` | 服务端钳制 30~90 |
| `MYSQL_*` / `REDIS_*` | 连接信息与密码 |
| `WECHAT_APPID` / `WECHAT_APPSECRET` | 微信登录与订阅消息 |
| `WX_TEMPLATE_APPROVED/REJECTED/CHECKIN` | 订阅消息模板 ID（未配置则跳过推送，不报错） |
| `CORS_ORIGINS` / `ADMIN_ORIGIN` / `BASE_URL` | 白名单与站点地址 |
| `ALLOW_MOCK_DB` / `ALLOW_MOCK_REDIS` | 仅非生产可启用模拟数据 |

`productionConfigGuard.validate()` 在启动时校验，配置不合规（弱密钥、默认账号、生产启用 Mock）直接拒绝启动。

### 业务参数（当前为 `config/index.js` 代码常量，非运行时可配）
- 预约：提前 3 天、开放 08:00–23:00、开始前 3h 内不可取消、迟到 15 分钟判爽约、爽约 3 次限制、暂停 7 天、每日上限 3 次
- 信用：初始 100、上限 120、爽约 −20、违规 −10、表扬 +5、反馈 +3、警告 80 / 限制 60 / 封禁 30

### 本地启动
```bash
npm run install:all
npm run db:init                      # schema.sql + seed.sql
npm run db:migrate:reservation && npm run db:migrate:notification
npm run db:migrate:observability && npm run db:migrate:backup && npm run db:migrate:performance
npm run server                       # API :3000
npm run admin                        # 管理端 :5173（Vite 代理 /api → 3000）
cd server && npm run start:scheduler # 独立 Worker
```

微信开发者工具导入 `miniapp/`；真机调试在「网络设置」页填局域网地址，或按 `docs/network-setup.md`。

### 常用检查
```bash
npm run check:security               # 安全关键项 + 运行时
npm run check:security-hardening     # 加固 + 密钥扫描
npm run check:reservation-consistency # 预约一致性 + MySQL 并发
npm run check:runtime-coordination    # 多实例协调 + Socket 鉴权/限流/广播
npm run check:notification-outbox
npm run check:observability-audit
npm run check:backup-recovery
npm run check:release                # 发布前门禁
npm run check:performance            # 性能与容量
npm run check:acceptance             # 最终验收
npm run check:all                    # 全量串行
```

---

## 八、部署

### 容器化（推荐）
`Dockerfile`：多阶段构建 → 创建 uid 10001 非 root 用户 → `tini` 作 PID 1 → HEALTHCHECK 命中 `/api/v1/ops/live`。

`deploy/docker-compose.production.yml` 编排：`mysql`(healthcheck) / `redis`(requirepass) / **`api-blue` + `api-green` 蓝绿双槽** / `scheduler`(独立 Worker) / `migrate`(profile 手动触发) / `admin` / `gateway`(nginx-unprivileged，切 upstream)。

安全基线（全局）：`read_only: true` + `tmpfs` 可写区 + `no-new-privileges` + `cap_drop: ALL`；`backend` 网络 `internal: true`，数据库不暴露。

发布流程：`deploy/scripts/deploy-blue-green.sh` → `migrate.sh` → `wait-ready.sh`（等 `/ops/ready`）→ 切换 `active-upstream.conf`；失败用 `rollback-blue-green.sh` 回滚；`release-gate.sh` 做前置门禁。

### 备选：传统部署
`deploy/nginx.conf` + `deploy/ecosystem.config.js`（PM2，2 实例 cluster，512M 上限）+ `deploy/deploy.sh`。

---

## 九、测试账号与登录方式

### 9.1 学生登录：**不是「账号 + 密码」，而是「学号 + 一卡通卡号」**

小程序登录页（`pages/login`）有两种模式，学生走 `student` 模式：

| 接口 | `POST /api/v1/auth/login/student` |
|---|---|
| 入参 | `studentNo`（学号，正则 `^\d{9,10}$`）+ `cardNo`（一卡通卡号，正则 `^\d{6}$`） |
| 校验 | `authController.js:303` — `SELECT * FROM users WHERE (student_id = ? OR student_no = ?) AND card_no = ?`，**明文比对** |

> 管理端「账号管理」页里学生的那个输入框，标签就是**「一卡通号」**（`Account/Index.vue:131`）而非「密码」；只是接口字段复用了 `password` 这个 key，落库时写入 `users.card_no`。
> ⚠️ **因此 `users.card_no` 是明文存储的 6 位数字**（`accountController.js:214`、`accountBatch.js:90`、`updateAccount` 的 `card_no = ?`）。这既是登录凭据又是可被库内任意读者看到的明文，属于已知弱点，见第十二节 N6。

### 9.2 种子学生账号（`server/sql/seed.sql` 与 `mock-db.js` 一致，**仅 2 个**）

| 姓名 | 学号（登录名） | 一卡通卡号（口令） | 信用分 | 楼栋/房间 |
|------|------|------|------|------|
| 张三 | `2024001001` | `200001` | 80 | B座 / B301 |
| 李四 | `2024001002` | `200002` | 95 | C座 / C205 |

> 旧版本本文档曾写有王五/赵六/钱七三个学生，经核对 `seed.sql` **不存在**，已删除该错误内容。

### 9.3 管理员账号

**A. Mock 模式（`mock-db.js`，本地无 MySQL 时默认走这条）**

| 用户名 | 密码 | 角色 | 数据范围 |
|--------|------|------|----------|
| `admin` | `admin123` | admin | 全院 |
| `superadmin` | `super123` | super_admin | 全院 |
| `counselor` | `counselor123` | counselor | 全院 |
| `building_admin` | `admin123` | admin | 仅 B座（`scope_type=building`） |

**B. 真实数据库（`seed.sql` 导入后）**

| 用户名 | 姓名 | 角色 | 密码 |
|--------|------|------|------|
| `admin` | 系统管理员 | admin | ⚠️ 未知，见下 |
| `superadmin` | 超级管理员 | super_admin | ⚠️ 未知，见下 |
| `counselor` | 辅导员 | counselor | ⚠️ 未知，见下 |

> ⚠️ **重要更正**：三个账号的哈希完全相同（`$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy`），但**它不是 `bcrypt("password")`，也不是 admin123 / super123 / counselor123 / 123456 等常见弱口令**——已用 `bcryptjs` 对 700+ 候选逐一口令验证，全部不匹配。该哈希疑似从外部示例复制而来的占位值，**明文不可知**。
> 后果：**直接用 `seed.sql` 初始化的库，管理员实际上登不进去**，且项目**没有 admin 重置脚本**（`server/scripts/` 不存在，`package.json` 也无相关 script）。
> 处理建议：部署时用下面的 SQL 覆盖为已知口令（把 `<你的密码>` 换成 bcrypt 哈希），或在 Mock 模式下先把管理员建好再切库。
> ```sql
> UPDATE admins SET password = '<bcrypt 哈希>' WHERE username IN ('admin','superadmin','counselor');
> ```

---

## 十、残余问题与待办

### 已解决（2026-05-30 旧版遗留，现已修复）
| 编号 | 原问题 | 现状 |
|---|---|---|
| P1 | 管理后台 `/api/v1/buildings`、`/rooms` 404 | ✅ 路径统一为 `/admin/buildings`、`/admin/rooms`（见 `admin/src/api/room.js`） |
| P2 | Dashboard 数据为空 | ✅ `scopedStatsController.dashboard` 已完整实现（今日/待审/在用/爽约/7日趋势/房型分布/排行） |
| P3 | 爽约任务 `userID=undefined` | ✅ `detectNoshow` 已重写，正确使用 `reservation.user_id` |
| P4 | 管理端与小程序 API 路径不一致 | ✅ 已统一到 `/api/v1` |
| P5 | 订阅消息模板 ID 未填写 | ✅ 改走环境变量 `WX_TEMPLATE_*`，未配置则跳过推送 |
| P7 | 日志需定期清理 | ✅ winston `maxsize` 5MB × `maxFiles` 5 轮转；且敏感字段自动脱敏 |

### 仍待办
| 编号 | 问题 | 归属 | 说明 |
|---|---|---|---|
| P6 | 生产域名与备案 | 部署 | 代码中**已无硬编码生产域名**（仅微信官方 API 域名，属正常）。仍需：购买域名 + ICP 备案 + SSL + 微信后台配置服务器域名白名单 |
| P8 | 依赖安全审计 | 安全 | CI 已有 `secret-scan` 与 `security-hardening`，建议定期执行 `npm audit` 并升级 |

### 本次新发现
| 编号 | 问题 | 影响 | 状态 / 建议 |
|---|---|---|---|
| N1 | `reservation_groups` / `reservation_group_members` 表已建，后端无写入路径 | 小程序有 `group-reserve` 页面但无法落库 | ✅ **已实现全套后端（2026-09-09）**，见下文「团队预约功能」 |
| N2 | 信用分与预约参数硬编码在 `config/index.js` | 管理端已有「信用配置」页但未打通 `system_config` | ✅ **已修复（2026-09-09）**，见下文「运行时配置改造」 |
| N3 | Mock 分支遍布所有 Service（`db.isMock()`） | 易出现"测试通过、生产失败" | ⚠️ 风险提示：新增 Service 时务必同时实现两条路径 |
| N4 | `reservation_slots` 随预约时长膨胀（4h = 240 行） | 存储与索引压力 | ⚠️ 风险提示：依赖 performance-indexes 迁移 + `admin/archive` 定期归档 |
| N5 | 管理端存在冗余/不可达页面 | 维护困惑 | ✅ **已处理（2026-09-09）**，见下文「冗余页面清理」 |
| N6 | 学生登录凭据 `users.card_no` **明文存储**；且 `seed.sql` 的管理员哈希明文不可知 | 明文凭据 + 用 seed 初始化的库管理员登不进去 | ⏳ 待决策：`card_no` 建议改为 bcrypt 或只做冗余校验；管理员需部署时重置口令。详见第九节 |

### 运行时配置改造（N2，2026-09-09 已完成）

**目标**：让 `system_config` 表里的配置真正覆盖 `config/index.js` 中的硬编码默认值，运营期无需改代码重启。

**新增文件**
- `server/src/services/runtimeConfigService.js` — 核心。导出 `CREDIT_KEYS`、`RESERVATION_NUMERIC_KEYS`、`RESERVATION_STRING_KEYS`、`BOUNDS`、`parseValue`、`loadRuntimeConfig`、`startAutoRefresh`、`stopAutoRefresh`、`snapshot`。

**改动文件**
| 文件 | 改动 |
|---|---|
| `server/src/app.js` | `startServer` 中先 `await loadRuntimeConfig()` 再 `startAutoRefresh()`；`shutdown` 中 `stopAutoRefresh()` |
| `server/src/scheduler-worker.js` | 同上（Worker 需要 noshow / 提醒相关参数） |
| `server/src/controllers/adminController.js` | `getConfig` 返回 `parseValue()` 结果而非原始 JSON 字符串；新增 `getEffectiveConfig`；`updateConfig` 重写为按 section 过滤未知键 → upsert → 立即 `loadRuntimeConfig()` → 返回 `{ appliedFields }` |
| `server/src/routes/admin.js` | 新增 `GET /api/v1/admin/config/effective`（`super_admin`） |
| `admin/src/api/runtimeConfig.js` | 新增，`snapshot()` |
| `admin/src/views/Credit/ScoreConfig.vue` | 重写：字段对齐后端 `config.credit`（initialScore / maxScore / noshowPenalty / violationPenalty / goodReward / feedbackReward / goodThreshold / warningThreshold / restrictThreshold / restrictDays / banThreshold / banDays）；提交 `{ credit: {...} }`；新增「当前生效值」面板 |

**关键约定（踩坑点）**
1. **扣分在库中存正数**，加载时统一转负：`noshowPenalty` / `violationPenalty` 走 `-Math.abs(clamp(...))`。管理端表单也填正数。
2. **所有数值走 `BOUNDS` 钳制**，非法值（NaN、超范围）回落到 `config/index.js` 的默认值，不会写脏运行时。
3. **刷新策略是 30s TTL 轮询**（`setInterval` + `unref()`），不是 Redis 发布订阅 —— 好处是不用改任何业务代码，代价是多实例最长 30s 不一致窗口。
4. **Mock 模式下 `loadRuntimeConfig` 是 no-op**，直接保持硬编码默认值。
5. `getEffectiveConfig` 仅供 `super_admin`，返回 `{ credit, reservation, loadedAt }`。

### 冗余页面清理（N5，2026-09-09 已完成）

**先纠正一个误判**：初查时认为 `ReviewQueue.vue` 与 `Admins.vue` 都是「未接入路由的孤儿页」。实际复核后发现 `ReviewQueue.vue` **并非孤儿** —— `PendingList.vue` 只是个 3 行壳：

```vue
<template><ReviewQueue /></template>
<script setup>import ReviewQueue from './ReviewQueue.vue'</script>
```

即 `ReviewQueue.vue` 一直通过它生效，是「预约审核」页的真实实现。因此保留 `ReviewQueue.vue`，改为清理真正冗余的两项：

| 处理 | 文件 | 原因 | 影响 |
|---|---|---|---|
| 改路由 | `adminRoutes.js` `reservation/pending` | 指向 `ReviewQueue.vue`，去掉中间壳 | 行为完全不变，少一层无谓间接 |
| 删除 | `views/Reservation/PendingList.vue` | 纯转发壳，无独立内容 | 无。路由已改指实际实现 |
| 删除 | `views/System/Admins.vue` | 全项目**零引用**的真孤儿；依赖 `GET /admin/managers`（只读列表），增删改复用 `createAccount`/`updateAccount`/`deleteAccount`，与 `/admin/accounts` 完全同源 | 无。页面本来就不可达；功能已被 `Account/Index.vue`（路由 `account`，`super_only`，覆盖 super_admin/导生/counselor）完整覆盖 |

> 两文件均为 git tracked 且删除前未修改，如需回滚：`git checkout -- admin/src/views/Reservation/PendingList.vue admin/src/views/System/Admins.vue`。
> ⚠️ 注意别误删 `views/Poster/PendingList.vue` —— 同名但属海报模块，仍在用。
>
> 验证：`npx vite build` exit 0；全项目 grep `Reservation/PendingList` / `System/Admins` 无残留引用。

### 团队预约功能（N1，2026-09-09 已实现）

**背景**：`reservation_groups` / `reservation_group_members` 两张表早在 schema 中就已建立，但后端长期没有任何写入路径，小程序 `pages/group-reserve` 调用的 `/groups` 系列接口全部 404。本次补齐完整后端。

**新增文件**
| 文件 | 职责 |
|---|---|
| `server/src/services/reservationGroupService.js` | 全部业务逻辑（校验、占槽、成员变动、审批、列表） |
| `server/src/controllers/reservationGroupController.js` | HTTP 层：参数提取、权限前置、响应 |
| `server/src/routes/groups.js` | 路由，已在 `routes/index.js` 挂载为 `/api/v1/groups` |
| `server/sql/migrations/20260909_group_reservation.sql` | **存量库必须执行** |
| `admin/src/api/group.js` | 管理端接口封装 |
| `admin/src/views/Group/PendingList.vue` | 管理端「组团审核」页（列表/筛选/通过/退回/成员详情） |

**接口清单**
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/groups` | 学生 | 创建团队，立即占槽并生成主预约 |
| GET | `/groups/mine` | 学生 | 我发起/参与的团队 |
| GET | `/groups/pending` | 管理员（受楼栋范围） | 待审团队列表 |
| GET | `/groups/:id` | 成员或管理员 | 详情（含 members） |
| POST | `/groups/:id/join` | 学生 | 加入 |
| POST | `/groups/:id/leave` | 学生 | 退出（发起人不可） |
| DELETE | `/groups/:id` | 发起人 | 解散，释放槽位并触发候补转正 |
| PUT | `/groups/:id/approve` | 管理员 | 通过 |
| PUT | `/groups/:id/reject` | 管理员 | 拒绝（必填原因） |

**业务规则（关键假设，改动前务必确认）**
1. **整房占用**：团队按整个房间占用，成员不单独占座。主预约 `seat_id` 为 NULL，写入 `reservation_slots` 时 `seat_scope = 0`，与普通整房预约共用唯一键 `uk_room_seat_date_minute`，天然互斥。
2. **创建即占槽**：不在审批通过时才占，否则多个团队会重复占用同一时段、审批阶段才暴露冲突。
3. **归属创建者**：主预约挂在发起人名下，**签到、爽约、信用分变动全部算发起人**，成员仅作参与人登记，不产生独立预约记录。
4. **成员变动不影响库存**：加入/退出只改成员表并同步主预约 `participants`。
5. **招募与审批解耦**：只有被拒绝或取消才锁定成员变动；审批状态本身不锁——无需审核的房间创建即 `approved`，此时仍应允许加入。
6. **自习室不支持组团**（`SEAT_REQUIRED_TYPES`）：成员无法各自落座。
7. 人数上限受 `min(50, room.capacity)` 约束；并发加入由 `uk_group_user` 唯一键 + `SELECT ... FOR UPDATE` 双重保障。
8. 加入时校验该成员此时段无其它进行中的个人预约（`PERSONAL_SLOT_CONFLICT`）。

**字段映射**（小程序 ↔ 数据库）
`title ↔ name`、`description ↔ purpose`、`startHour/endHour（可为数字 14）↔ start_time/end_time（'14:00'）`、`maxMembers ↔ max_members`。对外返回的 `status` 是招募态（`open`/`full`/`closed`），审批态单独放在 `approvalStatus`。

**管理端页面**
路由 `reservation/groups`（菜单「预约与使用 → 组团审核」），所有管理员角色可见。已加入三处配置，缺一不可：
- `adminRoutes.js` 的 `adminChildren` 路由条目
- `adminRoutes.js` 的 `navSections`（`reservation` 分组）
- `adminRolePolicy.js` 的 `ROLE_NAV_PRIORITY`（三种角色各自的菜单排序）

`GET /groups/pending` 支持 `roomId` / `date` / `buildingId` 三个筛选维度，楼栋范围由 `adminScope` 强制注入，前端无法越权。批量通过由前端逐个调用实现（后端暂无批量接口）。

**待办**
- 存量库需执行迁移：`server/sql/migrations/20260909_group_reservation.sql`（新库已同步进 `schema.sql`，无需迁移）。
- **MySQL 事务路径未实机验证**（本机 MySQL 凭据不匹配），仅 Mock 路径跑通 50 + 12 项断言。首次部署请在测试库先跑一遍。
- 小程序「我的组团」入口已接入：在「我的预约」页顶部加入口条，跳转 `pages/group-list/group-list`（调用 `/groups/mine`）；详情页发起人多出「解散组团」按钮（`DELETE /groups/:id`），非发起人显示「退出」。

---

## 十一、关键文件路径速查

| 用途 | 路径 |
|------|------|
| 后端入口 | `server/src/app.js` |
| 定时任务 Worker | `server/src/scheduler-worker.js` |
| **预约写入唯一入口** | `server/src/services/reservationCommandService.js` |
| 预约释放 + 候补转正 | `server/src/services/reservationLifecycleService.js` |
| **楼栋数据范围中间件** | `server/src/middleware/adminScope.js` |
| 认证中间件 | `server/src/middleware/auth.js` |
| 路由注册 | `server/src/routes/index.js` |
| 运维接口 | `server/src/routes/ops.js` |
| 业务参数（默认值） | `server/src/config/index.js` |
| **运行时配置覆盖层** | `server/src/services/runtimeConfigService.js` |
| 团队预约业务 | `server/src/services/reservationGroupService.js` |
| 团队预约路由 | `server/src/routes/groups.js` |
| 团队预约迁移 | `server/sql/migrations/20260909_group_reservation.sql` |
| 数据库 Schema | `server/sql/schema.sql` |
| 种子数据 | `server/sql/seed.sql` |
| 小程序入口 / 配置 | `miniapp/app.js` / `miniapp/app.json` |
| 小程序请求封装 | `miniapp/utils/request.js` |
| 小程序网络配置 | `miniapp/utils/network-config.js` |
| 管理端路由与权限 | `admin/src/router/adminRoutes.js` |
| 管理端请求封装 | `admin/src/utils/request.js` |
| 部署编排 | `deploy/docker-compose.production.yml` |
| 蓝绿发布脚本 | `deploy/scripts/deploy-blue-green.sh` |
| 接口文档 | `docs/api-reference.md` |
| 数据字典 | `docs/data-dictionary.md` |
| **架构全景分析** | `docs/project-architecture-review.md` |

---

## 十二、给新会话的注意事项（血泪经验）

1. **WXML 模板中不能调用任何 JS 方法**（`.charAt()` / `.split()` / `parseInt()`），所有逻辑必须在 `.js` 中预计算。
2. **时间格式统一 HH:MM 零填充**（`Math.floor` + `padStart(2,'0')`），历史 bug 曾产生 "14.5:00"。
3. **字段名在 WXML 中需同时兼容 camelCase 与 snake_case** 回退。
4. **TabBar 操作必须先 `switchTabList()` 再 `setSelected()`**，避免竞态。
5. **预约写入只能走 `reservationCommandService`**，不要新建第二套实现。
6. **新增管理端接口必须挂 `adminScope` 系列中间件**，前端 `meta.roles` 不是安全边界。
7. **不要相信旧版 `PROJECT_CONTEXT.md`**（2026-05-30），以源码和本版为准。
8. 生产环境 JWT 与签到凭证必须配置**独立**的强随机密钥。
9. **读信用分/预约参数不要直接 `require config`** —— 运行时值可能被 `system_config` 覆盖，走 `runtimeConfigService.snapshot()`。扣分一律以负数参与计算。
10. 管理端 `src/api/*.js` 一律用**具名导出**，不要 default 导入（Vite 构建会直接报 "default is not exported"）。
11. **判定「孤儿页面」不能只看路由表**。本项目存在 `PendingList.vue` 这类纯转发壳（`<ReviewQueue />`），页面看似无路由引用，实则通过壳间接生效。判断前必须全项目 grep 文件名与组件名，否则会误删正在使用的实现。
12. **Mock 数据库的 SQL 能力有硬边界**，写业务 SQL 时必须同时满足 MySQL 与 Mock：
    - 别名是**硬编码映射表**（`r`→`reservations`、`rm`→`rooms`、`u`→`users`、`s`→`seats`、`b`→`buildings`…）。写 `JOIN rooms r` 会 JOIN 到 **reservations** 而不是 rooms，返回完全错误的行。表示 rooms 必须用 `rm`。
    - 不解析 `EXISTS` 子查询，需改写为两次查询 + `IN (...)`。
    - 无事务能力（`getConnection()` 返回 `{isMock:true}`，`assertTransactional` 直接抛错），Service 必须自带 Mock 分支。
13. **同一条 `ALTER TABLE` 中，新列的 `AFTER` 不要指向本语句刚加的列**，部分 MySQL 版本会报 Unknown column。列顺序不重要时直接省略 `AFTER`。

---

## 十三、历史 Spec 迭代（已完成 19 个）

`fix-login-server-startup`、`fix-real-device-login`、`fix-login-network-and-studyroom-timeline`、`fix-room-list-display`、`fix-timeline-and-seats`、`fix-timeline-core-and-announcements`、`fix-room-detail-and-admin`、`fix-tabbar-login-reservation`、`fix-reservation-and-permissions`、`fix-root-cause-time-login-admin`、`fix-six-real-device-issues`、`fix-critical-bugs-and-enhancements`、`fix-critical-remaining-issues`、`fix-four-remaining-issues`、`fix-tabbar-race-and-data-unpack`、`fix-wxml-compilation-errors`、`create-admin-profile-page`、`comprehensive-fix-and-enhance`、`production-deploy-and-launch`。

Spec 文档位于 `d:\敬一书院\.trae\specs\`。当前版本 1.0.0 已进入运维与加固阶段，重点在一致性、可观测性、灾备与发布门禁。

---

> **文档维护**: 每次重大变更后请更新此文档，确保跨会话上下文一致性。本次更新依据：全量源码通读（后端 15,281 行 / 26 控制器 / 19 路由 / 33 服务 / 11 中间件，管理端 23 条路由，小程序 34 页面）+ N2 运行时配置改造落地 + N5 冗余页面清理 + N1 团队预约全套后端（2026-09-09）。
