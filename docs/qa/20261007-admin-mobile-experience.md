# 管理端移动页面与电脑后台同步修复

## 已处理的问题

- 功能房列表使用搜索框、分类与状态下拉，覆盖实际空间类型。D128 显示“联系辅导员预约”。房间卡片进入管理员空间详情，预约记录仍进入管理员流程。
- 新增管理员空间详情，提供预约记录、今日时段安排、信息编辑和状态调整。时段安排只读，明确标注；编辑开放、关闭时间采用时间选择器。普通管理员只读，会长团可配置，服务端继续校验角色。
- 状态支持开放、关闭、维护、联系辅导员预约。D128 关闭/维护时正确显示对应状态，再开放仍按辅导员预约规则执行。两端筛选使用同一服务端结果；新增房间也正确保存所选状态。
- 宿生状态显示中文，信用分为 0 时不会显示成 100。
- 信用管理补充姓名/学号搜索、违规类型和信用区间筛选、信用详情、调整分数及填写原因。低于 80 分的预约权限变化均可查询；旧限制只清理旧记录，不重置当前信用权限。
- 信用调整记录保存实际分数变化，在事务内锁定当前分数后设置目标分，继续执行预约日期、次数、时段限制，不增加信用封禁登录处理。新详情与设置接口仅辅导员、会长团可使用。
- 海报审核增加申请详情和实际上传图片的预览；测试申请没有上传图片时明确显示“未上传”，不生成虚假海报。拒绝理由采用常用原因下拉与空白输入框。
- 统一管理页弹窗、按钮与填写状态，信用规则及预约制度按标题、段落、要点排版，保留全部原规则。仍保留预约制度阅读计时、滚动及勾选要求。
- 电脑后台同步房间时段设置、完整分类、信用查询/详情/设置、海报图片/详情/常用拒绝理由；修正接口返回字段与页面字段不对应造成的空白显示。违规创建先查找明确学号，再提交实际用户与扣分值。
- 修复电脑后台菜单在角色/登录状态变化后访问已经卸载菜单的问题。

## 主要文件

| 范围 | 文件 |
| --- | --- |
| 移动房间管理 | `miniapp/pages/admin-rooms/*`、`miniapp/pages/admin-room-detail/*`、`miniapp/pages/admin-reservation/*`、`miniapp/app.json` |
| 移动宿生、信用、海报 | `miniapp/pages/admin-users/*`、`miniapp/pages/admin-credit/*`、`miniapp/pages/admin-poster/*` |
| 弹窗与规则排版 | `miniapp/components/app-dialog/*`、`miniapp/utils/dialog.js`、`credit-rules-presenter.js`、`rules-presenter.js`、`miniapp/styles/admin-management.wxss`、`rules-content.wxss` |
| 使用共享弹窗的页面 | `admin-home`、`admin-reservation`、`admin-reservation-detail`、`admin-profile`、`admin-feedback`、`credit-detail`；预约制度涉及 `study-room`、`room-timeline`、`rules` |
| 电脑后台 | `admin/src/views/Room/Manage.vue`、`Credit/Blacklist.vue`、`Credit/Violations.vue`、`Poster/PendingList.vue`、`Account/Index.vue`、`admin/src/api/credit.js`、`utils/managementPresenter.js`、`components/Layout.vue`、`utils/navigationState.js` |
| 服务端 | `server/src/controllers/adminController.js`、`creditController.js`、`server/src/routes/credit.js`、`server/src/services/creditService.js`、`roomBookingPolicy.js`；移动展示同步 `miniapp/utils/room-booking-policy.js` |
| 回归检查 | `scripts/admin-experience-api-check.js`、`mobile-admin-experience-check.js`、`admin-management-presenter-check.mjs`、`admin-experience-runtime.cjs`；现有房间初始化检查补充新的规则排版依赖，信用检查固定测试时钟避免下午过期 |

## 验证记录

- 完整检查：94 个脚本，83 通过、1 部分通过、10 项需要独立真实环境或开发者工具会话，0 失败。结果：`.runlogs/comprehensive-2026-10-07T08-32-15-950Z/results.json`。部分通过项的 65 条模拟服务断言均通过，仅真实数据库迁移未验证。
- 电脑后台生产构建通过。现有依赖注释及构建包体积提示不阻断构建。
- 微信开发者工具实际运行：房间下拉、D128 状态、卡片跳转、编辑时间选择器、只读时段、中文宿生状态、信用搜索/详情/设置、海报详情与拒绝弹窗、分段信用规则及预约制度；普通管理员无法打开空间编辑。0 运行异常。截图及报告：`.artifacts/admin-mobile/`。
- 电脑后台浏览器实际检查：房间编辑开放时段、信用区间筛选及宿生数据、信用详情与设置表单、海报详情及常用拒绝理由。未通过界面更改真实业务分数或审核结果；写入由独立数据环境测试验证。
- 会长团、普通管理员、学生的接口权限边界、零分仍可登录、房间状态及时间保存/校验已在独立环境验证。宿管核验与楼栋权限、管理员扫码留在本账号流程的既有回归检查通过。
- 本地后台已加载最终修改，保留原有定时任务流程。
- 开发者工具另行补跑房间入口检查：6 个入口、12 次真实请求均成功，无错误提示；报告 `.artifacts/room-entry/report.json`。因此完整检查中标为需要会话的房间入口项已另行实测通过。
- 使用学生测试账号另行补跑时段界面检查：自习室、通用座位、组团房间三种页面均通过，包含制度阅读、日期选择、固定表头/座位列、滚动范围、时间弹层及进入确认页；未提交预约。报告 `.artifacts/timeline-layout/report.json`。完整检查中两个开发者工具项目均已补测，合计 85 项验证通过，剩余 8 项真实数据库/缓存专项未验证、1 项部分通过。
