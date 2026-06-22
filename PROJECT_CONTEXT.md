# 敬一书院预约系统 — 项目全景上下文文档

> **生成日期**: 2026-05-30  
> **用途**: 跨会话上下文传递，供新会话快速理解项目全貌并继续工作  
> **GitHub**: (待填写)  
> **微信AppID**: wxa83f083ceb601977

---

## 一、项目概述

**敬一书院预约系统**是一个基于微信小程序的校园功能房预约管理平台，包含三端：

| 端 | 技术栈 | 路径 | 用途 |
|----|--------|------|------|
| 微信小程序 | 原生微信小程序 | `miniapp/` | 宿生预约、管理员审批 |
| 管理后台 | Vue 3 + Vite | `admin/` | Web管理后台 |
| 后端API | Node.js + Express | `server/` | RESTful API服务 |

**项目路径**: `d:\敬一书院\jingyi-reservation-system\`

---

## 二、技术架构

### 2.1 后端 (server/)
```
server/
├── src/
│   ├── app.js                    # 入口，Express + CORS + 路由挂载
│   ├── config/
│   │   ├── index.js              # JWT密钥、baseUrl、微信配置
│   │   ├── database.js           # MySQL连接池
│   │   ├── redis.js              # Redis配置
│   │   ├── logger.js             # 日志
│   │   └── mock-db.js            # 模拟数据库（开发用）
│   ├── middleware/
│   │   ├── auth.js               # JWT认证中间件
│   │   ├── roleAuth.js           # 角色权限中间件
│   │   ├── rateLimit.js          # 限流
│   │   └── validator.js          # 参数校验
│   ├── controllers/              # 15个控制器
│   ├── routes/                   # 15个路由文件
│   ├── services/
│   │   ├── creditService.js
│   │   ├── schedulerService.js
│   │   ├── wechatService.js      # 微信订阅消息
│   │   └── wechatPushService.js
│   └── utils/
├── sql/
│   ├── schema.sql                # 数据库表结构
│   └── seed.sql                  # 种子数据
├── logs/                         # 运行日志
└── .env.example                  # 环境变量模板
```

### 2.2 小程序 (miniapp/)
```
miniapp/
├── pages/
│   ├── index/                    # 首页（功能房分类列表）
│   ├── login/                    # 登录页
│   ├── profile/                  # 宿生个人中心
│   ├── profile-edit/             # 个人信息编辑
│   ├── room-list/                # 功能房列表
│   ├── room-detail/              # 房间详情
│   ├── room-timeline/            # 时间线选座
│   ├── room-compare/             # 房间对比
│   ├── reservation-confirm/      # 预约确认
│   ├── reservation-detail/       # 预约详情
│   ├── my-reservations/          # 我的预约
│   ├── notifications/            # 消息通知
│   ├── feedback/                 # 问题反馈
│   ├── qrcode/                   # 签到二维码
│   ├── rules/                    # 规章制度
│   ├── credit-detail/            # 信用分明细
│   ├── group-reserve/            # 团队预约
│   ├── poster-apply/             # 海报申请
│   ├── reading-room/             # 阅览室
│   ├── study-room/               # 自习室
│   ├── admin-home/               # 管理员首页（审批）
│   ├── admin-manage/             # 管理中心
│   ├── admin-profile/            # 管理员个人中心
│   ├── admin-reservation/        # 预约管理
│   ├── admin-rooms/              # 功能房管理
│   ├── admin-users/              # 宿生管理
│   ├── admin-feedback/           # 反馈管理
│   └── admin-announcement/       # 公告管理
├── components/
│   ├── room-card/                # 房间卡片组件
│   ├── reservation-card/         # 预约卡片组件
│   ├── date-picker/              # 日期选择器
│   └── timeline/                 # 时间线组件
├── custom-tab-bar/               # 自定义TabBar
├── services/
│   └── subscribeMessage.js       # 微信订阅消息
├── utils/
│   ├── request.js                # HTTP请求封装
│   ├── auth.js                   # 认证工具
│   ├── util.js                   # 通用工具
│   └── local-data.js             # 本地模拟数据
├── app.js                        # 小程序入口
├── app.json                      # 全局配置+TabBar
└── project.config.json           # 项目配置
```

### 2.3 管理后台 (admin/)
```
admin/
├── src/
│   ├── views/
│   │   ├── Login.vue
│   │   ├── Dashboard/Index.vue
│   │   ├── Reservation/AllList.vue
│   │   ├── Room/Manage.vue
│   │   ├── System/Admins.vue
│   │   └── ... (15个页面)
│   ├── api/                      # API调用封装
│   ├── router/                   # 路由配置
│   ├── store/user.js             # 用户状态
│   └── utils/request.js          # HTTP请求
├── package.json
└── vite.config.js
```

---

## 三、API路由表

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/v1/auth/login` | 宿生登录 | 否 |
| POST | `/api/v1/auth/login/admin` | 管理员登录 | 否 |
| GET | `/api/v1/user/profile` | 获取个人信息 | JWT |
| PUT | `/api/v1/user/profile` | 更新个人信息 | JWT |
| GET | `/api/v1/room` | 功能房列表 | 否 |
| GET | `/api/v1/room/:id` | 房间详情 | 否 |
| GET | `/api/v1/room/:id/seats` | 座位列表 | 否 |
| GET | `/api/v1/room/:id/timeline` | 时间线 | 否 |
| GET | `/api/v1/room/stats` | 房间统计 | 管理员 |
| GET | `/api/v1/reservation` | 我的预约 | JWT |
| POST | `/api/v1/reservation` | 创建预约 | JWT |
| DELETE | `/api/v1/reservation/:id` | 取消预约 | JWT |
| GET | `/api/v1/reservation/pending` | 待审批列表 | 管理员 |
| GET | `/api/v1/reservation/pending-count` | 待审批数量 | 管理员 |
| PUT | `/api/v1/reservation/:id/approve` | 审批通过 | 管理员 |
| PUT | `/api/v1/reservation/:id/reject` | 审批拒绝 | 管理员 |
| GET | `/api/v1/user/list` | 用户列表 | 管理员 |
| PUT | `/api/v1/user/:id/credit` | 调整信用分 | 管理员 |
| PUT | `/api/v1/user/:id/ban` | 封禁/解封 | 管理员 |
| GET | `/api/v1/feedback` | 反馈列表 | 管理员 |
| PUT | `/api/v1/feedback/:id/resolve` | 处理反馈 | 管理员 |
| GET | `/api/v1/stats/dashboard` | 仪表盘统计 | 管理员 |
| GET | `/api/v1/notification` | 通知列表 | JWT |
| GET | `/api/v1/rules` | 规章制度 | 否 |
| GET | `/api/v1/checkin/verify` | 签到验证 | 否 |
| POST | `/api/v1/checkin` | 签到 | JWT |
| GET | `/api/v1/credit/:userId` | 信用分 | JWT |
| GET | `/api/v1/audit/pending` | 审核列表 | 管理员 |
| POST | `/api/v1/poster` | 海报申请 | JWT |
| GET | `/api/v1/reading-room` | 阅览室 | JWT |
| POST | `/api/v1/reading-room` | 阅览室预约 | JWT |

