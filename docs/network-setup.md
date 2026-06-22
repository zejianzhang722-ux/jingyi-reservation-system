# 网络设置说明

## 本机开发

1. 启动后端：`cd server && npm run dev`
2. 启动后台：`cd admin && npm run dev`
3. 后台默认访问：`http://localhost:5173`
4. 后端默认接口：`http://127.0.0.1:3000/api/v1`

后台开发代理读取 `admin/.env`：

```text
VITE_API_BASE_URL=/api/v1
VITE_DEV_API_TARGET=http://127.0.0.1:3000
```

## 小程序真机调试

1. 确认手机和电脑在同一个局域网。
2. 查询电脑局域网 IP，例如 `192.168.1.8`。
3. 在小程序“我的 -> 网络设置”中填写电脑 IP 和端口 `3000`。
4. 点击“测试连接”，看到“连接正常”后再调试预约流程。

如果连接失败，优先检查：

- 后端是否已启动。
- Windows 防火墙是否允许 Node.js 被局域网访问。
- 手机和电脑是否在同一网络。
- 小程序开发者工具是否允许不校验合法域名。

## 正式部署

正式上线后需要准备 HTTPS 域名，并把以下位置改为真实地址：

- 小程序“网络设置”中的完整接口地址，例如 `https://api.example.edu.cn/api/v1`。
- 服务端 `.env` 中的 `BASE_URL`。
- 服务端 `.env` 中的 `CORS_ORIGINS`，加入后台正式域名。
- 后台 `.env.production` 中的 `VITE_API_BASE_URL`。

不要把密钥、正式数据库密码或微信密钥写入仓库。
