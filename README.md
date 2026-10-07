# 敬一书院功能房预约系统

这是一个包含微信小程序、网页管理后台、Node.js API、Scheduler Worker、MySQL 与 Redis 的功能房预约平台。当前正式版本为 `1.0.0`。

## 项目组成

| 模块 | 路径 | 说明 |
|---|---|---|
| 微信小程序 | `miniapp/` | 学生端与小程序管理员端 |
| 管理后台 | `admin/` | Vue 3 管理页面 |
| 后端服务 | `server/` | Express API 与业务服务 |
| 部署 | `deploy/`、`Dockerfile` | 容器、蓝绿发布与回滚 |
| 数据库 | `server/sql/`、`scripts/` | 结构、数据和可重复迁移 |
| 测试 | `.github/workflows/`、`scripts/` | 安全、一致性、灾备、发布和性能门禁 |
| 文档 | `docs/` | 接口、数据、运维、用户和验收手册 |

## 主要能力

- 房间、座位、时间轴、预约、候补、审批、签到、通知、信用和反馈；
- 管理员楼栋数据范围、房间管理、预约审核、统计和公告；
- 预约幂等、并发时间槽唯一约束和条件更新；
- Redis 多实例协调、实时事件和事务 Outbox；
- 请求关联、结构化日志、指标、告警和审计哈希链；
- 加密备份、第二副本、隔离恢复、归档和灾备演练；
- 非 root 容器、数据库发布门禁、蓝绿切换和应用回滚；
- 慢查询指纹、连接池监控、性能索引和容量回归。

## 2026-10-07 更新

- 会长团、辅导员、普通管理员与宿管的权限、菜单和扫码流程分别校验，核验完成停留在自身流程。
- 信用分仅影响预约日期、同类每日次数和可预约时段，不因低信用分限制登录。
- 功能房支持长期状态与指定日期时间的定时状态，到期恢复长期状态；未来关闭、维护时段不能新预约。
- 小程序与网页同步完善房间管理、信用搜索与设置、海报详情和图片、拒绝理由及规则说明。
- 预约次数、冲突、组团独占、共享容量、取消和修改、提醒等近期规则一并核对；D128仍需联系辅导员预约。

更新与升级说明：[2026-10-07 更新记录](CHANGELOG.md)、[数据库升级与验证](docs/upgrade-20261007.md)。
完整核对：[近期两端改动检查记录](docs/qa/20261007-room-status-recent-cross-client-audit.md)。

## 本地启动步骤

```bash
npm run install:all
npm run db:init
npm run db:migrate:reservation
npm run db:migrate:notification
npm run db:migrate:observability
npm run db:migrate:backup
npm run db:migrate:performance
npm run server
```

管理后台：

```bash
npm run admin
```

Scheduler Worker：

```bash
cd server
npm run start:scheduler
```

微信开发者工具导入 `miniapp/` 目录。真机调试按 `docs/network-setup.md` 配置后端地址。

## 常用检查

```bash
npm run check:security
npm run check:security-hardening
npm run check:runtime-coordination
npm run check:notification-outbox
npm run check:observability-audit
npm run check:backup-recovery
npm run check:release
npm run check:performance
npm run check:acceptance
npm run check:comprehensive
```

真实 MySQL、Redis 与启动后 API 检查由 GitHub Actions 执行。后端集成测试使用 `cd server && npm run test:integration`，管理后台构建使用 `cd admin && npm run build`。

## 运维接口

| 路径 | 说明 |
|---|---|
| `/api/v1/ops/live` | 进程存活 |
| `/api/v1/ops/ready` | 依赖和数据库结构就绪 |
| `/api/v1/ops/version` | 版本、提交号、构建时间和槽位 |
| `/api/v1/ops/status` | 完整运行状态 |
| `/api/v1/ops/metrics` | Prometheus 指标 |
| `/api/v1/ops/audit-integrity` | 审计完整性校验 |

## 文档索引

- `docs/engineering-roadmap.md`
- `docs/api-reference.md`
- `docs/data-dictionary.md`
- `docs/user-guide.md`
- `docs/final-acceptance-checklist.md`
- `docs/performance-capacity-runbook.md`
- `docs/container-release-runbook.md`
- `docs/backup-recovery-dr-runbook.md`
- `docs/observability-audit-runbook.md`
- `docs/reservation-consistency-rollout.md`
- `docs/upgrade-20261007.md`
- `docs/reservation-policy-20261006.md`
- `docs/qa/20261007-credit-booking-only.md`
- `docs/qa/20261007-room-status-recent-cross-client-audit.md`

## 生产约束

- 正式配置与测试配置分离；
- 发布前执行备份、迁移和 Readiness 门禁；
- 写入型性能测试只能在隔离环境运行；
- 数据库变更遵循“扩展—迁移—收缩”；
- 新功能同步补充测试、指标、接口和用户文档。
