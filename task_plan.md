# Task Plan

## Goal
修复真机调试发现的6个问题：①个人信息编辑跳转登录页 ②首页图标变纯色方块 ③时间线时间格式错误 ④管理员界面需独立 ⑤反馈管理后台缺失 ⑥角色权限区分

## Phases
| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | complete | 真机登录修复（platform自动检测） |
| Phase 2 | in_progress | 修复6个真机调试问题 |
| Phase 3 | not_started | 全链路验证 |

## Current Phase
Phase 2: 修复6个真机调试问题
Status: in_progress

## Decisions Made
| Date | Decision | Reason |
|------|----------|--------|
| 2026-05-20 | 问题①：创建独立的profile-edit页面 | 当前editProfile跳转到login页，需创建专用编辑页 |
| 2026-05-20 | 问题②：emoji图标在真机可能不显示 | 改用文字+彩色背景圆圈替代emoji |
| 2026-05-20 | 问题③：时间格式化缺少补零 | startM/endMin为0时显示"H:0"而非"H:00" |
| 2026-05-20 | 问题④：管理员需独立TabBar | 根据角色动态切换TabBar和首页 |
| 2026-05-20 | 问题⑤：后端需反馈API+管理后台模块 | 当前后端无feedback路由 |
| 2026-05-20 | 问题⑥：角色权限中间件 | 需在API层增加角色校验 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| 真机登录失败 | 3 | platform自动检测localhost/LAN IP |
