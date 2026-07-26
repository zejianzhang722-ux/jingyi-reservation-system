var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')
var approvalPresenter = require('../../utils/admin-approval-presenter')

var STATUS_LABELS = {
  pending: '普通待审', counselor_pending: '重点待审', approved: '已通过', rejected: '已拒绝',
  cancelled: '已取消', checked_in: '使用中', completed: '已完成', noshow: '未到场'
}
var USER_STATUS_LABELS = { active: '正常', restricted: '受限', disabled: '停用', banned: '已封禁', blocked: '冻结' }

Page({
  data: {
    reservation: null,
    pageStatus: 'loading',
    errorMessage: '',
    canApprove: false,
    canReject: false,
    processing: false
  },
  ensureAccess: function () {
    var role = auth.getUserRole()
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      this.setData({ reservation: null, canApprove: false, canReject: false, processing: false })
      wx.showToast({ title: '请先登录管理员账号', icon: 'none' })
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    if (!adminPolicy.can(role, 'reservationView')) {
      this.setData({ reservation: null, canApprove: false, canReject: false, processing: false })
      wx.showToast({ title: '当前账号无权查看预约', icon: 'none' })
      wx.reLaunch({ url: '/pages/admin-manage/admin-manage' })
      return false
    }
    return true
  },
  onLoad: function (options) {
    if (!this.ensureAccess()) return
    this._reservationId = Number(options && options.id)
    if (!Number.isInteger(this._reservationId) || this._reservationId <= 0) {
      this.setData({ pageStatus: 'error', errorMessage: '预约编号无效', reservation: null })
      return
    }
    this.loadDetail()
  },
  onShow: function () {
    if (!this._hasShown) { this._hasShown = true; return }
    if (this._reservationId && this.ensureAccess() && !this.data.processing) this.loadDetail()
  },
  canAuditReservation: function (reservation) {
    var role = auth.getUserRole()
    if (!reservation) return false
    if (reservation.status === 'pending') return adminPolicy.can(role, 'ordinaryApproval')
    if (reservation.status === 'counselor_pending') return adminPolicy.can(role, 'counselorApproval')
    return false
  },
  loadDetail: function () {
    var that = this
    if (!this.ensureAccess() || !this._reservationId) return Promise.resolve()
    this._detailRequestVersion = (this._detailRequestVersion || 0) + 1
    var requestVersion = this._detailRequestVersion
    this.setData({ pageStatus: 'loading', errorMessage: '', canApprove: false, canReject: false })
    return request.get('/reservation/' + this._reservationId, {}, { silent: true }).then(function (data) {
      if (requestVersion !== that._detailRequestVersion || !that.ensureAccess()) return
      var reservation = approvalPresenter.toCard(data || {})
      reservation.credit_score = data && data.credit_score
      reservation.user_status = data && data.user_status
      reservation.userStatusLabel = USER_STATUS_LABELS[reservation.user_status] || reservation.user_status || '未知'
      reservation.statusLabel = STATUS_LABELS[reservation.status] || reservation.status || '未知状态'
      var canAudit = that.canAuditReservation(reservation)
      that.setData({ reservation: reservation, pageStatus: 'ready', errorMessage: '', canApprove: canAudit, canReject: canAudit })
    }).catch(function (err) {
      if (requestVersion !== that._detailRequestVersion) return
      that.setData({ reservation: null, pageStatus: 'error', errorMessage: err && err.message ? err.message : '预约详情加载失败，请稍后重试', canApprove: false, canReject: false })
    })
  },
  onRetry: function () { return this.loadDetail() },
  notifySource: function () {
    if (typeof this.getOpenerEventChannel !== 'function') return
    try {
      var channel = this.getOpenerEventChannel()
      if (channel && typeof channel.emit === 'function') channel.emit('reservationUpdated', { id: this._reservationId })
    } catch (err) {}
  },
  submitAudit: function (action, body, successText) {
    var that = this
    var reservation = this.data.reservation
    if (this.data.processing || !this.ensureAccess()) return
    if (!this.canAuditReservation(reservation)) {
      this.setData({ canApprove: false, canReject: false })
      wx.showToast({ title: '当前状态或角色不可审批', icon: 'none' })
      return
    }
    this.setData({ processing: true })
    request.post('/audit/' + reservation.id + '/' + action, body || {}, { silent: true }).then(function () {
      wx.showToast({ title: successText, icon: 'success' })
      that.notifySource()
      return that.loadDetail()
    }, function (err) {
      wx.showToast({ title: err && err.message ? err.message : '审批失败，请稍后重试', icon: 'none' })
    }).then(function () { that.setData({ processing: false }) }, function () { that.setData({ processing: false }) })
  },
  onApprove: function () {
    var that = this
    if (this.data.processing || !this.canAuditReservation(this.data.reservation)) return
    wx.showModal({ title: '确认通过', content: '确定通过这条预约申请吗？', success: function (result) {
      if (!result.confirm || that.data.processing) return
      that.submitAudit('approve', {}, '已通过')
    } })
  },
  onReject: function () {
    var that = this
    if (this.data.processing || !this.canAuditReservation(this.data.reservation)) return
    wx.showModal({ title: '拒绝预约', content: '请填写拒绝理由', editable: true, placeholderText: '拒绝理由（必填）', success: function (result) {
      if (!result.confirm) return
      var reason = String(result.content || '').trim()
      if (!reason) { wx.showToast({ title: '请填写拒绝理由', icon: 'none' }); return }
      if (that.data.processing) return
      that.submitAudit('reject', { reason: reason }, '已拒绝')
    } })
  }
})