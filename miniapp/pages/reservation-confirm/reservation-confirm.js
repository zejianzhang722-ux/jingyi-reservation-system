var request = require('../../utils/request')
var auth = require('../../utils/auth')
var localData = require('../../utils/local-data')
var subscribeMessage = require('../../services/subscribeMessage')

function padTime(value) { return (value < 10 ? '0' : '') + value }
function formatTime(hour, minute) { return padTime(hour) + ':' + padTime(minute || 0) }
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
function isPositiveInteger(value) { var n = Number(value); return Number.isInteger(n) && n > 0 }
function isTeamRoomType(type) {
  return ['seminar_room', 'shared_space', 'seminar', 'discussion', 'media_room', 'media', 'multi_purpose_hall', 'competition_room', 'competition', 'roadshow_space', 'roadshow'].indexOf(type || '') !== -1
}
function getParticipantCount(data) {
  var roomType = data.room ? data.room.type : ''
  if (roomType === 'seminar_room' || roomType === 'shared_space' || roomType === 'seminar' || roomType === 'discussion' || roomType === 'multi_purpose_hall') return Number(data.discussionFields.participantCount || 0)
  if (roomType === 'media_room' || roomType === 'media') return Number(data.mediaFields.participantCount || 0)
  if (roomType === 'competition_room' || roomType === 'roadshow_space' || roomType === 'competition' || roomType === 'roadshow') return Number(data.competitionFields.participantCount || 0)
  return 1
}

