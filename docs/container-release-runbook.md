# 第九阶段：容器化、灰度发布与回滚手册

## 1. 部署目标

生产拓扑拆分为以下独立进程：

- `api-blue`、`api-green`：两个可切换API槽位；
- `scheduler`：单独运行预约任务、通知Outbox和自动备份；
- `admin`：不可变管理后台静态镜像；
- `gateway`：统一代理管理后台、API、上传文件和WebSocket；
- `mysql`、`redis`：状态服务；
- `migrate`：只执行一次的数据库发布门禁。

API镜像使用固定数值UID 10001、只读根文件系统、删除Linux capabilities并启用`no-new-privileges`。管理后台使用非特权Nginx镜像。

## 2. 镜像构建

```bash
export RELEASE_TAG=2026.06.26-1
export GIT_SHA=$(git rev-parse HEAD)
export BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

docker build \
  --build-arg APP_VERSION="$RELEASE_TAG" \
  --build-arg GIT_SHA="$GIT_SHA" \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  -t registry.example.edu/jingyi-api:"$RELEASE_TAG" .

docker build \
  -t registry.example.edu/jingyi-admin:"$RELEASE_TAG" \
  admin
```

镜像不得使用可变的`latest`作为发布依据。发布记录必须保存镜像仓库、标签、镜像摘要、Git提交号和构建时间。

## 3. 生产环境配置

将`deploy/production.env.example`复制到服务器安全目录，设置权限为`0600`，再配置：

```bash
export PRODUCTION_ENV_FILE=/secure/path/jingyi.production.env
export API_IMAGE=registry.example.edu/jingyi-api
export ADMIN_IMAGE=registry.example.edu/jingyi-admin
export RELEASE_TAG=2026.06.26-1
export RELEASE_ID=prod-20260626-1
export GIT_SHA=<完整提交号>
export APP_VERSION=2026.06.26-1
export BUILD_TIME=<UTC构建时间>
```

更推荐由容器平台的Secret功能设置敏感变量，或使用镜像入口脚本支持的`*_FILE`变量。禁止将真实密钥提交到仓库或写入镜像层。

## 4. 首次启动

```bash
docker compose -f deploy/docker-compose.production.yml up -d mysql redis
docker compose -f deploy/docker-compose.production.yml --profile migration run --rm migrate
docker compose -f deploy/docker-compose.production.yml up -d api-blue api-green scheduler admin gateway
```

检查：

```bash
curl -f http://127.0.0.1:8080/api/v1/ops/live
curl -f http://127.0.0.1:8080/api/v1/ops/ready
curl -f http://127.0.0.1:8080/api/v1/ops/version
```

`/ops/version`应返回版本、Git SHA、构建时间、发布编号和当前槽位。

## 5. 蓝绿发布

```bash
sh deploy/scripts/deploy-blue-green.sh
```

脚本按以下顺序执行：

1. 使用目录锁阻止两个发布同时进行；
2. 确定当前活动槽位和待发布槽位；
3. 拉取新API和管理后台镜像；
4. 通过当前活动API创建并验证发布前加密备份；
5. 运行四组可重复数据库迁移和生产Readiness检查；
6. 仅重建非活动API槽位；
7. 等待其Readiness通过；
8. 调用`/ops/version`核对目标Git SHA；
9. 生成新的Nginx upstream，执行`nginx -t`后无中断reload；
10. 使用新镜像重建Scheduler；
11. 保存当前和上一个发布槽位，以便快速回滚。

数据库迁移必须保持至少一个发布窗口的向后兼容性。删除列、重命名列、缩窄字段等破坏性变更应拆为“扩展—迁移—收缩”多个版本，不得与应用切换同时完成。

## 6. 灰度观察

流量切换后至少观察15分钟：

- `/api/v1/ops/status`无Critical告警；
- 5xx比例和P95耗时没有明显上升；
- 通知Outbox没有持续积压；
- WebSocket连接和事件投递正常；
- 登录、房间列表、创建预约、取消、签到、审批各执行一次；
- 当前槽位报告预期`GIT_SHA`和`RELEASE_ID`。

观察窗口内保留旧槽位，不应立即删除旧容器或镜像。

## 7. 应用回滚

```bash
sh deploy/scripts/rollback-blue-green.sh
```

回滚脚本会先确认上一槽位仍然Ready，再原子切换Nginx upstream。它**不会反向执行数据库迁移**。因此：

- 发布前迁移必须兼容旧应用；
- 若迁移已造成数据不可逆变化，必须按灾备手册恢复到隔离库并制定数据修复方案；
- 不得为了追求快速回滚直接执行未经验证的DOWN SQL。

## 8. 发布失败处理

- 备份或备份校验失败：停止发布，修复存储、权限或密钥问题；
- 迁移失败：不切换流量，保留当前槽位，检查可重复迁移日志；
- 新槽位不Ready：收集容器日志并删除失败槽位，不影响当前流量；
- 版本号不匹配：视为镜像标签污染，禁止继续发布；
- Nginx配置检查失败：保持旧upstream，不执行reload；
- 切换后业务异常：在兼容性窗口内执行应用槽位回滚。

## 9. 发布后清理

确认新版本稳定后：

```bash
docker image prune --filter until=168h
docker compose -f deploy/docker-compose.production.yml ps
```

至少保留上一个已验证版本的镜像和槽位。清理不能触及MySQL、Redis、上传、主备份和第二副本数据卷。
