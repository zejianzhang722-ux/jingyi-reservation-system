# 第七阶段：可观测性、审计追踪与运行告警手册

## 1. 阶段目标

本阶段为服务端建立统一的请求关联、结构化日志、运行指标、受保护的运维端点、管理员操作审计和异常告警能力。目标是在不暴露用户隐私和敏感凭据的前提下，使常见故障能够被发现、定位、复核和追责。

## 2. 上线前迁移

依次执行：

```bash
node scripts/apply-reservation-consistency-migration.js
node scripts/apply-notification-outbox-migration.js
node scripts/apply-observability-audit-migration.js
node scripts/production-data-readiness-check.js
```

`apply-observability-audit-migration.js` 使用 MySQL advisory lock，可重复执行。它会保留旧操作日志，为新日志增加请求编号、角色、请求方法、路径、结果、脱敏元数据和哈希链字段，并将管理员外键改为 `ON DELETE SET NULL`，避免管理员账号删除后审计记录一并丢失。

## 3. 生产环境变量

至少配置：

```env
OPS_MONITOR_TOKEN=<至少32字符的随机值>
AUDIT_IP_HASH_SALT=<至少32字符的随机值，部署后不要随意更换>
OPS_MONITOR_INTERVAL_MS=60000
OPS_ALERT_COOLDOWN_MS=300000
OPS_OUTBOX_BACKLOG_WARNING=100
OPS_OUTBOX_OLDEST_WARNING_SECONDS=300
OPS_OUTBOX_DEAD_CRITICAL=1
OPS_HTTP_5XX_RATE_WARNING=0.05
OPS_HTTP_ERROR_MINIMUM_SAMPLES=20
OPS_AUDIT_FAILURE_CRITICAL=1
LOG_LEVEL=info
```

`OPS_MONITOR_TOKEN` 仅供监控系统访问详细运维接口，不得写入前端、小程序或仓库。`AUDIT_IP_HASH_SALT` 用于对来源 IP 做不可逆哈希，应由密钥管理系统保存。

## 4. 运维端点

公共探针：

- `GET /api/v1/ops/live`：进程存活探针；
- `GET /api/v1/ops/ready`：MySQL、Redis、预约结构和审计结构就绪探针；
- 兼容别名：`GET /api/v1/health`、`GET /api/v1/ready`。

受保护端点需携带请求头：

```text
X-Ops-Token: <OPS_MONITOR_TOKEN>
```

- `GET /api/v1/ops/status`：依赖、通知 Outbox、审计完整性、调度器和进程状态；
- `GET /api/v1/ops/metrics`：Prometheus 文本指标；
- `GET /api/v1/ops/audit-integrity?limit=500`：校验最近审计哈希链。

示例：

```bash
curl -H "X-Ops-Token: $OPS_MONITOR_TOKEN" https://example.edu/api/v1/ops/status
curl -H "X-Ops-Token: $OPS_MONITOR_TOKEN" https://example.edu/api/v1/ops/metrics
```

## 5. 请求关联与日志

每个 HTTP 请求都有 `X-Request-Id`。调用方可提供符合格式的编号，服务端也会生成 UUID，并在响应头中返回同一编号。排查问题时应同时检索：

- 请求编号；
- 时间范围；
- HTTP 方法与规范化路径；
- 状态码和耗时；
- 管理员编号与角色；
- Outbox 事件键或预约编号。

生产环境日志输出为 JSON 到标准输出，同时保留轮转文件。密码、Token、Cookie、会话密钥、微信标识和私钥类字段会被递归脱敏。

## 6. 审计日志

管理员、超级管理员和辅导员执行 `POST`、`PUT`、`PATCH`、`DELETE` 请求时，系统记录：

- 操作者、角色和请求编号；
- 操作、目标表及目标编号；
- 方法、路径、状态码和结果；
- 哈希后的来源 IP、User-Agent；
- 已脱敏并限长的参数、查询和请求体；
- 前一条哈希和当前条目哈希。

旧日志可能没有哈希，完整性校验会将其计入 `unhashed`，但不会错误地判定新哈希链断裂。任何新日志内容被修改，都会导致 `entry_hash_mismatch` 或 `chain_link_mismatch`。

## 7. 默认告警

系统周期性检查并结构化输出 `operational_alert`：

- `DEPENDENCY_NOT_READY`：MySQL、Redis或迁移未就绪；
- `OUTBOX_DEAD_LETTERS`：出现通知死信；
- `OUTBOX_BACKLOG`：Outbox积压超过阈值；
- `OUTBOX_OLDEST_PENDING`：最旧未完成通知等待过久；
- `HTTP_5XX_RATE`：达到最小样本后，5xx比例超过阈值；
- `AUDIT_WRITE_FAILURES`：审计写入失败；
- `AUDIT_CHAIN_INVALID`：审计哈希链异常。

多实例环境下检查任务通过 Redis 分布式锁避免重复执行；相同告警在冷却窗口内不会反复刷屏。生产平台应将 `severity=critical` 接入电话、短信或即时通讯告警，将 `warning` 接入工作群或工单。

## 8. 故障处置顺序

1. 查看 `/ops/status`，确认是依赖、结构、Outbox、HTTP错误率还是审计异常；
2. 使用 `requestId` 检索结构化日志；
3. 对 Outbox 死信核对 `last_error`、通道和重试次数，不要直接删除；
4. 审计链异常时暂停高风险管理操作，导出受影响时间段日志并保存数据库快照；
5. 数据库结构未就绪时停止流量切换，重新执行可重复迁移与 readiness 检查；
6. 修复后再次检查 `/ops/ready`、`/ops/status` 和 `/ops/audit-integrity`。

## 9. 数据保留建议

- 应用日志：在线保留不少于30天，归档不少于180天；
- 审计日志：建议不少于1年，重要管理操作可延长；
- 告警事件和处置记录：与审计日志保持同等期限；
- 禁止通过删除管理员账号清除审计记录；
- 备份与恢复、归档不可篡改存储将在第八阶段完成。
