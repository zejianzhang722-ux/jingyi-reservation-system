# 信用分仅限制预约权限

## 原因与当前结果

本机服务中的 2024001001 在修复前信用分为 20，状态为 banned，并有截至 2026-11-06 的信用限制期限。旧规则在低于 30 分时写入封禁状态，登录和登录后的身份检查据此拒绝访问，因此开发者工具显示“账号已被封禁”。

现在信用分不再写入封禁或暂停账号状态，也不阻止登录、信用查询或通知连接。登录时会清理旧规则留下的有期限信用限制，不修改信用分及信用记录。明确的人工账号停用仍单独处理，管理员账号权限和宿管核验流程不变。

本机服务已更新，2024001001 实际登录、个人资料和信用查询均返回成功。本机使用模拟数据库，重启后该账号恢复初始 80 分；另用独立的 20 分旧封禁和 0 分数据验证了低分登录与预约限制，并非仅靠恢复 80 分判断修复成功。

## 新的默认预约规则

| 信用分 | 允许日期 | 每天同类功能房次数 | 允许时段 |
| --- | --- | --- | --- |
| ≥80 | 今天至 3 天后 | 3 次 | 房间开放时间 |
| 60–79 | 今天至 2 天后 | 2 次 | 房间开放时间 |
| 30–59 | 今天至 1 天后 | 1 次 | 08:00–20:00，且在房间开放时间内 |
| 0–29 | 仅当天 | 1 次 | 09:00–17:00，且在房间开放时间内 |

次数按使用日期和房间类型计算，加入团队也计入，发起人不重复计数。取消或被拒绝释放次数；其他原有计数、时间冲突、房间容量和审核规则继续执行。创建、加入团队、修改预约采用同一规则，修改不会重复计算自身。已有预约仍可查看、取消、核验和签退。分数变化后即时执行当前区间，不再等待 7 天或 30 天解禁。

分数边界使用现有信用配置中的阈值，日期上限不超过系统整体预约上限。原有 banThreshold 等内部字段保留兼容，含义改为严格预约限制区间，不再产生登录封禁；旧限制天数不再参与信用处罚。

## 主要文件

- `server/src/services/creditBookingPolicy.js`：统一分数区间、日期、次数、时段和历史信用封禁识别。
- `server/src/services/creditService.js`：扣分只更新余额及日志，发送预约权限提示；清理历史有期限信用限制，提供统一规则说明。
- `server/src/controllers/authController.js`、`server/src/middleware/auth.js`、`server/src/services/socketAuthService.js`：学生登录、接口身份检查和通知连接不再因信用限制被拒绝。
- `server/src/services/reservationCommandService.js`、`reservationService.js`、`reservationGroupService.js`、`reservationDailyPolicy.js`：创建、加入组团及已有修改流程统一检查当前信用权限，模拟与数据库路径使用同一规则。
- `server/src/utils/helpers.js`：支持提前天数为 0，修复“仅当天”误用默认 3 天的问题；拒绝无效日期。
- `server/src/controllers/creditController.js`：停止信用管理入口新增账号封禁或暂停，保留旧记录清理。
- `server/src/services/reservationRulesText.js`、`miniapp/utils/reservation-rules.js`、`miniapp/pages/credit-detail/credit-detail.js` 与 `.wxml`：更新信用说明，移除封禁账号文案。
- `admin/src/views/Credit/ScoreConfig.vue`、`Blacklist.vue`、`miniapp/pages/admin-credit/admin-credit.wxml`、`miniapp/pages/admin-stats/admin-stats.js`：移除信用封禁操作、停用旧处罚天数编辑，更新预约权限说明。
- `scripts/credit-booking-permissions-check.js`：新增旧信用封禁、零分登录、权限边界、预约次数、修改、加入团队和人工账号停用检查。
- `scripts/credit-integrity-check.js`、`credit-mock-check.js`、`socket-auth-check.js`、`noshow-rollback-check.js`、`reservation-daily-policy-check.js`、`reservation-mutation-policy-check.js`、`admin-site-ux-check.mjs`：更新旧处罚断言，同时保留余额、记账、防重、回滚、锁定顺序和权限检查。

## 检查结果

- `npm run check:comprehensive`：91 项，80 通过、1 部分验证、10 外部环境项未验证、0 失败。结果见 `.runlogs/comprehensive-2026-10-07T06-52-01-829Z/results.json`。
- 补充核对数据库时间格式含秒的区间边界后，信用、团队及修改相关 7 项复测均通过，结果见 `.runlogs/comprehensive-2026-10-07T06-54-13-532Z/results.json`。
- `admin` 中 `npm run build`、`npm run test:layout` 通过；变更语法检查和 `git diff --check` 通过。
- 部分验证项的 65 个补签用例通过，真实 MySQL 迁移未执行；另 10 项需要专用真实数据库、Redis 或已登录微信开发者工具环境，未计作通过。本次未完成真机摄像头及页面视觉验收。
- 本机测试账号登录成功，宿管核验、角色权限、信用记账和学生闭环检查通过。未修改 `config.toml`。
