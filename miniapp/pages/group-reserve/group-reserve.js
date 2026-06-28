var request = require('../../utils/request')

function todayText() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
function trimForm(form) { var next = Object.assign({}, form || {}); Object.keys(next).forEach(function (key) { if (typeof next[key] === 'string') next[key] = next[key].trim() }); return next }

Page({
  data: {
    roomId: '', room: null, mode: 'create', groupId: '',
    form: { title: '', date: '', startHour: '', endHour: '', maxMembers: 4, description: '' },
    group: null, members: [], loading: true, submitting: false, today: todayText(),
    statusMap: { open: '招募中', pending_confirm: '待成员确认', full: '已确认', submitted: '已生成预约', cancelled: '已取消', closed: '已关闭' },
    memberStatusMap: { pending: '待确认', confirmed: '已确认', rejected: '已拒绝' }
  },

  onLoad: function (options) {
    var roomId = options.roomId || ''
    var mode = options.mode || (options.groupId ? 'detail' : 'create')
    var groupId = options.groupId || ''
    this.setData({ roomId: roomId, mode: mode, groupId: groupId })
    if (roomId) this.loadRoomInfo(roomId)
    if (groupId) this.loadGroupInfo(groupId)
    if (!roomId && !groupId) this.setData({ loading: false })
  },

  loadRoomInfo: function (roomId) { var that = this; request.get('/room/' + roomId).then(function (data) { var roomName = data && data.name ? data.name : ''; that.setData({ room: data, loading: false, 'form.title': roomName ? roomName + '团队预约' : that.data.form.title }) }).catch(function () { that.setData({ loading: false }) }) },
  loadGroupInfo: function (groupId) { var that = this; this.setData({ loading: true }); request.get('/groups/' + groupId).then(function (data) { that.setData({ group: data, members: data.members || [], room: data.roomName ? { name: data.roomName } : that.data.room, loading: false }) }).catch(function (err) { that.setData({ loading: false }); wx.showToast({ title: err && err.message ? err.message : '组团不存在', icon: 'none' }) }) },

  onTitleInput: function (e) { this.setData({ 'form.title': e.detail.value }) },
  onDateChange: function (e) { this.setData({ 'form.date': e.detail.value }) },
  onStartHourChange: function (e) { this.setData({ 'form.startHour': e.detail.value }) },
  onEndHourChange: function (e) { this.setData({ 'form.endHour': e.detail.value }) },
  onMaxMembersChange: function (e) { this.setData({ 'form.maxMembers': Number(e.detail.value) || '' }) },
  onDescriptionInput: function (e) { this.setData({ 'form.description': e.detail.value }) },

  validateGroupForm: function (form) {
    if (!this.data.roomId) return '缺少功能房信息'
    if (!form.title) return '请填写团队预约标题'
    if (form.title.length > 80) return '标题不能超过80字'
    if (!form.date) return '请选择日期'
    if (form.date < todayText()) return '日期不能早于今天'
    if (!form.startHour) return '请选择开始时间'
    if (!form.endHour) return '请选择结束时间'
    if (form.startHour >= form.endHour) return '结束时间必须晚于开始时间'
    var maxMembers = Number(form.maxMembers)
    if (!maxMembers || maxMembers < 2 || maxMembers > 500) return '团队人数不能少于2人，且不能超过容量'
    if (form.description && form.description.length > 200) return '描述不能超过200字'
    return ''
  },

  onCreateGroup: function () {
    var that = this
    if (this.data.submitting) return
    var form = trimForm(this.data.form)
    var error = this.validateGroupForm(form)
    if (error) { wx.showToast({ title: error, icon: 'none' }); return }
    var data = Object.assign({}, form, { roomId: this.data.roomId, startTime: form.startHour, endTime: form.endHour, maxMembers: Number(form.maxMembers), purpose: form.description })
    this.setData({ submitting: true, form: form })
    request.post('/groups', data).then(function (res) { wx.showToast({ title: '创建成功', icon: 'success' }); that.setData({ submitting: false, mode: 'detail', groupId: res.id, group: res, members: res.members || [] }) }).catch(function (err) { that.setData({ submitting: false }); wx.showToast({ title: err && err.message ? err.message : '创建失败', icon: 'none' }) })
  },

  onJoinGroup: function () { var that = this; if (this.data.submitting) return; this.setData({ submitting: true }); request.post('/groups/' + this.data.groupId + '/join').then(function (res) { wx.showToast({ title: '加入成功', icon: 'success' }); that.setData({ submitting: false, group: res, members: res.members || [] }) }).catch(function (err) { that.setData({ submitting: false }); wx.showToast({ title: err && err.message ? err.message : '加入失败', icon: 'none' }) }) },

  onConfirmJoin: function () {
    var that = this
    if (this.data.submitting || !this.data.groupId) return
    this.setData({ submitting: true })
    request.post('/groups/' + this.data.groupId + '/confirm').then(function (data) {
      wx.showToast({ title: data && data.reservation ? '已进入预约流程' : '已确认参与', icon: 'success' })
      that.setData({ submitting: false, group: data, members: data.members || [] })
    }).catch(function (err) { that.setData({ submitting: false }); wx.showToast({ title: err && err.message ? err.message : '确认失败', icon: 'none' }) })
  },

  onSubmitReservation: function () {
    var that = this
    if (this.data.submitting || !this.data.groupId) return
    if ((this.data.members || []).length < 2) { wx.showToast({ title: '至少2人后才能提交预约', icon: 'none' }); return }
    wx.showModal({ title: '提交正式预约', content: '仅当所有成员已确认时才能提交。提交后将进入预约审核流程，成员将不能再退出。确认继续？', success: function (res) { if (!res.confirm) return; that.setData({ submitting: true }); request.post('/groups/' + that.data.groupId + '/submit-reservation', {}).then(function (data) { wx.showToast({ title: '已提交预约', icon: 'success' }); that.setData({ submitting: false, group: data, members: data.members || [] }) }).catch(function (err) { that.setData({ submitting: false }); wx.showToast({ title: err && err.message ? err.message : '提交失败', icon: 'none' }) }) } })
  },

  onViewReservation: function () { var id = this.data.group && (this.data.group.reservationId || this.data.group.reservation_id); if (id) wx.navigateTo({ url: '/pages/reservation-detail/reservation-detail?id=' + id }) },
  onLeaveGroup: function () { var that = this; if (this.data.submitting) return; wx.showModal({ title: '确认退出', content: this.data.group && this.data.group.isCreator ? '发起人取消将取消整个团队预约，确认继续？' : '确认退出该团队预约？', success: function (res) { if (!res.confirm) return; that.setData({ submitting: true }); request.post('/groups/' + that.data.groupId + '/leave').then(function (data) { wx.showToast({ title: data && data.status === 'cancelled' ? '已取消团队预约' : '已退出', icon: 'success' }); that.setData({ submitting: false, group: data, members: data.members || [] }) }).catch(function (err) { that.setData({ submitting: false }); wx.showToast({ title: err && err.message ? err.message : '退出失败', icon: 'none' }) }) } }) },
  onShareAppMessage: function () { return { title: '邀请你确认团队预约 - ' + (this.data.group ? this.data.group.title : ''), path: '/pages/group-reserve/group-reserve?mode=detail&groupId=' + this.data.groupId } }
})
