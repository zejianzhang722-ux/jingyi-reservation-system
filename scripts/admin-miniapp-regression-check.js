const path = require('path')

const root = path.resolve(__dirname, '..')
const storage = {
  token: 'admin-token',
  userInfo: { id: 1, role: 'admin', name: '管理员' }
}
const navCalls = []

global.wx = {
  getStorageSync: function(key) { return storage[key] },
  setStorageSync: function(key, value) { storage[key] = value },
  removeStorageSync: function(key) { delete storage[key] },
  navigateTo: function(options) { navCalls.push({ type: 'navigateTo', url: options.url }) },
  reLaunch: function(options) { navCalls.push({ type: 'reLaunch', url: options.url }) },
  showToast: function() {},
  showModal: function() {}
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
