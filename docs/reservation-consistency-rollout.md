# 预约一致性迁移与上线手册

本手册用于部署预约时间槽、幂等键、事务创建、候补唯一约束与候补转正改造。生产环境不得跳过备份、预检和迁移后校验。

## 一、上线前准备

1. 停止或临时禁止预约创建、修改、取消、审核、加入/退出候补和候补转正等写操作。
2. 确认当前服务实例已停止定时任务，避免迁移过程中执行爽约检测或候补过期处理。
3. 对 MySQL 数据库执行完整备份，并验证备份文件可恢复。
4. 确保部署账号具备 `ALTER`、`CREATE`、`INDEX`、`SELECT`、`INSERT`、`DELETE` 和 `UPDATE` 权限。
5. 准备真实 Redis 服务。生产环境不允许回退到进程内模拟 Redis。

建议备份命令：

```bash
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --databases jingyi_reservation \
  > jingyi_reservation_before_consistency.sql
```

## 二、执行只读预检

```bash
cd <repository-root>

MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=<migration-user> \
MYSQL_PASSWORD='<password>' \
MYSQL_DATABASE=jingyi_reservation \
node scripts/reservation-migration-precheck.js \
  > reservation-precheck.json
```

预检退出码：

- `0`：没有迁移阻断项；
- `1`：数据库连接或脚本执行异常；
- `2`：存在数据阻断项，不得继续迁移。

必须先处理以下阻断数据：

- 有效预约时间重叠；
- 开始时间、结束时间格式错误或时长不为正；
- 预约时长超过房间限制；
- 有效自习室预约没有座位；
- 重复幂等键；
- 同一用户在同一房间、座位范围、日期和时间段存在多条 `waiting` 候补记录；
- 预约关联的用户、房间或座位不存在。

候补重复记录必须由业务负责人确认保留哪一条，其余记录应改为 `cancelled` 或 `expired`。迁移脚本不会擅自替用户选择保留记录。

## 三、执行可恢复迁移

优先使用可重复执行的迁移脚本，不建议直接在生产环境逐句粘贴 SQL：

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=<migration-user> \
MYSQL_PASSWORD='<password>' \
MYSQL_DATABASE=jingyi_reservation \
node scripts/apply-reservation-consistency-migration.js \
  | tee reservation-migration-result.json
```

迁移脚本会：

- 获取 MySQL advisory lock，防止多个迁移进程同时执行；
- 检测并补充 `idempotency_key`、`request_hash`；
- 检测并补充幂等唯一索引；
- 检测并创建 `reservation_slots`；
- 先清除非有效预约残留时间槽，再为历史有效预约补写缺失槽；
- 对回填结果执行数量、范围和归属校验；
- 校验通过后添加分钟级时间槽唯一索引；
- 为候补表添加仅在 `status='waiting'` 时生效的生成列 `waiting_seat_scope`；
- 添加 `uk_waitlist_user_slot`，阻止同一用户并发加入相同候补队列；
- 已完成的步骤不会重复执行，因此中断后可重新运行。

迁移期间必须保持预约和候补写入口关闭。脚本的 advisory lock 只能阻止其他迁移进程，不能替代业务停写。

仓库中的 `server/sql/migrations/20260624_waitlist_consistency.sql` 可用于审阅数据库变更，但生产部署仍推荐执行可恢复的 JavaScript 迁移脚本。

## 四、执行严格迁移后校验

```bash
REQUIRE_SLOT_CONSISTENCY=true \
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=<migration-user> \
MYSQL_PASSWORD='<password>' \
MYSQL_DATABASE=jingyi_reservation \
node scripts/reservation-migration-precheck.js \
  > reservation-postcheck.json
```

严格校验还会把以下问题视为阻断项：

- 有效预约的实际时间槽数量与预约时长不一致；
- 已取消、已拒绝、已完成或爽约的预约仍残留时间槽。

严格校验退出码必须为 `0`，否则不得启动新版本。

## 五、验证生产依赖与数据库结构

```bash
NODE_ENV=production \
ALLOW_MOCK_DB=false \
ALLOW_MOCK_REDIS=false \
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=<application-user> \
MYSQL_PASSWORD='<password>' \
MYSQL_DATABASE=jingyi_reservation \
REDIS_HOST=127.0.0.1 \
REDIS_PORT=6379 \
REDIS_PASSWORD='<redis-password>' \
node scripts/production-data-readiness-check.js
```

预期输出：

```text
production-data-readiness-check passed
```

新版本服务在生产环境启动时也会检查：

- MySQL 必须为真实连接；
- Redis 必须为真实连接；
- 预约幂等列和唯一索引必须存在；
- 时间槽表及分钟级唯一索引必须存在；
- 候补生成列和有效候补唯一索引必须存在且结构正确。

任一条件不满足时，服务会拒绝监听端口。

## 六、上线后检查

部署后分别访问：

```text
GET /api/v1/health
GET /api/v1/ready
```

- `/health` 用于进程存活检查；
- `/ready` 用于 MySQL、Redis 和预约一致性结构检查；
- 只有 `/ready` 返回 HTTP 200，实例才应加入负载均衡。

随后执行以下业务验收：

1. 两个用户同时提交相同房间、相同时间段，只允许一个成功；
2. 相同用户使用同一幂等键重复提交，返回同一预约；
3. 同一幂等键更改参数，返回 HTTP 409；
4. 修改预约后旧时间槽释放、新时间槽建立；
5. 取消或拒绝预约后，第一位有效候补自动转正；
6. 候补预约、时间槽和候补状态同时提交；
7. 同一用户并发加入同一候补队列，只生成一条 `waiting` 记录，另一请求返回 HTTP 409；
8. 退出已处理或不存在的候补记录返回 HTTP 409；
9. 超过房间最大时长时拒绝，等于最大时长时允许；
10. 通知发送失败时，不得将已经提交成功的预约返回为失败。

## 七、异常处理与回退

### 迁移脚本失败

1. 保持预约和候补写入口关闭；
2. 保存迁移日志和预检报告；
3. 修复报告中的数据问题；
4. 重新执行可恢复迁移脚本；
5. 再次执行严格迁移后校验。

不要在校验失败时启动新版本。

### 新版本启动失败

检查日志中的 `DATA_READINESS_FAILED`：

- 缺少数据库对象：重新执行迁移脚本；
- 候补生成列或唯一索引不正确：检查是否完整执行了最新迁移；
- MySQL 不可用：恢复数据库连接；
- Redis 不可用：恢复真实 Redis 服务；
- 不得通过打开 Mock 配置绕过生产启动检查。

### 必须回退旧版本

若必须回退应用代码，建议保留新增列、`reservation_slots` 表、候补生成列和唯一索引，不要立即删除数据库结构。这些结构对旧版本通常向后兼容，直接删除可能造成占用信息丢失或重新出现重复候补。

只有在确认备份可恢复、旧版本已停止写入且确需数据库回退时，才执行数据库恢复。数据库恢复完成后重新运行旧版本的数据一致性检查。