---

## 四、所有Spec目录及状态

项目共经历 **18个** Spec迭代，按时间线排列：

### 4.1 已完成 ✅

| # | Spec ID | 说明 | 核心修复 |
|---|---------|------|----------|
| 1 | `fix-login-server-startup` | 修复登录服务器启动 | 服务端启动、环境检测 |
| 2 | `fix-real-device-login` | 修复真机登录 | platform自动检测localhost/LAN IP |
| 3 | `fix-login-network-and-studyroom-timeline` | 修复登录网络和时间线 | 网络请求适配、真机API |
| 4 | `fix-room-list-display` | 修复房间列表显示 | API数据正确渲染 |
| 5 | `fix-timeline-and-seats` | 修复时间线和座位 | 时间线选座功能 |
| 6 | `fix-timeline-core-and-announcements` | 修复时间线核心和公告 | 时间线算法、公告系统 |
| 7 | `fix-room-detail-and-admin` | 修复房间详情和管理员 | 详情页、管理员基础功能 |
| 8 | `fix-tabbar-login-reservation` | 修复TabBar和登录预约 | TabBar根据角色切换 |
| 9 | `fix-reservation-and-permissions` | 修复预约和权限 | 预约流程、权限校验 |
| 10 | `fix-root-cause-time-login-admin` | 根因修复：时间+登录+管理员 | 时间格式".5"根因、未登录显示、管理员功能 |
| 11 | `fix-six-real-device-issues` | 修复6个真机问题 | 6项全链路修复 |
| 12 | `fix-critical-bugs-and-enhancements` | 修复关键bug | 各模块增强 |
| 13 | `fix-critical-remaining-issues` | 修复剩余关键问题 | 登录问题、显示问题 |
| 14 | `fix-four-remaining-issues` | 修复4个剩余问题 | 登录、预约、管理 |
| 15 | `fix-tabbar-race-and-data-unpack` | 修复TabBar竞态 | TabBar竞态条件、数据解包 |
| 16 | `fix-wxml-compilation-errors` | 修复WXML编译错误 | `.charAt()/.split()` 等非法调用 |
| 17 | `create-admin-profile-page` | 创建管理员个人中心 | 独立admin-profile页面 |
| 18 | `comprehensive-fix-and-enhance` | 综合修复和增强 | 全链路验证 |
| 19 | `production-deploy-and-launch` | 生产部署和上线准备 | 安全配置、部署脚本、测试方案 |

