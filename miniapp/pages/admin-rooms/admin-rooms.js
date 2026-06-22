var request = require('../../utils/request')

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
    this.loadData()
  },

  onShow: function () {
    this.loadData()
  },

  loadData: function () {
    var that = this
    var params = {}
    var apiType = apiTypeMap[this.data.filterType]
    if (apiType) params.type = apiType

    return request.get('/room', params, { silent: true }).then(function (data) {
      var list = Array.isArray(data) ? data : (data.list || data.rooms || [])
      that.setData({ list: list })
    }).catch(function () {
      that.setData({ list: [] })
    })
  },

  onFilterType: function (e) {
    this.setData({ filterType: e.currentTarget.dataset.type || '' })
    return this.loadData()
  },

  onToggleStatus: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var currentStatus = e.currentTarget.dataset.status
    var newStatus = currentStatus === 'open' ? 'closed' : 'open'
    var statusText = newStatus === 'open' ? '开放' : '关闭'
    wx.showModal({
      title: '确认操作',
      content: '确定将功能房状态改为“' + statusText + '”？',
      success: function (res) {
        if (res.confirm) {
          request.put('/admin/rooms/' + id, { status: newStatus }).then(function () {
            wx.showToast({ title: '操作成功', icon: 'success' })
            that.loadData()
          }).catch(function () {
            wx.showToast({ title: '操作失败', icon: 'none' })
          })
        }
      }
    })
  },

  onViewDetail: function (e) {
    var id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/room-detail/room-detail?roomId=' + id })
  }
})
