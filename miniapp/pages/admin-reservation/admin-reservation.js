var request = require('../../utils/request')

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
      var list = data
      if (!Array.isArray(list)) list = data.list || data.reservations || []
      if (that.data.keyword) {
        var kw = that.data.keyword.toLowerCase()
        list = list.filter(function (r) {
          return (r.userName || r.user_name || '').toLowerCase().indexOf(kw) >= 0 ||
            (r.roomName || r.room_name || '').toLowerCase().indexOf(kw) >= 0
        })
      }
      that.setData({ list: list, hasMore: list.length >= 20 })
    }).catch(function () {
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
    wx.showModal({
      title: '确认审批',
      content: '确定通过该预约？',
      success: function (res) {
        if (res.confirm) {
          request.put('/reservation/' + id + '/approve', {}).then(function () {
            wx.showToast({ title: '已通过', icon: 'success' })
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
          request.put('/reservation/' + id + '/reject', { reason: res.content || '' }).then(function () {
            wx.showToast({ title: '已拒绝', icon: 'success' })
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
