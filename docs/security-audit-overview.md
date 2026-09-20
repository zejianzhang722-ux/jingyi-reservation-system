# 三端未授权出入口与暴露面安全审查 — 概览

## 做了什么
对敬一书院预约系统三端（移动学生端、移动管理端、管理后台端）开展未预期暴露/未授权开放出入口审查。主理人逐文件核对 30+ 源码文件取证（后端入口/22路由/11中间件/27控制器、管理后台路由守卫、小程序网络层与登录层、Dockerfile、9个CI workflow），架构师基于证据做系统级暴露面定级。

## 关键结论
- 三端共识别 **29 项对外暴露入口**。
- **P1 经核实降为 P4**：refreshToken 漏洞在死代码中（实际 /refresh 路由用 tokenController.refresh，已安全 fail-closed+rotation），不可利用；死代码已改安全，建议删除。
- **P2 高危 4 项**：opsAuth 非生产全放行、mock 登录逃生阀未治理+mock-db 后门、小程序 mockLogin 假登录、network-settings 自定义后端地址（钓鱼）。
- **P3 中高危 2 项**：studentLogin 学号+6位卡号弱认证、network-settings 钓鱼入口。
- 已确认安全：WebSocket 鉴权、上传/备份防护、Dockerfile 规范、生产配置守卫主体、scheduler-worker 不监听端口。

## 交付文件
- `docs/security-audit-report.md` — 完整审查报告（暴露面总览表 + P1–P6 问题清单 + 架构加固建议 + 待复核事项）

## 建议下一步
1. P1-C1 经核实为死代码漏洞不可利用（实际 /refresh 路由用 tokenController.refresh 已安全）；最高优先转 P2 组（opsAuth fail-open / 逃生阀 / 移动端调试入口物理剔除）；
2. P2 组（opsAuth fail-closed / 逃生阀治理 / 移动端调试入口物理剔除）作为一批统一处理；
3. 完成报告"五、待主理人复核事项"6 项后再启动修复实现。
