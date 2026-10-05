var request = require('../../utils/request')

// 状态文本与颜色在 JS 层预计算，WXML 不可调用方法。
var STATUS_TEXT = {
  pending: '待审核',
  counselor_pending: '待辅导员审核',
  approved: '已通过',
  rejected: '未通过',
  cancelled: '已解散'
}
var STATUS_COLOR = {
  pending: '#FA8C16',
  counselor_pending: '#FA8C16',
  approved: '#1890FF',
  rejected: '#FF4D4F',
  cancelled: '#999999'
}

Page({
  data: {
    groups: [],
    loading: true,
    loadError: ''
  },

  onLoad: function () {
    this.loadGroups()
  },

  onShow: function () {
    // 从详情页返回时刷新，保证状态与人数同步
    if (this.data.groups.length) this.loadGroups()
  },

  onPullDownRefresh: function () {
    this.loadGroups()
  },

  loadGroups: function () {
    var that = this
    this.setData({ loading: true, loadError: '' })
    request.get('/groups/mine').then(function (data) {
      var list = (data && data.list) || []
      var groups = list.map(function (g) {
        return Object.assign({}, g, {
          statusText: STATUS_TEXT[g.approvalStatus] || '未知',
          statusColor: STATUS_COLOR[g.approvalStatus] || '#999999',
          roleText: g.isCreator ? '我发起的' : '我参与的'
        })
      })
      that.setData({ groups: groups, loading: false })
      wx.stopPullDownRefresh()
    }).catch(function () {
      that.setData({ loading: false, loadError: '加载失败，下拉刷新重试' })
      wx.stopPullDownRefresh()
    })
  },

  onGroupTap: function (e) {
    var id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: '/pages/group-reserve/group-reserve?mode=detail&groupId=' + id
    })
  },

  onGoRoomList: function () {
    wx.navigateTo({ url: '/pages/room-list/room-list?groupMode=1' })
  }
})
