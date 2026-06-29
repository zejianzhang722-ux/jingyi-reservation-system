var request = require('../../utils/request')
var auth = require('../../utils/auth')

function todayText() {
  var d = new Date()
  var y = d.getFullYear()
  var m = String(d.getMonth() + 1).padStart(2, '0')
  var day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

function trimForm(form) {
  var next = Object.assign({}, form || {})
  Object.keys(next).forEach(function (key) { next[key] = String(next[key] || '').trim() })
  return next
}

Page({
  data: {
    form: {
      title: '', content: '', organization: '', contactPerson: '', contactPhone: '',
      startDate: '', endDate: '', posterImage: '', locationId: '', locationName: ''
    },
    submitting: false,
    uploading: false,
    posterLocations: [],
    locationIndex: -1,
    today: todayText()
  },

  onLoad: function () { this.loadPosterLocations() },

  loadPosterLocations: function () {
    var that = this
    request.get('/poster/locations', {}, { silent: true }).then(function (data) {
      that.setData({ posterLocations: Array.isArray(data) ? data : [] })
    }).catch(function () {
      that.setData({ posterLocations: [
        { id: 1, name: 'B座1楼公告栏', location: 'B座1楼大厅' },
        { id: 2, name: 'C座1楼公告栏', location: 'C座1楼大厅' },
        { id: 3, name: 'D座1楼公告栏', location: 'D座1楼大厅' },
        { id: 4, name: 'B座5楼公告栏', location: 'B座5楼走廊' }
      ] })
    })
  },

  onTitleInput: function (e) { this.setData({ 'form.title': e.detail.value }) },
  onContentInput: function (e) { this.setData({ 'form.content': e.detail.value }) },
  onOrganizationInput: function (e) { this.setData({ 'form.organization': e.detail.value }) },
  onContactPersonInput: function (e) { this.setData({ 'form.contactPerson': e.detail.value }) },
  onContactPhoneInput: function (e) { this.setData({ 'form.contactPhone': e.detail.value }) },
  onStartDateChange: function (e) { this.setData({ 'form.startDate': e.detail.value }) },
  onEndDateChange: function (e) { this.setData({ 'form.endDate': e.detail.value }) },
  onLocationChange: function (e) {
    var index = Number(e.detail.value)
    var item = this.data.posterLocations[index] || {}
    this.setData({ locationIndex: index, 'form.locationId': item.id || '', 'form.locationName': item.name || item.location || '' })
  },

  onChooseImage: function () {
    var that = this
    if (this.data.uploading) return
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        var tempFilePath = res.tempFilePaths && res.tempFilePaths[0]
        if (!tempFilePath) { wx.showToast({ title: '未选择图片', icon: 'none' }); return }
        that.uploadImage(tempFilePath)
      }
    })
  },

  uploadImage: function (filePath) {
    var that = this
    this.setData({ uploading: true, 'form.posterImage': filePath })
    wx.uploadFile({
      url: request.getBaseUrl() + '/poster/upload',
      filePath: filePath,
      name: 'file',
      header: { Authorization: 'Bearer ' + auth.getToken(), Accept: 'application/json' },
      success: function (res) {
        var data = {}
        try { data = JSON.parse(res.data) } catch (e) { data = {} }
        if (res.statusCode >= 200 && res.statusCode < 300 && (data.code === 0 || data.code === 200) && data.data && data.data.url) {
          that.setData({ 'form.posterImage': data.data.url })
          wx.showToast({ title: '图片已上传', icon: 'success' })
        } else {
          that.setData({ 'form.posterImage': '' })
          wx.showToast({ title: data.message || '图片上传失败', icon: 'none' })
        }
      },
      fail: function () {
        that.setData({ 'form.posterImage': '' })
        wx.showToast({ title: '图片上传失败', icon: 'none' })
      },
      complete: function () { that.setData({ uploading: false }) }
    })
  },

  validateForm: function (form) {
    if (!form.title) return '请填写标题'
    if (form.title.length > 100) return '标题不能超过100字'
    if (!form.organization) return '请填写组织'
    if (!form.contactPerson) return '请填写联系人'
    if (!/^1\d{10}$/.test(form.contactPhone)) return '联系电话应为11位手机号'
    if (!form.startDate) return '请选择开始日期'
    if (!form.endDate) return '请选择结束日期'
    if (form.startDate > form.endDate) return '结束日期不能早于开始日期'
    if (!form.locationName) return '请选择张贴位置'
    return ''
  },

  buildPayload: function (form) {
    return {
      title: form.title,
      content: form.content,
      description: form.content,
      organization: form.organization,
      contactPerson: form.contactPerson,
      contactName: form.contactPerson,
      contactPhone: form.contactPhone,
      startDate: form.startDate,
      endDate: form.endDate,
      posterImage: form.posterImage,
      imageUrl: form.posterImage,
      locationId: form.locationId,
      locationName: form.locationName,
      position: form.locationName
    }
  },

  onSubmit: function () {
    var that = this
    if (this.data.submitting || this.data.uploading) return
    var form = trimForm(this.data.form)
    var error = this.validateForm(form)
    if (error) { wx.showToast({ title: error, icon: 'none' }); return }
    this.setData({ submitting: true, form: form })
    request.post('/poster', this.buildPayload(form)).then(function () {
      that.setData({ submitting: false })
      wx.showToast({ title: '申请已提交', icon: 'success' })
      setTimeout(function () { wx.navigateBack() }, 900)
    }).catch(function (err) {
      that.setData({ submitting: false })
      wx.showToast({ title: err && err.message ? err.message : '提交失败', icon: 'none' })
    })
  }
})