Page({
  data: {
    roomId: '', date: '', startHour: 0, startMin: 0, endHour: 0, endMin: 0,
    seatId: '', seatName: '', room: null, userInfo: null, phone: '', cardNo: '',
    agreedRules: false, submitting: false, timeStr: '', durationStr: '',
    teamMode: false,
    teamMembers: [],
    teamHint: '多人团队预约需填写除本人外的成员学号和姓名。系统匹配后会向成员发送确认通知，全部确认后自动进入预约审核流程。',
    discussionFields: { purposeCategory: '', participantCount: '', hasMultimedia: false, hasOwnAppliance: false },
    mediaFields: { participantCount: '', purpose: '' },
    competitionFields: { competitionName: '', participantCount: '' },
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
      roomId: roomId, date: date, startHour: startHour, startMin: startMin,
      endHour: endHour, endMin: endMin,
      seatId: options.seatId || '', seatName: options.seatName ? decodeURIComponent(options.seatName) : '',
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
      that.setData({ roomId: resolvedId || roomId, room: data })
      that.refreshTeamMembers()
    }).catch(function () {
      var data = localData.getRoomById(roomId)
      if (data) { that.setData({ roomId: data.id || roomId, room: data }); that.refreshTeamMembers() }
    })
  },

  loadUserInfo: function () {
    var that = this
    request.get('/user/profile', {}, { silent: true }).then(function (data) { that.applyUserInfo(data); auth.setUserInfo(data) }).catch(function () { that.applyUserInfo(auth.getUserInfo()) })
  },

  applyUserInfo: function (data) {
    if (!data) return
    this.setData({ userInfo: data, phone: data.phone || '', cardNo: data.card_no || data.cardNo || '' })
  },

  onPhoneInput: function (e) { this.setData({ phone: e.detail.value }) },
  onCardNoInput: function (e) { this.setData({ cardNo: e.detail.value }) },
  onAgreeRules: function () { this.setData({ agreedRules: !this.data.agreedRules }) },
  onViewRules: function () { wx.navigateTo({ url: '/pages/rules/rules?type=' + (this.data.room ? this.data.room.type : '') }) },
  onPurposeCategoryChange: function (e) { this.setData({ 'discussionFields.purposeCategory': this.data.purposeCategories[e.detail.value] }) },

  onParticipantCountInput: function (e) {
    var field = e.currentTarget.dataset.field
    var value = String(e.detail.value || '').replace(/\D/g, '')
    var obj = {}; obj[field + '.participantCount'] = value
    this.setData(obj)
    this.refreshTeamMembers(value)
  },

  refreshTeamMembers: function (rawCount) {
    var count = Number(rawCount || getParticipantCount(this.data) || 0)
    var room = this.data.room || {}
    var teamMode = isTeamRoomType(room.type) && count >= 2 && !this.data.seatId
    var needed = teamMode ? Math.max(0, count - 1) : 0
    var members = (this.data.teamMembers || []).slice(0, needed)
    while (members.length < needed) members.push({ studentNo: '', realName: '' })
    this.setData({ teamMode: teamMode, teamMembers: members })
  },

  onTeamMemberInput: function (e) {
    var index = Number(e.currentTarget.dataset.index)
    var field = e.currentTarget.dataset.field
    var members = (this.data.teamMembers || []).slice()
    if (!members[index]) members[index] = { studentNo: '', realName: '' }
    members[index][field] = e.detail.value
    this.setData({ teamMembers: members })
  },

  onCompetitionNameInput: function (e) { var field = e.currentTarget.dataset.field; var obj = {}; obj[field + '.competitionName'] = e.detail.value; this.setData(obj) },
  onMediaPurposeInput: function (e) { this.setData({ 'mediaFields.purpose': e.detail.value }) },
  onMultimediaChange: function (e) { this.setData({ 'discussionFields.hasMultimedia': e.detail.value }) },
  onOwnApplianceChange: function (e) { this.setData({ 'discussionFields.hasOwnAppliance': e.detail.value }) },

  validateTeamMembers: function () {
    if (!this.data.teamMode) return ''
    var members = this.data.teamMembers || []
    if (!members.length) return '请填写团队成员信息'
    var seen = {}
    for (var i = 0; i < members.length; i++) {
      var studentNo = String(members[i].studentNo || '').trim()
      var realName = String(members[i].realName || '').trim()
      if (!/^\d{9,10}$/.test(studentNo)) return '第' + (i + 1) + '名成员学号应为9-10位数字'
      if (!realName) return '第' + (i + 1) + '名成员姓名不能为空'
      if (seen[studentNo]) return '成员学号不能重复'
      seen[studentNo] = true
      var selfNo = this.data.userInfo && (this.data.userInfo.student_no || this.data.userInfo.student_id)
      if (selfNo && String(selfNo) === studentNo) return '团队成员不需要填写本人'
    }
    return ''
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
    if (roomType === 'seminar_room' || roomType === 'shared_space' || roomType === 'seminar' || roomType === 'discussion' || roomType === 'multi_purpose_hall') {
      if (!this.data.discussionFields.purposeCategory) return '请选择用途分类'
      if (!isPositiveInteger(this.data.discussionFields.participantCount)) return '请输入有效参与人数'
      if (Number(this.data.discussionFields.participantCount) < 2) return '多人功能房预约人数不能少于2人'
      if (room.capacity && Number(this.data.discussionFields.participantCount) > Number(room.capacity)) return '参与人数不能超过功能房容量'
    }
    if (roomType === 'media_room' || roomType === 'media') {
      if (!this.data.mediaFields.purpose) return '请输入用途'
      if (!isPositiveInteger(this.data.mediaFields.participantCount)) return '请输入有效参与人数'
      if (Number(this.data.mediaFields.participantCount) < 2) return '影音室预约人数不能少于2人'
      if (room.capacity && Number(this.data.mediaFields.participantCount) > Number(room.capacity)) return '参与人数不能超过功能房容量'
    }
    if (roomType === 'competition_room' || roomType === 'roadshow_space' || roomType === 'competition' || roomType === 'roadshow') {
      if (!this.data.competitionFields.competitionName) return '请输入项目名称'
      if (!isPositiveInteger(this.data.competitionFields.participantCount)) return '请输入有效参与人数'
      if (Number(this.data.competitionFields.participantCount) < 2) return '团队预约人数不能少于2人'
      if (room.capacity && Number(this.data.competitionFields.participantCount) > Number(room.capacity)) return '参与人数不能超过功能房容量'
    }
    return this.validateTeamMembers()
  },

  buildPayload: function () {
    var startTime = formatTime(this.data.startHour, this.data.startMin)
    var endTime = formatTime(this.data.endHour, this.data.endMin)
    var data = { roomId: normalizeId(this.data.roomId), date: this.data.date, startTime: startTime, endTime: endTime, startHour: this.data.startHour, startMin: this.data.startMin, endHour: this.data.endHour, endMin: this.data.endMin, phone: this.data.phone, cardNo: this.data.cardNo }
    var roomType = this.data.room ? this.data.room.type : ''
    if (this.data.seatId) data.seatId = normalizeId(this.data.seatId)
    if (roomType === 'seminar_room' || roomType === 'shared_space' || roomType === 'seminar' || roomType === 'discussion' || roomType === 'multi_purpose_hall') { data.purposeCategory = this.data.discussionFields.purposeCategory; data.purpose = this.data.discussionFields.purposeCategory; data.participantCount = Number(this.data.discussionFields.participantCount); data.participants = Number(this.data.discussionFields.participantCount); data.hasMultimedia = this.data.discussionFields.hasMultimedia; data.hasOwnAppliance = this.data.discussionFields.hasOwnAppliance }
    else if (roomType === 'media_room' || roomType === 'media') { data.participantCount = Number(this.data.mediaFields.participantCount); data.participants = Number(this.data.mediaFields.participantCount); data.purpose = this.data.mediaFields.purpose }
    else if (roomType === 'competition_room' || roomType === 'roadshow_space' || roomType === 'competition' || roomType === 'roadshow') { data.competitionName = this.data.competitionFields.competitionName; data.purpose = this.data.competitionFields.competitionName; data.participantCount = Number(this.data.competitionFields.participantCount); data.participants = Number(this.data.competitionFields.participantCount) }
    return data
  },

  buildGroupPayload: function () {
    var payload = this.buildPayload()
    return {
      roomId: payload.roomId,
      title: (this.data.room ? this.data.room.name : '功能房') + '团队预约',
      date: payload.date,
      startTime: payload.startTime,
      endTime: payload.endTime,
      maxMembers: payload.participants,
      purpose: payload.purpose,
      description: payload.purpose || '',
      invitedMembers: (this.data.teamMembers || []).map(function (m) { return { studentNo: String(m.studentNo || '').trim(), realName: String(m.realName || '').trim() } })
    }
  },

  onSubmit: function () {
    if (this.data.submitting) return
    var error = this.validateForm()
    if (error) {
      if (error.indexOf('登录') !== -1) { wx.showModal({ title: '需要重新登录', content: error, showCancel: false, success: function () { auth.logout() } }) }
      else { wx.showToast({ title: error, icon: 'none' }) }
      return
    }
    var that = this
    this.setData({ submitting: true })
    if (this.data.teamMode) {
      request.post('/groups', this.buildGroupPayload()).then(function (res) {
        that.setData({ submitting: false })
        wx.showToast({ title: '已发送成员确认', icon: 'success' })
        subscribeMessage.requestReservationSubscribe()
        setTimeout(function () { wx.redirectTo({ url: '/pages/group-reserve/group-reserve?mode=detail&groupId=' + res.id }) }, 1200)
      }).catch(function (err) { that.setData({ submitting: false }); wx.showToast({ title: err && err.message ? err.message : '发起组团失败', icon: 'none' }) })
      return
    }
    request.post('/reservation', this.buildPayload()).then(function (res) {
      that.setData({ submitting: false })
      wx.showToast({ title: res.status === 'approved' ? '预约成功' : '已提交审核', icon: 'success' })
      subscribeMessage.requestReservationSubscribe()
      setTimeout(function () { wx.redirectTo({ url: '/pages/reservation-detail/reservation-detail?id=' + res.id }) }, 1200)
    }).catch(function (err) { that.setData({ submitting: false }); wx.showToast({ title: err && err.message ? err.message : '预约失败，请重试', icon: 'none' }) })
  }
})
