var request = require('../../utils/request')
var localData = require('../../utils/local-data')
var bookingPolicy = require('../../utils/room-booking-policy')

Page({
  data: {
    roomId: '',
    room: null,
    mode: 'create',
    groupId: '',
    form: {
      title: '',
      date: '',
      startHour: '',
      endHour: '',
      maxMembers: 4,
      description: ''
    },
    group: null,
    members: [],
    loading: true
  },

  onLoad: function (options) {
    var roomId = options.roomId || ''
    var mode = options.mode || 'create'
    var groupId = options.groupId || ''
    this.setData({
      roomId: roomId,
      mode: mode,
      groupId: groupId
    })

    if (roomId) this.loadRoomInfo(roomId)
    if (groupId) this.loadGroupInfo(groupId)
  },

  loadRoomInfo: function (roomId) {
    var that = this
    request.get('/room/' + roomId).then(function (data) {
      that.setData({ room: bookingPolicy.presentRoom(data), loading: false })
    }).catch(function () {
      var room = localData.getRoomById(roomId)
      that.setData({ room: room ? bookingPolicy.presentRoom(room) : null, loading: false })
    })
  },

  loadGroupInfo: function (groupId) {
    var that = this
    request.get('/groups/' + groupId).then(function (data) {
      that.setData({
        group: data,
        members: data.members || [],
        loading: false
      })
    }).catch(function () {
      that.setData({ loading: false })
    })
  },

  onTitleInput: function (e) {
    this.setData({ 'form.title': e.detail.value })
  },

  onDateChange: function (e) {
    this.setData({ 'form.date': e.detail.value })
  },

  onStartHourChange: function (e) {
    this.setData({ 'form.startHour': e.detail.value })
  },

  onEndHourChange: function (e) {
    this.setData({ 'form.endHour': e.detail.value })
  },

  onMaxMembersChange: function (e) {
    this.setData({ 'form.maxMembers': Number(e.detail.value) })
  },

  onDescriptionInput: function (e) {
    this.setData({ 'form.description': e.detail.value })
  },

  validateGroupForm: function () {
    var blocked = bookingPolicy.blockReason(this.data.room, 'group')
    if (blocked) return blocked
    var count = Number(this.data.form.maxMembers)
    if (!Number.isInteger(count) || count < 2) return '请填写至少2人的实际参与人数（含发起人）'
    if (this.data.room.capacity && count > Number(this.data.room.capacity)) return '实际参与人数不能超过功能房容量'
    if (!String(this.data.form.title || '').trim()) return '请填写标题'
    if (!this.data.form.date) return '请选择日期'
    if (!this.data.form.startHour || !this.data.form.endHour || this.data.form.endHour <= this.data.form.startHour) return '请选择有效的开始和结束时间'
    return ''
  },

  onCreateGroup: function () {
    var error = this.validateGroupForm()
    if (error) { wx.showToast({ title: error, icon: 'none' }); return }
    var form = this.data.form
    if (!form.title) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    if (!form.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }

    var that = this
    var data = Object.assign({}, form, { roomId: this.data.roomId })

    request.post('/groups', data).then(function (res) {
      wx.showToast({ title: '创建成功', icon: 'success' })
      that.setData({
        mode: 'detail',
        groupId: res.id,
        group: res,
        members: res.members || []
      })
    })
  },

  onJoinGroup: function () {
    var that = this
    request.post('/groups/' + this.data.groupId + '/join').then(function (res) {
      wx.showToast({ title: '加入成功', icon: 'success' })
      that.loadGroupInfo(that.data.groupId)
    })
  },

  onLeaveGroup: function () {
    var that = this
    request.post('/groups/' + this.data.groupId + '/leave').then(function () {
      wx.showToast({ title: '已退出', icon: 'success' })
      that.loadGroupInfo(that.data.groupId)
    })
  },

  onDissolveGroup: function () {
    var that = this
    wx.showModal({
      title: '解散组团',
      content: '解散后将取消关联预约并释放时段，确定吗？',
      confirmColor: '#FF4D4F',
      success: function (res) {
        if (!res.confirm) return
        request.del('/groups/' + that.data.groupId).then(function () {
          wx.showToast({ title: '已解散', icon: 'success' })
          setTimeout(function () { wx.navigateBack() }, 800)
        })
      }
    })
  },

  onShareAppMessage: function () {
    return {
      title: '邀请你加入组团预约 - ' + (this.data.group ? this.data.group.title : ''),
      path: '/pages/group-reserve/group-reserve?mode=join&groupId=' + this.data.groupId
    }
  }
})
