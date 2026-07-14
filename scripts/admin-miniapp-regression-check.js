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
  assert(navCalls[0] && navCalls[0].url === '/pages/admin-home/admin-home?queueType=admin', '普通审核入口应明确携带 admin 队列参数')
  navCalls.length = 0
  managePage.onItemTap({ currentTarget: { dataset: { key: 'counselorPending' } } })
  assert(navCalls[0] && navCalls[0].url === '/pages/admin-home/admin-home?queueType=counselor', '辅导员重点审核入口应明确携带 counselor 队列参数')
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

  ;['counselor', 'super_admin'].forEach(function(role) {
    storage.userInfo.role = role
    capabilityCalls.length = 0
    request.get = function(url, params) {
      capabilityCalls.push({ method: 'GET', url: url, params: params || {} })
      return Promise.resolve({ list: [{ id: 101, status: 'pending', title: '迎新海报' }], total: 1, page: 1, pageSize: 20 })
    }
    posterPage = loadPage('miniapp/pages/admin-poster/admin-poster.js')
    posterPage.onLoad.call(posterPage)
    assert(!capabilityCalls.some(function(call) { return call.url === '/poster' }), role + ' 海报页 onLoad 只初始化，不应重复读取')
    posterPage.onShow.call(posterPage)
  })
  await flushPromises()
  var posterReadCalls = capabilityCalls.filter(function(call) { return call.method === 'GET' && call.url === '/poster' })
  assert(posterReadCalls.length === 1, '海报页首次 onLoad + onShow 只能读取一次')
  assert(posterReadCalls[0].params.status === 'pending' && posterReadCalls[0].params.page === 1 && posterReadCalls[0].params.pageSize === 20, '海报页应请求待审核第一页并固定每页 20 条')
  assert(posterPage.data.list.length === 1 && posterPage.data.list[0].id === 101, '海报页应解析分页响应 data.list')

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
  request.get = function(url, params) {
    approvalCalls.push({ method: 'GET', url: url, params: params || {} })
    if (url === '/audit/pending') {
      return Promise.resolve({ list: [{ id: 101, status: params.type === 'counselor' ? 'counselor_pending' : 'pending' }], total: 1, page: 1, pageSize: 10 })
    }
    if (url === '/reservation') {
      return Promise.resolve({ list: [{ id: 101, status: 'pending' }, { id: 102, status: 'counselor_pending' }], total: 2, page: 1, pageSize: 20 })
    }
    if (url === '/reservation/pending-count') return Promise.resolve({ count: 1 })
    if (url === '/room/stats') return Promise.resolve({ activeRooms: 6, todayReservations: 2 })
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
  homePage.onLoad.call(homePage, { queueType: 'counselor' })
  assert(!approvalCalls.some(function(call) { return call.url === '/audit/pending' }), '首页 onLoad 只初始化，不应重复加载列表')
  homePage.onShow.call(homePage)
  await flushPromises()
  let pendingCall = approvalCalls.find(function(call) { return call.method === 'GET' && call.url === '/audit/pending' })
  assert(pendingCall && pendingCall.params.type === 'admin' && pendingCall.params.page === 1 && pendingCall.params.pageSize === 10, '普通审核入口应请求 admin 队列的 /audit/pending')
  assert(!approvalCalls.some(function(call) { return call.url === '/audit/pending' && call.params.type === 'counselor' }), '导生管理员不得请求 counselor 审核队列')
  assert(approvalCalls.some(function(call) { return call.url === '/reservation/pending-count' && call.params.type === 'admin' }), '待审核数量应明确请求 admin 队列')
  assert(homePage.data.queueType === 'admin' && homePage.data.queueLabel === '普通预约审核', '普通审核入口应显示普通队列标签')
  assert(homePage.data.pendingList.length === 1 && homePage.data.pendingList[0].id === 101, '审核列表应处理 list/total/page/pageSize 响应')
  assert(approvalCalls.filter(function(call) { return call.url === '/audit/pending' }).length === 1, '首页首次 onLoad + onShow 只能产生一轮列表请求')
  assert(!approvalCalls.some(function(call) { return call.url === '/feedback' }), '导生管理员不应请求反馈管理数据')

  approvalCalls.length = 0
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  await flushPromises()
  assert(approvalCalls.some(function(call) { return call.method === 'POST' && call.url === '/audit/101/approve' }), '批准应 POST /audit/101/approve')
  assert(approvalCalls.some(function(call) { return call.method === 'GET' && call.url === '/audit/pending' }), '批准成功后应从服务端重载审核列表')
  assert(approvalCalls.some(function(call) { return call.method === 'GET' && call.url === '/reservation/pending-count' }), '批准成功后应从服务端重载统计')

  approvalCalls.length = 0
  modalResponse = { confirm: true, content: '时间冲突' }
  homePage.onReject.call(homePage, { currentTarget: { dataset: { id: 101 } } })
  await flushPromises()
  assert(approvalCalls.some(function(call) { return call.method === 'POST' && call.url === '/audit/101/reject' && call.body.reason === '时间冲突' }), '拒绝应 POST /audit/101/reject 并传递理由')

  approvalCalls.length = 0
  storage.userInfo.role = 'counselor'
  homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  homePage.onLoad.call(homePage, {})
  homePage.onShow.call(homePage)
  await flushPromises()
  pendingCall = approvalCalls.find(function(call) { return call.method === 'GET' && call.url === '/audit/pending' })
  assert(pendingCall && pendingCall.params.type === 'counselor', '辅导员默认应请求 counselor 队列')
  assert(homePage.data.canSwitchQueue && homePage.data.queueLabel === '辅导员重点审核', '辅导员应可切换队列并显示重点审核标签')

  approvalCalls.length = 0
  storage.userInfo.role = 'super_admin'
  homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  homePage.onLoad.call(homePage, { queueType: 'admin' })
  homePage.onShow.call(homePage)
  await flushPromises()
  pendingCall = approvalCalls.find(function(call) { return call.method === 'GET' && call.url === '/audit/pending' })
  assert(pendingCall && pendingCall.params.type === 'admin', '超级管理员应消费明确的普通队列参数')
  approvalCalls.length = 0
  homePage = loadPage('miniapp/pages/admin-home/admin-home.js')
  homePage.onLoad.call(homePage, { queueType: 'counselor' })
  homePage.onShow.call(homePage)
  await flushPromises()
  pendingCall = approvalCalls.find(function(call) { return call.method === 'GET' && call.url === '/audit/pending' })
  assert(pendingCall && pendingCall.params.type === 'counselor', '超级管理员应消费明确的辅导员队列参数')

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
  assert(reservationPage.data.list[0].canAudit === true && reservationPage.data.list[1].canAudit === false, '导生管理员只能操作 pending 状态')
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
  homeStatsRefresh.resolve({ count: 0, activeRooms: 6, todayReservations: 2, total: 0 })
  await flushPromises()
  await flushPromises()
  assert(!homePage.data.processingById[101], '首页列表和统计刷新完成后应恢复该预约操作状态')

  const failedHomeApproval = deferred()
  request.post = function() { return failedHomeApproval.promise }
  homePage.onApprove.call(homePage, { currentTarget: { dataset: { id: 102 } } })
  failedHomeApproval.reject(new Error('expected failure'))
  await flushPromises()
  assert(!homePage.data.processingById[102], '首页审批失败后也应恢复该预约操作状态')

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

  const pendingCountRequests = [deferred(), deferred()]
  let pendingCountRequestIndex = 0
  request.get = function(url) {
    if (url === '/reservation/pending-count') return pendingCountRequests[pendingCountRequestIndex++].promise
    if (url === '/room/stats') return Promise.resolve({ activeRooms: 6, todayReservations: 2 })
    if (url === '/feedback') return Promise.resolve({ total: 3 })
    return Promise.resolve({})
  }
  homePage.loadStats.call(homePage)
  homePage.loadStats.call(homePage)
  pendingCountRequests[1].resolve({ count: 9 })
  await flushPromises()
  pendingCountRequests[0].resolve({ count: 2 })
  await flushPromises()
  assert(homePage.data.pendingCount === 9, '首页较旧的待审核数量响应不得覆盖最新统计')

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
  assert(counselorReservationPage.data.list.every(function(item) { return item.canAudit }), '辅导员可操作 pending 和 counselor_pending 状态')

  request.get = originalGet
  request.post = originalPost
  modalResponse = { confirm: true, content: '' }

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
