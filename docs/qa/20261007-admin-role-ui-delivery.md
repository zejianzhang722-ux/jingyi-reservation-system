# 管理员扫码与按钮检查

本次保留其他业务改动，修复管理员角色与扫码入口，并接通统一按钮样式：

- `miniapp/utils/admin-policy.js`：能力校验先归一化角色，兼容 `superadmin` 和 `super_admin`，与工作台及页面校验一致。
- `miniapp/pages/admin-home/admin-home.js/wxml/wxss`：扫码入口按角色选择管理员扫码页；审批、详情和重试按钮接入统一样式，最低高度 88rpx；通过、拒绝和查看保持等宽间距。
- `miniapp/pages/admin-manage/admin-manage.js`：宿管回自身工作台；菜单展示和点击都按权限检查，扫码进入独立管理员页面。
- `miniapp/utils/auth.js`、`miniapp/utils/role-model.js`：账号角色统一归一化，工作台和扫码路径显式区分导生会、宿管和无权限账号。
- `miniapp/pages/admin-profile/admin-profile.js/wxml`、`miniapp/pages/profile/profile.js`：管理员个人页与宿管区分，避免串页；角色名称与账号信息弹窗一致。
- `miniapp/pages/admin-stats/admin-stats.js`：增加统计权限检查，阻止宿管直接进入统计页。
- `miniapp/app.json`：注册 `admin-scan`；`miniapp/app.wxss`：加载统一按钮样式和尺寸、颜色变量。
- `miniapp/styles/button.wxss`：修复原生按钮默认色覆盖主次按钮颜色的问题。
- `miniapp/pages/admin-reservation/admin-reservation.wxml`、`miniapp/pages/admin-reservation-detail/admin-reservation-detail.wxml`：审批提交时显示统一禁用及加载状态。
- `miniapp/pages/admin-scan/admin-scan.js`：进入、返回和核验操作前检查当前角色，账号切换后不能沿用旧页面提交。
- `miniapp/pages/admin-scan/admin-scan.wxss`：扫码页原生按钮统一间距、圆角、主次样式及禁用、加载状态；覆盖仅在管理员扫码页生效。
- `scripts/miniapp-role-model-check.js`：补充角色别名能力、各角色工作台及未知角色安全回落检查。
- `scripts/miniapp-role-gate-check.js`：修正角色模块函数调用，补充首页扫码路径和伪造菜单点击检查，共 89 项。
- `scripts/miniapp-scan-stay-check.js`：运行真实页面方法，模拟相机和接口，验证五种角色预览、确认成功及网络异常后均留在自身扫码页。
- `package.json`：增加 `npm run check:miniapp-admin-role`，统一执行上述角色和扫码检查。

## 已有修复的逻辑核对

`miniapp/utils/role-model.js` 根据角色推导层级和工作台：导生会管理层使用 `admin-home`、`admin-scan`，宿管使用 `verification`、`dorm-scan`。`auth.js`、`admin-home.js`、`admin-manage.js`、`admin-profile.js` 读取同一角色规则。`admin-scan.js` 只允许导生会管理层进入，复用核验方法，提交完成不执行页面跳转。`app.json` 已注册独立扫码页。

管理员页面已有 `miniapp/styles/button.wxss` 统一按钮样式，涉及首页、管理、预约列表及详情、房间、用户、信用、反馈、海报、统计和个人页。此次补齐首页小按钮及扫码页原生按钮。宿管能力仍只有 `scanCheckin`，未改宿管页面工厂、原始样式及签到接口。

## 2026-10-07 当前验证

通过：角色模型 53 项、页面门禁 89 项、五种角色扫码停留及账号切换检查、管理员小程序回归、UI 检查、页面转场检查、原扫码核验流程检查、后端权限边界检查、宿管后端完整核验检查。

页面门禁连续执行 10 次均通过且输出一致。全部已注册页面的配套文件、按钮样式变量和本次修改的 JavaScript 语法检查均通过。

未通过的扩大检查：

- `check:mobile`：学生张三登录信用分预期 80 不符。

前一轮失败的后端权限边界与宿管核验检查，本轮在暂停其他修改后的工作区均已通过。本轮未修改后端业务或认证规则。

已调用官方微信开发者工具 CLI，连接到本机 21033 端口，但打开项目时返回 `code 10：需要重新登录`。因此未完成官方预览编译及真机视觉验收；自动检查和模拟页面测试不能代替实际设备验收。未修改 Codex 的 config.toml。
