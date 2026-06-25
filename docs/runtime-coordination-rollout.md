# 运行时协调与实时通道部署手册

本手册适用于启用 Redis 分布式定时任务锁、Socket.IO 管理员鉴权和跨实例实时广播后的部署。

## 一、推荐部署拓扑

推荐将 API 实例和定时任务 Worker 分开运行：

- API：可以水平扩展多个实例，`ENABLE_SCHEDULER=false`；
- Scheduler Worker：至少一个实例，执行 `npm run start:scheduler`；
- MySQL：所有实例连接同一生产数据库；
- Redis：API 和 Scheduler Worker 必须连接同一 Redis 集群或同一逻辑数据库；
- Nginx 或其他入口代理：转发 HTTP 与 WebSocket。

即使运行多个 Scheduler Worker，Redis 分布式锁也会让每个任务在同一触发周期内只有一个实例获得执行权。生产环境仍建议独立 Worker，便于资源隔离、日志观察和故障处理。

## 二、环境变量

API 实例：

```bash
NODE_ENV=production
ENABLE_SCHEDULER=false
ALLOW_MOCK_DB=false
ALLOW_MOCK_REDIS=false
MYSQL_HOST=<mysql-host>
MYSQL_PORT=3306
MYSQL_USER=<application-user>
MYSQL_PASSWORD=<password>
MYSQL_DATABASE=jingyi_reservation
REDIS_HOST=<redis-host>
REDIS_PORT=6379
REDIS_PASSWORD=<redis-password>
REDIS_DB=0
JWT_SECRET=<strong-secret>
```

Scheduler Worker 使用相同数据库和 Redis 配置，不需要监听 HTTP 端口：

```bash
cd server
npm run start:scheduler
```

简单的单实例环境仍可在 API 进程中设置 `ENABLE_SCHEDULER=true`，但不建议在生产多实例部署中同时使用“API 内置 Scheduler”和独立 Worker。

## 三、PM2 示例

```javascript
module.exports = {
  apps: [
    {
      name: 'jingyi-api',
      script: 'src/app.js',
      cwd: './server',
      instances: 2,
      exec_mode: 'cluster',
      env_production: {
        NODE_ENV: 'production',
        ENABLE_SCHEDULER: 'false'
      }
    },
    {
      name: 'jingyi-scheduler',
      script: 'src/scheduler-worker.js',
      cwd: './server',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
}
```

Redis 分布式锁允许 Scheduler Worker 临时扩展为两个实例，但应先确认任务耗时、Redis 可用性和日志告警均正常。

## 四、容器部署建议

建议使用两个 Deployment 或两类容器：

```text
jingyi-api
  command: node src/app.js
  replicas: 2+

jingyi-scheduler
  command: node src/scheduler-worker.js
  replicas: 1
```

API 和 Worker 必须使用相同版本镜像、相同 MySQL 配置、相同 Redis 配置和相同 JWT 密钥。

API 就绪探针：

```text
GET /api/v1/ready
```

只有返回 HTTP 200 后才加入流量入口。Scheduler Worker 不提供 HTTP 探针，建议使用进程存活检查和日志/指标告警。

## 五、Nginx WebSocket 配置

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream jingyi_api {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    location /socket.io/ {
        proxy_pass http://jingyi_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }

    location /api/ {
        proxy_pass http://jingyi_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

当前管理后台使用 WebSocket-only 连接，并由 Redis 广播适配器同步多实例事件。其他客户端若启用 HTTP long-polling，需要配置粘性会话，或者统一改为 WebSocket-only。

## 六、Socket.IO 安全规则

实时监控连接必须携带管理员 access token：

```javascript
io(origin, {
  path: '/socket.io',
  transports: ['websocket'],
  auth: callback => callback({ token: localStorage.getItem('token') || '' })
})
```

服务端会拒绝：

- 未提供 token；
- access token 已过期或无效；
- refresh token；
- 已加入黑名单的 token；
- 学生账号；
- 已禁用管理员；
- 数据库角色与 token 角色不一致。

房间权限：

- `admin:<id>`：管理员本人；
- `building:<id>`：超级管理员或对应楼栋管理员；
- `room:<id>`：超级管理员或对应楼栋管理员；
- `monitor:all`：仅超级管理员。

## 七、Redis 故障行为

生产环境中：

- Scheduler 无法连接真实 Redis 时拒绝启动；
- Socket.IO 跨实例广播无法连接真实 Redis 时 API 拒绝启动；
- Socket.IO 黑名单检查失败时拒绝新实时连接；
- 不允许切换到进程内 Mock Redis。

Redis 恢复后，应滚动重启受影响的 API 和 Scheduler Worker，确认日志出现：

```text
Redis跨实例广播已启用
定时任务Worker已启动
```

## 八、上线验证

1. 启动两个 API 实例和一个 Scheduler Worker；
2. 两个管理端分别连接不同 API 实例；
3. 验证双方均能完成 Socket.IO 管理员鉴权；
4. 由实例 A 向 `building:<id>` 广播测试事件，确认实例 B 的客户端收到；
5. 使用学生 token、refresh token 和已撤销 token 连接，确认均被拒绝；
6. 同时启动两个 Scheduler Worker，确认同一任务一个执行、另一个记录 `skipped`；
7. 停止 Redis，确认新 API 或 Worker 实例无法以生产模式启动；
8. 恢复 Redis 后滚动重启并重新验证；
9. 检查 `/api/v1/ready` 返回 HTTP 200；
10. 观察至少一个完整任务周期，确认没有重复通知或重复状态变更。

## 九、回退方案

如实时广播出现异常：

1. 保持数据库版本不变；
2. 暂停 Scheduler Worker；
3. 回退应用镜像；
4. 管理后台临时使用手动刷新；
5. 不得通过启用 Mock Redis 绕过生产依赖检查。

Redis 广播频道不保存业务数据，回退时无需清理数据库。分布式锁键带有 TTL，Worker 停止后会自动过期。
