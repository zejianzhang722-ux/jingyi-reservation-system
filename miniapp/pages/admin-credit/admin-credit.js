var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

var violationTab = { key: 'violations', name: '违规记录' }
var blacklistTab = { key: 'blacklist', name: '黑名单' }

Page({
  data: {
    activeTab: 'violations',
    tabs: [violationTab],
    violations: [],
    blacklist: [],
    loading: true
  },

  onLoad: function (options) {
    if (!this.ensureAdmin()) return
    var role = auth.getUserRole()
    var tabs = adminPolicy.can(role, 'blacklistManage') ? [violationTab, blacklistTab] : [violationTab]
    var requestedTab = options && options.tab
    var activeTab = tabs.some(function (tab) { return tab.key === requestedTab }) ? requestedTab : 'violations'
    this.setData({ tabs: tabs, activeTab: activeTab })
    return this.loadData()
  },

  ensureAdmin: function () {
    var role = auth.getUserRole()
    if (!auth.isLoggedIn() || !auth.isAdmin() || !adminPolicy.can(role, 'violationView')) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  onTabTap: function (e) {
    var key = e.currentTarget.dataset.key
    var visible = this.data.tabs.some(function (tab) { return tab.key === key })
    this.setData({ activeTab: visible ? key : 'violations' })
    return this.loadData()
  },

  loadData: function () {
    if (this.data.activeTab === 'violations') return this.loadViolations()
    if (this.data.activeTab === 'blacklist' && adminPolicy.can(auth.getUserRole(), 'blacklistManage')) return this.loadBlacklist()
    this.setData({ activeTab: 'violations' })
    return this.loadViolations()
  },

  loadViolations: function () {
    var that = this
    this.setData({ loading: true })
    return request.get('/credit/violations', { page: 1, pageSize: 20 }, { silent: true }).then(function (data) {
      var list = Array.isArray(data) ? data : (data.list || [])
      that.setData({ violations: list, loading: false })
    }).catch(function () {
      that.setData({ violations: [], loading: false })
      wx.showToast({ title: '违规记录加载失败', icon: 'none' })
    })
  },

  loadBlacklist: function () {
    var that = this
    this.setData({ loading: true })
    return request.get('/credit/blacklist', {}, { silent: true }).then(function (data) {
      that.setData({ blacklist: Array.isArray(data) ? data : [], loading: false })
    }).catch(function () {
      that.setData({ blacklist: [], loading: false })
      wx.showToast({ title: '黑名单加载失败', icon: 'none' })
    })
  },

  onUnban: function (e) {
    if (!adminPolicy.can(auth.getUserRole(), 'blacklistManage')) {
      wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
      return
    }
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
