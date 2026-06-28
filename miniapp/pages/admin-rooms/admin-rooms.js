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

function emptyRoomForm() {
  return {
    id: '',
    name: '',
    type: 'study_room',
    buildingId: '',
    floor: '',
    location: '',
    capacity: '',
    openStartTime: '08:00',
    openEndTime: '22:00',
    maxDuration: '240',
    facilities: '',
    description: '',
    status: 'open',
    needAudit: true,
    needCounselorAudit: false
  }
}

Page({
  data: {
    list: [],
    filterType: '',
    showForm: false,
    formMode: 'create',
    form: emptyRoomForm(),
    submitting: false,
    typeOptions: [
      { value: 'study_room', label: '自习室' },
      { value: 'seminar_room', label: '共享空间' },
      { value: 'media_room', label: '影音室' },
      { value: 'competition_room', label: '备赛间' },
      { value: 'roadshow_space', label: '路演空间' },
      { value: 'reading_room', label: '阅览室' },
      { value: 'multi_purpose_hall', label: '多功能厅' },
      { value: 'other', label: '其他' }
    ],
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

  onLoad: function () { this.loadData() },
  onShow: function () { this.loadData() },

  loadData: function () {
    var that = this
    var params = {}
    var apiType = apiTypeMap[this.data.filterType]
    if (apiType) params.type = apiType

    return request.get('/admin/rooms', params, { silent: true }).then(function (data) {
      var list = Array.isArray(data) ? data : (data.list || data.rooms || [])
      that.setData({ list: list })
    }).catch(function () {
      return request.get('/room', params, { silent: true }).then(function (data) {
        var list = Array.isArray(data) ? data : (data.list || data.rooms || [])
        that.setData({ list: list })
      }).catch(function () {
        that.setData({ list: [] })
      })
    })
  },

  onFilterType: function (e) {
    this.setData({ filterType: e.currentTarget.dataset.type || '' })
    return this.loadData()
  },

  onAddRoom: function () {
    this.setData({ showForm: true, formMode: 'create', form: emptyRoomForm(), submitting: false })
  },

  onEditRoom: function (e) {
    var id = e.currentTarget.dataset.id
    var room = (this.data.list || []).find(function (item) { return String(item.id) === String(id) }) || {}
    var form = Object.assign(emptyRoomForm(), {
      id: room.id || '',
      name: room.name || '',
      type: room.type || 'study_room',
      buildingId: room.building_id || room.buildingId || '',
      floor: room.floor || '',
      location: room.location || room.building_name || '',
      capacity: room.capacity || '',
      openStartTime: room.open_start_time || room.openStartTime || '08:00',
      openEndTime: room.open_end_time || room.openEndTime || '22:00',
      maxDuration: room.max_duration || room.maxDuration || '240',
      facilities: room.facilities || '',
      description: room.description || '',
      status: room.status || 'open',
      needAudit: room.need_audit === 1 || room.needAudit === true,
      needCounselorAudit: room.need_counselor_audit === 1 || room.needCounselorAudit === true
    })
    this.setData({ showForm: true, formMode: 'edit', form: form, submitting: false })
  },

  onCancelForm: function () {
    if (this.data.submitting) return
    this.setData({ showForm: false, form: emptyRoomForm() })
  },

  onFormInput: function (e) {
    var field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onTypeChange: function (e) {
    var idx = Number(e.detail.value) || 0
    var option = this.data.typeOptions[idx] || this.data.typeOptions[0]
    this.setData({ 'form.type': option.value })
  },

  onStatusChange: function (e) {
    var options = ['open', 'closed', 'maintenance']
    this.setData({ 'form.status': options[Number(e.detail.value) || 0] })
  },

  onSwitchChange: function (e) {
    var field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: !!e.detail.value })
  },

  validateForm: function () {
    var f = this.data.form
    if (!String(f.name || '').trim()) return '请输入功能房名称'
    if (!String(f.buildingId || '').trim()) return '请输入楼栋ID'
    if (!String(f.capacity || '').trim() || Number(f.capacity) <= 0) return '请输入有效容量'
    if (!/^\d{2}:\d{2}$/.test(String(f.openStartTime || ''))) return '开放开始时间格式应为08:00'
    if (!/^\d{2}:\d{2}$/.test(String(f.openEndTime || ''))) return '开放结束时间格式应为22:00'
    if (!String(f.maxDuration || '').trim() || Number(f.maxDuration) <= 0) return '请输入最长预约分钟数'
    return ''
  },

  buildPayload: function () {
    var f = Object.assign({}, this.data.form)
    Object.keys(f).forEach(function (key) {
      if (typeof f[key] === 'string') f[key] = f[key].trim()
    })
    return {
      name: f.name,
      type: f.type,
      buildingId: Number(f.buildingId),
      floor: f.floor ? Number(f.floor) : null,
      location: f.location,
      capacity: Number(f.capacity),
      openStartTime: f.openStartTime,
      openEndTime: f.openEndTime,
      maxDuration: Number(f.maxDuration),
      facilities: f.facilities,
      description: f.description,
      status: f.status,
      needAudit: !!f.needAudit,
      needCounselorAudit: !!f.needCounselorAudit
    }
  },

  onSubmitForm: function () {
    var that = this
    var error = this.validateForm()
    if (error) { wx.showToast({ title: error, icon: 'none' }); return }
    if (this.data.submitting) return
    var payload = this.buildPayload()
    var isEdit = this.data.formMode === 'edit'
    var req = isEdit ? request.put('/admin/rooms/' + this.data.form.id, payload) : request.post('/admin/rooms', payload)
    this.setData({ submitting: true })
    req.then(function () {
      wx.showToast({ title: isEdit ? '已保存' : '已新增', icon: 'success' })
      that.setData({ showForm: false, form: emptyRoomForm(), submitting: false })
      that.loadData()
    }).catch(function (err) {
      that.setData({ submitting: false })
      wx.showToast({ title: err && err.message ? err.message : '保存失败', icon: 'none' })
    })
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
