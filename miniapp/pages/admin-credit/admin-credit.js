var request = require('../../utils/request')
var auth = require('../../utils/auth')

function pickList(data) {
  if (Array.isArray(data)) return data
  return (data && (data.list || data.items || data.records || data.blacklist || data.violations)) || []
}

function maskConfigKey(key) {
  var hiddenKeys = ['jwt', 'token', 'secret', 'password', 'appid', 'app_secret', 'template', 'database', 'db_', 'mysql']
  var lower = String(key || '').toLowerCase()
  return hiddenKeys.some(function (item) { return lower.indexOf(item) >= 0 })
}

Page({
  data: {
    activeTab: 'violations',
    tabs: [
      { key: 'violations', name: '违规记录' },
      { key: 'blacklist', name: '黑名单' },
      { key: 'config', name: '信用配置' }
    ],
    violations: [],
    blacklist: [],
    configList: [],
    loading: true
  },

  onLoad: function () {
    if (!this.ensureAdmin()) return
    this.loadData()
  },

  ensureAdmin: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  onTabTap: function (e) {
    this.setData({ activeTab: e.currentTarget.dataset.key, loading: true })
    this.loadData()
  },

  loadData: function () {
    if (this.data.activeTab === 'violations') return this.loadViolations()
    if (this.data.activeTab === 'blacklist') return this.loadBlacklist()
    return this.loadConfig()
  },

  loadViolations: function () {
    var that = this
    this.setData({ loading: true })
    return request.get('/credit/violations', { page: 1, pageSize: 20 }, { silent: true }).then(function (data) {
      that.setData({ violations: pickList(data), loading: false })
    }).catch(function () {
      that.setData({ violations: [], loading: false })
      wx.showToast({ title: '违规记录加载失败', icon: 'none' })
    })
  },

  loadBlacklist: function () {
    var that = this
    this.setData({ loading: true })
    return request.get('/credit/blacklist', {}, { silent: true }).then(function (data) {
      that.setData({ blacklist: pickList(data), loading: false })
    }).catch(function () {
      that.setData({ blacklist: [], loading: false })
      wx.showToast({ title: '黑名单加载失败', icon: 'none' })
    })
  },

  loadConfig: function () {
    var that = this
    this.setData({ loading: true })
    return request.get('/admin/config', {}, { silent: true }).then(function (data) {
      var list = Object.keys(data || {}).filter(function (key) {
        return !maskConfigKey(key)
      }).map(function (key) {
        return { key: key, value: data[key] }
      })
      that.setData({ configList: list, loading: false })
    }).catch(function () {
      that.setData({ configList: [], loading: false })
      wx.showToast({ title: '信用配置加载失败', icon: 'none' })
    })
  },

  onGoUsers: function () {
    wx.navigateTo({ url: '/pages/admin-users/admin-users' })
  },

  onUnban: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '解除限制',
      content: '确认将该宿生恢复为正常状态？',
      success: function (res) {
        if (res.confirm) {
          request.put('/credit/blacklist/' + id, { action: 'unban' }).then(function () {
            wx.showToast({ title: '已解除', icon: 'success' })
            that.loadBlacklist()
          }).catch(function () {
            wx.showToast({ title: '操作失败', icon: 'none' })
          })
        }
      }
    })
  }
})
