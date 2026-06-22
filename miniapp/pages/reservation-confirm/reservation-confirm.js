var request = require('../../utils/request')
var auth = require('../../utils/auth')
var localData = require('../../utils/local-data')
var subscribeMessage = require('../../services/subscribeMessage')

function padTime(value) {
  return (value < 10 ? '0' : '') + value
}

function formatTime(hour, minute) {
  return padTime(hour) + ':' + padTime(minute || 0)
}

function formatDuration(startHour, startMin, endHour, endMin) {
  var durationMin = (endHour * 60 + endMin) - (startHour * 60 + startMin)
  if (durationMin <= 0) return '0分钟'
  var hours = Math.floor(durationMin / 60)
  var mins = durationMin % 60
  return (hours > 0 ? hours + '小时' : '') + (mins > 0 ? mins + '分钟' : '')
}

function normalizeId(value) {
  if (value === undefined || value === null || value === '') return ''
  var numberValue = Number(value)
  if (!isNaN(numberValue) && numberValue > 0) return numberValue
  return value
}

function isPositiveInteger(value) {
  var n = Number(value)
  return Number.isInteger(n) && n > 0
}

Page({
  data: {
    roomId: '',
    date: '',
    startHour: 0,
    startMin: 0,
    endHour: 0,
    endMin: 0,
    seatId: '',
    seatName: '',
    room: null,
    userInfo: null,
    phone: '',
    cardNo: '',
    agreedRules: false,
    submitting: false,
    timeStr: '',
    durationStr: '',
    discussionFields: {
      purposeCategory: '',
      participantCount: '',
      hasMultimedia: false,
      hasOwnAppliance: false
    },
    mediaFields: {
      participantCount: '',
      purpose: ''
    },
    competitionFields: {
      competitionName: '',
      participantCount: ''
    },
    purposeCategories: ['学术讨论', '项目合作', '课程作业', '社团活动', '其他']
  },

  onLoad: function (options) {
    var roomIdentity = options.roomId || options.roomName || options.room || options.name || options.roomCode || options.room_number || ''
    var roomId = localData.resolveRoomId(roomIdentity)
    var date = options.date || ''
    var startHour = Math.floor(Number(options.startHour)) || 0
    var startMin = Math.floor(Number(options.startMin)) || 0
    var endHour = Math.floor(Number(options.endHour)) || 0
    var endMin = Math.floor(Number(options.endMin)) || 0

    this.setData({
      roomId: roomId,
      date: date,
      startHour: startHour,
      startMin: startMin,
      endHour: endHour,
      endMin: endMin,
      seatId: options.seatId || '',
      seatName: options.seatName ? decodeURIComponent(options.seatName) : '',
      timeStr: formatTime(startHour, startMin) + ' - ' + formatTime(endHour, endMin),
      durationStr: formatDuration(startHour, startMin, endHour, endMin)
    })

    this.loadRoomInfo(roomId)
    this.loadUserInfo()
  },

  loadRoomInfo: function (roomId) {
    var that = this
    request.get('/room/' + roomId).then(function (data) {
      var resolvedId = localData.resolveRoomId(data.id || data.room_id || data.roomId || data.name || data.room_number || roomId)
      that.setData({
        roomId: resolvedId || roomId,
        room: data
      })
    }).catch(function () {
      var data = localData.getRoomById(roomId)
      if (data) {
        that.setData({
          roomId: data.id || roomId,
          room: data
        })
      }
    })
  },

  loadUserInfo: function () {
    var that = this
    request.get('/user/profile', {}, { silent: true }).then(function (data) {
      that.applyUserInfo(data)
      auth.setUserInfo(data)
    }).catch(function () {
      that.applyUserInfo(auth.getUserInfo())
    })
  },

  applyUserInfo: function (data) {
    if (!data) return
    this.setData({
      userInfo: data,
      phone: data.phone || '',
      cardNo: data.card_no || data.cardNo || ''
    })
  },

  onPhoneInput: function (e) {
    this.setData({ phone: e.detail.value })
  },

  onCardNoInput: function (e) {
    this.setData({ cardNo: e.detail.value })
  },

  onAgreeRules: function () {
    this.setData({ agreedRules: !this.data.agreedRules })
  },

  onViewRules: function () {
    wx.navigateTo({ url: '/pages/rules/rules?type=' + (this.data.room ? this.data.room.type : '') })
  },

  onPurposeCategoryChange: function (e) {
    this.setData({ 'discussionFields.purposeCategory': this.data.purposeCategories[e.detail.value] })
  },

  onParticipantCountInput: function (e) {
    var field = e.currentTarget.dataset.field
    var value = String(e.detail.value || '').replace(/\D/g, '')
    var obj = {}
    obj[field + '.participantCount'] = value
    this.setData(obj)
  },

  onCompetitionNameInput: function (e) {
    var field = e.currentTarget.dataset.field
    var obj = {}
    obj[field + '.competitionName'] = e.detail.value
    this.setData(obj)
  },

  onMediaPurposeInput: function (e) {
    this.setData({ 'mediaFields.purpose': e.detail.value })
  },

  onMultimediaChange: function (e) {
    this.setData({ 'discussionFields.hasMultimedia': e.detail.value })
  },

  onOwnApplianceChange: function (e) {
    this.setData({ 'discussionFields.hasOwnAppliance': e.detail.value })
  },

  validateForm: function () {
    if (!auth.getToken()) return '登录已过期，请重新登录后再预约'
    if (!Number(this.data.roomId)) return '房间信息异常，请返回重新选择功能房'
    if (!this.data.agreedRules) return '请先阅读并同意管理制度'
    if (!/^\d{11}$/.test(this.data.phone)) return '请输入11位手机号'
    if (!/^\d{6}$/.test(this.data.cardNo)) return '请输入6位一卡通号'
    var room = this.data.room
    var isStudyRoom = room && (room.type === 'study_room' || room.type === 'study')
    if (isStudyRoom && !this.data.seatId) return '请选择座位'
    var roomType = room ? room.type : ''
    if (roomType === 'seminar_room' || roomType === 'shared_space' || roomType === 'seminar' || roomType === 'discussion') {
      if (!this.data.discussionFields.purposeCategory) return '请选择用途分类'
      if (!isPositiveInteger(this.data.discussionFields.participantCount)) return '请输入有效参与人数'
      if (room.capacity && Number(this.data.discussionFields.participantCount) > Number(room.capacity)) return '参与人数不能超过功能房容量'
    }
    if (roomType === 'media_room' || roomType === 'media') {
      if (!this.data.mediaFields.purpose) return '请输入用途'
      if (!isPositiveInteger(this.data.mediaFields.participantCount)) return '请输入有效参与人数'
      if (room.capacity && Number(this.data.mediaFields.participantCount) > Number(room.capacity)) return '参与人数不能超过功能房容量'
    }
    if (roomType === 'competition_room' || roomType === 'roadshow_space' || roomType === 'competition' || roomType === 'roadshow') {
      if (!this.data.competitionFields.competitionName) return '请输入项目名称'
      if (!isPositiveInteger(this.data.competitionFields.participantCount)) return '请输入有效参与人数'
      if (room.capacity && Number(this.data.competitionFields.participantCount) > Number(room.capacity)) return '参与人数不能超过功能房容量'
    }
    return ''
  },

  buildPayload: function () {
    var startTime = formatTime(this.data.startHour, this.data.startMin)
    var endTime = formatTime(this.data.endHour, this.data.endMin)
    var data = {
      roomId: normalizeId(this.data.roomId),
      date: this.data.date,
      startTime: startTime,
      endTime: endTime,
      startHour: this.data.startHour,
      startMin: this.data.startMin,
      endHour: this.data.endHour,
      endMin: this.data.endMin,
      phone: this.data.phone,
      cardNo: this.data.cardNo
    }

    var roomType = this.data.room ? this.data.room.type : ''
    if (this.data.seatId) data.seatId = normalizeId(this.data.seatId)
    if (roomType === 'seminar_room' || roomType === 'shared_space' || roomType === 'seminar' || roomType === 'discussion') {
      data.purposeCategory = this.data.discussionFields.purposeCategory
      data.purpose = this.data.discussionFields.purposeCategory
      data.participantCount = Number(this.data.discussionFields.participantCount)
      data.participants = Number(this.data.discussionFields.participantCount)
      data.hasMultimedia = this.data.discussionFields.hasMultimedia
      data.hasOwnAppliance = this.data.discussionFields.hasOwnAppliance
    } else if (roomType === 'media_room' || roomType === 'media') {
      data.participantCount = Number(this.data.mediaFields.participantCount)
      data.participants = Number(this.data.mediaFields.participantCount)
      data.purpose = this.data.mediaFields.purpose
    } else if (roomType === 'competition_room' || roomType === 'roadshow_space' || roomType === 'competition' || roomType === 'roadshow') {
      data.competitionName = this.data.competitionFields.competitionName
      data.purpose = this.data.competitionFields.competitionName
      data.participantCount = Number(this.data.competitionFields.participantCount)
      data.participants = Number(this.data.competitionFields.participantCount)
    }
    return data
  },

  onSubmit: function () {
    if (this.data.submitting) return
    var error = this.validateForm()
    if (error) {
      if (error.indexOf('登录') !== -1) {
        wx.showModal({
          title: '需要重新登录',
          content: error,
          showCancel: false,
          success: function () {
            auth.logout()
          }
        })
      } else {
        wx.showToast({ title: error, icon: 'none' })
      }
      return
    }

    var that = this
    this.setData({ submitting: true })
    request.post('/reservation', this.buildPayload()).then(function (res) {
      that.setData({ submitting: false })
      wx.showToast({ title: '预约成功', icon: 'success' })
      subscribeMessage.requestReservationSubscribe()
      setTimeout(function () {
        wx.redirectTo({ url: '/pages/reservation-detail/reservation-detail?id=' + res.id })
      }, 1200)
    }).catch(function (err) {
      that.setData({ submitting: false })
      wx.showToast({ title: err && err.message ? err.message : '预约失败，请重试', icon: 'none' })
    })
  }
})
