var request = require('../../utils/request')

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
      that.setData({ room: data, loading: false })
    }).catch(function () {
      that.setData({ loading: false })
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

  onCreateGroup: function () {
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

  onShareAppMessage: function () {
    return {
      title: '邀请你加入组团预约 - ' + (this.data.group ? this.data.group.title : ''),
      path: '/pages/group-reserve/group-reserve?mode=join&groupId=' + this.data.groupId
    }
  }
})
