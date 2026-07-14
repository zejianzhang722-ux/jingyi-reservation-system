var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

var apiTypeMap = {
  study: 'study_room',
  shared: 'seminar_room',
  discussion: 'seminar_room',
  media: 'media_room',
  competition: 'competition_room',
  roadshow: 'roadshow_space',
  dance: 'dance_room',
  reading: 'reading_room',
  multi: 'multi_purpose_hall'
}

Page({
  data: {
    list: [],
    filterType: '',
    canConfigureRooms: false,
    typeMap: {
      study_room: '自习室',
      seminar_room: '共享空间',
      shared_space: '共享空间',
      media_room: '影音室',
      competition_room: '备赛间',
      roadshow_space: '路演空间',
      dance_room: '舞蹈室',
      multi_purpose_hall: '多功能厅',
      reading_room: '阅览室',
      study_center: '学业辅导',
      career_center: '生涯咨询',
      job_studio: '就业创业',
      party_room: '党团活动',
      psychology_room: '心理咨询',
      tutor: '团员模范岗',
      other: '其他'
    },
    statusMap: { open: '开放中', closed: '已关闭', maintenance: '维护中' }
  },

  onLoad: function () {
    this.ensureAdmin()
  },

  onShow: function () {
    if (this.ensureAdmin()) return this.loadData()
  },

  hasReadAccess: function () {
    return auth.isLoggedIn() && auth.isAdmin() && adminPolicy.can(auth.getUserRole(), 'roomView')
  },

  clearList: function () {
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    this.setData({ list: [] })
  },

  ensureAdmin: function () {
    if (!this.hasReadAccess()) {
      this.clearList()
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  loadData: function () {
    var that = this
    if (!this.hasReadAccess()) {
      this.clearList()
      return Promise.resolve()
    }
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    var requestVersion = this._listRequestVersion
    var params = {}
    var apiType = apiTypeMap[this.data.filterType]
    if (apiType) params.type = apiType

    return request.get('/room', params, { silent: true }).then(function (data) {
      if (!that.hasReadAccess()) {
        that.clearList()
        return
      }
      if (requestVersion !== that._listRequestVersion) return
      var list = Array.isArray(data) ? data : (data.list || data.rooms || [])
      that.setData({ list: list })
    }).catch(function () {
      if (!that.hasReadAccess()) {
        that.clearList()
        return
      }
      if (requestVersion !== that._listRequestVersion) return
      that.setData({ list: [] })
    })
  },

  onFilterType: function (e) {
    this.setData({ filterType: e.currentTarget.dataset.type || '' })
    return this.loadData()
  },

  onToggleStatus: function (e) {
    wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
  },

  onViewDetail: function (e) {
    var id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/room-detail/room-detail?roomId=' + id })
  }
})
