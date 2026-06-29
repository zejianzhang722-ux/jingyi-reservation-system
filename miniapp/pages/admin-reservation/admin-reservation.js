var request = require('../../utils/request')

function normalizeStatus(status) {
  var value = String(status || '').trim().toLowerCase()
  var map = {
    pass: 'approved',
    passed: 'approved',
    approve: 'approved',
    approved: 'approved',
    reject: 'rejected',
    rejected: 'rejected',
    cancel: 'cancelled',
    canceled: 'cancelled',
    cancelled: 'cancelled',
    checkin: 'checked_in',
    checkedin: 'checked_in',
    checked_in: 'checked_in',
    in_use: 'checked_in',
    finish: 'completed',
    finished: 'completed',
    completed: 'completed',
    pending: 'pending',
    counselor_pending: 'counselor_pending'
  }
  return map[value] || value
}

function getReservationStatus(item) {
  return normalizeStatus(item.status || item.auditStatus || item.audit_status || item.state)
}

function filterReservations(list, status, keyword) {
  var result = (list || []).map(function (item) {
    return Object.assign({}, item, { status: getReservationStatus(item) })
  })
  if (status) {
    result = result.filter(function (item) {
      return item.status === status
    })
  }
  if (keyword) {
    var kw = keyword.toLowerCase()
    result = result.filter(function (r) {
      return [
        r.userName,
        r.user_name,
        r.realName,
        r.real_name,
        r.studentNo,
        r.student_no,
        r.roomName,
        r.room_name,
        r.roomNumber,
        r.room_number
      ].join(' ').toLowerCase().indexOf(kw) >= 0
    })
  }
  return result
}

Page({
  data: {
    list: [],
    filterStatus: '',
    keyword: '',
    page: 1,
    hasMore: true,
    statusMap: { pending: '待审批', counselor_pending: '待辅导员审批', approved: '已通过', rejected: '已拒绝', cancelled: '已取消', checked_in: '使用中', completed: '已完成' }
  },
  onLoad: function () { this.loadData() },
  onPullDownRefresh: function () {
    this.setData({ page: 1, hasMore: true })
    this.loadData()
    wx.stopPullDownRefresh()
  },
  loadData: function () {
    var that = this
    var params = { page: this.data.page, pageSize: 20 }
    if (this.data.filterStatus) params.status = this.data.filterStatus
    request.get('/reservation', params, { silent: true }).then(function (data) {
      var rawList = data
      if (!Array.isArray(rawList)) rawList = data.list || data.reservations || []
      var list = filterReservations(rawList, that.data.filterStatus, that.data.keyword)
      var nextList = that.data.page > 1 ? that.data.list.concat(list) : list
      that.setData({ list: nextList, hasMore: rawList.length >= 20 })
    }).catch(function () {
      that.setData({ list: [], hasMore: false })
    })
  },
  onFilter: function (e) {
    this.setData({ filterStatus: e.currentTarget.dataset.status, page: 1, hasMore: true })
    this.loadData()
  },
  onSearch: function (e) {
    this.setData({ keyword: e.detail.value.trim(), page: 1, hasMore: true })
    this.loadData()
  },
  onApprove: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认审批',
      content: '确定通过该预约？',
      success: function (res) {
        if (res.confirm) {
          request.put('/reservation/' + id + '/approve', {}).then(function () {
            wx.showToast({ title: '已通过', icon: 'success' })
            that.setData({ page: 1, hasMore: true })
            that.loadData()
          }).catch(function () { wx.showToast({ title: '操作失败', icon: 'none' }) })
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
      placeholderText: '拒绝理由',
      success: function (res) {
        if (res.confirm) {
          var reason = String(res.content || '').trim()
          if (!reason) {
            wx.showToast({ title: '请填写拒绝理由', icon: 'none' })
            return
          }
          request.put('/reservation/' + id + '/reject', { reason: reason }).then(function () {
            wx.showToast({ title: '已拒绝', icon: 'success' })
            that.setData({ page: 1, hasMore: true })
            that.loadData()
          }).catch(function () { wx.showToast({ title: '操作失败', icon: 'none' }) })
        }
      }
    })
  },
  onViewDetail: function (e) {
    var id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/reservation-detail/reservation-detail?id=' + id })
  },
  onLoadMore: function () {
    if (!this.data.hasMore) return
    this.setData({ page: this.data.page + 1 })
    this.loadData()
  }
})
