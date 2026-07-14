var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

Page({
  data: {
    list: [],
    loading: false,
    error: '',
    processingIds: {},
    statusMap: {
      pending: '待审核',
      approved: '已通过',
      rejected: '已拒绝',
      cleaned: '已清理',
      expired: '已过期',
      violation: '违规'
    }
  },

  hasAccess: function () {
    return auth.isLoggedIn() && auth.isAdmin() && adminPolicy.can(auth.getUserRole(), 'posterReview')
  },

  clearSensitiveData: function () {
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    this.setData({ list: [], loading: false, error: '', processingIds: {} })
  },

  ensureAccess: function () {
    if (this.hasAccess()) return true
    this.clearSensitiveData()
    if (auth.isLoggedIn() && auth.isAdmin()) {
      wx.showToast({ title: '当前账号无海报审核权限', icon: 'none' })
      wx.reLaunch({ url: '/pages/admin-manage/admin-manage' })
    } else {
      wx.reLaunch({ url: '/pages/login/login' })
    }
    return false
  },

  onLoad: function () {
    this.ensureAccess()
  },

  onShow: function () {
    if (!this.ensureAccess()) return
    return this.loadData()
  },

  loadData: function () {
    if (!this.ensureAccess()) return Promise.resolve()
    var that = this
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    var requestVersion = this._listRequestVersion
    this.setData({ loading: true, error: '' })
    return request.get('/poster', {
      status: 'pending',
      page: 1,
      pageSize: 20
    }, { silent: true }).then(function (data) {
      if (requestVersion !== that._listRequestVersion) return
      if (!that.hasAccess()) {
        that.ensureAccess()
        return
      }
      var list = Array.isArray(data) ? data : ((data && data.list) || [])
      that.setData({
        list: Array.isArray(list) ? list : [],
        loading: false,
        error: ''
      })
    }).catch(function () {
      if (requestVersion !== that._listRequestVersion) return
      if (!that.hasAccess()) {
        that.ensureAccess()
        return
      }
      that.setData({
        list: [],
        loading: false,
        error: '海报审核暂时未能加载'
      })
    })
  },

  onRetry: function () {
    return this.loadData()
  },

  isProcessing: function (id) {
    return !!this.data.processingIds[id]
  },

  setProcessing: function (id, processing) {
    var next = Object.assign({}, this.data.processingIds)
    if (processing) next[id] = true
    else delete next[id]
    this.setData({ processingIds: next })
  },

  finishProcessing: function (id) {
    if (this.hasAccess()) this.setProcessing(id, false)
  },

  submitDecision: function (id, action, body, successTitle) {
    if (!this.ensureAccess() || this.isProcessing(id)) return Promise.resolve()
    var that = this
    this.setProcessing(id, true)
    return request.post('/poster/' + id + '/' + action, body || {}).then(function () {
      if (!that.hasAccess()) {
        that.ensureAccess()
        return
      }
      wx.showToast({ title: successTitle, icon: 'success' })
      return that.loadData()
    }, function () {
      if (!that.hasAccess()) {
        that.ensureAccess()
        return
      }
      wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' })
    }).then(function () {
      that.finishProcessing(id)
    }, function () {
      that.finishProcessing(id)
    })
  },

  onApprove: function (e) {
    if (!this.ensureAccess()) return
    var that = this
    var id = e.currentTarget.dataset.id
    if (this.isProcessing(id)) return
    wx.showModal({
      title: '通过海报申请',
      content: '确认通过这份海报投放申请？',
      success: function (res) {
        if (!res.confirm) return
        if (!that.ensureAccess() || that.isProcessing(id)) return
        that.submitDecision(id, 'approve', {}, '已通过')
      }
    })
  },

  onReject: function (e) {
    if (!this.ensureAccess()) return
    var that = this
    var id = e.currentTarget.dataset.id
    if (this.isProcessing(id)) return
    wx.showModal({
      title: '拒绝海报申请',
      content: '请输入拒绝理由',
      editable: true,
      placeholderText: '请说明需要修改的内容',
      success: function (res) {
        if (!res.confirm) return
        if (!that.ensureAccess() || that.isProcessing(id)) return
        var reason = String(res.content || '').trim()
        if (!reason) {
          wx.showToast({ title: '请填写拒绝理由', icon: 'none' })
          return
        }
        that.submitDecision(id, 'reject', { reason: reason }, '已拒绝')
      }
    })
  }
})
