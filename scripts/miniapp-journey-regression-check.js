const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const errors = []

function read(relPath) { return fs.readFileSync(path.join(root, relPath), 'utf8') }
function fail(message) { errors.push(message) }
function mustContain(content, pattern, message) { if (!pattern.test(content)) fail(message) }
function mustNotContain(content, pattern, message) { if (pattern.test(content)) fail(message) }

const loginWxml = read('miniapp/pages/login/login.wxml')
const requestJs = read('miniapp/utils/request.js')
const profileEditJs = read('miniapp/pages/profile-edit/profile-edit.js')
const adminUsersJs = read('miniapp/pages/admin-users/admin-users.js')
const adminUsersWxml = read('miniapp/pages/admin-users/admin-users.wxml')
const adminStatsJs = read('miniapp/pages/admin-stats/admin-stats.js')
const adminStatsWxml = read('miniapp/pages/admin-stats/admin-stats.wxml')
const adminManageJs = read('miniapp/pages/admin-manage/admin-manage.js')
const adminProfileJs = read('miniapp/pages/admin-profile/admin-profile.js')
const groupReserveJs = read('miniapp/pages/group-reserve/group-reserve.js')
const groupReserveWxml = read('miniapp/pages/group-reserve/group-reserve.wxml')
const reservationConfirmWxml = read('miniapp/pages/reservation-confirm/reservation-confirm.wxml')

mustContain(loginWxml, /宿生账号为学号，密码为6位一卡通号/, '登录页应明确说明宿生账号与 6 位一卡通号规则')
mustNotContain(loginWxml, /测试账号|服务器地址|127\.0\.0\.1|localhost|http:\/\//, '登录页不得暴露测试账号、服务器地址或明文接口')
mustContain(requestJs, /wx\.uploadFile/, '请求工具应提供认证文件上传能力')
mustContain(requestJs, /upload: upload/, '请求工具应导出上传方法')

mustContain(profileEditJs, /function isValidEmail/, '个人资料编辑页应保留邮箱格式校验函数')
mustContain(profileEditJs, /邮箱格式不正确/, '个人资料编辑页应对错误邮箱给出用户可理解提示')
mustContain(profileEditJs, /request\.put\('\/user\/profile'/, '个人资料编辑页应通过用户资料接口保存')

mustContain(adminUsersJs, /onAddUser/, '宿生管理应提供手动添加宿生入口')
mustContain(adminUsersJs, /submitAddUser/, '宿生管理应提供手动添加宿生提交逻辑')
mustContain(adminUsersJs, /request\.post\('\/user\/list'/, '宿生管理新增宿生应调用新增宿生接口')
mustContain(adminUsersJs, /request\.post\('\/user\/list\/import'/, '宿生管理应保留批量导入能力')
mustContain(adminUsersJs, /request\.upload\('\/user\/list\/import-file'/, '宿生管理应通过上传接口导入 xlsx 文件')
mustContain(adminUsersJs, /extension: \['xlsx', 'xls', 'csv', 'txt'\]/, '宿生管理选择文件应支持 xlsx')
mustContain(adminUsersWxml, /手动添加宿生/, '宿生管理弹窗标题应明确为手动添加宿生')
mustContain(adminUsersWxml, /{{submittingAdd \? '保存中\.\.\.' : \(formMode === 'edit' \? '保存修改' : '确认添加'\)}}/, '宿生管理添加按钮应有保存中状态，防止重复提交')
mustContain(adminUsersWxml, /导出Excel/, '宿生管理应提供 Excel 文件导出入口')
mustContain(adminUsersWxml, /\.xlsx\/\.xls\/\.csv/, '宿生管理导入说明应明确支持 xlsx 文件')

mustContain(adminStatsJs, /filters: \{ startDate:/, '数据统计页应提供筛选条件状态')
mustContain(adminStatsJs, /request\.get\('\/stats\/export'/, '数据统计页应通过统计导出接口获取数据')
mustContain(adminStatsJs, /filterRows\(data\.rows \|\| \[\], filters\)/, '数据统计导出前应按当前筛选条件过滤')
mustContain(adminStatsJs, /writeAndOpenExcel/, '数据统计页应生成可打开的 Excel 文件')
mustContain(adminStatsWxml, /按筛选导出/, '数据统计页应提供按筛选导出按钮')
mustContain(adminStatsWxml, /onStartDateChange/, '数据统计页应提供开始日期筛选')
mustContain(adminStatsWxml, /onEndDateChange/, '数据统计页应提供结束日期筛选')
mustContain(adminStatsWxml, /onStatusChange/, '数据统计页应提供预约状态筛选')

mustContain(adminManageJs, /title: '工作台与统计'/, '管理员管理中心应按工作台分组，而不是无结构功能列表')
mustContain(adminManageJs, /title: '预约与空间'/, '管理员管理中心应包含预约与空间分组')
mustContain(adminManageJs, /title: '宿生与信用'/, '管理员管理中心应包含宿生与信用分组')
mustContain(adminManageJs, /title: '运营发布'/, '管理员管理中心应包含运营发布分组')
mustContain(adminProfileJs, /key: 'network'/, '管理员我的页应保留安全的连接状态入口')
mustNotContain(adminProfileJs, /127\.0\.0\.1|localhost|服务器地址|API地址|测试账号/, '管理员我的页不得暴露服务器地址、API 地址或测试账号')

mustContain(groupReserveJs, /members \|\| \[\]\)\.length < 2/, '组团预约提交前应在前端拦截少于 2 人的情况')
mustContain(groupReserveJs, /成员将不能再退出/, '组团正式提交确认弹窗应提示提交后成员不能退出')
mustContain(groupReserveJs, /submitting \|\| !this\.data\.groupId/, '组团提交应有重复提交保护')
mustContain(groupReserveJs, /submit-reservation/, '组团预约应调用正式提交预约接口')
mustContain(groupReserveWxml, /确认参与/, '被邀请成员应能确认参与团队预约')
mustContain(groupReserveWxml, /查看预约单/, '组团提交后应提供查看预约单入口')
mustContain(groupReserveWxml, /!\(group\.reservationId \|\| group\.reservation_id\)/, '组团提交后应隐藏邀请、退出或取消入口')
mustContain(groupReserveWxml, /group\.canSubmitReservation/, '组团提交按钮应由后端返回的 canSubmitReservation 控制')

mustContain(reservationConfirmWxml, /required-star/, '预约确认页应展示必填标识')
mustContain(reservationConfirmWxml, /发起成员确认/, '多人功能房预约应在预约确认页发起成员确认')
mustContain(reservationConfirmWxml, /teamMembers/, '多人功能房预约应填写成员学号和姓名')
mustContain(reservationConfirmWxml, /btn-disabled/, '预约确认页提交中应进入禁用样式，防止重复点击')

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('miniapp-journey-regression-check passed')
