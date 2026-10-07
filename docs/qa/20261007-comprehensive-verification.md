# 2026-10-07 信用分与全面检查结果

## 结论

本次发现的学生信用分预期不一致来自检查共用运行中的服务及可变数据。旧检查固定要求张三初始信用分为 80，但先前的扣分、状态修改等操作会改变同一账号，重复执行时可能出现分数不同或账号被停用。使用全新独立数据后，登录、个人资料和信用明细均符合预期。本次没有将真实账号的信用分重置为测试值。

移动端检查保留初始 80 分断言，以及明细中 80、75、80 的余额断言。`npm run check:mobile` 连续两次通过。此前已有的信用完整性与信用模拟检查也通过，覆盖零分、上下限实际记分、限制阈值、限制到期恢复、同一预约重复扣分防重、接口余额及历史快照。

## 改动文件与作用

| 文件 | 改动 |
| --- | --- |
| `scripts/run-isolated-check.js` | 新增独立检查入口；使用临时数据、上传目录和独立服务端口，关闭定时任务，不连接运行中的业务服务，不执行真实数据库迁移。 |
| `scripts/comprehensive-check.js` | 新增完整检查入口，逐项运行并保存日志；区分通过、失败、部分验证和未验证，避免将定时任务正常防重日志误判为检查跳过。 |
| `package.json` | 新增 `check:comprehensive`，移动端及学生闭环检查改为独立运行。 |
| `scripts/mobile-regression-check.js` | 共享容量用例改用支持个人预约的创新工坊；保留人数为 0 的拒绝检查及合法人数预约检查，信用分断言不变。 |
| `server/src/middleware/auth.js` | 宿管可读取本人通知；学生资料等其他入口继续拒绝，核验入口保留。 |
| `miniapp/pages/admin-home/admin-home.js`、`miniapp/pages/admin-profile/admin-profile.js` | 角色名称使用同一来源，避免显示名称与权限模型不一致。 |
| `scripts/admin-dashboard-data-check.mjs` | 检查新增爽约趋势及按房间预约总量计算的爽约率。 |
| `scripts/admin-reservation-endpoints-check.mjs` | 明确检查普通审核队列，待审数量按独立初始数据验证。 |
| `scripts/admin-cross-client-data-sync-check.js`、`scripts/reservation-consistency-check.js`、`scripts/reservation-mutation-consistency-check.js`、`scripts/checkout-waitlist-consistency-check.js` | 普通预约用例改用符合当前预约规则的房间，保留冲突、修改、防重和释放检查。 |
| `scripts/admin-monitor-account-navigation-check.mjs` | 更新现有菜单、账号页和页面状态检查；仅提取模板中的可见文字；讨论室用例明确开放状态，并验证团队占用后可用容量为 0，学生无法读取其他人的预约详情。 |
| `scripts/avatar-display-policy-check.js` | 头像文件写入配置指定的目录，保留图片可访问和响应策略检查。 |
| `scripts/checkin-credential-check.js` | 等待缓存连接完成，检查实际扫码页面的调用路径。 |
| `scripts/security-runtime-check.js`、`server/tests/security-fixture.js` | 身份和补签安全用例采用当前签到时间窗口，并避开初始预约冲突。 |
| `server/tests/mock-seed-coverage-check.js` | 允许新环境的真实反馈列表为空，仍验证数据结构。 |
| `server/tests/qa-batch2-supplement-check.js` | 固定补签检查时间；外楼栋记录必须不可见；真实迁移改为明确开启且使用指定环境，不再自动尝试本机业务数据库。 |

## 已执行检查

完整命令：`npm run check:comprehensive`。

- 共 90 个检查入口：79 通过、1 部分验证、10 未验证、0 失败。
- 部分验证项为补签补充检查：65 个本地用例通过，真实 MySQL 迁移未执行。
- 完整日志和逐项结果：`.runlogs/comprehensive-2026-10-07T06-30-03-573Z/results.json`，同目录保存每项输出。该轮完成后进一步完善讨论室开放状态的测试数据，该项于 `.runlogs/comprehensive-2026-10-07T06-31-13-872Z` 再次通过。
- 覆盖学生预约及信用、管理员权限及审核、宿管核验、通知、团队预约、签到签退、隐私、请求更新、页面规则、事件同步、备份逻辑、发布准备等现有自动检查。
- 宿管完整核验检查通过：本人确认、并发重试、防重复签到、楼栋隔离、学生状态同步、异常处理、写入失败回滚、停用账号和记录保存。宿管通知权限及学生入口拒绝检查通过。
- `admin` 目录中 `npm run build` 通过，`npm run test:layout` 通过（1 个测试）。构建有依赖注释和包体积提示，无构建错误。
- 公共接口响应检查：16 次请求，0 失败，本次第 95 百分位响应时间约 57 毫秒。使用本地模拟数据，不代表生产负载性能，也不包含该性能脚本的可选登录接口。
- 变更的 JavaScript 语法检查及 `git diff --check` 通过。

## 未验证范围

以下 10 个入口需要专用外部环境，未计作通过：

- MySQL：`mysql-backup-recovery-check.js`、`mysql-notification-outbox-check.js`、`mysql-observability-audit-check.js`、`mysql-performance-index-check.js`、`mysql-reservation-concurrency-check.js`、`reservation-migration-precheck.js`。
- 接近生产的数据库及缓存环境：`production-data-readiness-check.js`。
- 真实 Redis：`redis-runtime-integration-check.js`。
- 已登录的微信开发者工具自动化环境：`room-entry-runtime-check.cjs`、`timeline-layout-runtime-check.cjs`。此前官方开发者工具检查返回需要重新登录，未验证真实手机和摄像头扫码效果。

本次验证针对当前工作区的自动检查和管理后台构建，不等于生产数据库、真机和完整人工视觉验收均已通过。未修改 `config.toml`。
