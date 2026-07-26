var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

var PRESETS = {
  ordinary: { label: '普通待审', status: 'pending' },
  priority: { label: '重点待审', status: 'counselor_pending', capability: 'counselorApproval' },
  actionable: { label: '全部可处理', actionable: 1 },
  today: { label: '今日预约', today: true },
  in_use: { label: '使用中', status: 'checked_in' }
}

var STATUS_FILTERS = ['', 'pending', 'approved', 'rejected', 'checked_in', 'completed']

function fingerprintValue(value) {
  return value === undefined || value === null ? '' : String(value)
}

Page({
  data: {
    list: [],
    filterPreset: '',
    filterLabel: '',
    filterStatus: '',
    filterDate: '',
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
  todayString: function () {
    var today = new Date()
    var month = String(today.getMonth() + 1)
    var day = String(today.getDate())
    if (month.length < 2) month = '0' + month
    if (day.length < 2) day = '0' + day
    return today.getFullYear() + '-' + month + '-' + day
  },
  normalizePreset: function (preset, role) {
    if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) return ''
    if (preset === 'priority' && !adminPolicy.can(role, PRESETS.priority.capability)) return 'ordinary'
    return preset
  },
  applyPreset: function (preset, role) {
    var normalized = this.normalizePreset(preset, role)
    var config = normalized ? PRESETS[normalized] : null
    this.setData({
      filterPreset: normalized,
      filterLabel: config ? config.label : '',
      filterStatus: config && config.status ? config.status : '',
      filterDate: config && config.today ? this.todayString() : '',
      page: 1,
      hasMore: true
    })
  },
  normalizeActivePreset: function (role) {
    if (!this.data.filterPreset) return
    var normalized = this.normalizePreset(this.data.filterPreset, role)
    if (normalized !== this.data.filterPreset) this.applyPreset(normalized, role)
    else if (normalized === 'today') this.setData({ filterDate: this.todayString() })
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
    if (!this.ensureAccess()) return
    this.applyPreset(options && options.preset, auth.getUserRole())
  },
  onShow: function () {
    if (!this.ensureAccess()) return
    this.normalizeActivePreset(auth.getUserRole())
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
    if (!this.ensureAccess()) return Promise.resolve()
    this.normalizeActivePreset(auth.getUserRole())
    var requestContext = this.requestContextFingerprint()
    var that = this
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    var requestVersion = this._listRequestVersion
    var params = { page: this.data.page, pageSize: 20 }
    if (this.data.filterStatus) params.status = this.data.filterStatus
    if (this.data.filterPreset === 'actionable') params.actionable = 1
    if (this.data.filterDate) params.date = this.data.filterDate
    return request.get('/reservation', params, { silent: true }).then(function (data) {
      if (requestVersion !== that._listRequestVersion) return
      if (!that.ensureAccess()) return
      if (that.requestContextFingerprint() !== requestContext) {
        that.setData({ list: [] })
        that.normalizeActivePreset(auth.getUserRole())
        return that.loadData()
      }
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
    var status = e && e.currentTarget && e.currentTarget.dataset.status
    if (STATUS_FILTERS.indexOf(status) === -1) status = ''
    this.setData({
      filterPreset: '',
      filterLabel: '',
      filterStatus: status,
      filterDate: '',
      page: 1,
      hasMore: true
    })
    this.loadData()
  },
  onClearPreset: function () {
    this.setData({
      filterPreset: '',
      filterLabel: '',
      filterStatus: '',
      filterDate: '',
      page: 1,
      hasMore: true
    })
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