---

## 五、已完成的关键修复清单

### 5.1 时间格式修复（全链路）
- **根因**: 服务端`reservationController.js`的create方法忽略`startMin`/`endMin`，产生"14.5:00"格式
- **修复**: 服务端+前端统一使用`Math.floor`+`padStart(2,'0')`拼接HH:MM
- **涉及文件**: reservationController.js, room-timeline.js, reservation-confirm.js, room-compare.js, study-room.js

### 5.2 "未登录"显示修复
- **根因**: 管理员登录API返回`realName`(camelCase)，profile页只检查`name`/`real_name`/`nickname`
- **修复**: 服务端authController.js新增`name`字段；前端profile.wxml回退链增加`realName`
- **涉及文件**: authController.js, userController.js, profile.js, profile.wxml, login.js

### 5.3 管理员功能完善
- **新增7个API**: 待审批列表、审批通过/拒绝、用户列表、房间统计、反馈处理
- **新增2个页面**: admin-announcement（公告管理）、admin-rooms（功能房管理）
- **增强3个页面**: admin-reservation（分页+搜索）、admin-users（信用分调整）、admin-feedback（回复）

### 5.4 字段名一致性修复（13处）
- admin-home、admin-feedback、notifications、credit-detail、my-reservations、room-detail等
- 所有WXML增加camelCase/snake_case双回退

### 5.5 WXML编译安全
- 修复3处非法JS方法调用：`.charAt()`、`parseInt()`、`.split()`
- 改为在.js中预计算字段，WXML仅使用纯变量

### 5.6 TabBar导航修复
- 修复竞态条件：`switchTabList`增加变更检测
- 6个tabBar页面的`onShow`统一先调`switchTabList()`再设`selected`

### 5.7 管理员"我的"页面
- 创建独立`admin-profile`页面，包含数据统计、系统管理入口、账号管理
- TabBar adminList第3项指向admin-profile而非宿生profile

### 5.8 生产环境安全配置
- CORS: `origin: '*'` → 域名白名单
- JWT: 硬编码 → `process.env.JWT_SECRET`
- 小程序: `urlCheck: false` → `true`
- 创建`.env.example`、nginx.conf、PM2配置、部署脚本

### 5.9 微信订阅消息推送
- 服务端: `wechatService.js`（access_token缓存、发送审批/拒绝/签到通知）
- 前端: `subscribeMessage.js`（请求订阅授权）
- 预约成功后自动请求授权，审批通过/拒绝后自动推送

---

## 六、当前残余问题

### 6.1 高优先级 🔴

| 编号 | 问题 | 影响范围 | 状态 |
|------|------|----------|------|
| P1 | 管理后台部分API 404（如`/api/v1/buildings`、`/api/v1/rooms`） | admin前端 | 待修复 |
| P2 | 管理后台dashboard数据为空（返回`{}`） | admin前端 | 待修复 |
| P3 | 爽约检测定时任务中`userID=undefined` | 定时任务 | 待调查 |

### 6.2 中优先级 🟡

| 编号 | 问题 | 影响范围 | 状态 |
|------|------|----------|------|
| P4 | 管理后台与小程序API路径不一致 | admin前端 | 待统一 |
| P5 | 订阅消息模板ID未填写 | 微信推送 | 待微信后台申请后填写 |
| P6 | 生产环境域名未配置 | 部署 | 待购买域名+备案 |

### 6.3 低优先级 🟢

| 编号 | 问题 | 影响范围 | 状态 |
|------|------|----------|------|
| P7 | 日志文件需定期清理 | 服务器 | 日志轮转配置 |
| P8 | npm依赖安全审计 | 安全 | 待执行`npm audit` |

---

## 七、数据库表结构

