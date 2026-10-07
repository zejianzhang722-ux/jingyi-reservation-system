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

var statusLabelMap = {
  open: '\u5f00\u653e\u4e2d',
  closed: '\u5df2\u5173\u95ed',
  maintenance: '\u7ef4\u62a4\u4e2d',
  counselor_only: '联系辅导员预约'
}

function fingerprintValue(value) {
  return value === undefined || value === null ? '' : String(value)
}

Page({
  data: {
    list: [],
    visibleRooms: [], keyword: '', typeIndex: 0, statusIndex: 0,
    typeOptions: [{key:'',label:'全部分类'},{key:'study',label:'自习室'},{key:'shared',label:'共享空间'},{key:'media',label:'影音室'},{key:'competition',label:'备赛间'},{key:'roadshow',label:'路演空间'},{key:'dance',label:'舞蹈室'},{key:'multi',label:'多功能厅'},{key:'reading',label:'阅览室'},{key:'study_center',label:'学业辅导'},{key:'career_center',label:'生涯咨询'},{key:'job_studio',label:'就业创业'},{key:'party_room',label:'党团活动室'},{key:'psychology_room',label:'心理咨询'},{key:'tutor',label:'团员模范岗'},{key:'mentor_room',label:'导师交流室'},{key:'innovation_workshop',label:'创新工坊'},{key:'national_defense_studio',label:'国防工作室'},{key:'data_room',label:'资料室'},{key:'other',label:'其他空间'}],
    statusOptions: [{key:'',label:'全部状态'},{key:'open',label:'开放中'},{key:'closed',label:'已关闭'},{key:'maintenance',label:'维护中'},{key:'counselor_only',label:'联系辅导员预约'}],
    filterType: '',
    filterStatus: '',
    filterStatusLabel: '',
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
      tutor: '团员模范岗', mentor_room: '导师交流室', innovation_workshop: '创新工坊', national_defense_studio: '国防工作室', data_room: '资料室',
      other: '其他'
    },
    statusMap: { open: '开放中', closed: '已关闭', maintenance: '维护中', counselor_only: '联系辅导员预约' }
  },

  onLoad: function (options) {
    if (!this.ensureAdmin()) return
    this.applyStatusPreset(options && options.status)
  },

  onShow: function () {
    if (this.ensureAdmin()) return this.loadData()
  },

  hasReadAccess: function () {
    return auth.isLoggedIn() && auth.isAdmin() && adminPolicy.can(auth.getUserRole(), 'roomView')
  },

  normalizeStatus: function (status) {
    return Object.prototype.hasOwnProperty.call(statusLabelMap, status) ? status : ''
  },

  applyStatusPreset: function (status) {
    var normalized = this.normalizeStatus(status)
    this.setData({
      filterStatus: normalized,
      filterStatusLabel: normalized ? statusLabelMap[normalized] : '', statusIndex: this.data.statusOptions.findIndex(function(item) { return item.key === normalized })
    })
  },

  requestContextFingerprint: function () {
    var userInfo = auth.getUserInfo() || {}
    var buildingId = userInfo.buildingId
    var scopeType = userInfo.scopeType
    if (buildingId === undefined) buildingId = userInfo.building_id
    if (scopeType === undefined) scopeType = userInfo.scope_type
    return JSON.stringify([
      fingerprintValue(userInfo.id),
      fingerprintValue(userInfo.username),
      fingerprintValue(userInfo.role),
      fingerprintValue(buildingId),
      fingerprintValue(scopeType)
    ])
  },

  clearList: function () {
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    this.setData({ list: [], visibleRooms: [] })
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
    var requestContext = this.requestContextFingerprint()
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    var requestVersion = this._listRequestVersion
    var params = { page: 1, pageSize: 100 }
    var filterType = this.data.filterType;
    var apiType = apiTypeMap[filterType] || (this.data.typeOptions.some(function(item) { return item.key === filterType }) ? filterType : '')
    if (apiType) params.type = apiType
    if (this.data.filterStatus && this.data.filterStatus !== 'counselor_only') params.status = this.data.filterStatus

    return request.get('/admin/rooms', params, { silent: true }).then(function (data) {
      if (!that.hasReadAccess()) {
        that.clearList()
        return
      }
      if (requestVersion !== that._listRequestVersion) return
      if (that.requestContextFingerprint() !== requestContext) {
        that.clearList()
        if (that.hasReadAccess()) return that.loadData()
        return
      }
      var list = Array.isArray(data) ? data : (data.list || data.rooms || [])
      that.setData({ list: list }); that.filterRooms()
    }).catch(function () {
      if (!that.hasReadAccess()) {
        that.clearList()
        return
      }
      if (requestVersion !== that._listRequestVersion) return
      if (that.requestContextFingerprint() !== requestContext) {
        that.clearList()
        if (that.hasReadAccess()) return that.loadData()
        return
      }
      that.setData({ list: [], visibleRooms: [] })
    })
  },

  onFilterType: function (e) {
    this.setData({ filterType: e.currentTarget.dataset.type || '' })
    return this.loadData()
  },

  onClearStatus: function () {
    this.applyStatusPreset('')
    return this.loadData()
  },

  filterRooms: function () {
    var that = this, keyword = this.data.keyword.toLowerCase();
    this.setData({ visibleRooms: this.data.list.filter(function(room) { return (!that.data.filterStatus || room.status === that.data.filterStatus) && (!keyword || String(room.name + ' ' + (room.location || '')).toLowerCase().indexOf(keyword) !== -1) }) });
  },
  onSearch: function(e) { this.setData({ keyword: e.detail.value.trim() }); this.filterRooms(); },
  onTypeChange: function(e) { var index = Number(e.detail.value); this.setData({ typeIndex: index, filterType: this.data.typeOptions[index].key }); return this.loadData(); },
  onStatusChange: function(e) { this.applyStatusPreset(this.data.statusOptions[Number(e.detail.value)].key); return this.loadData(); },
  onToggleStatus: function (e) {
    wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
  },

  onViewDetail: function (e) {
    if (!this.ensureAdmin()) return
    var id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/admin-room-detail/admin-room-detail?roomId=' + id })
  }
})
