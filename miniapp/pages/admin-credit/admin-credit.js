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
    var requestedTab = options && options.tab
    this.syncRoleTabs(requestedTab)
    return this.loadData()
  },

  onShow: function () {
    if (!this.ensureAdmin()) return
    if (this.syncRoleTabs()) return this.loadData()
  },

  hasCapability: function (capability) {
    return auth.isLoggedIn() && auth.isAdmin() && adminPolicy.can(auth.getUserRole(), capability)
  },

  invalidateReads: function () {
    this._readVersion = (this._readVersion || 0) + 1
  },

  beginRead: function () {
    this.invalidateReads()
    return this._readVersion
  },

  syncRoleTabs: function (requestedTab) {
    var canManageBlacklist = this.hasCapability('blacklistManage')
    var tabs = canManageBlacklist ? [violationTab, blacklistTab] : [violationTab]
    var currentTab = requestedTab || this.data.activeTab
    var activeTab = tabs.some(function (tab) { return tab.key === currentTab }) ? currentTab : 'violations'
    var previousKeys = this.data.tabs.map(function (tab) { return tab.key }).join(',')
    var nextKeys = tabs.map(function (tab) { return tab.key }).join(',')
    var changed = previousKeys !== nextKeys || this.data.activeTab !== activeTab
    var nextData = { tabs: tabs, activeTab: activeTab }
    if (!canManageBlacklist) nextData.blacklist = []
    if (changed) {
      this.invalidateReads()
      nextData.loading = false
    }
    this.setData(nextData)
    return changed
  },

  clearForLostCapability: function (capability) {
    if (capability === 'blacklistManage' && this.hasCapability('violationView')) {
      this.syncRoleTabs()
      this.setData({ blacklist: [], loading: false })
      return
    }
    this.invalidateReads()
    this.setData({ violations: [], blacklist: [], loading: false, tabs: [violationTab], activeTab: 'violations' })
  },

  canApplyRead: function (version, capability) {
    if (!this.hasCapability(capability)) {
      this.clearForLostCapability(capability)
      return false
    }
    return version === this._readVersion
  },

  ensureAdmin: function () {
    if (!this.hasCapability('violationView')) {
      this.clearForLostCapability('violationView')
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  onTabTap: function (e) {
    if (!this.ensureAdmin()) return
    this.syncRoleTabs()
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
    var requestVersion = this.beginRead()
    this.setData({ loading: true })
    return request.get('/credit/violations', { page: 1, pageSize: 20 }, { silent: true }).then(function (data) {
      if (!that.canApplyRead(requestVersion, 'violationView')) return
      var list = Array.isArray(data) ? data : (data.list || [])
      that.setData({ violations: list, loading: false })
    }).catch(function () {
      if (!that.canApplyRead(requestVersion, 'violationView')) return
      that.setData({ violations: [], loading: false })
      wx.showToast({ title: '违规记录加载失败', icon: 'none' })
    })
  },

  loadBlacklist: function () {
    var that = this
    if (!this.hasCapability('blacklistManage')) {
      this.clearForLostCapability('blacklistManage')
      return Promise.resolve()
    }
    var requestVersion = this.beginRead()
    this.setData({ loading: true })
    return request.get('/credit/blacklist', {}, { silent: true }).then(function (data) {
      if (!that.canApplyRead(requestVersion, 'blacklistManage')) return
      that.setData({ blacklist: Array.isArray(data) ? data : [], loading: false })
    }).catch(function () {
      if (!that.canApplyRead(requestVersion, 'blacklistManage')) return
      that.setData({ blacklist: [], loading: false })
      wx.showToast({ title: '黑名单加载失败', icon: 'none' })
    })
  },

  onUnban: function (e) {
    if (!this.ensureBlacklistAction()) return
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '解除限制',
      content: '确认将该宿生恢复为正常状态？',
      success: function (res) {
        if (!res.confirm) return
        if (!that.ensureBlacklistAction()) return
        request.put('/credit/blacklist/' + id, { action: 'unban' }).then(function () {
          wx.showToast({ title: '已解除', icon: 'success' })
          that.loadBlacklist()
        }).catch(function () {
          wx.showToast({ title: '操作失败', icon: 'none' })
        })
      }
    })
  },

  ensureBlacklistAction: function () {
    if (!this.hasCapability('blacklistManage')) {
      this.clearForLostCapability('blacklistManage')
      wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
      wx.reLaunch({ url: auth.isLoggedIn() && auth.isAdmin() ? '/pages/admin-manage/admin-manage' : '/pages/login/login' })
      return false
    }
    return true
  }
})
