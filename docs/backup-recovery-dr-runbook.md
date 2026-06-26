# 第八阶段：自动备份、恢复校验与灾备演练手册

## 1. 目标与边界

本阶段将原管理端“备份成功”占位接口替换为真实、可验证、可恢复的加密备份流程。备份同时覆盖 MySQL 逻辑数据与上传文件，支持第二副本、保留策略、恢复隔离校验、数据归档和灾备演练。

默认目标：

- RPO：不超过24小时；
- RTO：常规数据量下不超过2小时；
- 每日自动全量逻辑备份；
- 至少保留7份，默认保留30天；
- 主备份与第二副本不得位于同一存储故障域；
- 每季度至少执行一次自动化恢复演练。

## 2. 数据库迁移

依次执行：

```bash
node scripts/apply-reservation-consistency-migration.js
node scripts/apply-notification-outbox-migration.js
node scripts/apply-observability-audit-migration.js
node scripts/apply-backup-recovery-migration.js
node scripts/production-data-readiness-check.js
```

新安装也可在主结构完成后执行 `server/sql/backup-recovery.sql`。

## 3. 必需环境变量

```env
BACKUP_ENCRYPTION_KEY=<32字节Base64或64位十六进制密钥>
BACKUP_DIR=/var/lib/jingyi/backups
BACKUP_SECONDARY_DIR=/mnt/offsite/jingyi-backups
UPLOADS_DIR=/app/server/uploads
ENABLE_AUTOMATED_BACKUPS=true
BACKUP_CRON=30 2 * * *
RETENTION_CRON=15 3 * * 0
BACKUP_RETENTION_DAYS=30
BACKUP_MIN_KEEP=7
RETENTION_AUDIT_DAYS=365
RETENTION_NOTIFICATION_DAYS=180
RETENTION_OUTBOX_DAYS=90
DATA_RETENTION_APPLY=false
```

`BACKUP_ENCRYPTION_KEY` 应保存在密钥管理系统，不能写入仓库、镜像或前端。密钥丢失将导致备份无法恢复；密钥泄露后应先完成重新加密与轮换，再废弃旧密钥。

生产环境默认要求第二副本。仅在明确接受单副本风险时设置：

```env
ALLOW_SINGLE_COPY_BACKUP=true
```

## 4. 备份格式

备份文件扩展名为 `.jybak`，使用 AES-256-GCM 认证加密，旁边有同名 `.sha256` 校验文件。加密包中包含：

- `database.sql`：通过 `mysqldump --single-transaction` 生成；
- `uploads.tar.gz`：上传文件归档；
- `manifest.json`：来源数据库、创建时间、组件大小、SHA-256和必要数据表清单。

备份文件不能直接通过Web下载，管理端只返回编号、文件名、大小、校验值和第二副本状态。

## 5. 手动和自动备份

手动命令：

```bash
node scripts/run-backup.js
```

管理端超级管理员可调用：

- `POST /api/v1/admin/backup`：创建真实加密备份；
- `GET /api/v1/admin/backups`：查看备份执行记录；
- `POST /api/v1/admin/backups/:fileName/verify`：验证指定备份。

自动备份只在 Scheduler Worker 中运行。启用 `ENABLE_AUTOMATED_BACKUPS=true` 后，默认每天02:30执行备份，每周日03:15执行归档保留任务。多实例通过 Redis 分布式锁避免重复执行。

## 6. 完整性校验

```bash
node scripts/verify-backup.js /var/lib/jingyi/backups/<file>.jybak
```

校验顺序：

1. 对加密文件核对外部SHA-256；
2. 使用AES-GCM认证标签验证密文未被篡改；
3. 解压后核对每个组件的SHA-256；
4. 检查备份格式和清单。

任一环节失败都不得继续恢复。

## 7. 隔离恢复

禁止默认覆盖当前生产数据库。恢复必须指定新的目标数据库，并进行双重确认：

```bash
export ALLOW_RESTORE=true
export RESTORE_CONFIRM_DATABASE=jingyi_restore_20260626
node scripts/restore-backup.js /path/to/backup.jybak jingyi_restore_20260626
```

需要恢复上传文件时：

```bash
export RESTORE_UPLOADS=true
export RESTORE_UPLOADS_DIR=/tmp/jingyi-restored-uploads
```

恢复完成后，脚本会检查用户、管理员、房间、预约、预约槽位、通知、Outbox、审计和系统配置等必要数据表。验证通过后，仍需人工抽查关键数量、最近预约和上传文件，再决定是否切换流量。

只有在维护窗口、完整备份已验证且获得双人审批的情况下，才允许设置 `ALLOW_IN_PLACE_RESTORE=true` 覆盖原数据库。

## 8. 灾备演练

```bash
node scripts/disaster-recovery-drill.js
```

演练会：

1. 创建一份新的加密备份；
2. 恢复到随机命名的隔离数据库；
3. 校验必要数据表；
4. 输出实际RTO和RPO；
5. 删除演练数据库。

演练报告应记录日期、备份编号、数据规模、RTO、RPO、失败点、修复措施和负责人。建议每季度执行，并在重大数据库结构变更后追加执行。

## 9. 数据保留与归档

默认归档：

- 操作审计日志：365天；
- 用户通知：180天；
- 已发送或死信Outbox：90天。

```bash
node scripts/run-data-retention.js
```

默认只创建加密归档，不删除数据库数据。确认归档文件与校验文件已写入持久化存储后，才设置：

```env
DATA_RETENTION_APPLY=true
```

归档删除按已成功写入的最大记录ID和截止时间执行，降低新数据被误删的风险。

## 10. 告警与处置

新增告警：

- `BACKUP_MISSING`：没有成功备份；
- `BACKUP_STALE`：最近成功备份超过允许时长；
- `BACKUP_FAILURES`：24小时内出现备份失败；
- `BACKUP_SECONDARY_COPY_MISSING`：最近备份缺少第二副本。

处置顺序：

1. 检查磁盘空间、目录权限和 `mysqldump`/`tar` 是否可用；
2. 检查数据库连接和加密密钥是否注入；
3. 检查第二副本挂载或对象存储同步；
4. 手动创建并验证一份新备份；
5. 对连续失败立即冻结高风险结构变更；
6. 必要时执行隔离恢复演练确认可恢复性。
