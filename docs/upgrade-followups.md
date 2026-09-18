# 升级改造 · 遗留事项登记（upgrade follow-ups）

> 来源：Batch0 + Batch1（T01 业务错误码 / T02 隐私脱敏 / T03 临时授权+岗位交接）施工过程中发现、但**本批次未处理**的事项。
> 维护：新增遗留项请追加到对应优先级段落，并写明 `文件:行` 与建议动作。
> 约定：本项目**删除任何代码/文件前必须先说明并获得确认**；因此本清单中的「死代码」仅登记，不擅自删除。

---

## P1 · 合规 / 安全（建议下一批优先）

### P1-0 停用 `manualCheckin` 直写路径（R-08 迁移收尾）
- 位置：`server/src/controllers/checkinController.js` 的 `manualCheckin`（以及 `POST /api/v1/checkin/manual`）。
- 现状：Batch2（T04/R-08）新增了「补签申请 → 审核 → 写入 checkins」受控流程（`services/supplementService.js`
  + `controllers/supplementController.js` + `POST /api/v1/checkin/supplement`），并已把 `manualCheckin` 的
  事务写入体抽为可复用函数 `applyManualCheckinWithinTransaction` 供审核通过后调用。
- 但为**避免蓝绿期前端 500**，本批次**保留** `manualCheckin` 直写路径可用（前端 admin UI 仍在使用）。
- 后续动作：**前端迁移到补签申请-审核流后，停用/移除 `manualCheckin` 直写**（先在 admin UI 去掉「直接手动签到」
  入口，再评估下线后端接口与路由 `routes/checkin.js` 的 `/manual`）。**删除前须先说明并获确认。**

### P1-1 其余 PII 明文出口尚未接入分级脱敏（R-14 未覆盖）
本批次只对「预约 / 签到 / 审批队列」链路接入脱敏（`utils/maskPresenter.js` + `services/privacyAuditService.js`）。
以下接口仍直接返回学号 / 手机号 / 姓名的明文，建议按同一模式接入 `privacyAuditService.maskRowsForRequest(req, rows, ...)`：

| 序号 | 位置 | 风险字段 |
|---|---|---|
| 1 | `server/src/controllers/accountController.js:88,105` | 管理员列表 `phone` |
| 2 | `server/src/controllers/accountController.js:116,125,132` | 用户列表 `student_id` / `student_no` / `phone` |
| 3 | `server/src/controllers/auditController.js:44` | 审核列表 `nickname` / `real_name` / `student_id` / `student_no` |
| 4 | `server/src/controllers/creditController.js:11,56` | 违约/受限名单 `student_id` |
| 5 | `server/src/controllers/posterController.js:29` | 海报列表 `student_id` |
| 6 | `server/src/controllers/readingRoomController.js:53` | 在馆记录 `student_id` |
| 7 | `server/src/controllers/statsController.js:191,252,258,263` | 统计导出 `student_id` / `real_name` / `phone` |
| 8 | `server/src/controllers/scopedStatsController.js:332` | 爽约榜 `student_id` |
| 9 | `server/src/services/reservationGroupService.js:140` | 团队成员 `student_id` / `student_no` |

### P1-2 预约详情对管理员返回明文但**未落审计**
`server/src/controllers/reservationController.js` 的 `detail`：管理员在数据域内可见 `student_id` / `student_no` 明文
（`phone` 已被 delete，但学号未处理，且**没有调用** `privacyAuditService.recordPlaintextAccess`）。
建议：对管理员明文访问补审计（`scope=admin_global|admin_building` 时），与列表接口口径一致。

---

## P2 · 健壮性 / 可维护性

