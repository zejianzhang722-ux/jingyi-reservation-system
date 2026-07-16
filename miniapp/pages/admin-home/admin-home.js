var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')
var approvalPresenter = require('../../utils/admin-approval-presenter')

var ROLE_NAMES = {
  super_admin: '超级管理员',
  admin: '导生管理员',
  counselor: '书院辅导员'
}

function numberOrZero(value) {
  var number = Number(value)
  return Number.isFinite(number) ? number : 0
}

Page({
  data: {
    queueType: 'admin',
    queueLabel: '普通预约审核',
    ordinaryPendingCount: 0,
    counselorPendingCount: 0,
    actionablePendingCount: 0,
    activeRoomCount: 0,
    todayReservations: 0,
    inUseCount: 0,
    feedbackCount: 0,
    feedbackStatus: 'idle',
    statsStatus: 'loading',
    statsError: '',
    hasTrustedStats: false,
    listStatus: 'loading',
    listError: '',
    pendingList: [],
    roleName: '管理员',
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
  applyRole: function (role, requestedQueue) {
    var defaultQueue = adminPolicy.defaultQueueType(role)
    var queueType = defaultQueue
    if (requestedQueue === 'admin' || requestedQueue === 'counselor') {
      queueType = adminPolicy.queueType(role, requestedQueue)
    }
    this._loadedRole = role
    this.setData({
      roleName: ROLE_NAMES[role] || '管理员',
      queueType: queueType,
      queueLabel: queueType === 'counselor' ? '辅导员重点审核' : '普通预约审核',
      canSwitchQueue: adminPolicy.can(role, 'counselorApproval'),
      canManageFeedback: adminPolicy.can(role, 'feedbackManage')
    })
  },
  onLoad: function (options) {
    if (!this.ensureAdmin()) return
    var requestedQueue = options && (options.type || options.queueType)
    this.applyRole(auth.getUserRole(), requestedQueue)
  },
  onShow: function () {
    if (!this.ensureAdmin()) return
    var role = auth.getUserRole()
    if (this._loadedRole !== role) {
      this.applyRole(role)
      this.setData({ pendingList: [], listStatus: 'loading', listError: '' })
    }
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
    this.setData({ statsStatus: 'loading', statsError: '' })

    var dashboardRequest = request.get('/stats/dashboard', {}, { silent: true }).then(function (data) {
      if (requestVersion !== that._statsRequestVersion) return
      data = data || {}
      that.setData({
        ordinaryPendingCount: numberOrZero(data.ordinaryPendingCount),
        counselorPendingCount: numberOrZero(data.counselorPendingCount),
        actionablePendingCount: numberOrZero(data.actionablePendingCount),
        activeRoomCount: numberOrZero(data.activeRoomCount),
        todayReservations: numberOrZero(data.todayReservations),
        inUseCount: numberOrZero(data.usingCount !== undefined ? data.usingCount : data.inUseCount),
        statsStatus: 'ready',
        statsError: '',
        hasTrustedStats: true
      })
    }).catch(function () {
      if (requestVersion !== that._statsRequestVersion) return
      that.setData({
        statsStatus: 'error',
        statsError: that.data.hasTrustedStats
          ? '统计更新失败，当前显示上次结果'
          : '暂无可信统计数据，请重新加载'
      })
    })

    var feedbackRequest = Promise.resolve()
    if (adminPolicy.can(role, 'feedbackManage')) {
      this.setData({ feedbackStatus: 'loading' })
      feedbackRequest = request.get('/feedback', { status: 'pending' }, { silent: true }).then(function (data) {
        if (requestVersion !== that._statsRequestVersion) return
        that.setData({ feedbackCount: numberOrZero(data && data.total), feedbackStatus: 'ready' })
      }).catch(function () {
        if (requestVersion !== that._statsRequestVersion) return
        that.setData({ feedbackStatus: 'error' })
      })
    } else {
      this.setData({ feedbackCount: 0, feedbackStatus: 'idle' })
    }
    return Promise.all([dashboardRequest, feedbackRequest])
  },
  onRetryStats: function () {
    return this.loadStats()
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
      var rows = Array.isArray(data) ? data : (data && (data.items || data.list)) || []
      var list = rows.slice(0, 10).map(approvalPresenter.toCard)
      that.setData({
        pendingList: list,
        listStatus: list.length ? 'ready' : 'empty',
        listError: ''
      })
    }).catch(function () {
      if (requestVersion !== that._pendingRequestVersion) return
      that.setData({
        pendingList: [],
        listStatus: 'error',
        listError: '审批列表加载失败，请检查网络后重新加载'
      })
    })
  },
  onQueueChange: function (event) {
    var role = auth.getUserRole()
    var requestedQueue = event && event.currentTarget && event.currentTarget.dataset.type
    var queueType = adminPolicy.queueType(role, requestedQueue)
    if (queueType === this.data.queueType) return
    this._loadedRole = role
    this.setData({
      queueType: queueType,
      queueLabel: queueType === 'counselor' ? '辅导员重点审核' : '普通预约审核',
      pendingList: [],
      listStatus: 'loading',
      listError: ''
    })
    this.loadPendingList()
  },
  onRetryList: function () {
    this.setData({ pendingList: [], listStatus: 'loading', listError: '' })
    return this.loadPendingList()
  },
  onViewDetail: function (event) {
    var id = event.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/admin-reservation-detail/admin-reservation-detail?id=' + id })
  },
  isProcessing: function (id) {
    return !!this.data.processingById[id]
  },
  canQuickApproveItem: function (id) {
    var item = (this.data.pendingList || []).find(function (candidate) { return Number(candidate.id) === Number(id) })
    return !!item && this.data.queueType === 'admin' && adminPolicy.canQuickApprove(auth.getUserRole(), item.status)
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
  onApprove: function (event) {
    var that = this
    var id = event.currentTarget.dataset.id
    if (!this.canQuickApproveItem(id) || this.isProcessing(id)) return
    wx.showModal({
      title: '确认审批',
      content: '确定通过该预约申请？',
      success: function (result) {
        if (!result.confirm || that.isProcessing(id)) return
        that.setProcessing(id, true)
        request.post('/audit/' + id + '/approve', {}, { silent: true }).then(function () {
          wx.showToast({ title: '已通过', icon: 'success' })
          return Promise.all([that.loadPendingList(), that.loadStats()])
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
  onReject: function (event) {
    var that = this
    var id = event.currentTarget.dataset.id
    if (!this.canQuickApproveItem(id) || this.isProcessing(id)) return
    wx.showModal({
      title: '拒绝预约',
      content: '请输入拒绝理由',
      editable: true,
      placeholderText: '请输入拒绝理由',
      success: function (result) {
        if (!result.confirm) return
        var reason = String(result.content || '').trim()
        if (!reason) {
          wx.showToast({ title: '请填写拒绝理由', icon: 'none' })
          return
        }
        if (that.isProcessing(id)) return
        that.setProcessing(id, true)
        request.post('/audit/' + id + '/reject', { reason: reason }, { silent: true }).then(function () {
          wx.showToast({ title: '已拒绝', icon: 'success' })
          return Promise.all([that.loadPendingList(), that.loadStats()])
        }, function (err) {
          wx.showToast({ title: err && err.message ? err.message : '操作失败', icon: 'none' })
        }).then(function () {
          that.setProcessing(id, false)
        }, function () {
          that.setProcessing(id, false)
        })
      }
    })
  }
})
