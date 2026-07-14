var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

Page({
  data: {
    pendingCount: 0,
    todayReservations: 0,
    feedbackCount: 0,
    activeRooms: 0,
    pendingList: [],
    roleName: '管理员',
    queueType: 'admin',
    queueLabel: '普通预约审核',
    canSwitchQueue: false,
    canManageFeedback: false,
    processingById: {},
    scanning: false
  },
  ensureAdmin: function () {
    var role = auth.getUserRole()
    if (!auth.isLoggedIn() || !auth.isAdmin() || !adminPolicy.can(role, 'ordinaryApproval')) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },
  onLoad: function (options) {
    if (!this.ensureAdmin()) return
    var role = auth.getUserRole()
    var requested = options && options.queueType
    var preferred = requested || (role === 'counselor' ? 'counselor' : 'admin')
    var queueType = adminPolicy.queueType(role, preferred)
    var nameMap = { super_admin: '超级管理员', admin: '导生管理员', counselor: '书院辅导员' }
    this.setData({
      roleName: nameMap[role] || '管理员',
      queueType: queueType,
      queueLabel: queueType === 'counselor' ? '辅导员重点审核' : '普通预约审核',
      canSwitchQueue: adminPolicy.can(role, 'counselorApproval'),
      canManageFeedback: adminPolicy.can(role, 'feedbackManage')
    })
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
    var role = auth.getUserRole()
    this._statsRequestVersion = (this._statsRequestVersion || 0) + 1
    var requestVersion = this._statsRequestVersion
    var pendingRequest = request.get('/reservation/pending-count', { type: this.data.queueType }, { silent: true }).then(function (data) {
      if (requestVersion !== that._statsRequestVersion) return
      that.setData({ pendingCount: data.count || 0 })
    }).catch(function () {})
    var roomRequest = request.get('/room/stats', {}, { silent: true }).then(function (data) {
      if (requestVersion !== that._statsRequestVersion) return
      that.setData({ activeRooms: data.activeRooms || 12, todayReservations: data.todayReservations || 0 })
    }).catch(function () {
      if (requestVersion !== that._statsRequestVersion) return
      that.setData({ activeRooms: 12 })
    })
    var feedbackRequest = Promise.resolve()
    if (adminPolicy.can(role, 'feedbackManage')) {
      feedbackRequest = request.get('/feedback', { status: 'pending' }, { silent: true }).then(function (data) {
        if (requestVersion !== that._statsRequestVersion) return
        that.setData({ feedbackCount: data.total || 0 })
      }).catch(function () {})
    } else {
      this.setData({ feedbackCount: 0 })
    }
    return Promise.all([pendingRequest, roomRequest, feedbackRequest])
  },
  loadPendingList: function () {
    var that = this
    this._pendingRequestVersion = (this._pendingRequestVersion || 0) + 1
    var requestVersion = this._pendingRequestVersion
    return request.get('/audit/pending', {
      type: this.data.queueType,
      page: 1,
      pageSize: 10
    }, { silent: true }).then(function (data) {
      if (requestVersion !== that._pendingRequestVersion) return
      var list = Array.isArray(data) ? data : (data && data.list) || []
      that.setData({ pendingList: list.slice(0, 10) })
    }).catch(function () {
      if (requestVersion !== that._pendingRequestVersion) return
      that.setData({ pendingList: [] })
    })
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
  showScanError: function (message) {
    wx.showToast({ title: message || '扫码签到失败', icon: 'none', duration: 2500 })
  },
  onScanCheckin: function () {
    var that = this
    if (this.data.scanning) return
    this.setData({ scanning: true })
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: function (scanResult) {
        var payload = null
        try {
          payload = JSON.parse(scanResult.result || '')
        } catch (err) {
          that.showScanError('该二维码不是有效的签到凭证')
          return
        }
        if (!payload || payload.type !== 'jingyi-checkin' || !payload.reservationId || !payload.credential) {
          that.showScanError('动态签到凭证格式无效')
          return
        }
        request.post('/checkin', { reservationId: payload.reservationId, credential: payload.credential }).then(function () {
          wx.showToast({ title: '签到成功', icon: 'success' })
          that.loadStats()
        }).catch(function (err) {
          that.showScanError(err && err.message ? err.message : '签到失败，请刷新二维码后重试')
        })
      },
      fail: function (err) {
        if (err && String(err.errMsg || '').indexOf('cancel') !== -1) return
        that.showScanError('无法完成扫码，请检查相机权限')
      },
      complete: function () { that.setData({ scanning: false }) }
    })
  },
  onApprove: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    if (this.isProcessing(id)) return
    wx.showModal({
      title: '确认审批',
      content: '确定通过该预约申请？',
      success: function (res) {
        if (!res.confirm) return
        if (that.isProcessing(id)) return
        that.setProcessing(id, true)
        request.post('/audit/' + id + '/approve', {}).then(function () {
          wx.showToast({ title: '已通过', icon: 'success' })
          return Promise.all([that.loadPendingList(), that.loadStats()])
        }, function () {
          wx.showToast({ title: '操作失败', icon: 'none' })
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
    if (this.isProcessing(id)) return
    wx.showModal({
      title: '拒绝预约',
      content: '请输入拒绝理由',
      editable: true,
      placeholderText: '请输入拒绝理由',
      success: function (res) {
        if (!res.confirm) return
        var reason = String(res.content || '').trim()
        if (!reason) {
          wx.showToast({ title: '请填写拒绝理由', icon: 'none' })
          return
        }
        if (that.isProcessing(id)) return
        that.setProcessing(id, true)
        request.post('/audit/' + id + '/reject', { reason: reason }).then(function () {
          wx.showToast({ title: '已拒绝', icon: 'success' })
          return Promise.all([that.loadPendingList(), that.loadStats()])
        }, function () {
          wx.showToast({ title: '操作失败', icon: 'none' })
        }).then(function () {
          that.setProcessing(id, false)
        }, function () {
          that.setProcessing(id, false)
        })
      }
    })
  }
})
