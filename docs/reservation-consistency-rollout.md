# 预约一致性迁移与上线手册

本手册用于部署预约时间槽、幂等键、事务创建与候补转正改造。生产环境不得跳过备份、预检和迁移后校验。

## 一、上线前准备

1. 停止或临时禁止预约创建、修改、取消、审核和候补转正等写操作。
2. 确认当前服务实例已停止定时任务，避免迁移过程中执行爽约检测。
3. 对 MySQL 数据库执行完整备份，并验证备份文件可恢复。
4. 确保部署账号具备 `ALTER`、`CREATE`、`INDEX`、`SELECT`、`INSERT` 和 `UPDATE` 权限。
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
- 重复幂等键；
- 预约关联的用户、房间或座位不存在。

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
- 检测并补充分钟级时间槽唯一索引；
- 为历史有效预约补写缺失的分钟槽；
- 对回填结果执行数量校验；
- 已完成的步骤不会重复执行，因此中断后可重新运行。

迁移期间必须保持预约写入口关闭。脚本的 advisory lock 只能阻止其他迁移进程，不能替代业务停写。

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
- 预约幂等列、时间槽表和关键唯一索引必须存在。

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
7. 超过房间最大时长时拒绝，等于最大时长时允许；
8. 通知发送失败时，不得将已经提交成功的预约返回为失败。

## 七、异常处理与回退

### 迁移脚本失败

1. 保持预约写入口关闭；
2. 保存迁移日志和预检报告；
3. 修复报告中的数据问题；
4. 重新执行可恢复迁移脚本；
5. 再次执行严格迁移后校验。

不要在校验失败时启动新版本。

### 新版本启动失败

检查日志中的 `DATA_READINESS_FAILED`：

- 缺少数据库对象：重新执行迁移脚本；
- MySQL 不可用：恢复数据库连接；
- Redis 不可用：恢复真实 Redis 服务；
- 不得通过打开 Mock 配置绕过生产启动检查。

### 必须回退旧版本

若必须回退应用代码，建议保留新增列和 `reservation_slots` 表，不要立即删除数据库结构。新增结构对旧版本通常是向后兼容的，直接删除可能造成预约占用信息丢失。

只有在确认备份可恢复、旧版本已停止写入且确需数据库回退时，才执行数据库恢复。数据库恢复完成后重新运行旧版本的数据一致性检查。
