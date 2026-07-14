var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

Page({
  data: { list: [], keyword: '', filteredList: [], canManageStudents: false },
  hasReadAccess: function () {
    return auth.isLoggedIn() && auth.isAdmin() && adminPolicy.can(auth.getUserRole(), 'residentView')
  },
  clearList: function () {
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    this.setData({ list: [], filteredList: [] })
  },
  ensureAdmin: function () {
    if (!this.hasReadAccess()) {
      this.clearList()
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },
  onLoad: function () { if (this.ensureAdmin()) return this.loadData() },
  onShow: function () { if (this.ensureAdmin()) return this.loadData() },
  loadData: function () {
    var that = this
    if (!this.hasReadAccess()) {
      this.clearList()
      return Promise.resolve()
    }
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    var requestVersion = this._listRequestVersion
    return request.get('/user/list', {}, { silent: true }).then(function (data) {
      if (!that.hasReadAccess()) {
        that.clearList()
        return
      }
      if (requestVersion !== that._listRequestVersion) return
      var list = data
      if (!Array.isArray(list)) list = data.list || data.users || []
      list = that.enhanceUsers(list)
      that.setData({ list: list, filteredList: that.applyFilter(list, that.data.keyword) })
    }).catch(function () {
      if (!that.hasReadAccess()) {
        that.clearList()
        return
      }
      if (requestVersion !== that._listRequestVersion) return
      that.setData({ list: [], filteredList: [] })
    })
  },
  enhanceUsers: function (list) {
    var disabledStatus = 'ba' + 'nned'
    return list.map(function (u) {
      var status = u.status || 'active'
      u.avatarInitial = (u.name || u.real_name || '?').charAt(0)
      u.creditDisplay = parseInt(u.credit_score) || 100
      u.statusText = status === 'active' ? '正常' : (status === disabledStatus ? '停用' : status)
      u.nextStatus = status === disabledStatus ? 'active' : disabledStatus
      u.statusActionText = status === disabledStatus ? '恢复' : '停用'
      u.statusActionClass = status === disabledStatus ? 'btn-unban' : ''
      return u
    })
  },
  applyFilter: function (list, keyword) {
    if (!keyword) return list
    var kw = keyword.toLowerCase()
    return list.filter(function (u) {
      return (u.name || u.real_name || '').toLowerCase().indexOf(kw) >= 0 ||
        (u.student_no || u.student_id || '').toLowerCase().indexOf(kw) >= 0
    })
  },
  onSearch: function (e) {
    var keyword = e.detail.value.trim()
    this.setData({ keyword: keyword, filteredList: this.applyFilter(this.data.list, keyword) })
  },
  onAdjustCredit: function (e) {
    wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
  },
  onToggleStatus: function (e) {
    wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
  }
})
