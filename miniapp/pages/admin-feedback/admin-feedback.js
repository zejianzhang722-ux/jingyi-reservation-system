var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

Page({
  data: { list: [], filterStatus: '', replyId: null, replyContent: '' },
  ensureFeedbackAccess: function () {
    var role = auth.getUserRole()
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    if (!adminPolicy.can(role, 'feedbackManage')) {
      wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
      wx.reLaunch({ url: '/pages/admin-manage/admin-manage' })
      return false
    }
    return true
  },
  onLoad: function () { if (this.ensureFeedbackAccess()) return this.loadFeedback() },
  onShow: function () { if (this.ensureFeedbackAccess()) return this.loadFeedback() },
  loadFeedback: function () {
    if (!this.ensureFeedbackAccess()) return Promise.resolve()
    var that = this
    request.get('/feedback', { status: this.data.filterStatus }, { silent: true }).then(function (data) {
      var list = data.list || data || []
      that.setData({ list: Array.isArray(list) ? list : [] })
    }).catch(function () {
      that.setData({ list: [] })
    })
  },
  onFilter: function (e) {
    if (!this.ensureFeedbackAccess()) return
    this.setData({ filterStatus: e.currentTarget.dataset.status })
    this.loadFeedback()
  },
  onReplyInput: function (e) {
    this.setData({ replyContent: e.detail.value })
  },
  showReply: function (e) {
    this.setData({ replyId: e.currentTarget.dataset.id, replyContent: '' })
  },
  cancelReply: function () {
    this.setData({ replyId: null, replyContent: '' })
  },
  submitReply: function () {
    if (!this.ensureFeedbackAccess()) return
    var that = this
    var id = this.data.replyId
    if (!this.data.replyContent) { wx.showToast({ title: '请输入回复内容', icon: 'none' }); return }
    request.put('/feedback/' + id + '/resolve', { reply: this.data.replyContent }).then(function () {
      wx.showToast({ title: '回复成功', icon: 'success' })
      that.setData({ replyId: null, replyContent: '' })
      that.loadFeedback()
    }).catch(function () {
      wx.showToast({ title: '回复失败', icon: 'none' })
    })
  },
  onResolve: function (e) {
    if (!this.ensureFeedbackAccess()) return
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认处理',
      content: '确定将该反馈标记为已处理？',
      success: function (res) {
        if (res.confirm) {
          request.put('/feedback/' + id + '/resolve', {}).then(function () {
            wx.showToast({ title: '已处理', icon: 'success' })
            that.loadFeedback()
          }).catch(function () {
            wx.showToast({ title: '操作失败', icon: 'none' })
          })
        }
      }
    })
  }
})
