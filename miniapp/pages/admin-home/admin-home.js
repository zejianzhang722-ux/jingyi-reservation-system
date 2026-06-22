var request = require('../../utils/request')
var auth = require('../../utils/auth')

Page({
  data: {
    pendingCount: 0,
    todayReservations: 0,
    feedbackCount: 0,
    activeRooms: 0,
    pendingList: [],
    roleName: '管理员'
  },
  ensureAdmin: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },
  onLoad: function () {
    if (!this.ensureAdmin()) return
    var role = auth.getUserRole()
    var nameMap = { super_admin: '超级管理员', admin: '导生管理员', counselor: '书院辅导员' }
    this.setData({ roleName: nameMap[role] || '管理员' })
    this.loadStats()
    this.loadPendingList()
  },
  onShow: function () {
    if (!this.ensureAdmin()) return
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTabList()
      this.getTabBar().setData({ selected: 0 })
    }
    this.loadStats()
    this.loadPendingList()
  },
  loadStats: function () {
    var that = this
    request.get('/reservation/pending-count', {}, { silent: true }).then(function (data) {
      that.setData({ pendingCount: data.count || 0 })
    }).catch(function () {})
    request.get('/room/stats', {}, { silent: true }).then(function (data) {
      that.setData({ activeRooms: data.activeRooms || 12, todayReservations: data.todayReservations || 0 })
    }).catch(function () {
      that.setData({ activeRooms: 12 })
    })
    request.get('/feedback', { status: 'pending' }, { silent: true }).then(function (data) {
      that.setData({ feedbackCount: data.total || 0 })
    }).catch(function () {})
  },
  loadPendingList: function () {
    var that = this
    request.get('/reservation/pending', {}, { silent: true }).then(function (data) {
      var list = data
      if (!Array.isArray(list)) list = []
      that.setData({ pendingList: list.slice(0, 10) })
    }).catch(function () {
      that.setData({ pendingList: [] })
    })
  },
  onApprove: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认审批',
      content: '确定通过该预约申请？',
      success: function (res) {
        if (res.confirm) {
          request.put('/reservation/' + id + '/approve', {}).then(function () {
            wx.showToast({ title: '已通过', icon: 'success' })
            that.loadPendingList()
            that.loadStats()
          }).catch(function () {
            wx.showToast({ title: '操作失败', icon: 'none' })
          })
        }
      }
    })
  },
  onReject: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '拒绝预约',
      content: '请输入拒绝理由',
      editable: true,
      placeholderText: '请输入拒绝理由',
      success: function (res) {
        if (res.confirm) {
          request.put('/reservation/' + id + '/reject', { reason: res.content || '' }).then(function () {
            wx.showToast({ title: '已拒绝', icon: 'success' })
            that.loadPendingList()
            that.loadStats()
          }).catch(function () {
            wx.showToast({ title: '操作失败', icon: 'none' })
          })
        }
      }
    })
  }
})
