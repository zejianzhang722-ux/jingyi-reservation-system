const path = require('path')

const root = path.resolve(__dirname, '..')
const navCalls = []

global.wx = {
  getStorageSync: function() { return null },
  setStorageSync: function() {},
  removeStorageSync: function() {},
  navigateTo: function(options) { navCalls.push(options.url) },
  showToast: function() {},
  setNavigationBarTitle: function() {},
  stopPullDownRefresh: function() {},
  navigateBack: function() {}
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
  assert(pageConfig, relativePath + ' did not register Page')
  pageConfig.data = JSON.parse(JSON.stringify(pageConfig.data || {}))
  pageConfig.setData = function(next) {
    Object.keys(next).forEach(function(key) {
      pageConfig.data[key] = next[key]
    })
  }
  pageConfig.selectComponent = function() { return null }
  return pageConfig
}

async function main() {
  const request = require('../miniapp/utils/request')
  const originalGet = request.get
  const requestCalls = []
  request.get = function(url, params) {
    requestCalls.push({ url: url, params: params || {} })
    return Promise.resolve({})
  }

  const detailPage = loadPage('miniapp/pages/room-detail/room-detail.js')
  detailPage.setData({ room: { name: 'Missing id room', type: 'seminar_room' }, loading: false })
  detailPage.onReserveTap()
  assert(navCalls.length === 0, 'room detail navigated before a valid room id was ready')

  const timelinePage = loadPage('miniapp/pages/room-timeline/room-timeline.js')
  timelinePage.setData({ roomId: '', selectedDate: '2026-06-03', loading: false })
  await timelinePage.loadTimeline()
  assert(
    !requestCalls.some(function(call) { return call.url.indexOf('/room//timeline') !== -1 }),
    'timeline requested an empty room id URL'
  )

  request.get = originalGet
  console.log('miniapp-room-navigation-check passed')
  process.exit(0)
}

main().catch(function(err) {
  console.error(err.message)
  process.exit(1)
})