根据 `server/sql/schema.sql`：

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `users` | 宿生用户 | id, student_id, real_name, password_hash, credit_score, openid |
| `admins` | 管理员 | id, username, real_name, password_hash, role, wechat_openid |
| `rooms` | 功能房 | id, name, room_number, building, floor, capacity, open_start_time, open_end_time, status |
| `seats` | 座位 | id, room_id, seat_number, status |
| `reservations` | 预约 | id, user_id, room_id, seat_id, date, start_time, end_time, status, reservation_code |
| `feedbacks` | 反馈 | id, user_id, content, status, reply, created_at |
| `notifications` | 通知 | id, user_id, title, content, is_read, created_at |
| `announcements` | 公告 | id, title, content, created_by, created_at |
| `credit_records` | 信用记录 | id, user_id, change_amount, new_score, type, reason, created_at |
| `checkins` | 签到记录 | id, reservation_id, user_id, checkin_time |
| `rules` | 规章制度 | id, title, content, sort_order |
| `posters` | 海报申请 | id, user_id, title, content, status |

---

## 八、角色权限体系

| 角色 | 标识 | 权限 |
|------|------|------|
| 宿生 (student) | - | 查看功能房、预约、取消、签到、反馈 |
| 管理员 (admin) | `admin` | 审批预约、管理房间、管理用户 |
| 超级管理员 (super_admin) | `super_admin` | 全部权限 + 管理管理员 |
| 辅导员 (counselor) | `counselor` | 查看统计、审批预约 |

**权限中间件**: `server/src/middleware/roleAuth.js`
- `requireAdmin`: 允许 admin + super_admin + counselor
- `requireSuperAdmin`: 仅允许 super_admin

---

## 九、测试账号信息

### 宿生账号
| 姓名 | 学号 | 信用分 | 登录方式 |
|------|------|--------|----------|
| 张三 | 2024001001 | 80 | 微信登录/学号密码 |
| 李四 | 2024001002 | 95 | 微信登录/学号密码 |
| 王五 | 2024001003 | 100 | 微信登录/学号密码 |
| 赵六 | 2024001004 | 80 | 微信登录/学号密码 |
| 钱七 | 2024001005 | 100 | 微信登录/学号密码 |

### 管理员账号
| 用户名 | 姓名 | 角色 | 密码 |
|--------|------|------|------|
| admin | 系统管理员 | admin | admin123 |
| superadmin | 超级管理员 | super_admin | super123 |
| counselor | 辅导员 | counselor | counselor123 |

---

## 十、部署状态

### 已完成的部署准备
- ✅ Nginx反向代理配置 (`deploy/nginx.conf`)
- ✅ PM2集群配置 (`deploy/ecosystem.config.js`)
- ✅ 一键部署脚本 (`deploy/deploy.sh`)
- ✅ 环境变量模板 (`server/.env.example`)
- ✅ 测试方案文档 (`docs/test-plan.md`)
- ✅ 运维监控方案 (`docs/ops-monitoring.md`)

### 待完成的上线步骤
- [ ] 购买域名（推荐 `.top` 首年¥1）
- [ ] 注册云服务器（推荐 Oracle Cloud 永久免费）
- [ ] ICP备案（个人可备案，7-20天）
- [ ] 配置SSL证书（Let's Encrypt免费）
- [ ] 微信后台配置服务器域名白名单
- [ ] 申请订阅消息模板ID
- [ ] 填写 `.env` 生产环境变量
- [ ] 替换 `request.js` 中 `PROD_BASE_URL` 为实际域名
- [ ] 上传小程序并提交审核

---

## 十一、关键文件路径速查

