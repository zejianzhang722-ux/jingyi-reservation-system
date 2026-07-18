const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const storage = {
  token: 'admin-token',
  userInfo: { id: 1, role: 'admin', name: '管理员' }
}
const navCalls = []
const toastCalls = []
let modalResponse = { confirm: true, content: '' }
let holdModal = false
let pendingModalSuccess = null

global.wx = {
  getStorageSync: function(key) { return storage[key] },
  setStorageSync: function(key, value) { storage[key] = value },
  removeStorageSync: function(key) { delete storage[key] },
  navigateTo: function(options) { navCalls.push({ type: 'navigateTo', url: options.url }) },
  redirectTo: function(options) { navCalls.push({ type: 'redirectTo', url: options.url }) },
  switchTab: function(options) { navCalls.push({ type: 'switchTab', url: options.url }) },
  reLaunch: function(options) { navCalls.push({ type: 'reLaunch', url: options.url }) },
  showToast: function(options) { toastCalls.push(options || {}) },
  showModal: function(options) {
    if (holdModal) {
      pendingModalSuccess = options && options.success
      return
    }
    if (options && options.success) options.success(modalResponse)
  },
  stopPullDownRefresh: function() {}
}
global.getApp = function() { return { globalData: {} } }

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadPage(relativePath) {
  let pageConfig = null
  global.Page = function(config) { pageConfig = config }
  const fullPath = path.join(root, relativePath)
  delete require.cache[require.resolve(fullPath)]
  require(fullPath)
  assert(pageConfig, relativePath + ' 未注册 Page')
  pageConfig.data = JSON.parse(JSON.stringify(pageConfig.data || {}))
  pageConfig.setData = function(next) {
    Object.keys(next).forEach(function(key) {
      const parts = key.split('.')
      let target = pageConfig.data
      for (let i = 0; i < parts.length - 1; i++) {
        target[parts[i]] = target[parts[i]] || {}
        target = target[parts[i]]
      }
      target[parts[parts.length - 1]] = next[key]
    })
  }
  return pageConfig
}

function loadComponent(relativePath) {
  let componentConfig = null
  global.Component = function(config) { componentConfig = config }
  const fullPath = path.join(root, relativePath)
  delete require.cache[require.resolve(fullPath)]
  require(fullPath)
  assert(componentConfig, relativePath + ' 未注册 Component')
  componentConfig.data = JSON.parse(JSON.stringify(componentConfig.data || {}))
  componentConfig.setData = function(next) {
    Object.keys(next).forEach(function(key) { componentConfig.data[key] = next[key] })
  }
  Object.keys(componentConfig.methods || {}).forEach(function(key) { componentConfig[key] = componentConfig.methods[key] })
  return componentConfig
}
function getManageKeysForRole(role) {
  storage.userInfo.role = role
  const page = loadPage('miniapp/pages/admin-manage/admin-manage.js')
  page.onLoad.call(page)
  return {
    page: page,
    keys: (page.data.groups || []).reduce(function(all, group) {
      return all.concat((group.items || []).map(function(item) { return item.key }))
    }, [])
  }
}

function assertIncludesAll(actual, expected, message) {
  expected.forEach(function(key) {
    assert(actual.indexOf(key) !== -1, message + ': ' + key)
  })
}

function assertExcludesAll(actual, expected, message) {
  expected.forEach(function(key) {
    assert(actual.indexOf(key) === -1, message + ': ' + key)
  })
}

function flushPromises() {
  return new Promise(function(resolve) { setImmediate(resolve) })
}

