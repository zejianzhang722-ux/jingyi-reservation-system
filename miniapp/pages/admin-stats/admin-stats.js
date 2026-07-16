var request = require('../../utils/request')
var auth = require('../../utils/auth')

function numberOrZero(value) {
  var number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function emptyDashboard() {
  return {
    todayReservations: 0,
    ordinaryPendingCount: 0,
    counselorPendingCount: 0,
    usingCount: 0,
    activeRoomCount: 0
  }
}

Page({
  data: {
    pageStatus: 'loading',
    errorMessage: '',
    showCounselorPending: false,
    dashboard: emptyDashboard(),
    usageRows: [],
    noshow: {
      totalNoshow: 0,
      topNoshowUsers: [],
      roomNoshowStats: []
    },
    creditDistribution: []
  },

  onLoad: function () {
    if (!this.ensureAdmin()) return
    this.applyRole()
    this.loadData()
  },

  ensureAdmin: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  applyRole: function () {
    this.setData({ showCounselorPending: auth.getUserRole() !== 'admin' })
  },

  loadData: function () {
    var that = this
    this._requestVersion = (this._requestVersion || 0) + 1
    var requestVersion = this._requestVersion
    this.setData({ pageStatus: 'loading', errorMessage: '' })
    return Promise.all([
      request.get('/stats/dashboard', {}, { silent: true }),
      request.get('/stats/usage-rate', {}, { silent: true }),
      request.get('/stats/noshow', {}, { silent: true }),
      request.get('/stats/users', {}, { silent: true })
    ]).then(function (results) {
      if (requestVersion !== that._requestVersion) return
      var source = results[0] || {}
      var usageRows = (results[1] || []).slice(0, 8).map(function (item) {
        return {
          roomId: numberOrZero(item.room_id),
          roomName: item.room_name || '未命名房间',
          reservationCount: numberOrZero(item.reservation_count),
          usedDays: numberOrZero(item.used_days)
        }
      })
      var userStats = results[3] || {}
      that.setData({
        pageStatus: 'ready',
        errorMessage: '',
        dashboard: {
          todayReservations: numberOrZero(source.todayReservations),
          ordinaryPendingCount: numberOrZero(source.ordinaryPendingCount),
          counselorPendingCount: numberOrZero(source.counselorPendingCount),
          usingCount: numberOrZero(source.usingCount !== undefined ? source.usingCount : source.inUseCount),
          activeRoomCount: numberOrZero(source.activeRoomCount)
        },
        usageRows: usageRows,
        noshow: results[2] || that.data.noshow,
        creditDistribution: userStats.creditDistribution || []
      })
    }).catch(function () {
      if (requestVersion !== that._requestVersion) return
      that.setData({
        pageStatus: 'error',
        errorMessage: '统计数据加载失败，请检查网络后重新加载'
      })
    })
  },

  onRetry: function () {
    return this.loadData()
  },

  onRefresh: function () {
    return this.loadData()
  }
})