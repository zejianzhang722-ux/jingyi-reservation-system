var request = require('../../utils/request')
var auth = require('../../utils/auth')

function numberOrZero(value) {
  var number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : []
}

function normalizeNoshow(value) {
  value = value && typeof value === 'object' ? value : {}
  return {
    totalNoshow: numberOrZero(value.totalNoshow),
    topNoshowUsers: arrayOrEmpty(value.topNoshowUsers),
    roomNoshowStats: arrayOrEmpty(value.roomNoshowStats)
  }
}

function creditLevelLabel(level) {
  if (level === 'good') return '良好'
  if (level === 'warning') return '需注意'
  if (level === 'restricted') return '受限'
  if (level === 'banned' || level === 'blocked') return '封禁'
  return '未知'
}

function normalizeCreditDistribution(value) {
  return arrayOrEmpty(value).map(function (item) {
    item = item && typeof item === 'object' ? item : {}
    return { level: item.level || 'unknown', levelLabel: creditLevelLabel(item.level), count: numberOrZero(item.count) }
  })
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
    noshow: normalizeNoshow(),
    creditDistribution: []
  },

  onLoad: function () {
    if (!this.ensureAdmin()) return
    this.applyRole(auth.getUserRole())
    this.loadData()
  },

  ensureAdmin: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  onShow: function () {
    if (!this.ensureAdmin()) {
      this._requestVersion = (this._requestVersion || 0) + 1
      return
    }
    var role = auth.getUserRole()
    if (this._loadedRole && this._loadedRole !== role) {
      this.applyRole(role)
      this.loadData()
    }
  },

  applyRole: function (role) {
    this._loadedRole = role
    this.setData({ showCounselorPending: role !== 'admin' })
  },

  loadData: function () {
    var that = this
    var requestRole = auth.getUserRole()
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
      if (!auth.isLoggedIn() || !auth.isAdmin()) {
        that._requestVersion += 1
        wx.reLaunch({ url: '/pages/login/login' })
        return
      }
      var currentRole = auth.getUserRole()
      if (currentRole !== requestRole) {
        that.applyRole(currentRole)
        return that.loadData()
      }
      var source = results[0] || {}
      var usageRows = arrayOrEmpty(results[1]).slice(0, 8).map(function (item) {
        item = item && typeof item === 'object' ? item : {}
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
        noshow: normalizeNoshow(results[2]),
        creditDistribution: normalizeCreditDistribution(userStats.creditDistribution)
      })
    }).catch(function () {
      if (requestVersion !== that._requestVersion) return
      if (!auth.isLoggedIn() || !auth.isAdmin() || auth.getUserRole() !== requestRole) return
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