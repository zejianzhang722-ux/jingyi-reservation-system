var request = require('../../utils/request')
var util = require('../../utils/util')
var auth = require('../../utils/auth')

function toNumber(value, fallback) {
  var n = Number(value)
  return isNaN(n) ? fallback : n
}

function normalizeCreditRecord(item, index) {
  var change = toNumber(item.score_change !== undefined ? item.score_change : item.change, 0)
  return {
    id: item.id || index + 1,
    title: item.description || item.reason || item.title || '信用分变动',
    reason: item.description || item.reason || '暂无原因',
    type: item.type || 'credit',
    change: change,
    scoreAfter: item.score_after !== undefined ? item.score_after : (item.score || ''),
    time: item.created_at || item.createdAt || item.date || ''
  }
}

function normalizeReservation(item, index) {
  return {
    id: item.id || index + 1,
    roomName: item.room_name || item.roomName || '功能房',
    date: item.date || '',
    time: (item.start_time || item.startTime || '') + ' - ' + (item.end_time || item.endTime || ''),
    status: util.getStatusText(item.status || '') || '未知状态'
  }
}

Page({
  data: {
    mode: 'credit',
    creditScore: 100,
    creditColorValue: '#52C41A',
    records: [],
    stats: {
      totalReservations: 0,
      activeReservations: 0,
      noshowCount: 0,
      completedCount: 0,
      recentReservations: []
    },
    loading: true
  },

  onLoad: function (options) {
    var mode = options.tab === 'stats' ? 'stats' : 'credit'
    this.setData({ mode: mode })
    wx.setNavigationBarTitle({ title: mode === 'stats' ? '使用统计' : '信用分明细' })
    if (mode === 'stats') {
      this.loadUsageStats()
    } else {
      this.loadCreditDetail()
    }
  },

  loadCreditDetail: function () {
    var that = this
    request.get('/user/credit', {}, { silent: true }).then(function (data) {
      var cachedUser = auth.getUserInfo() || {}
      var score = toNumber(data.creditScore !== undefined ? data.creditScore : data.score, toNumber(cachedUser.credit_score || cachedUser.creditScore, 100))
      var logs = data.records || data.recentLogs || []
      auth.setUserInfo(Object.assign({}, cachedUser, { credit_score: score, creditScore: score }))
      that.setData({
        creditScore: score,
        creditColorValue: util.getCreditColorValue(score),
        records: logs.map(normalizeCreditRecord),
        loading: false
      })
    }).catch(function () {
      var cachedUser = auth.getUserInfo() || {}
      var fallbackScore = toNumber(cachedUser.credit_score || cachedUser.creditScore, 100)
      that.setData({
        creditScore: fallbackScore,
        creditColorValue: util.getCreditColorValue(fallbackScore),
        records: [],
        loading: false
      })
    })
  },

  loadUsageStats: function () {
    var that = this
    request.get('/user/stats', {}, { silent: true }).then(function (data) {
      var recent = data.recentReservations || []
      that.setData({
        stats: {
          totalReservations: data.totalReservations || 0,
          activeReservations: data.activeReservations || 0,
          noshowCount: data.noshowCount || 0,
          completedCount: data.completedCount || 0,
          recentReservations: recent.map(normalizeReservation)
        },
        loading: false
      })
    }).catch(function () {
      that.setData({ loading: false })
    })
  }
})
