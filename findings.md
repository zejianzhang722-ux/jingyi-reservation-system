# Findings

## Research Log
| Date | Source | Key Finding |
|------|--------|-------------|
| 2026-05-20 | profile.js:65 | editProfile跳转到`/pages/login/login?mode=edit`，login页没有edit模式处理 |
| 2026-05-20 | index.wxml:47 | 分类图标使用`category-icon-emoji`类显示emoji，真机可能渲染为方块 |
| 2026-05-20 | local-data.js:32-36 | emojiMap定义了12个分类emoji，但categories数据从API获取时没有emoji字段 |
| 2026-05-20 | study-room.js:240 | updateTimeDisplay中`startM < 10 ? '0' : ''`，当startM=0时显示"H:00"正确，但startH未补零 |
| 2026-05-20 | study-room.js:207-208 | startHourList格式为`i + ':00'`，如`8:00`而非`08:00` |
| 2026-05-20 | admin后端 | 无feedback路由，无feedback controller |
| 2026-05-20 | admin前端 | 无feedback管理页面 |
| 2026-05-20 | miniapp | 管理员登录后与宿生共享同一界面，无角色区分 |
| 2026-05-20 | auth.js | 仅有isLoggedIn/getToken/getUserInfo，无角色判断 |

## 问题详细分析

### 问题① 个人信息编辑跳转登录页
- profile.js:65 → `wx.navigateTo({ url: '/pages/login/login?mode=edit' })`
- login.js没有处理`mode=edit`参数
- 需要创建独立的profile-edit页面

### 问题② 首页图标变纯色方块
- index.wxml:47 使用`category-icon-emoji`类显示emoji
- 真机上某些emoji可能无法正常渲染
- API返回的categories没有emoji字段，本地categories有emoji但被API数据覆盖
- index.js:83-91 loadCategories从API获取数据时没有保留emoji字段

### 问题③ 时间格式错误
- study-room.js:240 `startStr = startH + ':' + (startM < 10 ? '0' : '') + startM`
- startH未补零：8显示为"8:00"而非"08:00"
- startHourList格式：`8:00`而非`08:00`
- picker显示的值格式不统一

### 问题④ 管理员界面
- 当前管理员登录后看到与宿生完全相同的界面
- 需要根据角色显示不同的TabBar和功能
- 管理员需要：审批管理、预约管理、用户管理、反馈查看

### 问题⑤ 反馈管理后台
- 小程序feedback.js调用`POST /feedback`但后端无此路由
- 管理后台无反馈管理页面
- 需要创建：后端feedback路由+controller，管理后台FeedbackView.vue

### 问题⑥ 角色权限
- 当前API无角色校验
- 需要区分：student/admin/super_admin/counselor
- 管理员API需要角色中间件保护