function deferred() {
  var resolve
  var reject
  var promise = new Promise(function(resolvePromise, rejectPromise) {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise: promise, resolve: resolve, reject: reject }
}

async function main() {
  const request = require('../miniapp/utils/request')
  const originalGet = request.get
  const calls = []
  request.get = function(url, params) {
    calls.push({ url: url, params: params || {} })
    return Promise.resolve([
      { id: 1, name: 'B228自习室', type: 'study_room', status: 'open' },
      { id: 6, name: 'B102共享空间', type: 'seminar_room', status: 'open' },
      { id: 11, name: 'C128影音室', type: 'media_room', status: 'open' },
      { id: 12, name: 'C310备赛间', type: 'competition_room', status: 'open' },
      { id: 13, name: 'B128路演空间', type: 'roadshow_space', status: 'open' },
      { id: 14, name: 'D127阅览室', type: 'reading_room', status: 'open' }
    ])
  }

  const roomsPage = loadPage('miniapp/pages/admin-rooms/admin-rooms.js')
  await roomsPage.onFilterType.call(roomsPage, { currentTarget: { dataset: { type: 'study' } } })
  assert(calls[calls.length - 1].params.type === 'study_room', '自习室筛选应请求后端 study_room 类型')
  await roomsPage.onFilterType.call(roomsPage, { currentTarget: { dataset: { type: 'shared' } } })
  assert(calls[calls.length - 1].params.type === 'seminar_room', '共享空间筛选应请求后端 seminar_room 类型')
  await roomsPage.onFilterType.call(roomsPage, { currentTarget: { dataset: { type: 'all-bookable' } } })
  assert(calls[calls.length - 1].params.type === undefined, '全部功能房筛选不应携带旧类型参数')

  request.get = originalGet

  const adminManage = getManageKeysForRole('admin')
  assertIncludesAll(adminManage.keys, ['pending', 'reservation', 'rooms', 'users', 'violations', 'stats'], '导生管理员移动菜单应包含')
  assertExcludesAll(adminManage.keys, ['counselorPending', 'poster', 'blacklist', 'feedback', 'announcement'], '导生管理员移动菜单不应包含')

  const counselorManage = getManageKeysForRole('counselor')
  assertIncludesAll(counselorManage.keys, ['pending', 'counselorPending', 'reservation', 'rooms', 'users', 'violations', 'blacklist', 'feedback', 'poster', 'stats'], '辅导员移动菜单应包含')
  assertExcludesAll(counselorManage.keys, ['announcement'], '辅导员移动菜单不应包含')

  const superAdminManage = getManageKeysForRole('super_admin')
  assertIncludesAll(superAdminManage.keys, ['pending', 'counselorPending', 'reservation', 'rooms', 'users', 'violations', 'blacklist', 'feedback', 'poster', 'stats'], '超级管理员移动菜单应包含现场业务入口')
  assertExcludesAll(superAdminManage.keys, ['announcement', 'accounts', 'backup', 'logs', 'config'], '超级管理员移动菜单不应包含电脑专属入口')

  const managePage = counselorManage.page
  assert(typeof managePage.goToStatsOverview === 'function', '管理页应提供数据统计入口')
  assert(typeof managePage.goToCreditManage === 'function', '管理页应提供信用管理入口')
  navCalls.length = 0
  managePage.onItemTap({ currentTarget: { dataset: { key: 'pending' } } })
  assert(navCalls[0] && navCalls[0].type === 'redirectTo' && navCalls[0].url === '/pages/admin-home/admin-home?queueType=admin', '普通审核入口应替换当前管理页并明确携带 admin 队列参数')
  navCalls.length = 0
  managePage.onItemTap({ currentTarget: { dataset: { key: 'counselorPending' } } })
  assert(navCalls[0] && navCalls[0].type === 'redirectTo' && navCalls[0].url === '/pages/admin-home/admin-home?queueType=counselor', '重点审核入口应替换当前管理页并明确携带 counselor 队列参数')
  navCalls.length = 0
  managePage.goToStatsOverview()
  assert(navCalls[0] && navCalls[0].url === '/pages/admin-stats/admin-stats', '数据统计应进入管理员统计页')
  navCalls.length = 0
  managePage.goToCreditManage()
  assert(navCalls[0] && navCalls[0].url === '/pages/admin-credit/admin-credit', '信用管理应进入管理员信用页')
  navCalls.length = 0
  managePage.onItemTap({ currentTarget: { dataset: { key: 'poster' } } })
  assert(navCalls[0] && navCalls[0].url === '/pages/admin-poster/admin-poster', '海报审核应进入预留海报审核页')
  navCalls.length = 0
  managePage.onItemTap({ currentTarget: { dataset: { key: 'violations' } } })
  assert(navCalls[0] && navCalls[0].url === '/pages/admin-credit/admin-credit?tab=violations', '违规记录应进入信用页对应标签')
  navCalls.length = 0
  managePage.onItemTap({ currentTarget: { dataset: { key: 'blacklist' } } })
  assert(navCalls[0] && navCalls[0].url === '/pages/admin-credit/admin-credit?tab=blacklist', '黑名单应进入信用页对应标签')

  const adminPolicy = require('../miniapp/utils/admin-policy')
  assert(adminPolicy.can('admin', 'ordinaryApproval'), '导生管理员应有普通审批能力')
  assert(!adminPolicy.can('admin', 'counselorApproval'), '导生管理员不应有辅导员重点审核能力')
  assert(adminPolicy.can('counselor', 'posterReview'), '辅导员应有海报审核能力')
  assert(adminPolicy.can('super_admin', 'posterReview'), '超级管理员应复用现场移动能力')
  assert(!adminPolicy.can('unknown', 'reservationView'), '未知角色不应获得移动管理能力')
  assert(adminPolicy.queueType('admin', 'counselor') === 'admin', '导生管理员不能切换到辅导员审批队列')
  assert(adminPolicy.queueType('counselor', 'counselor') === 'counselor', '辅导员可进入重点审核队列')
  assert(adminPolicy.queueType('super_admin', 'counselor') === 'counselor', '超级管理员可进入重点审核队列')
  assert(adminPolicy.defaultQueueType('admin') === 'admin', '导生管理员默认进入普通审核')
  assert(adminPolicy.defaultQueueType('counselor') === 'counselor', '辅导员默认进入重点审核')
  assert(adminPolicy.defaultQueueType('super_admin') === 'counselor', '超级管理员默认优先进入重点审核')
  assert(adminPolicy.canQuickApprove('admin', 'pending'), '导生管理员可快速处理普通待审')
  assert(!adminPolicy.canQuickApprove('counselor', 'counselor_pending'), '重点待审不得在卡片直接通过')

  const approvalPresenter = require('../miniapp/utils/admin-approval-presenter')
  const priorityCard = approvalPresenter.toCard({
    id: 5,
    user_name: '李四',
    student_id: '2024001002',
    room_name: 'C128影音室',
    room_type: 'media_room',
    building_id: 2,
    date: '2026-07-17',
    start_time: '14:00',
    end_time: '17:00',
    purpose: '观影活动',
    participants: 20,
    status: 'counselor_pending'
  })
  assert(priorityCard.id === 5, '审批卡应保留预约编号')
  assert(priorityCard.userName === '李四' && priorityCard.studentId === '2024001002', '审批卡应统一姓名和学号')
  assert(priorityCard.roomName === 'C128影音室', '审批卡应统一房间名称')
  assert(priorityCard.roomTypeLabel === '影音室' && priorityCard.buildingLabel === 'C座', '审批卡应显示空间类型和楼栋')
  assert(priorityCard.date === '2026-07-17' && priorityCard.timeSlot === '14:00-17:00', '审批卡应统一日期和时间段')
  assert(priorityCard.purpose === '观影活动' && priorityCard.participants === 20, '审批卡应统一用途和参与人数')
  assert(priorityCard.status === 'counselor_pending', '审批卡应保留审核状态')
  assert(priorityCard.queueLabel === '重点待审' && priorityCard.isPriority, '重点预约应有文字标签')

  const detailAppJson = require('../miniapp/app.json')
  assert(detailAppJson.pages.indexOf('pages/admin-reservation-detail/admin-reservation-detail') !== -1, 'app.json 应注册管理员预约详情页')
  const adminReservationDetailWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-reservation-detail/admin-reservation-detail.wxml'), 'utf8')
  assert(adminReservationDetailWxml.indexOf('信用分') !== -1, '管理员预约详情页应展示申请人信用分')
  assert(adminReservationDetailWxml.indexOf('我的预约') === -1, '管理员预约详情页不得出现学生端“我的预约”入口')
  assert(adminReservationDetailWxml.indexOf('取消预约') === -1, '管理员预约详情页不得出现学生端取消预约动作')

  const ordinaryCard = approvalPresenter.toCard({
    id: '6',
    userName: '王五',
    studentId: '2024001003',
    roomName: 'B228自习室',
    roomType: 'study_room',
    buildingId: 1,
    date: '2026-07-18',
    startTime: '09:00',
    endTime: '10:00',
    participantCount: '2',
    status: 'pending'
  })
  assert(ordinaryCard.id === 6 && ordinaryCard.userName === '王五' && ordinaryCard.studentId === '2024001003', '审批卡应兼容驼峰字段')
  assert(ordinaryCard.roomName === 'B228自习室' && ordinaryCard.roomTypeLabel === '自习室' && ordinaryCard.buildingLabel === 'B座', '审批卡应兼容驼峰空间字段')
  assert(ordinaryCard.date === '2026-07-18' && ordinaryCard.timeSlot === '09:00-10:00', '审批卡应兼容驼峰时间字段')
  assert(ordinaryCard.purpose === '用途未填写' && ordinaryCard.participants === 2, '审批卡应兼容驼峰人数并补齐用途')
  assert(ordinaryCard.status === 'pending' && !ordinaryCard.isPriority && ordinaryCard.queueLabel === '普通待审', '普通预约应有普通待审标签')

  const snakeCaseTimeSlotCard = approvalPresenter.toCard({ time_slot: '18:00-20:00' })
  assert(snakeCaseTimeSlotCard.timeSlot === '18:00-20:00', '审批卡应兼容蛇形时间段字段')

  const fallbackCard = approvalPresenter.toCard({})
  assert(fallbackCard.userName === '姓名未提供' && fallbackCard.studentId === '学号未提供', '审批卡应补齐姓名和学号缺省值')
  assert(fallbackCard.roomName === '房间未提供' && fallbackCard.roomTypeLabel === '其他空间' && fallbackCard.buildingLabel === '全院', '审批卡应补齐空间缺省值')
  assert(fallbackCard.purpose === '用途未填写' && fallbackCard.participants === 0, '审批卡应补齐用途和人数缺省值')
  assert(fallbackCard.queueLabel === '普通待审' && !fallbackCard.isPriority, '缺省状态应按普通待审展示')

  const originalPost = request.post
  const originalPut = request.put
  const originalDelete = request.delete
  const capabilityCalls = []
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    if (url === '/user/list') return Promise.resolve([])
    if (url === '/room') return Promise.resolve([])
    if (url === '/feedback') return Promise.resolve({ list: [] })
    return Promise.resolve([])
  }
  request.put = function(url, body) {
    capabilityCalls.push({ method: 'PUT', url: url, body: body || {} })
    return Promise.resolve({})
  }
  request.post = function(url, body) {
    capabilityCalls.push({ method: 'POST', url: url, body: body || {} })
    return Promise.resolve({})
  }
  request.delete = function(url) {
    capabilityCalls.push({ method: 'DELETE', url: url })
    return Promise.resolve({})
  }

  storage.userInfo.role = 'admin'
  capabilityCalls.length = 0
  let creditPage = loadPage('miniapp/pages/admin-credit/admin-credit.js')
  creditPage.onLoad.call(creditPage, { tab: 'blacklist' })
  await flushPromises()
  assert(creditPage.data.tabs.map(function(tab) { return tab.key }).join(',') === 'violations', '导生管理员信用页只能显示违规记录')
  assert(creditPage.data.activeTab === 'violations', '导生管理员通过旧链接进入黑名单时应回退到违规记录')
  assert(capabilityCalls.some(function(call) { return call.method === 'GET' && call.url === '/credit/violations' }), '导生管理员信用页应加载违规记录')
  assert(!capabilityCalls.some(function(call) { return call.url === '/credit/blacklist' }), '导生管理员不得通过旧链接请求黑名单')
  creditPage.onUnban.call(creditPage, { currentTarget: { dataset: { id: 1 } } })
  await flushPromises()
  assert(!capabilityCalls.some(function(call) { return call.method === 'PUT' && call.url === '/credit/blacklist/1' }), '导生管理员直接调用解除黑名单也不得发请求')

  ;['counselor', 'super_admin'].forEach(function(role) {
    storage.userInfo.role = role
    capabilityCalls.length = 0
    creditPage = loadPage('miniapp/pages/admin-credit/admin-credit.js')
    creditPage.onLoad.call(creditPage, { tab: 'blacklist' })
    assert(creditPage.data.tabs.map(function(tab) { return tab.key }).join(',') === 'violations,blacklist', role + ' 信用页应精确显示违规记录和黑名单')
    assert(creditPage.data.activeTab === 'blacklist', role + ' 应能通过旧链接进入黑名单')
    assert(capabilityCalls.some(function(call) { return call.method === 'GET' && call.url === '/credit/blacklist' }), role + ' 进入黑名单时应加载黑名单')
  })
  const creditWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-credit/admin-credit.wxml'), 'utf8')
  assert(creditWxml.indexOf("activeTab === 'config'") === -1 && creditWxml.indexOf('信用配置') === -1, '信用页移动端不应出现配置标签或内容')

  const usersWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-users/admin-users.wxml'), 'utf8')
  ;['admin', 'counselor', 'super_admin'].forEach(function(role) {
    storage.userInfo.role = role
    capabilityCalls.length = 0
    toastCalls.length = 0
    var usersPage = loadPage('miniapp/pages/admin-users/admin-users.js')
    usersPage.onLoad.call(usersPage)
    assert(usersPage.data.canManageStudents === false, role + ' 移动端宿生页不得管理账号状态或调分')
    assert(!capabilityCalls.some(function(call) { return call.method === 'GET' && call.url === '/user/list' }), role + ' 宿生页 onLoad 只校验权限，不应重复读取')
    usersPage.onShow.call(usersPage)
    assert(capabilityCalls.some(function(call) { return call.method === 'GET' && call.url === '/user/list' }), role + ' 移动端宿生页仍应允许查看列表')
    assert(capabilityCalls.filter(function(call) { return call.method === 'GET' && call.url === '/user/list' }).length === 1, role + ' 宿生页首次 onLoad + onShow 只能读取一次')
    usersPage.onAdjustCredit.call(usersPage, { currentTarget: { dataset: { id: 1, score: 100 } } })
    usersPage.onToggleStatus.call(usersPage, { currentTarget: { dataset: { id: 1, nextStatus: 'banned', action: '停用' } } })
    assert(!capabilityCalls.some(function(call) { return call.url.indexOf('/student-ops/') === 0 }), role + ' 直接调用宿生管理操作也不得发请求')
    assert(toastCalls.some(function(call) { return call.title === '请在电脑后台处理此项功能' }), role + ' 宿生管理操作应提示前往电脑后台')
  })
  assert(usersWxml.indexOf('wx:if="{{canManageStudents}}"') !== -1, '宿生页操作区域应受移动端管理能力控制')

  storage.userInfo.role = 'admin'
  capabilityCalls.length = 0
  toastCalls.length = 0
  const roomsPageReadOnly = loadPage('miniapp/pages/admin-rooms/admin-rooms.js')
  roomsPageReadOnly.onLoad.call(roomsPageReadOnly)
  assert(roomsPageReadOnly.data.canConfigureRooms === false, '移动端功能房页应为只读')
  assert(!capabilityCalls.some(function(call) { return call.method === 'GET' && call.url === '/room' }), '功能房页 onLoad 只校验权限，不应重复读取')
  roomsPageReadOnly.onShow.call(roomsPageReadOnly)
  assert(capabilityCalls.some(function(call) { return call.method === 'GET' && call.url === '/room' }), '移动端功能房页仍应读取房间列表')
  assert(capabilityCalls.filter(function(call) { return call.method === 'GET' && call.url === '/room' }).length === 1, '功能房页首次 onLoad + onShow 只能读取一次')
  roomsPageReadOnly.onToggleStatus.call(roomsPageReadOnly, { currentTarget: { dataset: { id: 1, status: 'open' } } })
  assert(!capabilityCalls.some(function(call) { return call.url.indexOf('/admin/rooms/') === 0 }), '直接调用房间状态操作也不得发请求')
  assert(toastCalls.some(function(call) { return call.title === '请在电脑后台处理此项功能' }), '房间配置操作应提示前往电脑后台')
  const roomsWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-rooms/admin-rooms.wxml'), 'utf8')
  assert(roomsWxml.indexOf('bindtap="onToggleStatus"') === -1, '移动端功能房页不应渲染状态变更按钮')

  storage.userInfo.role = 'admin'
  capabilityCalls.length = 0
  toastCalls.length = 0
  navCalls.length = 0
  let feedbackPage = loadPage('miniapp/pages/admin-feedback/admin-feedback.js')
  feedbackPage.onLoad.call(feedbackPage)
  feedbackPage.setData({ replyId: 1, replyContent: '处理完成' })
  feedbackPage.submitReply.call(feedbackPage)
  feedbackPage.onResolve.call(feedbackPage, { currentTarget: { dataset: { id: 1 } } })
  assert(!capabilityCalls.some(function(call) { return call.url.indexOf('/feedback') === 0 }), '导生管理员直接进入或调用反馈处理均不得请求反馈接口')
  assert(toastCalls.some(function(call) { return call.title === '请在电脑后台处理此项功能' }), '导生管理员直接进入反馈页应提示前往电脑后台')
  assert(navCalls.some(function(call) { return call.type === 'reLaunch' && call.url === '/pages/admin-manage/admin-manage' }), '导生管理员直接进入反馈页应返回管理中心')

  ;['counselor', 'super_admin'].forEach(function(role) {
    storage.userInfo.role = role
    capabilityCalls.length = 0
    feedbackPage = loadPage('miniapp/pages/admin-feedback/admin-feedback.js')
    feedbackPage.onLoad.call(feedbackPage)
    assert(!capabilityCalls.some(function(call) { return call.method === 'GET' && call.url === '/feedback' }), role + ' 反馈页 onLoad 只校验权限，不应重复读取')
    feedbackPage.onShow.call(feedbackPage)
    feedbackPage.onResolve.call(feedbackPage, { currentTarget: { dataset: { id: 2 } } })
    assert(capabilityCalls.some(function(call) { return call.method === 'GET' && call.url === '/feedback' }), role + ' 应能加载反馈')
    assert(capabilityCalls.filter(function(call) { return call.method === 'GET' && call.url === '/feedback' }).length === 1, role + ' 反馈页首次 onLoad + onShow 只能读取一次')
    assert(capabilityCalls.some(function(call) { return call.method === 'PUT' && call.url === '/feedback/2/resolve' }), role + ' 应能处理反馈')
  })

  storage.userInfo.role = 'counselor'
  capabilityCalls.length = 0
  const staleBlacklist = deferred()
  request.get = function(url) {
    capabilityCalls.push({ method: 'GET', url: url, params: {} })
    if (url === '/credit/blacklist') return staleBlacklist.promise
    return Promise.resolve([])
  }
  creditPage = loadPage('miniapp/pages/admin-credit/admin-credit.js')
  creditPage.onLoad.call(creditPage, { tab: 'blacklist' })
  storage.userInfo.role = 'admin'
  assert(typeof creditPage.onShow === 'function', '信用页应在 onShow 重新同步当前角色能力')
  creditPage.onShow.call(creditPage)
  assert(creditPage.data.activeTab === 'violations', '信用页角色降级后 onShow 应立即回到违规记录')
  assert(creditPage.data.tabs.map(function(tab) { return tab.key }).join(',') === 'violations', '信用页角色降级后 onShow 应立即移除黑名单标签')
  assert(creditPage.data.blacklist.length === 0, '信用页角色降级后 onShow 应立即清空黑名单')
  staleBlacklist.resolve([{ id: 901, student_id: 'sensitive' }])
  await flushPromises()
  assert(creditPage.data.blacklist.length === 0, '角色降级后完成的旧黑名单请求不得回写')

  storage.userInfo.role = 'admin'
  const creditReads = [deferred(), deferred()]
  let creditReadIndex = 0
  request.get = function(url) {
    capabilityCalls.push({ method: 'GET', url: url, params: {} })
    if (url === '/credit/violations') return creditReads[creditReadIndex++].promise
    return Promise.resolve([])
  }
  creditPage.loadViolations.call(creditPage)
  creditPage.loadViolations.call(creditPage)
  creditReads[1].resolve([{ id: 902 }])
  await flushPromises()
  creditReads[0].resolve([{ id: 901 }])
  await flushPromises()
  assert(creditPage.data.violations.length === 1 && creditPage.data.violations[0].id === 902, '信用页较旧读取不得覆盖最新结果')
  const staleCreditOnLogout = [deferred(), deferred()]
  let staleCreditIndex = 0
  request.get = function() { return staleCreditOnLogout[staleCreditIndex++].promise }
  creditPage.setData({ violations: [{ id: 903 }], blacklist: [{ id: 904 }] })
  creditPage.loadViolations.call(creditPage)
  creditPage.loadViolations.call(creditPage)
  storage.userInfo.role = 'student'
  staleCreditOnLogout[0].resolve([{ id: 905 }])
  await flushPromises()
  assert(creditPage.data.violations.length === 0 && creditPage.data.blacklist.length === 0, '信用页旧请求完成时发现已退出管理员也应立即清空全部数据')

  storage.userInfo.role = 'admin'
  const userReads = [deferred(), deferred()]
  let userReadIndex = 0
  request.get = function(url) {
    if (url === '/user/list') return userReads[userReadIndex++].promise
    return Promise.resolve([])
  }
  let usersRacePage = loadPage('miniapp/pages/admin-users/admin-users.js')
  usersRacePage.loadData.call(usersRacePage)
  usersRacePage.loadData.call(usersRacePage)
  userReads[1].resolve([{ id: 912, name: '最新宿生' }])
  await flushPromises()
  userReads[0].resolve([{ id: 911, name: '旧宿生' }])
  await flushPromises()
  assert(usersRacePage.data.list.length === 1 && usersRacePage.data.list[0].id === 912, '宿生页较旧读取不得覆盖最新结果')
  const staleUsersWhileLatestPending = [deferred(), deferred()]
  let staleUsersPendingIndex = 0
  request.get = function() { return staleUsersWhileLatestPending[staleUsersPendingIndex++].promise }
  usersRacePage.setData({ list: [{ id: 915 }], filteredList: [{ id: 915 }] })
  usersRacePage.loadData.call(usersRacePage)
  usersRacePage.loadData.call(usersRacePage)
  storage.userInfo.role = 'student'
  staleUsersWhileLatestPending[0].resolve([{ id: 916 }])
  await flushPromises()
  assert(usersRacePage.data.list.length === 0 && usersRacePage.data.filteredList.length === 0, '宿生页旧请求完成时发现已退出管理员也应立即清空列表')
  storage.userInfo.role = 'admin'
  const staleUsers = deferred()
  request.get = function() { return staleUsers.promise }
  usersRacePage.setData({ list: [{ id: 913 }], filteredList: [{ id: 913 }] })
  usersRacePage.loadData.call(usersRacePage)
  storage.userInfo.role = 'student'
  staleUsers.resolve([{ id: 914, name: '越权宿生' }])
  await flushPromises()
  assert(usersRacePage.data.list.length === 0 && usersRacePage.data.filteredList.length === 0, '退出管理员角色后完成的宿生请求不得回写且应清空列表')

  storage.userInfo.role = 'admin'
  const roomReads = [deferred(), deferred()]
  let roomReadIndex = 0
  request.get = function(url) {
    if (url === '/room') return roomReads[roomReadIndex++].promise
    return Promise.resolve([])
  }
  let roomsRacePage = loadPage('miniapp/pages/admin-rooms/admin-rooms.js')
  roomsRacePage.loadData.call(roomsRacePage)
  roomsRacePage.loadData.call(roomsRacePage)
  roomReads[1].resolve([{ id: 922, name: '最新房间' }])
  await flushPromises()
  roomReads[0].resolve([{ id: 921, name: '旧房间' }])
  await flushPromises()
  assert(roomsRacePage.data.list.length === 1 && roomsRacePage.data.list[0].id === 922, '房间页较旧读取不得覆盖最新结果')
  const staleRoomsWhileLatestPending = [deferred(), deferred()]
  let staleRoomsPendingIndex = 0
  request.get = function() { return staleRoomsWhileLatestPending[staleRoomsPendingIndex++].promise }
  roomsRacePage.setData({ list: [{ id: 925 }] })
  roomsRacePage.loadData.call(roomsRacePage)
  roomsRacePage.loadData.call(roomsRacePage)
  storage.userInfo.role = 'student'
  staleRoomsWhileLatestPending[0].resolve([{ id: 926 }])
  await flushPromises()
  assert(roomsRacePage.data.list.length === 0, '房间页旧请求完成时发现已退出管理员也应立即清空列表')
  storage.userInfo.role = 'admin'
  const staleRooms = deferred()
  request.get = function() { return staleRooms.promise }
  roomsRacePage.setData({ list: [{ id: 923 }] })
  roomsRacePage.loadData.call(roomsRacePage)
  storage.userInfo.role = 'student'
  staleRooms.resolve([{ id: 924, name: '越权房间' }])
  await flushPromises()
  assert(roomsRacePage.data.list.length === 0, '退出管理员角色后完成的房间请求不得回写且应清空列表')

  storage.userInfo.role = 'counselor'
  const feedbackReads = [deferred(), deferred()]
  let feedbackReadIndex = 0
  request.get = function(url) {
    if (url === '/feedback') return feedbackReads[feedbackReadIndex++].promise
    return Promise.resolve([])
  }
  let feedbackRacePage = loadPage('miniapp/pages/admin-feedback/admin-feedback.js')
  feedbackRacePage.loadFeedback.call(feedbackRacePage)
  feedbackRacePage.loadFeedback.call(feedbackRacePage)
  feedbackReads[1].resolve({ list: [{ id: 932 }] })
  await flushPromises()
  feedbackReads[0].resolve({ list: [{ id: 931 }] })
  await flushPromises()
  assert(feedbackRacePage.data.list.length === 1 && feedbackRacePage.data.list[0].id === 932, '反馈页较旧读取不得覆盖最新结果')
  const staleFeedbackWhileLatestPending = [deferred(), deferred()]
  let staleFeedbackPendingIndex = 0
  request.get = function() { return staleFeedbackWhileLatestPending[staleFeedbackPendingIndex++].promise }
  feedbackRacePage.setData({ list: [{ id: 935 }] })
  feedbackRacePage.loadFeedback.call(feedbackRacePage)
  feedbackRacePage.loadFeedback.call(feedbackRacePage)
  storage.userInfo.role = 'admin'
  staleFeedbackWhileLatestPending[0].resolve({ list: [{ id: 936 }] })
  await flushPromises()
  assert(feedbackRacePage.data.list.length === 0, '反馈页旧请求完成时发现能力失效也应立即清空列表')
  storage.userInfo.role = 'counselor'
  const staleFeedback = deferred()
  request.get = function() { return staleFeedback.promise }
  feedbackRacePage.setData({ list: [{ id: 933 }] })
  feedbackRacePage.loadFeedback.call(feedbackRacePage)
  storage.userInfo.role = 'admin'
  feedbackRacePage.onShow.call(feedbackRacePage)
  assert(feedbackRacePage.data.list.length === 0, '反馈权限降级后 onShow 应立即清空反馈数据')
  staleFeedback.resolve({ list: [{ id: 934, content: '越权反馈' }] })
  await flushPromises()
  assert(feedbackRacePage.data.list.length === 0, '反馈权限降级后完成的旧请求不得回写')

  request.put = function(url, body) {
    capabilityCalls.push({ method: 'PUT', url: url, body: body || {} })
    return Promise.resolve({})
  }
  holdModal = true
  pendingModalSuccess = null
  storage.userInfo.role = 'counselor'
  capabilityCalls.length = 0
  toastCalls.length = 0
  navCalls.length = 0
  creditPage = loadPage('miniapp/pages/admin-credit/admin-credit.js')
  creditPage.setData({ violations: [{ id: 940 }], blacklist: [{ id: 941 }] })
  creditPage.onUnban.call(creditPage, { currentTarget: { dataset: { id: 941 } } })
  assert(typeof pendingModalSuccess === 'function', '解除黑名单应等待用户确认')
  storage.userInfo.role = 'student'
  pendingModalSuccess({ confirm: true })
  await flushPromises()
  assert(!capabilityCalls.some(function(call) { return call.url === '/credit/blacklist/941' }), '解除黑名单弹窗打开后角色降级不得提交')
  assert(creditPage.data.violations.length === 0 && creditPage.data.blacklist.length === 0, '解除黑名单确认时退出管理员应清空全部信用数据')
  assert(toastCalls.some(function(call) { return call.title === '请在电脑后台处理此项功能' }), '解除黑名单确认时权限失效应提示')
  assert(navCalls.some(function(call) { return call.type === 'reLaunch' && call.url === '/pages/login/login' }), '解除黑名单确认时退出管理员应返回登录页')

  pendingModalSuccess = null
  storage.userInfo.role = 'counselor'
  capabilityCalls.length = 0
  toastCalls.length = 0
  navCalls.length = 0
  feedbackPage = loadPage('miniapp/pages/admin-feedback/admin-feedback.js')
  feedbackPage.onResolve.call(feedbackPage, { currentTarget: { dataset: { id: 942 } } })
  assert(typeof pendingModalSuccess === 'function', '反馈处理应等待用户确认')
  storage.userInfo.role = 'admin'
  pendingModalSuccess({ confirm: true })
  await flushPromises()
  assert(!capabilityCalls.some(function(call) { return call.url === '/feedback/942/resolve' }), '反馈处理弹窗打开后角色降级不得提交')
  assert(toastCalls.some(function(call) { return call.title === '请在电脑后台处理此项功能' }), '反馈确认时权限失效应提示')
  assert(navCalls.some(function(call) { return call.type === 'reLaunch' && call.url === '/pages/admin-manage/admin-manage' }), '反馈确认时权限失效应返回管理中心')
  holdModal = false
  pendingModalSuccess = null

  ;['admin', 'counselor', 'super_admin'].forEach(function(role) {
    storage.userInfo.role = role
    capabilityCalls.length = 0
    toastCalls.length = 0
    navCalls.length = 0
    var announcementPage = loadPage('miniapp/pages/admin-announcement/admin-announcement.js')
    announcementPage.onLoad.call(announcementPage)
    announcementPage.onAdd.call(announcementPage)
    announcementPage.onSubmit.call(announcementPage)
    announcementPage.onDelete.call(announcementPage, { currentTarget: { dataset: { id: 1 } } })
    assert(!capabilityCalls.some(function(call) { return call.url.indexOf('/admin/announcements') === 0 }), role + ' 移动端公告页不得请求公告接口')
    assert(toastCalls.some(function(call) { return call.title === '请在电脑后台处理此项功能' }), role + ' 移动端公告页应提示前往电脑后台')
    assert(navCalls.some(function(call) { return call.type === 'reLaunch' && call.url === '/pages/admin-manage/admin-manage' }), role + ' 移动端公告页应返回管理中心')
  })
  const announcementWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-announcement/admin-announcement.wxml'), 'utf8')
  assert(announcementWxml.indexOf('请在电脑后台处理此项功能') !== -1, '移动端公告页应显示电脑后台说明')
  assert(announcementWxml.indexOf('bindtap="onAdd"') === -1 && announcementWxml.indexOf('bindtap="onSubmit"') === -1 && announcementWxml.indexOf('bindtap="onDelete"') === -1, '移动端公告页不应提供公告操作')

  const posterAppJson = require('../miniapp/app.json')
  assert(posterAppJson.pages.indexOf('pages/admin-poster/admin-poster') !== -1, 'app.json 应注册移动端海报审核页')

  storage.userInfo.role = 'admin'
  capabilityCalls.length = 0
  toastCalls.length = 0
  navCalls.length = 0
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    return Promise.resolve({ list: [] })
  }
  request.post = function(url, body) {
    capabilityCalls.push({ method: 'POST', url: url, body: body || {} })
    return Promise.resolve({})
  }
  let posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
  posterPage.onLoad.call(posterPage)
  posterPage.onShow.call(posterPage)
  await flushPromises()
  assert(!capabilityCalls.some(function(call) { return call.url.indexOf('/poster') === 0 }), '导生管理员进入海报审核页时任何生命周期都不得请求海报接口')
  assert(toastCalls.length > 0, '导生管理员进入海报审核页应收到无权访问提示')
  assert(navCalls.some(function(call) { return call.type === 'reLaunch' && call.url === '/pages/admin-manage/admin-manage' }), '导生管理员进入海报审核页应返回管理中心')

  var posterRoles = ['counselor', 'super_admin']
  for (var posterRoleIndex = 0; posterRoleIndex < posterRoles.length; posterRoleIndex++) {
    var posterRole = posterRoles[posterRoleIndex]
    storage.userInfo.role = posterRole
    capabilityCalls.length = 0
    request.get = function(url, params) {
      capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
      return Promise.resolve({ list: [{ id: 101, status: 'pending', title: '迎新海报' }], total: 1, page: 1, pageSize: 20 })
    }
    posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
    posterPage.onLoad.call(posterPage)
    assert(!capabilityCalls.some(function(call) { return call.url === '/poster' }), posterRole + ' 海报页 onLoad 只初始化，不应重复读取')
    posterPage.onShow.call(posterPage)
    var posterReadCalls = capabilityCalls.filter(function(call) { return call.method === 'GET' && call.url === '/poster' })
    assert(posterReadCalls.length === 1, posterRole + ' 海报页首次 onLoad + onShow 只能读取一次')
    assert(posterReadCalls[0].params.status === 'pending' && posterReadCalls[0].params.page === 1 && posterReadCalls[0].params.pageSize === 20, posterRole + ' 海报页应请求待审核第一页并固定每页 20 条')
    await flushPromises()
    assert(posterPage.data.list.length === 1 && posterPage.data.list[0].id === 101, posterRole + ' 海报页应解析分页响应 data.list')
  }

  const posterWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-poster/admin-poster.wxml'), 'utf8')
  const posterJs = fs.readFileSync(path.join(root, 'miniapp/pages/admin-poster/admin-poster.js'), 'utf8')
  assert(posterJs.indexOf('local-data') === -1, '海报审核页不得使用本地样例数据')
  ;['loading', 'error', 'list.length === 0', 'onRetry', '海报审核暂时未能加载', '暂无待审核海报'].forEach(function(text) {
    assert(posterWxml.indexOf(text) !== -1, '海报审核页应提供加载、空、错误和重试状态：' + text)
  })
  ;['real_name', 'nickname', 'student_id', 'position_name', 'position', 'location', 'start_date', 'end_date', 'description', 'status'].forEach(function(field) {
    assert(posterWxml.indexOf(field) !== -1, '海报审核卡片应展示真实服务端字段及兜底：' + field)
  })
  assert(posterWxml.indexOf("item.status === 'pending'") !== -1, '海报审核操作只应对 pending 状态显示')
  assert(posterWxml.indexOf('processingIds[item.id]') !== -1, '海报审核卡片应显示按申请锁定的处理中状态')

  storage.userInfo.role = 'counselor'
  capabilityCalls.length = 0
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    return Promise.reject(new Error('expected poster load failure'))
  }
  posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
  await posterPage.loadData.call(posterPage)
  assert(posterPage.data.loading === false && posterPage.data.error === '海报审核暂时未能加载', '海报加载失败应落入可重试错误状态')
  capabilityCalls.length = 0
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    return Promise.resolve({ list: [] })
  }
  await posterPage.onRetry.call(posterPage)
  assert(capabilityCalls.filter(function(call) { return call.url === '/poster' }).length === 1, '海报错误态重试应重新读取服务端')
  assert(posterPage.data.loading === false && posterPage.data.error === '' && posterPage.data.list.length === 0, '海报重试成功后应进入明确空态')

  storage.userInfo.role = 'counselor'
  capabilityCalls.length = 0
  var firstPosterPage = []
  for (var posterId = 1; posterId <= 20; posterId++) firstPosterPage.push({ id: posterId, status: 'pending' })
  const secondPosterPage = deferred()
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    if (params.page === 1) return Promise.resolve({ list: firstPosterPage, total: 21, page: 1, pageSize: 20 })
    return secondPosterPage.promise
  }
  posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
  posterPage.onLoad.call(posterPage)
  posterPage.onShow.call(posterPage)
  await flushPromises()
  assert(posterPage.data.page === 1 && posterPage.data.pageSize === 20 && posterPage.data.total === 21 && posterPage.data.hasMore === true, '海报第一页应保存服务端分页信息并标记仍有更多')
  posterPage.onLoadMore.call(posterPage)
  posterPage.onLoadMore.call(posterPage)
  var secondPageCalls = capabilityCalls.filter(function(call) { return call.url === '/poster' && call.params.page === 2 })
  assert(secondPageCalls.length === 1 && secondPageCalls[0].params.pageSize === 20 && secondPageCalls[0].params.status === 'pending', '海报加载更多应准确请求第二页且阻止并发重复')
  assert(posterPage.data.loadingMore === true, '海报加载更多期间应显示独立加载状态')
  secondPosterPage.resolve({ list: [{ id: 20, status: 'pending' }, { id: 21, status: 'pending' }], total: 21, page: 2, pageSize: 20 })
  await flushPromises()
  assert(posterPage.data.list.length === 21 && posterPage.data.list[20].id === 21, '海报加载更多应按 id 去重后追加到已有列表')
  assert(posterPage.data.page === 2 && posterPage.data.total === 21 && posterPage.data.hasMore === false && posterPage.data.loadingMore === false, '海报第二页完成后应更新分页并停止加载状态')
  var readsBeforeNoMore = capabilityCalls.length
  posterPage.onLoadMore.call(posterPage)
  assert(capabilityCalls.length === readsBeforeNoMore, '海报没有更多数据时不得继续请求')

  var exhaustedPosterCases = [
    { name: '空追加页', items: [], expectedLength: 20 },
    { name: '不足一页', items: [{ id: 21, status: 'pending' }], expectedLength: 21 },
    { name: '全部重复', items: firstPosterPage.slice(), expectedLength: 20 }
  ]
  for (var exhaustedIndex = 0; exhaustedIndex < exhaustedPosterCases.length; exhaustedIndex++) {
    var exhaustedCase = exhaustedPosterCases[exhaustedIndex]
    request.get = function(url, params) {
      if (params.page === 1) return Promise.resolve({ list: firstPosterPage, total: 100, page: 1, pageSize: 20 })
      return Promise.resolve({ list: exhaustedCase.items, total: 100, page: 2, pageSize: 20 })
    }
    posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
    await posterPage.loadData.call(posterPage)
    await posterPage.onLoadMore.call(posterPage)
    assert(posterPage.data.list.length === exhaustedCase.expectedLength, exhaustedCase.name + ' 应保留并正确合并已有海报')
    assert(posterPage.data.hasMore === false, exhaustedCase.name + ' 即使服务端旧 total 较大也应停止继续加载')
  }

  var fullSecondPosterPage = []
  for (var fullPosterId = 21; fullPosterId <= 40; fullPosterId++) fullSecondPosterPage.push({ id: fullPosterId, status: 'pending' })
  request.get = function(url, params) {
    if (params.page === 1) return Promise.resolve({ list: firstPosterPage, total: 60, page: 1, pageSize: 20 })
    return Promise.resolve({ list: fullSecondPosterPage, total: 60, page: 2, pageSize: 20 })
  }
  posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
  await posterPage.loadData.call(posterPage)
  await posterPage.onLoadMore.call(posterPage)
  assert(posterPage.data.list.length === 40 && posterPage.data.hasMore === true, '海报追加页满页、有新增且未达到 total 时应继续允许加载')

  capabilityCalls.length = 0
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    if (params.page === 1) return Promise.resolve({ list: firstPosterPage, total: 21, page: 1, pageSize: 20 })
    return Promise.reject(new Error('expected poster load-more failure'))
  }
  posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
  await posterPage.loadData.call(posterPage)
  await posterPage.onLoadMore.call(posterPage)
  assert(posterPage.data.list.length === 20 && posterPage.data.page === 1 && posterPage.data.hasMore === true, '海报加载更多失败应保留已有列表和当前页')
  assert(posterPage.data.loadingMore === false && posterPage.data.loadMoreError, '海报加载更多失败应提供可重试提示')
  const posterPagingWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-poster/admin-poster.wxml'), 'utf8')
  assert(posterPagingWxml.indexOf('onLoadMore') !== -1 && posterPagingWxml.indexOf('loadingMore') !== -1 && posterPagingWxml.indexOf('加载更多') !== -1, '海报列表应提供加载更多和加载中入口')

  const posterReads = [deferred(), deferred()]
  let posterReadIndex = 0
  request.get = function() { return posterReads[posterReadIndex++].promise }
  posterPage.loadData.call(posterPage)
  posterPage.loadData.call(posterPage)
  posterReads[1].resolve({ list: [{ id: 202, status: 'pending' }] })
  await flushPromises()
  posterReads[0].resolve({ list: [{ id: 201, status: 'pending' }] })
  await flushPromises()
  assert(posterPage.data.list.length === 1 && posterPage.data.list[0].id === 202, '海报旧列表响应不得覆盖较新的列表结果')

  const stalePosterRead = deferred()
  request.get = function() { return stalePosterRead.promise }
  posterPage.setData({ list: [{ id: 203, title: '敏感海报' }] })
  posterPage.loadData.call(posterPage)
  storage.userInfo.role = 'admin'
  stalePosterRead.resolve({ list: [{ id: 204, title: '越权海报' }] })
  await flushPromises()
  assert(posterPage.data.list.length === 0, '海报请求完成时角色降级不得回写并应清空敏感列表')

  storage.userInfo.role = 'counselor'
  capabilityCalls.length = 0
  navCalls.length = 0
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    return Promise.resolve({ list: [] })
  }
  posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
  posterPage.setData({ list: [{ id: 205, title: '待清空海报' }] })
  storage.userInfo.role = 'admin'
  posterPage.onShow.call(posterPage)
  assert(posterPage.data.list.length === 0, '海报页 onShow 发现角色降级应立即清空敏感列表')
  assert(!capabilityCalls.some(function(call) { return call.url === '/poster' }), '海报页 onShow 发现角色降级不得发读取请求')
  assert(navCalls.some(function(call) { return call.type === 'reLaunch' && call.url === '/pages/admin-manage/admin-manage' }), '海报页角色降级应返回管理中心')

  storage.userInfo.role = 'counselor'
  capabilityCalls.length = 0
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    return Promise.resolve({ list: [] })
  }
  request.post = function(url, body) {
    capabilityCalls.push({ method: 'POST', url: url, body: body || {} })
    return Promise.resolve({})
  }
  posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
  posterPage.setData({ list: [{ id: 101, status: 'pending' }] })
  modalResponse = { confirm: true, content: '' }
  posterPage.onApprove.call(posterPage, { currentTarget: { dataset: { id: 101 } } })
  await flushPromises()
  await flushPromises()
  assert(capabilityCalls.some(function(call) { return call.method === 'POST' && call.url === '/poster/101/approve' }), '海报批准应 POST /poster/101/approve')

  modalResponse = { confirm: true, content: '   ' }
  capabilityCalls.length = 0
  posterPage.onReject.call(posterPage, { currentTarget: { dataset: { id: 101 } } })
  await flushPromises()
  assert(!capabilityCalls.some(function(call) { return call.method === 'POST' && call.url === '/poster/101/reject' }), '海报拒绝理由为空白时不得提交')

  modalResponse = { confirm: true, content: '  信息不完整  ' }
  capabilityCalls.length = 0
  posterPage.onReject.call(posterPage, { currentTarget: { dataset: { id: 101 } } })
  await flushPromises()
  await flushPromises()
  assert(capabilityCalls.some(function(call) { return call.method === 'POST' && call.url === '/poster/101/reject' && call.body.reason === '信息不完整' }), '海报拒绝应提交清理空白后的理由')

  capabilityCalls.length = 0
  modalResponse = { confirm: true, content: '重复提交检查' }
  const posterApproval = deferred()
  const posterRefresh = deferred()
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    return posterRefresh.promise
  }
  request.post = function(url, body) {
    capabilityCalls.push({ method: 'POST', url: url, body: body || {} })
    return posterApproval.promise
  }
  posterPage.onApprove.call(posterPage, { currentTarget: { dataset: { id: 101 } } })
  posterPage.onApprove.call(posterPage, { currentTarget: { dataset: { id: 101 } } })
  posterPage.onReject.call(posterPage, { currentTarget: { dataset: { id: 101 } } })
  assert(capabilityCalls.filter(function(call) { return call.url === '/poster/101/approve' }).length === 1, '同一海报处理中不得重复提交')
  assert(posterPage.data.processingIds[101], '海报提交期间应按申请编号锁定操作')
  posterApproval.resolve({})
  await flushPromises()
  await flushPromises()
  assert(posterPage.data.processingIds[101], '海报批准成功但服务端列表仍在刷新时应继续锁定')
  posterPage.onApprove.call(posterPage, { currentTarget: { dataset: { id: 101 } } })
  assert(capabilityCalls.filter(function(call) { return call.url === '/poster/101/approve' }).length === 1, '海报刷新未完成时再次点击不得重复提交')
  posterRefresh.resolve({ list: [] })
  await flushPromises()
  await flushPromises()
  assert(!posterPage.data.processingIds[101], '海报服务端列表刷新完成后应解锁操作')

  const failedPosterApproval = deferred()
  request.post = function() { return failedPosterApproval.promise }
  posterPage.onApprove.call(posterPage, { currentTarget: { dataset: { id: 102 } } })
  failedPosterApproval.reject(new Error('expected poster approval failure'))
  await flushPromises()
  assert(!posterPage.data.processingIds[102], '海报审批失败后也应解锁操作')

  holdModal = true
  pendingModalSuccess = null
  capabilityCalls.length = 0
  navCalls.length = 0
  storage.userInfo.role = 'counselor'
  posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
  posterPage.setData({ list: [{ id: 101, status: 'pending', title: '敏感海报' }] })
  request.post = function(url, body) {
    capabilityCalls.push({ method: 'POST', url: url, body: body || {} })
    return Promise.resolve({})
  }
  posterPage.onReject.call(posterPage, { currentTarget: { dataset: { id: 101 } } })
  assert(typeof pendingModalSuccess === 'function', '海报拒绝应等待用户确认')
  storage.userInfo.role = 'admin'
  pendingModalSuccess({ confirm: true, content: '角色已降级' })
  await flushPromises()
  assert(!capabilityCalls.some(function(call) { return call.url === '/poster/101/reject' }), '海报拒绝弹窗打开后角色降级不得发写请求')
  assert(posterPage.data.list.length === 0, '海报拒绝确认时角色降级应清空敏感列表')
  assert(navCalls.some(function(call) { return call.type === 'reLaunch' && call.url === '/pages/admin-manage/admin-manage' }), '海报拒绝确认时角色降级应返回管理中心')
  holdModal = false
  pendingModalSuccess = null

  storage.userInfo.role = 'counselor'
  capabilityCalls.length = 0
  const posterWriteWhileDowngraded = deferred()
  posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
  posterPage.setData({ list: [{ id: 103, status: 'pending', title: '处理中海报' }] })
  request.post = function(url, body) {
    capabilityCalls.push({ method: 'POST', url: url, body: body || {} })
    return posterWriteWhileDowngraded.promise
  }
  request.get = function(url, params) {
    capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
    return Promise.resolve({ list: [] })
  }
  modalResponse = { confirm: true, content: '' }
  posterPage.onApprove.call(posterPage, { currentTarget: { dataset: { id: 103 } } })
  storage.userInfo.role = 'admin'
  posterWriteWhileDowngraded.resolve({})
  await flushPromises()
  await flushPromises()
  assert(!capabilityCalls.some(function(call) { return call.method === 'GET' && call.url === '/poster' }), '海报写请求完成时角色降级不得继续读取敏感列表')
  assert(posterPage.data.list.length === 0 && Object.keys(posterPage.data.processingIds).length === 0, '海报写请求期间角色降级应清空敏感列表和操作锁')

  request.get = originalGet
  request.put = originalPut
  request.post = originalPost
  request.delete = originalDelete

  const approvalCalls = []
  const homeSource = fs.readFileSync(path.join(root, 'miniapp/pages/admin-home/admin-home.js'), 'utf8')
  const homeWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-home/admin-home.wxml'), 'utf8')
  const homeWxss = fs.readFileSync(path.join(root, 'miniapp/pages/admin-home/admin-home.wxss'), 'utf8')
  assert(homeWxml.indexOf('加载失败') !== -1 && homeWxml.indexOf('重新加载') !== -1, '审批工作台应提供明确的加载失败和重新加载状态')
  assert(homeWxml.indexOf('item.purpose') !== -1 && homeWxml.indexOf('item.participants') !== -1, '审批卡片应展示用途和人数')
  assert(homeWxml.indexOf('统计加载中') !== -1 && homeWxml.indexOf('暂无可信统计数据') !== -1, '首次统计加载和失败应明确说明数据尚不可信')
  assert(homeWxml.indexOf('onRetryStats') !== -1 && homeWxml.indexOf('重新加载统计') !== -1, '统计失败应提供重新加载入口')
  assert(homeWxml.indexOf('feedbackStatus') !== -1 && homeWxml.indexOf('暂不可用') !== -1, '反馈指标失败时应显示不可用状态而不是可信 0')
  assert(homeWxml.indexOf("queueType === 'admin'") !== -1, '只有普通队列应显示快捷审批操作')
  assert(homeWxml.indexOf("item.status === 'pending'") !== -1, '普通队列也只能为 pending 卡片渲染快捷审批')
  assert(homeSource.indexOf('adminPolicy.canQuickApprove') !== -1, '快捷审批处理函数必须再次按角色和状态校验权限')
  assert(homeWxml.indexOf('aria-label="切换到普通待审队列"') !== -1 && homeWxml.indexOf('aria-label="切换到重点待审队列"') !== -1, '审批队列切换应提供无障碍名称')
  assert(homeWxml.indexOf('aria-label="扫码签到"') !== -1 && homeWxml.indexOf('aria-label="查看预约详情"') !== -1, '扫码和查看操作应提供无障碍名称')
  assert(homeWxml.indexOf('aria-label="重新加载反馈统计"') !== -1 && /\.retry-button\s*\{[^}]*min-height:\s*88rpx/.test(homeWxss), '反馈重试应有无障碍名称且列表重试触控高度应不小于 88rpx')
  assert(homeWxml.indexOf('aria-label="通过预约"') !== -1 && homeWxml.indexOf('aria-label="拒绝预约"') !== -1, '快捷审批操作应提供无障碍名称')
  assert(/\.queue-tab\s*\{[^}]*min-height:\s*88rpx/.test(homeWxss) && /\.scan-checkin-card\s*\{[^}]*min-height:\s*88rpx/.test(homeWxss), '队列和扫码主要触控区高度应不小于 88rpx')
  assert(homeWxml.indexOf('<navigator class="queue-tab') === -1, '队列切换应在当前页面完成，不应重复导航首页')
  assert(homeSource.indexOf('data.activeRooms || 12') === -1, '合法的开放房间数 0 不得被固定数字覆盖')
  assert(homeSource.indexOf('/room/stats') === -1 && homeSource.indexOf('activeRooms: 12') === -1, '首页统计不得请求旧房间统计或伪造开放房间数')
  request.get = function(url, params) {
    approvalCalls.push({ method: 'GET', url: url, params: params || {} })
    if (url === '/audit/pending') {
      return Promise.resolve({ items: [{ id: 101, status: params.type === 'counselor' ? 'counselor_pending' : 'pending' }], total: 1, page: 1, pageSize: 10 })
    }
    if (url === '/reservation') {
      return Promise.resolve({ list: [{ id: 101, status: 'pending' }, { id: 102, status: 'counselor_pending' }], total: 2, page: 1, pageSize: 20 })
    }
    if (url === '/stats/dashboard') return Promise.resolve({
      ordinaryPendingCount: 1,
      counselorPendingCount: 2,
      actionablePendingCount: 3,
      activeRoomCount: 0,
      todayReservations: 2,
      usingCount: 7
    })
    if (url === '/feedback') return Promise.resolve({ total: 3 })
    return Promise.resolve([])
  }
  request.post = function(url, body) {
    approvalCalls.push({ method: 'POST', url: url, body: body || {} })
    return Promise.resolve({})
  }
  const approvalGet = request.get
  const approvalPost = request.post

  storage.userInfo.role = 'admin'
  let homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  homePage.onLoad.call(homePage, {})
  assert(homePage.data.queueType === 'admin', '导生首页默认应是普通队列')
  storage.userInfo.role = 'counselor'
  homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  homePage.onLoad.call(homePage, {})
  assert(homePage.data.queueType === 'counselor', '辅导员首页默认应是重点队列')
  storage.userInfo.role = 'super_admin'
  homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  homePage.onLoad.call(homePage, {})
  assert(homePage.data.queueType === 'counselor', '超级管理员首页默认应是重点队列')

  storage.userInfo.role = 'admin'
  homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  homePage.onLoad.call(homePage, { queueType: 'counselor' })
  assert(homePage.data.queueType === 'admin', '导生首页默认且越权降级后应是普通队列')
  assert(!approvalCalls.some(function(call) { return call.url === '/audit/pending' }), '首页 onLoad 只初始化，不应重复加载列表')
  homePage.onShow.call(homePage)
  await flushPromises()
  let pendingCall = approvalCalls.find(function(call) { return call.method === 'GET' && call.url === '/audit/pending' })
  assert(pendingCall && pendingCall.params.type === 'admin' && pendingCall.params.page === 1 && pendingCall.params.pageSize === 10, '普通审核入口应请求 admin 队列的 /audit/pending')
  assert(!approvalCalls.some(function(call) { return call.url === '/audit/pending' && call.params.type === 'counselor' }), '导生管理员不得请求 counselor 审核队列')
  assert(approvalCalls.some(function(call) { return call.url === '/stats/dashboard' }), '首页统计应只读取统一仪表盘接口')
  assert(homePage.data.queueType === 'admin' && homePage.data.queueLabel === '普通预约审核', '普通审核入口应显示普通队列标签')
  assert(homePage.data.inUseCount === 7, '首页使用中数量应读取仪表盘真实 usingCount 字段')
  assert(homePage.data.pendingList.length === 1 && homePage.data.pendingList[0].id === 101, '审核列表应处理 list/total/page/pageSize 响应')
  assert(approvalCalls.filter(function(call) { return call.url === '/audit/pending' }).length === 1, '首页首次 onLoad + onShow 只能产生一轮列表请求')
  assert(!approvalCalls.some(function(call) { return call.url === '/feedback' }), '导生管理员不应请求反馈管理数据')

  approvalCalls.length = 0
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  await flushPromises()
  assert(approvalCalls.some(function(call) { return call.method === 'POST' && call.url === '/audit/101/approve' }), '批准应 POST /audit/101/approve')
  assert(approvalCalls.some(function(call) { return call.method === 'GET' && call.url === '/audit/pending' }), '批准成功后应从服务端重载审核列表')
  assert(approvalCalls.some(function(call) { return call.method === 'GET' && call.url === '/stats/dashboard' }), '批准成功后应从服务端重载统计')

  approvalCalls.length = 0
  modalResponse = { confirm: true, content: '时间冲突' }
  homePage.onReject.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  await flushPromises()
  assert(approvalCalls.some(function(call) { return call.method === 'POST' && call.url === '/audit/101/reject' && call.body.reason === '时间冲突' }), '拒绝应 POST /audit/101/reject 并传递理由')

  const approvalErrorCalls = []
  toastCalls.length = 0
  request.post = function(url, body, options) {
    approvalErrorCalls.push({ url: url, body: body || {}, options: options || {} })
    return Promise.reject({ message: '排期已失效' })
  }
  homePage.setData({ queueType: 'admin', pendingList: [{ id: 103, status: 'pending' }] })
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 103 } } })
  await flushPromises()
  assert(approvalErrorCalls[0] && approvalErrorCalls[0].options.silent === true, '快捷审批请求应静默请求层的重复错误提示')
  assert(toastCalls.length === 1 && toastCalls[0].title === '排期已失效', '快捷审批失败应只提示一次并保留服务端具体原因')
  approvalErrorCalls.length = 0
  toastCalls.length = 0
  modalResponse = { confirm: true, content: '材料不足' }
  homePage.onReject.call(homePage, { currentTarget: { dataset: { id: 103 } } })
  await flushPromises()
  assert(approvalErrorCalls[0] && approvalErrorCalls[0].options.silent === true, '快捷拒绝请求也应静默请求层的重复错误提示')
  assert(toastCalls.length === 1 && toastCalls[0].title === '排期已失效', '快捷拒绝失败应只提示一次并保留服务端具体原因')
  request.post = approvalPost
  modalResponse = { confirm: true, content: '时间冲突' }

  approvalCalls.length = 0
  storage.userInfo.role = 'counselor'
  homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  homePage.onLoad.call(homePage, {})
  assert(homePage.data.queueType === 'counselor', '辅导员首页默认应是重点队列')
  homePage.onShow.call(homePage)
  await flushPromises()
  pendingCall = approvalCalls.find(function(call) { return call.method === 'GET' && call.url === '/audit/pending' })
  assert(pendingCall && pendingCall.params.type === 'counselor', '辅导员默认应请求 counselor 队列')
  assert(homePage.data.canSwitchQueue && homePage.data.queueLabel === '辅导员重点审核', '辅导员应可切换队列并显示重点审核标签')

  approvalCalls.length = 0
  storage.userInfo.role = 'super_admin'
  homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  assert(typeof homePage.onQueueChange === 'function', '超级管理员首页应支持页内切换队列')
  homePage.onLoad.call(homePage, { queueType: 'admin' })
  homePage.onShow.call(homePage)
  await flushPromises()
  pendingCall = approvalCalls.find(function(call) { return call.method === 'GET' && call.url === '/audit/pending' })
  assert(pendingCall && pendingCall.params.type === 'admin', '超级管理员应消费明确的普通队列参数')
  approvalCalls.length = 0
  homePage.onQueueChange.call(homePage, { currentTarget: { dataset: { type: 'counselor' } } })
  await flushPromises()
  assert(homePage.data.queueType === 'counselor', '超级管理员应可在当前页切换到重点队列')
  assert(!navCalls.some(function(call) { return call.url && call.url.indexOf('/pages/admin-home/admin-home?') === 0 }), '队列切换不得重复导航当前首页')
  approvalCalls.length = 0
  homePage.onQueueChange.call(homePage, { currentTarget: { dataset: { type: 'counselor' } } })
  assert(approvalCalls.length === 0, '选择当前队列时不应重复请求')
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  assert(!approvalCalls.some(function(call) { return call.method === 'POST' }), '重点队列不得直接快捷审批')
  homePage.setData({ queueType: 'admin', pendingList: [{ id: 101, status: 'counselor_pending' }] })
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  homePage.onReject.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  assert(!approvalCalls.some(function(call) { return call.method === 'POST' }), '普通队列混入 counselor_pending 数据时也不得快捷审批')
  approvalCalls.length = 0
  homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  homePage.onLoad.call(homePage, { queueType: 'counselor' })
  homePage.onShow.call(homePage)
  await flushPromises()
  pendingCall = approvalCalls.find(function(call) { return call.method === 'GET' && call.url === '/audit/pending' })
  assert(pendingCall && pendingCall.params.type === 'counselor', '超级管理员应消费明确的辅导员队列参数')
  assert(homePage.data.queueType === 'counselor', '超级管理员首页默认应是重点队列')

  const ordinaryQueueRead = deferred()
  const counselorQueueRead = deferred()
  request.get = function(url, params) {
    if (url === '/audit/pending') return params.type === 'counselor' ? counselorQueueRead.promise : ordinaryQueueRead.promise
    return Promise.resolve({})
  }
  homePage.setData({ queueType: 'admin', queueLabel: '普通预约审核', pendingList: [] })
  homePage.loadPendingList.call(homePage)
  homePage.onQueueChange.call(homePage, { currentTarget: { dataset: { type: 'counselor' } } })
  counselorQueueRead.resolve({ list: [{ id: 202, status: 'counselor_pending' }] })
  await flushPromises()
  ordinaryQueueRead.resolve({ list: [{ id: 201, status: 'pending' }] })
  await flushPromises()
  assert(homePage.data.queueType === 'counselor' && homePage.data.pendingList.length === 1 && homePage.data.pendingList[0].id === 202, '旧普通队列响应晚到时不得覆盖已切换的重点队列')
  request.get = approvalGet

  const failedPendingPage = loadPage('miniapp/pages/admin-home/admin-home.js')
  storage.userInfo.role = 'admin'
  failedPendingPage.onLoad.call(failedPendingPage, {})
  request.get = function(url) {
    if (url === '/audit/pending') return Promise.reject(new Error('network unavailable'))
    return Promise.resolve({})
  }
  await failedPendingPage.loadPendingList.call(failedPendingPage)
  assert(failedPendingPage.data.listStatus === 'error', '审核列表请求失败后必须进入错误状态')
  assert(failedPendingPage.data.pendingList.length === 0 && failedPendingPage.data.listStatus !== 'empty', '请求失败不得伪装成空列表')
  request.get = function(url) {
    if (url === '/audit/pending') return Promise.resolve({ list: [{ id: 204, status: 'pending' }], total: 1, page: 1, pageSize: 10 })
    return Promise.resolve({})
  }
  await failedPendingPage.onRetryList.call(failedPendingPage)
  assert(failedPendingPage.data.listStatus === 'ready' && failedPendingPage.data.pendingList[0].id === 204, '审核列表重新加载成功后必须恢复可用状态')
  request.get = approvalGet

  storage.userInfo.role = 'counselor'
  const cachedRolePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  cachedRolePage.onLoad.call(cachedRolePage, {})
  storage.userInfo.role = 'admin'
  cachedRolePage.onShow.call(cachedRolePage)
  await flushPromises()
  assert(cachedRolePage.data.queueType === 'admin' && !cachedRolePage.data.canSwitchQueue, '缓存页面遇到角色切换时必须恢复当前角色的默认授权队列')

  const statsStatePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  statsStatePage.onLoad.call(statsStatePage, {})
  assert(statsStatePage.data.statsStatus === 'loading' && statsStatePage.data.hasTrustedStats === false, '首次统计加载时不应把初始 0 当作可信结果')
  request.get = function(url) {
    if (url === '/stats/dashboard') return Promise.reject(new Error('dashboard unavailable'))
    return Promise.resolve({})
  }
  await statsStatePage.loadStats.call(statsStatePage)
  assert(statsStatePage.data.statsStatus === 'error' && statsStatePage.data.hasTrustedStats === false, '首次统计失败后必须保持无可信数据状态')
  assert(statsStatePage.data.statsError.indexOf('暂无可信统计数据') !== -1, '首次统计失败应说明暂无可信统计数据')
  assert(typeof statsStatePage.onRetryStats === 'function', '统计失败后应可重新加载')
  request.get = function(url) {
    if (url === '/stats/dashboard') return Promise.resolve({ ordinaryPendingCount: 5, counselorPendingCount: 2, actionablePendingCount: 7, activeRoomCount: 4, todayReservations: 8, usingCount: 3 })
    return Promise.resolve({})
  }
  await statsStatePage.onRetryStats.call(statsStatePage)
  assert(statsStatePage.data.statsStatus === 'ready' && statsStatePage.data.hasTrustedStats === true, '统计成功后应标记已有可信结果')
  request.get = function(url) {
    if (url === '/stats/dashboard') return Promise.reject(new Error('refresh unavailable'))
    return Promise.resolve({})
  }
  await statsStatePage.loadStats.call(statsStatePage)
  assert(statsStatePage.data.hasTrustedStats === true && statsStatePage.data.ordinaryPendingCount === 5, '已有可信结果时刷新失败应保留旧值')
  assert(statsStatePage.data.statsError.indexOf('显示上次结果') !== -1, '已有可信结果刷新失败应明确说明显示上次结果')
  request.get = approvalGet

  storage.userInfo.role = 'counselor'
  const feedbackStatePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  feedbackStatePage.onLoad.call(feedbackStatePage, {})
  request.get = function(url) {
    if (url === '/stats/dashboard') return Promise.resolve({})
    if (url === '/feedback') return Promise.reject(new Error('feedback unavailable'))
    return Promise.resolve({})
  }
  await feedbackStatePage.loadStats.call(feedbackStatePage)
  assert(feedbackStatePage.data.feedbackStatus === 'error', '反馈数量首次失败应进入不可用状态')
  request.get = function(url) {
    if (url === '/stats/dashboard') return Promise.resolve({})
    if (url === '/feedback') return Promise.resolve({ total: 6 })
    return Promise.resolve({})
  }
  await feedbackStatePage.onRetryStats.call(feedbackStatePage)
  assert(feedbackStatePage.data.feedbackStatus === 'ready' && feedbackStatePage.data.feedbackCount === 6, '反馈数量成功后应成为可信结果')
  request.get = function(url) {
    if (url === '/stats/dashboard') return Promise.resolve({})
    if (url === '/feedback') return Promise.reject(new Error('feedback refresh unavailable'))
    return Promise.resolve({})
  }
  await feedbackStatePage.loadStats.call(feedbackStatePage)
  assert(feedbackStatePage.data.feedbackStatus === 'error' && feedbackStatePage.data.feedbackCount === 6, '反馈刷新失败应保留旧值但标记不可用')
  request.get = approvalGet

  approvalCalls.length = 0
  storage.userInfo.role = 'admin'
  const reservationPage = loadPage('miniapp/pages/admin-reservation/admin-reservation.js')
  reservationPage.onLoad.call(reservationPage, { queueType: 'counselor' })
  assert(!approvalCalls.some(function(call) { return call.url === '/reservation' }), '全部预约页 onLoad 只初始化，不应重复加载列表')
  assert(typeof reservationPage.onShow === 'function', '全部预约页应在 onShow 加载和刷新列表')
  reservationPage.onShow.call(reservationPage)
  await flushPromises()
  const reservationWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-reservation/admin-reservation.wxml'), 'utf8')
  assert(!Object.prototype.hasOwnProperty.call(reservationPage.data, 'queueType') && !Object.prototype.hasOwnProperty.call(reservationPage.data, 'queueLabel'), '全部预约页不应保留审核队列状态')
  assert(reservationWxml.indexOf('全部预约') !== -1, '全部预约页标题应明确说明展示全部预约')
  assert(reservationWxml.indexOf('queueLabel') === -1 && reservationWxml.indexOf('普通预约审核') === -1 && reservationWxml.indexOf('辅导员重点审核') === -1, '全部预约页不应显示审核队列标签')
  assert(approvalCalls.some(function(call) { return call.method === 'GET' && call.url === '/reservation' }), '全部预约页仍应读取 /reservation')
  assert(approvalCalls.filter(function(call) { return call.url === '/reservation' }).length === 1, '全部预约页首次 onLoad + onShow 只能产生一轮列表请求')
  assert(reservationPage.data.list[0].canQuickAudit === true && reservationPage.data.list[1].canQuickAudit === false, '导生管理员只能快捷操作 pending 状态')
  modalResponse = { confirm: true, content: '材料不全' }
  approvalCalls.length = 0
  reservationPage.onReject.call(reservationPage, { currentTarget: { dataset: { id: 101 } } })
  await flushPromises()
  assert(approvalCalls.some(function(call) { return call.method === 'POST' && call.url === '/audit/101/reject' && call.body.reason === '材料不全' }), '全部预约页拒绝应使用统一审核接口')
  assert(approvalCalls.some(function(call) { return call.method === 'GET' && call.url === '/reservation' }), '全部预约页审批后应重载服务端列表')

  modalResponse = { confirm: true, content: '   ' }
  approvalCalls.length = 0
  reservationPage.onReject.call(reservationPage, { currentTarget: { dataset: { id: 101 } } })
  await flushPromises()
  assert(!approvalCalls.some(function(call) { return call.method === 'POST' && call.url === '/audit/101/reject' }), '拒绝理由为空时不得提交审批')

  modalResponse = { confirm: true, content: '重复提交检查' }
  approvalCalls.length = 0
  homePage.setData({ queueType: 'admin', pendingList: [{ id: 101, status: 'pending' }, { id: 102, status: 'pending' }] })
  const homeApproval = deferred()
  const homePendingRefresh = deferred()
  const homeStatsRefresh = deferred()
  request.get = function(url) {
    approvalCalls.push({ method: 'GET', url: url, params: {} })
    if (url === '/audit/pending') return homePendingRefresh.promise
    return homeStatsRefresh.promise
  }
  request.post = function(url, body) {
    approvalCalls.push({ method: 'POST', url: url, body: body || {} })
    return homeApproval.promise
  }
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  homePage.onReject.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  assert(approvalCalls.filter(function(call) { return call.url === '/audit/101/approve' }).length === 1, '首页同一预约处理中不得重复提交')
  assert(homePage.data.processingById && homePage.data.processingById[101], '首页提交期间应标记该预约正在处理')
  homeApproval.resolve({})
  await flushPromises()
  await flushPromises()
  assert(homePage.data.processingById[101], '首页批准成功但列表和统计仍在刷新时应继续锁定该预约')
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  assert(approvalCalls.filter(function(call) { return call.url === '/audit/101/approve' }).length === 1, '首页刷新未完成时再次点击不得重复提交')
  homePendingRefresh.resolve({ list: [], total: 0, page: 1, pageSize: 10 })
  homeStatsRefresh.resolve({ ordinaryPendingCount: 0, counselorPendingCount: 0, actionablePendingCount: 0, activeRoomCount: 6, todayReservations: 2, inUseCount: 0 })
  await flushPromises()
  await flushPromises()
  assert(!homePage.data.processingById[101], '首页列表和统计刷新完成后应恢复该预约操作状态')

  const failedHomeApproval = deferred()
  request.post = function() { return failedHomeApproval.promise }
  homePage.setData({ pendingList: [{ id: 102, status: 'pending' }] })
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 102 } } })
  failedHomeApproval.reject(new Error('expected failure'))
  await flushPromises()
  assert(!homePage.data.processingById[102], '首页审批失败后也应恢复该预约操作状态')
  approvalCalls.length = 0
  storage.userInfo.role = 'counselor'
  const roleChangedApprovalPage = loadPage('miniapp/pages/admin-home/admin-home.js')
  roleChangedApprovalPage.onLoad.call(roleChangedApprovalPage, { queueType: 'admin' })
  roleChangedApprovalPage.setData({ queueType: 'admin', pendingList: [{ id: 105, status: 'pending' }] })
  const roleChangedApproval = deferred()
  request.post = function(url, body) {
    approvalCalls.push({ method: 'POST', url: url, body: body || {} })
    return roleChangedApproval.promise
  }
  request.get = function(url, params) {
    approvalCalls.push({ method: 'GET', url: url, params: params || {} })
    if (url === '/audit/pending') return Promise.resolve({ list: [], total: 0, page: 1, pageSize: 10 })
    if (url === '/stats/dashboard') return Promise.resolve({ ordinaryPendingCount: 0, counselorPendingCount: 0, actionablePendingCount: 0, activeRoomCount: 1 })
    return Promise.resolve({})
  }
  roleChangedApprovalPage.onApprove.call(roleChangedApprovalPage, { currentTarget: { dataset: { id: 105 } } })
  storage.userInfo.role = 'admin'
  roleChangedApproval.resolve({})
  await flushPromises()
  await flushPromises()
  assert(!approvalCalls.some(function(call) { return call.method === 'GET' && call.url === '/audit/pending' && call.params.type === 'counselor' }), '审批完成时角色降级后不得继续刷新重点队列')
  assert(!approvalCalls.some(function(call) { return call.method === 'GET' && call.url === '/feedback' }), '审批完成时角色降级后不得继续刷新辅导员专属数据')

  approvalCalls.length = 0
  const reservationApproval = deferred()
  const reservationRefresh = deferred()
  request.get = function(url) {
    approvalCalls.push({ method: 'GET', url: url, params: {} })
    if (url === '/reservation') return reservationRefresh.promise
    return Promise.resolve({})
  }
  request.post = function(url, body) {
    approvalCalls.push({ method: 'POST', url: url, body: body || {} })
    return reservationApproval.promise
  }
  reservationPage.onApprove.call(reservationPage, { currentTarget: { dataset: { id: 101 } } })
  reservationPage.onApprove.call(reservationPage, { currentTarget: { dataset: { id: 101 } } })
  reservationPage.onReject.call(reservationPage, { currentTarget: { dataset: { id: 101 } } })
  assert(approvalCalls.filter(function(call) { return call.url === '/audit/101/approve' }).length === 1, '全部预约页同一预约处理中不得重复提交')
  assert(reservationPage.data.processingById && reservationPage.data.processingById[101], '全部预约页提交期间应标记该预约正在处理')
  reservationApproval.resolve({})
  await flushPromises()
  await flushPromises()
  assert(reservationPage.data.processingById[101], '全部预约页批准成功但列表仍在刷新时应继续锁定该预约')
  reservationPage.onApprove.call(reservationPage, { currentTarget: { dataset: { id: 101 } } })
  assert(approvalCalls.filter(function(call) { return call.url === '/audit/101/approve' }).length === 1, '全部预约页刷新未完成时再次点击不得重复提交')
  reservationRefresh.resolve({ list: [], total: 0, page: 1, pageSize: 20 })
  await flushPromises()
  await flushPromises()
  assert(!reservationPage.data.processingById[101], '全部预约页列表刷新完成后应恢复该预约操作状态')

  const failedApproval = deferred()
  request.post = function() { return failedApproval.promise }
  reservationPage.setData({ list: [{ id: 102, status: 'pending', canQuickAudit: true }] })
  reservationPage.onApprove.call(reservationPage, { currentTarget: { dataset: { id: 102 } } })
  failedApproval.reject(new Error('expected failure'))
  await flushPromises()
  assert(!reservationPage.data.processingById[102], '全部预约页审批失败后也应恢复该预约操作状态')

  const homeRequests = [deferred(), deferred()]
  let homeRequestIndex = 0
  request.get = function(url) {
    if (url === '/audit/pending') return homeRequests[homeRequestIndex++].promise
    return Promise.resolve({})
  }
  homePage.loadPendingList.call(homePage)
  homePage.loadPendingList.call(homePage)
  homeRequests[1].resolve({ list: [{ id: 202 }], total: 1, page: 1, pageSize: 10 })
  await flushPromises()
  homeRequests[0].resolve({ list: [{ id: 201 }], total: 1, page: 1, pageSize: 10 })
  await flushPromises()
  assert(homePage.data.pendingList[0].id === 202, '首页旧列表响应不得覆盖较新的列表结果')

  const dashboardRequests = [deferred(), deferred()]
  let dashboardRequestIndex = 0
  request.get = function(url) {
    if (url === '/stats/dashboard') return dashboardRequests[dashboardRequestIndex++].promise
    if (url === '/feedback') return Promise.resolve({ total: 3 })
    return Promise.resolve({})
  }
  homePage.loadStats.call(homePage)
  homePage.loadStats.call(homePage)
  dashboardRequests[1].resolve({ ordinaryPendingCount: 9, counselorPendingCount: 4, actionablePendingCount: 13, activeRoomCount: 0, todayReservations: 2, inUseCount: 1 })
  await flushPromises()
  dashboardRequests[0].resolve({ ordinaryPendingCount: 2, counselorPendingCount: 1, actionablePendingCount: 3, activeRoomCount: 6, todayReservations: 2, inUseCount: 1 })
  await flushPromises()
  assert(homePage.data.ordinaryPendingCount === 9 && homePage.data.activeRoomCount === 0, '首页较旧的仪表盘响应不得覆盖最新统计，合法 0 必须保留')

  const reservationRequests = [deferred(), deferred()]
  let reservationRequestIndex = 0
  request.get = function(url) {
    if (url === '/reservation') return reservationRequests[reservationRequestIndex++].promise
    return Promise.resolve({})
  }
  reservationPage.loadData.call(reservationPage)
  reservationPage.loadData.call(reservationPage)
  reservationRequests[1].resolve({ list: [{ id: 302, status: 'pending' }], total: 1, page: 1, pageSize: 20 })
  await flushPromises()
  reservationRequests[0].resolve({ list: [{ id: 301, status: 'pending' }], total: 1, page: 1, pageSize: 20 })
  await flushPromises()
  assert(reservationPage.data.list[0].id === 302, '全部预约页旧列表响应不得覆盖较新的筛选或搜索结果')

  request.get = approvalGet
  request.post = approvalPost

  storage.userInfo.role = 'counselor'
  approvalCalls.length = 0
  const counselorReservationPage = loadPage('miniapp/pages/admin-reservation/admin-reservation.js')
  counselorReservationPage.onLoad.call(counselorReservationPage, { queueType: 'counselor' })
  counselorReservationPage.onShow.call(counselorReservationPage)
  await flushPromises()
  assert(counselorReservationPage.data.list.find(function(item) { return item.status === 'pending' }).canQuickAudit, '辅导员可快捷处理普通 pending 预约')
  assert(!counselorReservationPage.data.list.find(function(item) { return item.status === 'counselor_pending' }).canQuickAudit, '重点预约只能进入详情页审核')
  navCalls.length = 0
  counselorReservationPage.onViewDetail.call(counselorReservationPage, { currentTarget: { dataset: { id: 102 } } })
  assert(navCalls[0] && navCalls[0].url === '/pages/admin-reservation-detail/admin-reservation-detail?id=102', '全部预约详情应统一进入管理员预约详情页')

  const detailCalls = []
  var detailFixture = {
    id: 501, status: 'pending', user_name: '测试申请人', student_id: '2024001999',
    credit_score: 88, user_status: 'active', room_name: 'B228自习室', room_type: 'study_room', building_id: 1,
    date: '2026-07-20', start_time: '09:00', end_time: '10:00', purpose: '课程讨论', participants: 3
  }
  request.get = function(url, params, options) {
    detailCalls.push({ method: 'GET', url: url, params: params || {}, options: options || {} })
    return Promise.resolve(Object.assign({}, detailFixture))
  }
  request.post = function(url, body, options) {
    detailCalls.push({ method: 'POST', url: url, body: body || {}, options: options || {} })
    return Promise.resolve({})
  }

  storage.userInfo.role = 'admin'
  var detailPage = loadPage('miniapp/pages/admin-reservation-detail/admin-reservation-detail.js')
  assert(detailPage.data.reservation === null && detailPage.data.pageStatus === 'loading', '管理员详情初始不得构造备用预约')
  assert(detailPage.data.errorMessage === '' && !detailPage.data.canApprove && !detailPage.data.canReject && !detailPage.data.processing, '管理员详情初始操作状态应安全关闭')
  detailPage.onLoad.call(detailPage, { id: 501 })
  await flushPromises()
  assert(detailCalls[0] && detailCalls[0].url === '/reservation/501' && detailCalls[0].options.silent === true, '管理员详情应静默读取指定预约')
  assert(detailPage.data.pageStatus === 'ready' && detailPage.data.reservation.credit_score === 88 && detailPage.data.reservation.user_status === 'active', '详情转换后必须保留信用分和账号状态')
  assert(detailPage.data.canApprove && detailPage.data.canReject, '导生管理员可审核普通待审预约')

  detailFixture.status = 'counselor_pending'
  await detailPage.loadDetail.call(detailPage)
  assert(!detailPage.data.canApprove && !detailPage.data.canReject, '导生管理员可看重点预约但不可审批')
  storage.userInfo.role = 'counselor'
  await detailPage.loadDetail.call(detailPage)
  assert(detailPage.data.canApprove && detailPage.data.canReject, '辅导员可审核重点预约')
  storage.userInfo.role = 'super_admin'
  await detailPage.loadDetail.call(detailPage)
  assert(detailPage.data.canApprove && detailPage.data.canReject, '超级管理员可审核重点预约')
  detailFixture.status = 'pending'
  await detailPage.loadDetail.call(detailPage)
  assert(detailPage.data.canApprove && detailPage.data.canReject, '超级管理员可审核普通预约')
  detailFixture.status = 'approved'
  await detailPage.loadDetail.call(detailPage)
  assert(!detailPage.data.canApprove && !detailPage.data.canReject, '终态预约不得显示审批操作')

  storage.userInfo.role = 'student'
  detailCalls.length = 0
  toastCalls.length = 0
  navCalls.length = 0
  var deniedDetailPage = loadPage('miniapp/pages/admin-reservation-detail/admin-reservation-detail.js')
  deniedDetailPage.onLoad.call(deniedDetailPage, { id: 501 })
  assert(!detailCalls.some(function(call) { return call.method === 'GET' }), '学生直接进入管理员详情页不得请求预约详情')
  assert(toastCalls.length === 1 && navCalls.some(function(call) { return call.type === 'reLaunch' && call.url === '/pages/login/login' }), '无管理员权限时应清楚提示并返回登录页')

  storage.userInfo.role = 'admin'
  request.get = function() { return Promise.reject(new Error('详情暂不可用')) }
  var failedDetailPage = loadPage('miniapp/pages/admin-reservation-detail/admin-reservation-detail.js')
  failedDetailPage.onLoad.call(failedDetailPage, { id: 501 })
  await flushPromises()
  assert(failedDetailPage.data.pageStatus === 'error' && failedDetailPage.data.reservation === null, '详情接口失败应进入错误状态且不得使用备用预约')
  assert(failedDetailPage.data.errorMessage.indexOf('详情暂不可用') !== -1, '详情错误状态应保留具体原因')

  const invalidDetailCalls = []
  request.get = function(url) { invalidDetailCalls.push(url); return Promise.resolve(Object.assign({}, detailFixture)) }
  ;[undefined, 0, -1, 1.5, Infinity, 'Infinity', 'not-a-number'].forEach(function(id) {
    var invalidDetailPage = loadPage('miniapp/pages/admin-reservation-detail/admin-reservation-detail.js')
    invalidDetailPage.onLoad.call(invalidDetailPage, id === undefined ? {} : { id: id })
    assert(invalidDetailPage.data.pageStatus === 'error' && invalidDetailPage.data.errorMessage === '预约编号无效', '非正整数预约编号应本地进入统一错误状态：' + String(id))
  })
  assert(invalidDetailCalls.length === 0, '非正整数预约编号不得发起详情请求')

  const raceDetailReads = [deferred(), deferred()]
  let raceDetailReadIndex = 0
  request.get = function() { return raceDetailReads[raceDetailReadIndex++].promise }
  var raceDetailPage = loadPage('miniapp/pages/admin-reservation-detail/admin-reservation-detail.js')
  raceDetailPage.onLoad.call(raceDetailPage, { id: 501 })
  raceDetailPage.loadDetail.call(raceDetailPage)
  raceDetailReads[1].resolve(Object.assign({}, detailFixture, { user_name: '最新申请人', status: 'pending' }))
  await flushPromises()
  raceDetailReads[0].resolve(Object.assign({}, detailFixture, { user_name: '过期申请人', status: 'approved' }))
  await flushPromises()
  assert(raceDetailPage.data.reservation.userName === '最新申请人' && raceDetailPage.data.reservation.status === 'pending', '旧详情响应晚到不得覆盖较新的详情结果')

  storage.userInfo.role = 'counselor'
  const downgradedDetailRead = deferred()
  request.get = function() { return downgradedDetailRead.promise }
  var downgradedDetailPage = loadPage('miniapp/pages/admin-reservation-detail/admin-reservation-detail.js')
  downgradedDetailPage.onLoad.call(downgradedDetailPage, { id: 501 })
  storage.userInfo.role = 'admin'
  downgradedDetailRead.resolve(Object.assign({}, detailFixture, { status: 'counselor_pending' }))
  await flushPromises()
  assert(downgradedDetailPage.data.pageStatus === 'ready' && !downgradedDetailPage.data.canApprove && !downgradedDetailPage.data.canReject, '详情请求期间角色降级后重点预约不得显示审批按钮')

  request.get = function() { return Promise.resolve(Object.assign({}, detailFixture, { status: 'approved', user_status: 'banned' })) }
  var bannedApplicantPage = loadPage('miniapp/pages/admin-reservation-detail/admin-reservation-detail.js')
  bannedApplicantPage.onLoad.call(bannedApplicantPage, { id: 501 })
  await flushPromises()
  assert(bannedApplicantPage.data.reservation.userStatusLabel === '已封禁', '已封禁账号应显示中文状态')

  detailFixture.status = 'pending'
  request.get = function() { return Promise.resolve(Object.assign({}, detailFixture)) }
  var duplicateDetailPage = loadPage('miniapp/pages/admin-reservation-detail/admin-reservation-detail.js')
  duplicateDetailPage.onLoad.call(duplicateDetailPage, { id: 501 })
  await flushPromises()
  const detailApproval = deferred()
  detailCalls.length = 0
  toastCalls.length = 0
  request.post = function(url, body, options) {
    detailCalls.push({ method: 'POST', url: url, body: body || {}, options: options || {} })
    return detailApproval.promise
  }
  modalResponse = { confirm: true, content: '' }
  duplicateDetailPage.onApprove.call(duplicateDetailPage)
  duplicateDetailPage.onApprove.call(duplicateDetailPage)
  assert(detailCalls.filter(function(call) { return call.url === '/audit/501/approve' }).length === 1, '详情审批处理中不得重复提交')
  assert(detailCalls[0].options.silent === true && duplicateDetailPage.data.processing, '详情审批应静默请求且提交期间锁定操作')
  detailApproval.reject({ message: '预约状态已变化' })
  await flushPromises()
  assert(!duplicateDetailPage.data.processing, '详情审批失败后必须释放操作锁')
  assert(toastCalls.length === 1 && toastCalls[0].title === '预约状态已变化', '详情审批失败只提示一次服务端具体原因')

  detailCalls.length = 0
  toastCalls.length = 0
  modalResponse = { confirm: true, content: '   ' }
  duplicateDetailPage.onReject.call(duplicateDetailPage)
  assert(!detailCalls.some(function(call) { return call.method === 'POST' }), '详情拒绝理由为空时不得提交')
  assert(toastCalls.length === 1, '详情拒绝理由为空时应给出明确提示')

  storage.userInfo.role = 'admin'
  detailFixture.status = 'pending'
  const successfulDetailCalls = []
  request.get = function(url, params, options) {
    successfulDetailCalls.push({ method: 'GET', url: url, options: options || {} })
    return Promise.resolve(Object.assign({}, detailFixture))
  }
  request.post = function(url, body, options) {
    successfulDetailCalls.push({ method: 'POST', url: url, body: body || {}, options: options || {} })
    return Promise.resolve({})
  }
  const emittedDetailEvents = []
  var successfulDetailPage = loadPage('miniapp/pages/admin-reservation-detail/admin-reservation-detail.js')
  successfulDetailPage.getOpenerEventChannel = function() {
    return { emit: function(name, payload) { emittedDetailEvents.push({ name: name, payload: payload }) } }
  }
  successfulDetailPage.onLoad.call(successfulDetailPage, { id: 501 })
  await flushPromises()
  modalResponse = { confirm: true, content: '' }
  successfulDetailPage.onApprove.call(successfulDetailPage)
  await flushPromises()
  await flushPromises()
  assert(successfulDetailCalls.some(function(call) { return call.method === 'POST' && call.url === '/audit/501/approve' && call.options.silent === true }), '详情通过成功路径应调用静默审核接口')
  assert(successfulDetailCalls.filter(function(call) { return call.method === 'GET' && call.url === '/reservation/501' }).length === 2, '详情通过成功后应重新读取最新详情')
  assert(emittedDetailEvents.some(function(event) { return event.name === 'reservationUpdated' && event.payload.id === 501 }), '详情通过成功后应通知来源页刷新')
  modalResponse = { confirm: true, content: '材料不符合要求' }
  successfulDetailPage.onReject.call(successfulDetailPage)
  await flushPromises()
  await flushPromises()
  assert(successfulDetailCalls.some(function(call) { return call.method === 'POST' && call.url === '/audit/501/reject' && call.body.reason === '材料不符合要求' && call.options.silent === true }), '详情拒绝成功路径应提交必填理由')
  assert(successfulDetailCalls.filter(function(call) { return call.method === 'GET' && call.url === '/reservation/501' }).length === 3, '详情拒绝成功后也应重新读取最新详情')

  const detailSource = fs.readFileSync(path.join(root, 'miniapp/pages/admin-reservation-detail/admin-reservation-detail.js'), 'utf8')
  const detailWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-reservation-detail/admin-reservation-detail.wxml'), 'utf8')
  const detailWxss = fs.readFileSync(path.join(root, 'miniapp/pages/admin-reservation-detail/admin-reservation-detail.wxss'), 'utf8')
  assert(detailSource.indexOf('approvalPresenter.toCard') !== -1 && detailSource.indexOf('adminPolicy.can') !== -1, '管理员详情应复用审批展示转换并按能力判断操作')
  assert(detailWxml.indexOf('重新加载') !== -1 && detailWxml.indexOf('重点审批说明') !== -1, '管理员详情应包含错误重试和重点审批说明')
  assert(detailWxml.indexOf('aria-label="通过预约"') !== -1 && detailWxml.indexOf('aria-label="拒绝预约"') !== -1, '详情审批关键操作应有无障碍名称')
  assert(/\.action-button\s*\{[^}]*min-height:\s*88rpx/.test(detailWxss), '详情审批触控高度应不小于 88rpx')
  assert(detailWxss.indexOf('safe-area-inset-bottom') !== -1, '详情底部操作区不得遮挡系统安全区')

  request.get = originalGet
  request.post = originalPost
  modalResponse = { confirm: true, content: '' }

  storage.userInfo.role = 'admin'
  request.get = function(url) {
    if (url === '/stats/dashboard') return Promise.resolve({ todayReservations: 0, ordinaryPendingCount: 0, counselorPendingCount: 9, usingCount: 0, activeRoomCount: 0 })
    if (url === '/stats/usage-rate') return Promise.resolve([{ room_id: 1, room_name: 'B102共享空间', reservation_count: 0, used_days: 0 }])
    if (url === '/stats/noshow') return Promise.resolve({})
    if (url === '/stats/users') return Promise.resolve({ creditDistribution: [{ level: 'future_level', count: '2' }] })
    return Promise.resolve({})
  }
  var statsPage = loadPage('miniapp/pages/admin-stats/admin-stats.js')
  statsPage.onLoad.call(statsPage)
  await flushPromises()
  assert(statsPage.data.pageStatus === 'ready', '统计页合法零值和缺省结构应正常进入就绪状态')
  assert(statsPage.data.showCounselorPending === false && statsPage.data.dashboard.activeRoomCount === 0, '导生管理员应隐藏重点待审并保留合法零值')
  assert(statsPage.data.noshow.totalNoshow === 0 && Array.isArray(statsPage.data.noshow.topNoshowUsers), '统计页应归一化缺失的爽约结构')
  assert(Array.isArray(statsPage.data.creditDistribution) && statsPage.data.creditDistribution[0].levelLabel === '未知', '未知信用等级不得误显示为封禁')

  storage.userInfo.role = 'counselor'
  statsPage = loadPage('miniapp/pages/admin-stats/admin-stats.js')
  statsPage.onLoad.call(statsPage)
  await flushPromises()
  assert(statsPage.data.showCounselorPending === true && statsPage.data.dashboard.counselorPendingCount === 9, '辅导员应显示重点待审')

  var statsShouldFail = true
  request.get = function(url) {
    if (statsShouldFail && url === '/stats/dashboard') return Promise.reject(new Error('network unavailable'))
    if (url === '/stats/dashboard') return Promise.resolve({ ordinaryPendingCount: 3 })
    if (url === '/stats/usage-rate') return Promise.resolve([])
    if (url === '/stats/noshow') return Promise.resolve(null)
    if (url === '/stats/users') return Promise.resolve({ creditDistribution: null })
    return Promise.resolve({})
  }
  statsPage = loadPage('miniapp/pages/admin-stats/admin-stats.js')
  statsPage.onLoad.call(statsPage)
  await flushPromises()
  assert(statsPage.data.pageStatus === 'error' && statsPage.data.errorMessage, '统计页任一接口失败应进入明确错误状态')
  statsShouldFail = false
  await statsPage.onRetry.call(statsPage)
  assert(statsPage.data.pageStatus === 'ready' && statsPage.data.dashboard.ordinaryPendingCount === 3, '统计页重新加载应恢复可信数据')
  assert(Array.isArray(statsPage.data.creditDistribution) && statsPage.data.creditDistribution.length === 0, '统计页应把异常信用分布归一化为空列表')

  var firstStatsBatch = {
    '/stats/dashboard': deferred(),
    '/stats/usage-rate': deferred(),
    '/stats/noshow': deferred(),
    '/stats/users': deferred()
  }
  var useFreshStats = false
  request.get = function(url) {
    if (!useFreshStats) return firstStatsBatch[url].promise
    if (url === '/stats/dashboard') return Promise.resolve({ todayReservations: 22, ordinaryPendingCount: 4 })
    if (url === '/stats/usage-rate') return Promise.resolve([])
    if (url === '/stats/noshow') return Promise.resolve({ totalNoshow: 0, topNoshowUsers: [], roomNoshowStats: [] })
    if (url === '/stats/users') return Promise.resolve({ creditDistribution: [] })
    return Promise.resolve({})
  }
  storage.userInfo.role = 'admin'
  statsPage = loadPage('miniapp/pages/admin-stats/admin-stats.js')
  statsPage.onLoad.call(statsPage)
  useFreshStats = true
  await statsPage.loadData.call(statsPage)
  firstStatsBatch['/stats/dashboard'].resolve({ todayReservations: 1, ordinaryPendingCount: 1 })
  firstStatsBatch['/stats/usage-rate'].resolve([])
  firstStatsBatch['/stats/noshow'].resolve({})
  firstStatsBatch['/stats/users'].resolve({ creditDistribution: [] })
  await flushPromises()
  assert(statsPage.data.dashboard.todayReservations === 22, '统计页旧请求不得覆盖较新的刷新结果')

  var roleBatch = {
    '/stats/dashboard': deferred(),
    '/stats/usage-rate': deferred(),
    '/stats/noshow': deferred(),
    '/stats/users': deferred()
  }
  var roleRequestCount = 0
  request.get = function(url) {
    roleRequestCount += 1
    if (roleRequestCount <= 4) return roleBatch[url].promise
    if (url === '/stats/dashboard') return Promise.resolve({ ordinaryPendingCount: 8, counselorPendingCount: 0 })
    if (url === '/stats/usage-rate') return Promise.resolve([])
    if (url === '/stats/noshow') return Promise.resolve({})
    if (url === '/stats/users') return Promise.resolve({ creditDistribution: [] })
    return Promise.resolve({})
  }
  storage.userInfo.role = 'counselor'
  statsPage = loadPage('miniapp/pages/admin-stats/admin-stats.js')
  statsPage.onLoad.call(statsPage)
  storage.userInfo.role = 'admin'
  roleBatch['/stats/dashboard'].resolve({ ordinaryPendingCount: 1, counselorPendingCount: 99 })
  roleBatch['/stats/usage-rate'].resolve([])
  roleBatch['/stats/noshow'].resolve({})
  roleBatch['/stats/users'].resolve({ creditDistribution: [] })
  await flushPromises()
  await flushPromises()
  assert(statsPage.data.showCounselorPending === false && statsPage.data.dashboard.ordinaryPendingCount === 8, '请求中角色变化后应丢弃旧范围数据并按新角色重载')

  request.get = originalGet
  const statsSource = fs.readFileSync(path.join(root, 'miniapp/pages/admin-stats/admin-stats.js'), 'utf8')
  const statsWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-stats/admin-stats.wxml'), 'utf8')
  assert(statsSource.indexOf('reservation_count / 30') === -1, '统计页不得用预约次数伪造使用率')
  assert(statsSource.indexOf('formatPercent') === -1, '统计页不得保留伪百分比格式化逻辑')
  assert(statsWxml.indexOf('item.roomName') !== -1, '排行应使用统一房间名称字段')
  assert(statsWxml.indexOf('item.displayRate') === -1, '排行不得显示伪百分比')
  assert(statsWxml.indexOf('加载失败') !== -1 && statsWxml.indexOf('重新加载') !== -1, '统计页应提供失败重试')
  assert(statsWxml.indexOf('近 30 天暂无已通过或已使用预约') !== -1, '统计排行空态应解释有效记录口径')

  function findManageItem(page, key) {
    var items = (page.data.groups || []).reduce(function(all, group) { return all.concat(group.items || []) }, [])
    return items.find(function(item) { return item.key === key })
  }

  storage.userInfo.role = 'counselor'
  request.get = function(url) {
    assert(url === '/stats/dashboard', '管理页待办数只应请求统计概览')
    return Promise.resolve({ ordinaryPendingCount: 4, counselorPendingCount: 7 })
  }
  var manageBadgePage = loadPage('miniapp/pages/admin-manage/admin-manage.js')
  manageBadgePage.onShow.call(manageBadgePage)
  await flushPromises()
  assert(findManageItem(manageBadgePage, 'pending').badge === 4, '普通预约审核应显示普通待审数量')
  assert(findManageItem(manageBadgePage, 'counselorPending').badge === 7, '重点预约审核应显示辅导员重点待审数量')

  request.get = function() { return Promise.reject(new Error('network unavailable')) }
  manageBadgePage = loadPage('miniapp/pages/admin-manage/admin-manage.js')
  manageBadgePage.onShow.call(manageBadgePage)
  await flushPromises()
  assert(findManageItem(manageBadgePage, 'pending') && findManageItem(manageBadgePage, 'counselorPending'), '待办数失败时仍应保留审核入口')
  assert(findManageItem(manageBadgePage, 'pending').badge === undefined && findManageItem(manageBadgePage, 'counselorPending').badge === undefined, '待办数失败时应隐藏徽标')

  var failedRoleStats = deferred()
  request.get = function() { return failedRoleStats.promise }
  storage.userInfo.role = 'counselor'
  manageBadgePage = loadPage('miniapp/pages/admin-manage/admin-manage.js')
  manageBadgePage.onShow.call(manageBadgePage)
  storage.userInfo.role = 'admin'
  failedRoleStats.reject(new Error('network unavailable'))
  await flushPromises()
  assert(findManageItem(manageBadgePage, 'pending') && !findManageItem(manageBadgePage, 'counselorPending'), '待办请求失败且角色变化时应立即按当前角色重建菜单')
  assert(findManageItem(manageBadgePage, 'pending').badge === undefined, '待办请求失败且角色变化时应隐藏旧徽标')

  var staleManageStats = deferred()
  var useFreshManageStats = false
  request.get = function() {
    if (!useFreshManageStats) return staleManageStats.promise
    return Promise.resolve({ ordinaryPendingCount: 8, counselorPendingCount: 5 })
  }
  storage.userInfo.role = 'counselor'
  manageBadgePage = loadPage('miniapp/pages/admin-manage/admin-manage.js')
  manageBadgePage.onShow.call(manageBadgePage)
  useFreshManageStats = true
  manageBadgePage.onShow.call(manageBadgePage)
  await flushPromises()
  staleManageStats.resolve({ ordinaryPendingCount: 1, counselorPendingCount: 99 })
  await flushPromises()
  assert(findManageItem(manageBadgePage, 'pending').badge === 8 && findManageItem(manageBadgePage, 'counselorPending').badge === 5, '管理页旧统计响应不得覆盖较新的待办数')

  var roleManageStats = deferred()
  var roleManageCallCount = 0
  request.get = function() {
    roleManageCallCount += 1
    if (roleManageCallCount === 1) return roleManageStats.promise
    return Promise.resolve({ ordinaryPendingCount: 6, counselorPendingCount: 88 })
  }
  storage.userInfo.role = 'counselor'
  manageBadgePage = loadPage('miniapp/pages/admin-manage/admin-manage.js')
  manageBadgePage.onShow.call(manageBadgePage)
  storage.userInfo.role = 'admin'
  manageBadgePage.onShow.call(manageBadgePage)
  await flushPromises()
  roleManageStats.resolve({ ordinaryPendingCount: 1, counselorPendingCount: 99 })
  await flushPromises()
  assert(findManageItem(manageBadgePage, 'pending').badge === 6 && !findManageItem(manageBadgePage, 'counselorPending'), '管理页角色变化后应丢弃旧范围响应并按新角色刷新菜单')
  request.get = originalGet

  const manageSource = fs.readFileSync(path.join(root, 'miniapp/pages/admin-manage/admin-manage.js'), 'utf8')
  const manageWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-manage/admin-manage.wxml'), 'utf8')
  const manageWxss = fs.readFileSync(path.join(root, 'miniapp/pages/admin-manage/admin-manage.wxss'), 'utf8')
  assert(manageSource.indexOf("name: '普通预约审核'") !== -1 && manageSource.indexOf('共享空间等普通待审预约') !== -1, '普通审核入口应使用管理员能理解的名称和范围说明')
  assert(manageSource.indexOf("name: '重点预约审核'") !== -1 && manageSource.indexOf('处理需辅导员把关的特殊空间预约') !== -1, '重点审核入口应准确说明需辅导员把关的特殊空间预约')
  assert(manageWxml.indexOf('entry.badge') !== -1, '管理页审核入口应能展示待办徽标')
  assert(/padding:[^;]*calc\(180rpx \+ env\(safe-area-inset-bottom\)\)/.test(manageWxss), '管理页底部应为固定导航和安全区留足空间')
  assert(manageWxss.indexOf('#667085') !== -1, '管理页说明文字颜色不应过浅')

  const navComponent = loadComponent('miniapp/components/admin-nav/admin-nav.js')
  navComponent.data.selected = 'home'
  navCalls.length = 0
  var originalRedirectTo = wx.redirectTo
  var pendingRedirectOptions = null
  wx.redirectTo = function(options) {
    pendingRedirectOptions = options
    navCalls.push({ type: 'redirectTo', url: options.url })
  }
  navComponent.onTap.call(navComponent, { currentTarget: { dataset: { item: navComponent.data.items[1] } } })
  navComponent.onTap.call(navComponent, { currentTarget: { dataset: { item: navComponent.data.items[2] } } })
  assert(navCalls.length === 1 && navCalls[0].url === '/pages/admin-manage/admin-manage', '管理员底栏快速连续点击只应发起一次切页')
  pendingRedirectOptions.fail({ errMsg: 'redirectTo:fail' })
  navComponent.onTap.call(navComponent, { currentTarget: { dataset: { item: navComponent.data.items[2] } } })
  assert(navCalls.length === 2 && navCalls[1].url === '/pages/admin-profile/admin-profile', '管理员底栏切页失败后应释放点击锁')
  pendingRedirectOptions.complete()
  navComponent.onTap.call(navComponent, { currentTarget: { dataset: { item: navComponent.data.items[1] } } })
  assert(navCalls.length === 3, '管理员底栏切页完成后应释放点击锁')
  assert(!navCalls.some(function(call) { return call.type === 'reLaunch' }), '管理员底栏切页不得使用 reLaunch')
  wx.redirectTo = originalRedirectTo
  const navSource = fs.readFileSync(path.join(root, 'miniapp/components/admin-nav/admin-nav.js'), 'utf8')
  const navWxml = fs.readFileSync(path.join(root, 'miniapp/components/admin-nav/admin-nav.wxml'), 'utf8')
  assert(navSource.indexOf("iconPath: '/images/") !== -1 && navSource.indexOf('selectedIconPath') !== -1, '管理员底栏三项应配置真实普通和选中图标')
  assert(navWxml.indexOf('<image') !== -1 && navWxml.indexOf('mode="aspectFit"') !== -1, '管理员底栏应使用等比图片图标')
  navComponent.data.items.forEach(function(item) {
    ;[item.iconPath, item.selectedIconPath].forEach(function(iconPath) {
      assert(iconPath && fs.existsSync(path.join(root, 'miniapp', iconPath.replace(/^\//, ''))), '管理员底栏图标文件必须真实存在: ' + iconPath)
    })
  })

  const customTabSource = fs.readFileSync(path.join(root, 'miniapp/custom-tab-bar/index.js'), 'utf8')
  assert(customTabSource.indexOf('adminList') === -1 && customTabSource.indexOf('auth.isAdmin') === -1, '自定义学生底栏应删除未使用的管理员分支')
  assert(customTabSource.indexOf('studentList') !== -1 && customTabSource.indexOf('wx.switchTab') !== -1, '删除管理员分支后学生底栏逻辑必须保留')
  const studentTab = loadComponent('miniapp/custom-tab-bar/index.js')
  studentTab.switchTabList.call(studentTab)
  assert(studentTab.data.list.length === 4 && studentTab.data.list[1].pagePath === '/pages/my-reservations/my-reservations', '学生底栏应继续装载四个原有入口')
  navCalls.length = 0
  studentTab.onTabTap.call(studentTab, { currentTarget: { dataset: { index: 1, path: '/pages/my-reservations/my-reservations' } } })
  assert(navCalls.length === 1 && navCalls[0].type === 'switchTab' && navCalls[0].url === '/pages/my-reservations/my-reservations', '学生底栏点击预约应继续使用 switchTab 实际切页')

  const profileWxml = fs.readFileSync(path.join(root, 'miniapp/pages/admin-profile/admin-profile.wxml'), 'utf8')
  const profileWxss = fs.readFileSync(path.join(root, 'miniapp/pages/admin-profile/admin-profile.wxss'), 'utf8')
  assert(profileWxml.indexOf('账号与设置') !== -1, '管理员个人页标题应为账号与设置')
  assert(/padding:[^;]*calc\(180rpx \+ env\(safe-area-inset-bottom\)\)/.test(profileWxss), '账号与设置页底部应为固定导航和安全区留足空间')
  assert(profileWxss.indexOf('#667085') !== -1, '账号与设置页说明文字颜色不应过浅')

  ;['admin', 'counselor', 'super_admin'].forEach(function(role) {
    storage.userInfo.role = role
    var roleProfilePage = loadPage('miniapp/pages/admin-profile/admin-profile.js')
    roleProfilePage.onLoad.call(roleProfilePage)
    var networkItem = roleProfilePage.data.menuList.find(function(item) { return item.key === 'network' })
    var passwordItem = roleProfilePage.data.menuList.find(function(item) { return item.key === 'password' })
    assert(networkItem.name === '连接检查' && networkItem.desc === '检查当前是否能正常连接预约服务', '三类管理员均应看到面向使用者的连接检查说明')
    if (role === 'super_admin') {
      assert(passwordItem.desc.indexOf('电脑后台') !== -1, '超级管理员账号安全说明应指向电脑后台管理')
    } else {
      assert(passwordItem.desc.indexOf('超级管理员') !== -1, role + ' 账号安全说明应提示联系超级管理员')
    }
  })
  const profilePage = loadPage('miniapp/pages/admin-profile/admin-profile.js')
  const profileKeys = (profilePage.data.menuList || []).map(function(item) { return item.key })
  ;['reservation', 'rooms', 'users', 'feedback', 'announcement', 'stats'].forEach(function(key) {
    assert(profileKeys.indexOf(key) === -1, '管理员我的页不应重复放置业务管理入口：' + key)
  })
  ;['account', 'network', 'password', 'logout'].forEach(function(key) {
    assert(profileKeys.indexOf(key) !== -1, '管理员我的页应保留个人/系统入口：' + key)
  })

  const appJson = require('../miniapp/app.json')
  assert(appJson.pages.indexOf('pages/admin-stats/admin-stats') !== -1, 'app.json 应注册管理员数据统计页')
  assert(appJson.pages.indexOf('pages/admin-credit/admin-credit') !== -1, 'app.json 应注册管理员信用管理页')

  console.log('admin-miniapp-regression-check passed')
}

main().catch(function(err) {
  console.error(err.message)
  process.exitCode = 1
})
