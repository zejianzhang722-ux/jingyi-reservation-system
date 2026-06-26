# API 接口手册

## 1. 基本约定

- 基础路径：`/api/v1`；
- 数据格式：JSON；
- 字符编码：UTF-8；
- 访问令牌：`Authorization: Bearer <access-token>`；
- 请求关联：可传入 `X-Request-Id`，响应会返回同名请求编号；
- 预约写入：应传入 `Idempotency-Key` 或 `X-Idempotency-Key`；
- 时间：业务日期使用 `YYYY-MM-DD`，时间段使用 `HH:mm`；
- 分页：常用参数为 `page` 和 `pageSize`，单页最多 100 条。

统一成功结构：

```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

统一错误结构：

```json
{
  "code": 400,
  "message": "错误说明",
  "data": null,
  "requestId": "请求编号"
}
```

常见状态码：

| 状态码 | 说明 |
|---|---|
| 200/201 | 查询或写入成功 |
| 400 | 参数错误 |
| 401 | 未登录、令牌无效或令牌类型错误 |
| 403 | 角色或楼栋数据范围不足 |
| 404 | 资源不存在 |
| 409 | 幂等冲突、预约冲突或状态已被其他请求修改 |
| 413 | 上传文件过大 |
| 429 | 触发接口限流 |
| 500 | 未处理的服务错误 |
| 503 | 数据库、Redis、数据库结构或运行依赖未就绪 |

## 2. 认证

认证路由前缀：`/auth`。

主要能力包括学生登录、微信登录、管理员登录、访问令牌刷新和退出。访问令牌与刷新令牌用途不同，刷新令牌不能用于业务接口。管理员与学生会话分别存储，并支持令牌黑名单和会话撤销。

## 3. 用户

路由前缀：`/user`。

主要接口：

- 查询和更新个人资料；
- 查询信用分、限制状态和相关记录；
- 查询学生端首页所需信息；
- 管理员在数据范围内查询学生信息。

个人敏感资料只允许本人或具备相应管理权限的角色访问。

## 4. 功能房

路由前缀：`/room`。

| 方法与路径 | 权限 | 说明 |
|---|---|---|
| `GET /room` | 可匿名 | 房间列表、类型、楼栋、状态和关键词筛选 |
| `GET /room/:id` | 可匿名 | 房间详情和座位统计 |
| `GET /room/:id/seats` | 可匿名 | 房间座位列表 |
| `GET /room/:id/timeline` | 可匿名 | 指定日期的时间轴和座位占用状态 |
| `GET /room/type/:type` | 可匿名 | 按类型查询 |
| `GET /room/building/:building` | 可匿名 | 按楼栋查询 |
| `POST /room/compare` | 已登录 | 对比多个房间 |
| `GET /room/announcements` | 可匿名 | 最新公告 |
| `GET /room/stats` | 可匿名 | 开放房间和当日预约摘要 |

## 5. 预约

路由前缀：`/reservation`。

| 方法与路径 | 权限 | 说明 |
|---|---|---|
| `POST /reservation` | 学生 | 创建预约，支持幂等键和并发槽位约束 |
| `GET /reservation` | 已登录 | 学生查询本人预约，管理员按楼栋范围查询 |
| `GET /reservation/:id` | 资源所有者或管理员 | 预约详情和座位信息 |
| `PUT /reservation/:id` | 资源所有者或管理员 | 修改允许变更的预约信息 |
| `DELETE /reservation/:id` | 资源所有者或管理员 | 取消预约并释放占用槽位 |
| `POST /reservation/:id/rebook` | 资源所有者或管理员 | 基于历史预约重新预约 |
| `POST /reservation/check-conflict` | 已登录 | 检查时间段冲突 |
| `POST /reservation/waitlist` | 学生 | 加入候补队列 |
| `DELETE /reservation/:id/waitlist` | 学生 | 退出候补 |
| `GET /reservation/pending` | 管理员 | 查询数据范围内待审批预约 |
| `GET /reservation/pending-count` | 管理员 | 待审批数量 |
| `PUT /reservation/:id/approve` | 管理员 | 原子审批通过并创建通知 |
| `PUT /reservation/:id/reject` | 管理员 | 拒绝、释放槽位并通知用户 |
| `GET /reservation/:id/qrcode` | 资源所有者或管理员 | 获取短时动态签到凭证 |

预约创建的核心约束：

- 同一房间、座位范围、日期和时间槽只能成功占用一次；
- 同一用户和幂等键只执行一次；
- 重复请求返回原结果或 409，不得生成重复预约；
- 取消、拒绝和异常结束后会释放槽位并尝试提升候补；
- 审批更新使用条件更新，防止两名管理员重复处理。

## 6. 签到

路由前缀：`/checkin`。

| 方法与路径 | 权限 | 说明 |
|---|---|---|
| `POST /checkin` | 管理员 | 扫描动态凭证签到 |
| `POST /checkin/manual` | 管理员 | 人工签到 |
| `POST /checkin/checkout` | 预约所有者或管理员 | 签退 |
| `GET /checkin/status/:reservationId` | 预约所有者或管理员 | 查询签到状态 |
| `GET /checkin/current/:roomId` | 管理员 | 查询房间当前签到人员 |
| `POST /checkin/patrol` | 管理员 | 巡查记录 |

动态签到凭证包含有效期和一次性随机标识，服务端校验预约、房间、状态、时间窗口、权限和防重放状态。

## 7. 通知

路由前缀：`/notification`。

- `GET /notification`：分页读取站内通知；
- `GET /notification/unread-count`：未读数；
- `PUT /notification/:id/read`：标记单条已读；
- `PUT /notification/read-all`：全部已读。

通知写入和外部投递通过事务 Outbox 解耦。事件具有去重键、重试次数、下次可用时间和死信状态。

## 8. 统计与管理

统计路由前缀：`/stats`，仅管理员可访问且受楼栋范围约束。

- `GET /stats/dashboard`；
- `GET /stats/reservations`；
- `GET /stats/usage-rate`；
- `GET /stats/peak-hours`；
- `GET /stats/noshow`；
- `GET /stats/users`；
- `GET /stats/export`。

管理员管理路由前缀：`/admin`，覆盖房间、座位、楼栋、管理员账号、公告、系统配置、操作日志、学期归档和备份。超级管理员才能访问账号管理、全局配置、操作日志和备份能力。

## 9. 运维接口

路由前缀：`/ops`。

公开接口：

- `GET /ops/live`：进程存活；
- `GET /ops/ready`：数据库、Redis和数据库结构就绪；
- `GET /ops/version`：版本、提交号、构建时间、发布编号和部署槽位。

受 `X-Ops-Token` 保护的接口：

- `GET /ops/status`：完整运行状态、告警、备份、连接池和调度信息；
- `GET /ops/metrics`：Prometheus 格式指标；
- `GET /ops/audit-integrity`：审计哈希链完整性检查。

## 10. 安全注意事项

- 不得在日志、前端或错误响应中输出密码、令牌、微信密钥和备份密钥；
- 管理端接口不能只依赖前端隐藏按钮，后端必须执行角色和资源范围检查；
- 上传文件只允许白名单图片类型，并通过受控媒体路由读取；
- 客户端应把 409 视为业务竞争结果，把 429 视为限流结果，不应自动无限重试；
- 写入请求重试时必须复用同一幂等键；
- 生产监控接口必须配置高强度 `OPS_MONITOR_TOKEN`。
