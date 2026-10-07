# 2026-10-07 定时空间状态与近期两端改动全面核对

## 结果和使用方式

小程序“功能房管理 → 空间管理详情 → 调整状态”和网页“功能房 → 调整状态”均提供长期（全部时间段）和定时调整。定时安排使用日期、时间及状态选择器，支持开放、关闭、维护、联系辅导员预约，可查看和取消安排。相邻安排允许，重叠安排拒绝；结束时恢复最新长期状态，期间修改长期状态不会在到期时被旧状态覆盖。已有预约不会自动取消，管理员可继续进入预约记录处理。

状态按当前时间读取，预约按所选日期和完整起止区间校验，既覆盖新建、修改，也覆盖组团加入；跨入关闭、维护或辅导员预约时段的系统预约拒绝。临时开放须覆盖完整预约区间。学生可查看未来临时开放日历，卡片保留当前状态。D128党团活动室仍只联系辅导员，不因临时开放而允许系统预约。时段安排是查看已有使用情况；修改状态在“调整状态”进行，已有预约的审核、取消在“预约记录”进行。

## 近期改动核对范围

范围包含当前工作区相对最近提交 a3e412f 的全部近期改动，并结合本日五份交付、信用和全面检查记录核对，没有仅检查本轮页面。下列各项均核对网页对应页面、共用服务与回归入口；特定客户端才有的交互按相同权限和业务结果对照，不强行增加无关页面。

| 功能 | 小程序 / 服务 | 网页对应 | 检查内容及结果 |
|---|---|---|---|
| 角色、层级与菜单 | role-model、admin-policy、auth、admin-home/manage/profile、admin-scan | adminRoutes、adminRolePolicy、Layout、Verification | 会长团和宿管入口隔离、操作后留在自身流程、直接访问拦截、切换账号菜单重建；通过 |
| 现场核验与宿管 | verificationPolicy/Repository、checkinWindowPolicy、dorm 页面 | Checkin/Verification、Manage | 本人确认、楼栋范围、重复和并发提交、异常回滚、签到窗口、通知访问；通过 |
| 普通/辅导员/组团审核 | 审核页、approval 服务、group 服务 | ReviewQueue、CounselorPending、Group/PendingList | 队列、详情、原因、权限、人数、重复提交与状态终结；通过 |
| 预约规则与占用 | dailyPolicy、roomBookingPolicy、command/mutation/group 服务、学生时间线 | Room/RulesConfig、Monitor、预约查询 | 同类日期次数、跨房间冲突、相邻时段、团队独占、实际人数共享容量、D128、取消释放、修改排除自身；通过 |
| 定时状态和未来可用性 | roomStatusSchedule、roomController、adminController、room-detail、room-card | Room/Manage、Monitor、roomTimeline | 保存、当前生效、到期恢复、未来时段、相邻与重叠、临时开放、筛选计数和权限；通过 |
| 信用与登录 | creditBookingPolicy、creditService、auth/socket、credit-detail/admin-credit | Credit/ScoreConfig、Blacklist、Violations、Account/Index | 0分保留、实际变化与历史快照、低分登录、四区间预约权限、搜索筛选、详情和设置、旧记录解除；通过 |
| 通知与提醒 | notificationPresenter、adminNotification、danceGroupNotification、scheduler | Layout消息中心、相关审核和监控页 | 消息分类、开始/结束提醒、团队占用与解除、防重、账号范围、刷新；本地检查通过 |
| 宿生和账号管理 | admin-users、账号导入服务、adminNamePresenter | Account/Index、accountImport | 中文状态、默认管理员称呼、零分、导入字段和角色隔离；通过 |
| 海报、反馈与公告 | admin-poster/feedback、app-dialog、rules presenters | Poster/PendingList、Feedback、规则配置/公告 | 真实图片字段、缺图提示、详情、空白理由与常用项、结构化规则、保留完整说明；通过 |
| 菜单与页面状态 | 页面请求防旧账号数据覆盖、统一按钮样式 | Layout、navigationState、latestRequest、AsyncState | 账号切换、关闭旧菜单实例问题、加载/失败/空状态、按钮层级；通过 |
| 隐私、安全、运行维护 | 头像、身份、补签、outbox、审计、备份相关改动 | 账号、日志、备份入口 | 现有本地回归通过；真实数据库/缓存专项另列未验证 |

