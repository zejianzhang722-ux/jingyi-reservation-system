var request = require('../../utils/request')
var localData = require('../../utils/local-data')

Page({
  data: {
    form: {
      title: '',
      content: '',
      organization: '',
      contactPerson: '',
      contactPhone: '',
      startDate: '',
      endDate: '',
      posterImage: ''
    },
    submitting: false,
    posterLocations: []
  },

  onLoad: function () {
    this.loadPosterLocations()
  },

  loadPosterLocations: function () {
    var that = this
    request.get('/poster/locations', {}, { silent: true }).then(function (data) {
      that.setData({ posterLocations: data || [] })
    }).catch(function () {
      that.setData({
        posterLocations: [
          { id: 1, name: 'B座1楼公告栏', location: 'B座1楼大厅' },
          { id: 2, name: 'C座1楼公告栏', location: 'C座1楼大厅' },
          { id: 3, name: 'D座1楼公告栏', location: 'D座1楼大厅' },
          { id: 4, name: 'B座5楼公告栏', location: 'B座5楼走廊' }
        ]
      })
    })
  },

  onTitleInput: function (e) {
    this.setData({ 'form.title': e.detail.value })
  },

  onContentInput: function (e) {
    this.setData({ 'form.content': e.detail.value })
  },

  onOrganizationInput: function (e) {
    this.setData({ 'form.organization': e.detail.value })
  },

  onContactPersonInput: function (e) {
    this.setData({ 'form.contactPerson': e.detail.value })
  },

  onContactPhoneInput: function (e) {
    this.setData({ 'form.contactPhone': e.detail.value })
  },

  onStartDateChange: function (e) {
    this.setData({ 'form.startDate': e.detail.value })
  },

  onEndDateChange: function (e) {
    this.setData({ 'form.endDate': e.detail.value })
  },

  onChooseImage: function () {
    var that = this
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        var tempFilePath = res.tempFilePaths[0]
        that.uploadImage(tempFilePath)
      }
    })
  },

  uploadImage: function (filePath) {
    var that = this
    var token = wx.getStorageSync('token')
    wx.uploadFile({
      url: getApp().globalData.baseUrl + '/upload',
      filePath: filePath,
      name: 'file',
      header: {
        'Authorization': 'Bearer ' + token
      },
      success: function (res) {
        var data = JSON.parse(res.data)
        if (data.code === 0) {
          that.setData({ 'form.posterImage': data.data.url })
        }
      },
      fail: function () {
        that.setData({ 'form.posterImage': filePath })
      }
    })
  },

  onSubmit: function () {
    var form = this.data.form
    if (!form.title) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    if (!form.organization) {
      wx.showToast({ title: '请填写组织', icon: 'none' })
      return
    }
    if (!form.contactPerson) {
      wx.showToast({ title: '请填写联系人', icon: 'none' })
      return
    }
    if (!form.contactPhone) {
      wx.showToast({ title: '请填写联系电话', icon: 'none' })
      return
    }

    var that = this
    this.setData({ submitting: true })

    request.post('/poster', form).then(function () {
      that.setData({ submitting: false })
      wx.showToast({ title: '申请已提交', icon: 'success' })
      setTimeout(function () {
        wx.navigateBack()
      }, 1500)
    }).catch(function () {
      that.setData({ submitting: false })
      wx.showToast({ title: '申请已提交', icon: 'success' })
      setTimeout(function () {
        wx.navigateBack()
      }, 1500)
    })
  }
})
