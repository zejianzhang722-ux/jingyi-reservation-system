var request = require('../../utils/request')
var util = require('../../utils/util')
var auth = require('../../utils/auth')

function normalizeReservations(list) {
  var userInfo = auth.getUserInfo() || {}
  var userId = Number(userInfo.id)
  return (list || []).filter(function(item) {
    if (!userId || item.user_id === undefined) return true
    return Number(item.user_id) === userId
  }).map(function(item) {
    var next = Object.assign({}, item)
    next.statusText = util.getStatusText(next.status) || '未知状态'
    next.canCheckIn = util.canCheckIn(next)
    next.canCancel = util.canCancel(next)
    return next
  })
}

Page({
  data: {
    tabs: [
      { key: 'pending', name: '待审核', color: '#FA8C16' },
      { key: 'approved', name: '已通过', color: '#1890FF' },
      { key: 'using', name: '使用中', color: '#52C41A' },
      { key: 'completed', name: '已完成', color: '#999999' },
      { key: 'cancelled', name: '已取消', color: '#BBBBBB' },
      { key: 'noshow', name: '已爽约', color: '#FF4D4F' }
    ],
    currentTab: 'pending',
    currentTabName: '待审核',
    reservations: [],
    loading: true
  },

  onLoad: function () {
    this.loadReservations()
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTabList()
      this.getTabBar().setData({ selected: 1 })
    }
    this.loadReservations()
  },

  onPullDownRefresh: function () {
    this.loadReservations()
    wx.stopPullDownRefresh()
  },

  loadReservations: function () {
    var that = this
    var status = this.data.currentTab
    if (status === 'pending') {
      request.get('/reservation', { status: 'pending' }, { silent: true }).then(function (data) {
        return data && data.list ? data.list : (Array.isArray(data) ? data : [])
      }).then(function (pendingList) {
        return request.get('/reservation', { status: 'counselor_pending' }, { silent: true }).then(function (data2) {
          var cpList = data2 && data2.list ? data2.list : (Array.isArray(data2) ? data2 : [])
          return pendingList.concat(cpList)
        }).catch(function () {
          return pendingList
        })
      }).then(function (allPending) {
        that.setData({
          reservations: normalizeReservations(allPending || []),
          loading: false
        })
      }).catch(function () {
        that.setData({ loading: false, reservations: [] })
      })
    } else if (status === 'using') {
      request.get('/reservation', { status: 'checked_in' }, { silent: true }).then(function (data) {
        var list = data && data.list ? data.list : (Array.isArray(data) ? data : [])
        that.setData({
          reservations: normalizeReservations(list || []),
          loading: false
        })
      }).catch(function () {
        that.setData({ loading: false, reservations: [] })
      })
    } else {
      request.get('/reservation', { status: status }, { silent: true }).then(function (data) {
        var list = data && data.list ? data.list : (Array.isArray(data) ? data : [])
        that.setData({
          reservations: normalizeReservations(list || []),
          loading: false
        })
      }).catch(function () {
        that.setData({ loading: false, reservations: [] })
      })
    }
  },

  onTabChange: function (e) {
    var key = e.currentTarget.dataset.key
    var tab = this.data.tabs.find(function (t) { return t.key === key })
    this.setData({
      currentTab: key,
      currentTabName: tab ? tab.name : '',
      loading: true
    })
    this.loadReservations()
  },

  onReservationTap: function (e) {
    var id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({
        url: '/pages/reservation-detail/reservation-detail?id=' + id
      })
    }
  },

  onCancel: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认取消',
      content: '确定要取消此预约吗？',
      success: function (res) {
        if (res.confirm) {
          request.delete('/reservation/' + id).then(function () {
            wx.showToast({ title: '已取消', icon: 'success' })
            that.loadReservations()
          })
        }
      }
    })
  },

  onCheckIn: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    request.post('/checkin', { reservationId: id }).then(function () {
      wx.showToast({ title: '签到成功', icon: 'success' })
      that.loadReservations()
    })
  },

  onQRCode: function (e) {
    var id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: '/pages/qrcode/qrcode?id=' + id
    })
  }
})