### P2-0 组团预约审批绕过 R-02 乐观锁 / R-07 轨迹（third write path）
- 位置：`server/src/services/reservationGroupService.js` 的 `approveGroup`（约 517-520 行）与 `rejectGroup`（约 555 行）。
- 现象：`approveGroup` 直接 `UPDATE reservations SET status='approved', audited_by=?, audited_at=NOW() WHERE id=? AND status=?`，
  **未 `version = version + 1`、未写 `reservation_audit_trail`**；`rejectGroup` 经 `lifecycleService` 会自增 version，
  但同样不写业务轨迹。这是继「单条审批」「批量审批」之后**第三条改预约审核状态的路径**，绕过 R-02/R-07 不变式。
- 说明：该文件属**组团预约特性**（改动前工作区已在途、非 Batch2 产物），故本批次未改动，仅登记。
- 建议：组团审批一并接入 R-02（`version = version + 1`）与 R-07（写 `reservation_audit_trail`，可复用
  `services/reservationAuditTrailService.record`）；由组团特性作者收口。

### P2-1【已修】mock-db 聚合误判（列名含 min/max/avg 子串）
- 现象：`config/mock-db.js` 原用 `/COUNT|SUM|AVG|MIN|MAX/i`（**无词边界**）判定聚合，`admin_id` 含子串 `min`
  被误判为聚合，SELECT 返回 `[{__count__:n}]` 并丢失全部真实字段。任何「选到含 min/max/avg 列名」的查询都会中招。
- 处置：**本批次第 5 次提交已修复**——改为锚定函数调用 `/(COUNT|SUM|AVG|MIN|MAX)\s*\(|GROUP\s+BY/i`。
  并新增回归检查 `server/tests/mock-db-select-check.js`。
- 连带：`services/adminCapabilityService.js`、`services/adminHandoverService.js` 中为规避而写的 `SELECT *` 已恢复为按列查询。

### P2-2 死代码：`reservationApprovalController.pending` / `pendingCount`
- 位置：`server/src/controllers/reservationApprovalController.js`（函数体已加 `NOTE(死代码)` 注释）。
- 说明：这两个导出**当前没有任何路由挂载**；线上 `/reservation/pending` 实际由
  `controllers/scopedQueryController.pendingReservations` 提供（见 `routes/reservation.js`）。
- 建议：确认无外部调用后，另立任务清理（含对应 `module.exports` 项）。**删除前须先说明并获确认。**

### P2-3 access token 无法即时吊销（已知限制，非缺陷）
- 说明：本仓库 access token 为**无状态 JWT**。岗位交接（`services/adminHandoverService.accept`）与登出
  （`controllers/authController.logout`）只能删除 Redis 刷新令牌（`token:admin:<id>`）以阻止**续期**；
  已签发且未过期的 access token 在其 TTL 内仍然有效。
- 影响：交接/登出后存在一个不超过 access token TTL 的「残留可用窗口」。
- 若需即时吊销：引入 token 版本号（写进 JWT payload，登录/交接时自增并在校验时比对）或全量黑名单。

### P2-4 临时授权时间入参口径提醒（使用约定，非缺陷）
- `adminCapabilityService.grant` 的 `validFrom` / `validTo` 以**本地时间（无时区）**写入 DATETIME 并据此判定有效性。
- 前端若传字符串，请传本地时间（`YYYY-MM-DD HH:mm:ss`）或**带时区**的 ISO（`...Z` / `+08:00`）；
  **不要**传「UTC 值但省略时区后缀」（如 `date.toISOString().slice(0,19)`），否则会被当作本地时间而产生时区偏移。

### P2-5 `routes/index.js` 中 `/groups` 行的来源说明
- 位置：`server/src/routes/index.js`（该行上方已加 `FOLLOWUP` 注释）。
- 说明：`router.use('/groups', require('./groups'))` 属**此前在途的「组团预约」工作**（改动前工作区已是 dirty），
  非 Batch0+Batch1 产物。本批次为注册 `/admin/delegations` 而提交该文件时将其一并带入（提交 `aa646b3`）。
  留此说明仅为避免该功能作者困惑，**不要求拆分提交**。