| 用途 | 路径 |
|------|------|
| 后端入口 | [server/src/app.js](file:///d:/敬一书院/jingyi-reservation-system/server/src/app.js) |
| 后端配置 | [server/src/config/index.js](file:///d:/敬一书院/jingyi-reservation-system/server/src/config/index.js) |
| 路由注册 | [server/src/routes/index.js](file:///d:/敬一书院/jingyi-reservation-system/server/src/routes/index.js) |
| 预约控制器 | [server/src/controllers/reservationController.js](file:///d:/敬一书院/jingyi-reservation-system/server/src/controllers/reservationController.js) |
| 认证控制器 | [server/src/controllers/authController.js](file:///d:/敬一书院/jingyi-reservation-system/server/src/controllers/authController.js) |
| 用户控制器 | [server/src/controllers/userController.js](file:///d:/敬一书院/jingyi-reservation-system/server/src/controllers/userController.js) |
| 微信服务 | [server/src/services/wechatService.js](file:///d:/敬一书院/jingyi-reservation-system/server/src/services/wechatService.js) |
| 数据库Schema | [server/sql/schema.sql](file:///d:/敬一书院/jingyi-reservation-system/server/sql/schema.sql) |
| 小程序配置 | [miniapp/app.json](file:///d:/敬一书院/jingyi-reservation-system/miniapp/app.json) |
| 小程序入口 | [miniapp/app.js](file:///d:/敬一书院/jingyi-reservation-system/miniapp/app.js) |
| 请求封装 | [miniapp/utils/request.js](file:///d:/敬一书院/jingyi-reservation-system/miniapp/utils/request.js) |
| 自定义TabBar | [miniapp/custom-tab-bar/index.js](file:///d:/敬一书院/jingyi-reservation-system/miniapp/custom-tab-bar/index.js) |
| 项目配置 | [miniapp/project.config.json](file:///d:/敬一书院/jingyi-reservation-system/miniapp/project.config.json) |
| 订阅消息 | [miniapp/services/subscribeMessage.js](file:///d:/敬一书院/jingyi-reservation-system/miniapp/services/subscribeMessage.js) |
| 认证工具 | [miniapp/utils/auth.js](file:///d:/敬一书院/jingyi-reservation-system/miniapp/utils/auth.js) |
| 部署脚本 | [deploy/deploy.sh](file:///d:/敬一书院/jingyi-reservation-system/deploy/deploy.sh) |
| Nginx配置 | [deploy/nginx.conf](file:///d:/敬一书院/jingyi-reservation-system/deploy/nginx.conf) |
| PM2配置 | [deploy/ecosystem.config.js](file:///d:/敬一书院/jingyi-reservation-system/deploy/ecosystem.config.js) |
| 环境变量模板 | [server/.env.example](file:///d:/敬一书院/jingyi-reservation-system/server/.env.example) |
| 测试方案 | [docs/test-plan.md](file:///d:/敬一书院/jingyi-reservation-system/docs/test-plan.md) |
| 运维方案 | [docs/ops-monitoring.md](file:///d:/敬一书院/jingyi-reservation-system/docs/ops-monitoring.md) |
| 问题记录 | [findings.md](file:///d:/敬一书院/jingyi-reservation-system/findings.md) |
| 任务计划 | [task_plan.md](file:///d:/敬一书院/jingyi-reservation-system/task_plan.md) |

---

## 十二、历史Spec目录索引

所有Spec文档位于 `d:\敬一书院\.trae\specs\`：

| 目录 | 状态 |
|------|------|
| `fix-login-server-startup/` | ✅ 已完成 |
| `fix-real-device-login/` | ✅ 已完成 |
| `fix-login-network-and-studyroom-timeline/` | ✅ 已完成 |
| `fix-room-list-display/` | ✅ 已完成 |
| `fix-timeline-and-seats/` | ✅ 已完成 |
| `fix-timeline-core-and-announcements/` | ✅ 已完成 |
| `fix-room-detail-and-admin/` | ✅ 已完成 |
| `fix-tabbar-login-reservation/` | ✅ 已完成 |
| `fix-reservation-and-permissions/` | ✅ 已完成 |
| `fix-root-cause-time-login-admin/` | ✅ 已完成 |
| `fix-six-real-device-issues/` | ✅ 已完成 |
| `fix-critical-bugs-and-enhancements/` | ✅ 已完成 |
| `fix-critical-remaining-issues/` | ✅ 已完成 |
| `fix-four-remaining-issues/` | ✅ 已完成 |
| `fix-tabbar-race-and-data-unpack/` | ✅ 已完成 |
| `fix-wxml-compilation-errors/` | ✅ 已完成 |
| `create-admin-profile-page/` | ✅ 已完成 |
| `comprehensive-fix-and-enhance/` | ✅ 已完成 |
| `production-deploy-and-launch/` | ✅ 已完成 |

---

## 十三、给新会话的快速启动指南

### 继续开发小程序
1. 用微信开发者工具打开 `d:\敬一书院\jingyi-reservation-system\miniapp\`
2. 阅读本节了解当前状态
3. 查看【第六节】残余问题优先处理

### 继续开发后端
1. `cd d:\敬一书院\jingyi-reservation-system\server`
2. `npm install`
3. 启动服务: `node src/app.js` 或 `npm start`

### 继续开发管理后台
1. `cd d:\敬一书院\jingyi-reservation-system\admin`
2. `npm install`
3. `npm run dev`

### 关键注意事项
- WXML模板中不能使用任何JS方法调用（`.charAt()`、`.split()`、`parseInt()`等），所有逻辑必须在.js中预计算
- 时间格式统一使用HH:MM零填充
- 字段名在WXML中必须同时支持camelCase和snake_case回退
- TabBar操作必须先`switchTabList()`再`setSelected()`
- 管理员TabBar为3项，宿生TabBar为4项
- 服务端JWT密钥从环境变量`JWT_SECRET`读取
- 小程序请求URL由`utils/request.js`管理，生产环境需替换`PROD_BASE_URL`

---

> **文档维护**: 每次重大变更后请更新此文档，确保跨会话上下文一致性。