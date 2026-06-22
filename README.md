# 敬一书院功能房预约系统

这是一个面向书院功能房管理的预约系统，包含微信小程序、网页管理后台和后端服务三部分。系统支持宿生预约功能房、查看预约与信用分，管理员审核预约、管理房间、处理反馈和查看统计数据。

## 项目组成

| 模块 | 路径 | 说明 |
| --- | --- | --- |
| 微信小程序 | `miniapp/` | 宿生端与小程序管理员端 |
| 管理后台 | `admin/` | Vue 3 + Element Plus 后台管理页面 |
| 后端服务 | `server/` | Node.js + Express 接口服务 |
| 项目文档 | `docs/` | 网络配置、测试方案、运维说明 |
| 检查脚本 | `scripts/` | 网络、测试数据、学生闭环和界面检查 |

## 主要功能

- 宿生端：登录、房间浏览、时间段预约、预约确认、我的预约、签到、凭证码、消息通知、信用分明细、反馈。
- 管理端：预约审核、功能房管理、宿生管理、信用管理、数据统计、公告管理、反馈处理。
- 网络配置：支持本机调试、局域网真机调试和未来正式环境配置。
- 测试数据：保留张三、李四两个宿生测试账号，并与后台数据保持同一套来源。

## 本地启动

首次运行请分别安装后端和管理后台依赖：

```bash
npm run install:all
```

启动后端服务：

```bash
npm run server
```

启动管理后台：

```bash
npm run admin
```

管理后台默认由 Vite 启动，常见访问地址为：

```text
http://127.0.0.1:5173
```

如果端口被占用，请以终端实际输出为准。

## 微信小程序打开方式

请使用微信开发者工具导入以下目录：

```text
D:\敬一书院\jingyi-reservation-system\miniapp
```

小程序项目配置文件位于：

```text
miniapp/project.config.json
```

当前 AppID：

```text
wxa83f083ceb601977
```

真机调试前请确认手机和电脑在同一网络，并根据 `docs/network-setup.md` 配置后端访问地址。

## 常用检查

检查网络配置：

```bash
npm run check:network
```

检查测试数据一致性：

```bash
npm run check:test-data
```

检查学生端预约闭环：

```bash
npm run check:student-loop
```

检查移动端关键问题：

```bash
npm run check:mobile
```

检查小程序管理员端：

```bash
npm run check:admin-miniapp
```

检查小程序界面清理情况：

```bash
npm run check:miniapp-ui
```

检查请求刷新和令牌处理：

```bash
npm run check:request-refresh
```

后端集成检查：

```bash
cd server
npm run test:integration
```

管理后台打包检查：

```bash
cd admin
npm run build
```

## 环境配置

后端环境变量模板：

```text
server/.env.example
```

管理后台环境变量模板：

```text
admin/.env.example
```

不要把正式密钥、账号密码、数据库密码或生产域名直接写进业务代码。正式部署前，请根据模板创建本地 `.env` 文件。

## GitHub 仓库

当前公开仓库：

```text
https://github.com/zejianzhang722-ux/jingyi-reservation-system
```

## 备注

- 不要随意修改 `config.toml`。
- 小程序正式界面不应展示测试账号、服务器地址、调试说明、模板 ID 或英文状态码。
- 真机调试失败时，优先检查后端是否启动、手机是否能访问电脑局域网地址、微信开发者工具是否打开了正确的 `miniapp/` 目录。