本轮同步纠正 docs/reservation-policy-20261006.md 中“低信用分限制7天/封禁30天”的旧说明。信用不限制登录，仅限制预约日期、次数、时段；人工账号停用仍单独管理。

## 本轮涉及文件与逻辑

- server/src/services/roomStatusSchedule.js：统一解析、验证定时安排；计算当前状态和预约区间是否完整可用。
- server/src/services/roomBookingPolicy.js：预约类型规则与定时状态同时校验，输出长期、当前状态和安排列表。
- server/src/services/reservationCommandService.js、reservationService.js、reservationMutationService.js、reservationGroupService.js：新建、修改及新成员入口统一校验，不再按当前一刻状态拒绝未来临时开放。
- server/src/controllers/adminController.js：保存定时安排，当前有效状态筛选后再分页，监控时段反映关闭状态，保留原有会长团写权限。
- server/src/controllers/roomController.js：学生列表、详情和时段使用有效状态；半小时时段与定时关闭部分重叠也不可选。
- server/src/config/mock-db.js：更新赋值使用现有带引号列表解析，避免JSON/设施中的逗号导致保存截断。
- server/sql/schema.sql、server/sql/migrations/20261007_room_status_schedules.sql：持久保存定时安排的字段及现有数据库升级文件。
- miniapp/pages/admin-room-detail/：长期/定时调整、日期时间选择、安排展示与取消。
- miniapp/components/app-dialog/：补充日期及下拉状态选择，保留时间选择、加载和错误状态。
- miniapp/utils/room-booking-policy.js、miniapp/components/room-card/room-card.js：未来开放日历入口与当前状态显示分开，保留党团活动室限制。
- admin/src/views/Room/Manage.vue：长期/定时选择、起止日期时间、安排与取消；编辑基础信息时使用长期状态，避免把临时状态误存为长期状态。
- admin/src/views/Room/Monitor.vue、admin/src/utils/roomTimeline.js：不可预约时段的文字、颜色同步。
- admin/src/components/__tests__/Layout.spec.js：更新近期账号切换菜单重建的正确预期，避免要求关闭上一实例的菜单项。
- scripts/room-status-schedule-check.js、room-status-schedule-api-check.js：定时边界、恢复、日期对象、未来预约、两端读取、筛选和权限专项。

## 验证证据

最终完整回归结果见 .runlogs 中最新 comprehensive 目录的 results.json。回归采用独立数据和端口，未把运行中的学生账号重置为测试信用分。

已在真实微信开发者工具执行管理员体验检查、新增长期/定时表单检查、六个房间入口检查和学生自习室/单房/组团预约选择检查，均通过，没有运行异常。截图与报告在 .artifacts/admin-mobile、room-entry、timeline-layout。

已用独立浏览器测试账号登录网页后台，实际点击调整状态、两种模式、起止时间选择器；日期面板显示开始/结束日期和时间，未发现页面运行错误。网页构建与菜单布局测试通过。

真实 MySQL 升级和外部数据库/缓存专项未验证。本机服务仍使用非生产模拟数据库；新增字段的真实部署必须先备份、执行升级SQL，再在专用数据库验证。现有宿管页面及其工作台跳转未改，原核验全流程回归通过。本次未修改 config.toml。

### 最终执行记录

- 完整回归：.runlogs/comprehensive-2026-10-07T09-48-29-444Z/results.json；96个入口，85通过、10未验证、1部分验证、0失败。
- 后续仅补充“不可预约”与“维护”文案的区分检查，admin-monitor-account-navigation-check.mjs 通过；定时状态接口专项再次通过。
- 10个未验证入口中的房间入口、学生时间线已单独在实际开发者工具验证通过，剩余8个需专用MySQL/Redis环境；部分验证项65个本地用例通过，实际数据库迁移未执行。
- 管理员体验与新状态表单的实际页面检查通过，0运行异常。网页定时模式、日期时间面板实测通过，无页面错误；最终网页构建及Layout布局测试通过。
- 新定时状态规则、未来开放前端规则、监控及组团检查通过，语法和变更格式检查通过。
- 本地后台已重启以加载最终代码，定时任务仍开启。状态到期恢复采用读取时计算，不依赖某次定时任务是否准时执行，服务重启也不会覆盖长期状态。
