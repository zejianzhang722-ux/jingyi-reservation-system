var request = require('../../utils/request')
var auth = require('../../utils/auth')

function formatPercent(value) {
  var n = Number(value)
  if (isNaN(n)) return '0%'
  return n + '%'
}

Page({
  data: {
    loading: true,
    dashboard: {
      todayReservations: 0,
      pendingCount: 0,
      usingCount: 0,
      noshowCount: 0,
      usageRanking: { rooms: [], rates: [] },
      roomTypeStats: []
    },
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
    this.loadData()
  },

  ensureAdmin: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  loadData: function () {
    var that = this
    this.setData({ loading: true })
    Promise.all([
      request.get('/stats/dashboard', {}, { silent: true }),
      request.get('/stats/usage-rate', {}, { silent: true }),
      request.get('/stats/noshow', {}, { silent: true }),
      request.get('/stats/users', {}, { silent: true })
    ]).then(function (results) {
      var dashboard = results[0] || {}
      var usageRows = (results[1] || []).slice(0, 8).map(function (item) {
        return Object.assign({}, item, {
          displayRate: formatPercent(Math.min(100, Math.round((Number(item.reservation_count) || 0) / 30 * 100)))
        })
      })
      var userStats = results[3] || {}
      that.setData({
        loading: false,
        dashboard: Object.assign(that.data.dashboard, dashboard),
        usageRows: usageRows,
        noshow: results[2] || that.data.noshow,
        creditDistribution: userStats.creditDistribution || []
      })
    }).catch(function () {
      that.setData({ loading: false })
      wx.showToast({ title: '统计数据加载失败', icon: 'none' })
    })
  },

  onRefresh: function () {
    this.loadData()
  }
})
