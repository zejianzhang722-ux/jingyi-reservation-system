var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

Page({
  data: {
    list: [],
    filterStatus: '',
    keyword: '',
    page: 1,
    hasMore: true,
    processingById: {},
    statusMap: { pending: '待审批', counselor_pending: '待辅导员审批', approved: '已通过', rejected: '已拒绝', cancelled: '已取消', checked_in: '使用中', completed: '已完成' }
  },
  ensureAccess: function () {
    var role = auth.getUserRole()
    if (!auth.isLoggedIn() || !auth.isAdmin() || !adminPolicy.can(role, 'reservationView')) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },
  onLoad: function () {
    if (!this.ensureAccess()) return
  },
  onShow: function () {
    if (!this.ensureAccess()) return
    this.setData({ page: 1, hasMore: true })
    this.loadData()
  },
  onPullDownRefresh: function () {
    this.setData({ page: 1, hasMore: true })
    this.loadData()
    wx.stopPullDownRefresh()
  },
  canQuickAudit: function (status) {
    return adminPolicy.canQuickApprove(auth.getUserRole(), status)
  },
  findReservation: function (id) {
    return (this.data.list || []).find(function (item) { return Number(item.id) === Number(id) })
  },
  canQuickAuditItem: function (id) {
    var item = this.findReservation(id)
    return !!item && this.canQuickAudit(item.status)
  },
  isProcessing: function (id) {
    return !!this.data.processingById[id]
  },
  setProcessing: function (id, processing) {
    var next = Object.assign({}, this.data.processingById)
    if (processing) next[id] = true
    else delete next[id]
    this.setData({ processingById: next })
  },
  loadData: function () {
    var that = this
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    var requestVersion = this._listRequestVersion
    var params = { page: this.data.page, pageSize: 20 }
    if (this.data.filterStatus) params.status = this.data.filterStatus
    return request.get('/reservation', params, { silent: true }).then(function (data) {
      if (requestVersion !== that._listRequestVersion) return
      var list = data
      if (!Array.isArray(list)) list = (data && (data.list || data.reservations)) || []
      if (that.data.keyword) {
        var kw = that.data.keyword.toLowerCase()
        list = list.filter(function (r) {
          return (r.userName || r.user_name || '').toLowerCase().indexOf(kw) >= 0 ||
            (r.roomName || r.room_name || '').toLowerCase().indexOf(kw) >= 0
        })
      }
      list = list.map(function (item) {
        return Object.assign({}, item, { canQuickAudit: that.canQuickAudit(item.status) })
      })
      that.setData({ list: list, hasMore: list.length >= 20 })
    }).catch(function () {
      if (requestVersion !== that._listRequestVersion) return
      that.setData({ list: [] })
    })
  },
  onFilter: function (e) {
    this.setData({ filterStatus: e.currentTarget.dataset.status, page: 1 })
    this.loadData()
  },
  onSearch: function (e) {
    this.setData({ keyword: e.detail.value.trim() })
    this.loadData()
  },
  onApprove: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    if (!this.canQuickAuditItem(id) || this.isProcessing(id)) return
    wx.showModal({
      title: '确认审批',
      content: '确定通过该预约？',
      success: function (res) {
        if (!res.confirm) return
        if (!that.canQuickAuditItem(id) || that.isProcessing(id)) return
        that.setProcessing(id, true)
        request.post('/audit/' + id + '/approve', {}, { silent: true }).then(function () {
          wx.showToast({ title: '已通过', icon: 'success' })
          return that.loadData()
        }, function (err) {
          wx.showToast({ title: err && err.message ? err.message : '操作失败', icon: 'none' })
        }).then(function () {
          that.setProcessing(id, false)
        }, function () {
          that.setProcessing(id, false)
        })
      }
    })
  },
  onReject: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    if (!this.canQuickAuditItem(id) || this.isProcessing(id)) return
    wx.showModal({
      title: '拒绝预约',
      content: '请输入拒绝理由',
      editable: true,
      placeholderText: '拒绝理由',
      success: function (res) {
        if (!res.confirm) return
        var reason = String(res.content || '').trim()
        if (!reason) {
          wx.showToast({ title: '请填写拒绝理由', icon: 'none' })
          return
        }
        if (!that.canQuickAuditItem(id) || that.isProcessing(id)) return
        that.setProcessing(id, true)
        request.post('/audit/' + id + '/reject', { reason: reason }, { silent: true }).then(function () {
          wx.showToast({ title: '已拒绝', icon: 'success' })
          return that.loadData()
        }, function (err) {
          wx.showToast({ title: err && err.message ? err.message : '操作失败', icon: 'none' })
        }).then(function () {
          that.setProcessing(id, false)
        }, function () {
          that.setProcessing(id, false)
        })
      }
    })
  },
  onViewDetail: function (e) {
    wx.navigateTo({ url: '/pages/admin-reservation-detail/admin-reservation-detail?id=' + e.currentTarget.dataset.id })
  },
  onLoadMore: function () {
    if (!this.data.hasMore) return
    this.setData({ page: this.data.page + 1 })
    this.loadData()
  }
})
