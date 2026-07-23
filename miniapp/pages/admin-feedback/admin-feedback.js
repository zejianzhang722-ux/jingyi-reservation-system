var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

function fingerprintValue(value) {
  return value === undefined || value === null ? '' : String(value)
}

Page({
  data: { list: [], filterStatus: '', replyId: null, replyContent: '' },
  hasFeedbackAccess: function () {
    return auth.isLoggedIn() && auth.isAdmin() && adminPolicy.can(auth.getUserRole(), 'feedbackManage')
  },
  clearFeedbackData: function () {
    this._feedbackRequestVersion = (this._feedbackRequestVersion || 0) + 1
    this.setData({ list: [], replyId: null, replyContent: '' })
  },
  ensureFeedbackAccess: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      this.clearFeedbackData()
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    if (!this.hasFeedbackAccess()) {
      this.clearFeedbackData()
      wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
      wx.reLaunch({ url: '/pages/admin-manage/admin-manage' })
      return false
    }
    return true
  },
  normalizeStatus: function (status) {
    return status === 'pending' || status === 'resolved' ? status : ''
  },
  requestContextFingerprint: function () {
    var userInfo = auth.getUserInfo() || {}
    var buildingId = userInfo.buildingId
    var scopeType = userInfo.scopeType
    if (buildingId === undefined) buildingId = userInfo.building_id
    if (scopeType === undefined) scopeType = userInfo.scope_type
    return JSON.stringify([
      fingerprintValue(userInfo.id),
      fingerprintValue(userInfo.username),
      fingerprintValue(userInfo.role),
      fingerprintValue(buildingId),
      fingerprintValue(scopeType)
    ])
  },
  onLoad: function (options) {
    if (!this.ensureFeedbackAccess()) return
    this.setData({ filterStatus: this.normalizeStatus(options && options.status) })
  },
  onShow: function () { if (this.ensureFeedbackAccess()) return this.loadFeedback() },
  loadFeedback: function () {
    if (!this.ensureFeedbackAccess()) return Promise.resolve()
    var that = this
    var requestContext = this.requestContextFingerprint()
    this._feedbackRequestVersion = (this._feedbackRequestVersion || 0) + 1
    var requestVersion = this._feedbackRequestVersion
    return request.get('/feedback', { status: this.data.filterStatus }, { silent: true }).then(function (data) {
      if (!that.hasFeedbackAccess()) {
        that.clearFeedbackData()
        return
      }
      if (requestVersion !== that._feedbackRequestVersion) return
      if (that.requestContextFingerprint() !== requestContext) {
        that.clearFeedbackData()
        if (that.hasFeedbackAccess()) return that.loadFeedback()
        return
      }
      var list = data.list || data || []
      that.setData({ list: Array.isArray(list) ? list : [] })
    }).catch(function () {
      if (!that.hasFeedbackAccess()) {
        that.clearFeedbackData()
        return
      }
      if (requestVersion !== that._feedbackRequestVersion) return
      if (that.requestContextFingerprint() !== requestContext) {
        that.clearFeedbackData()
        if (that.hasFeedbackAccess()) return that.loadFeedback()
        return
      }
      that.setData({ list: [] })
    })
  },
  onFilter: function (e) {
    if (!this.ensureFeedbackAccess()) return
    this.setData({ filterStatus: this.normalizeStatus(e.currentTarget.dataset.status) })
    return this.loadFeedback()
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
        if (!res.confirm) return
        if (!that.ensureFeedbackAccess()) return
        request.put('/feedback/' + id + '/resolve', {}).then(function () {
          wx.showToast({ title: '已处理', icon: 'success' })
          that.loadFeedback()
        }).catch(function () {
          wx.showToast({ title: '操作失败', icon: 'none' })
        })
      }
    })
  }
})
