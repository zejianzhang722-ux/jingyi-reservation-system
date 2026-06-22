var request = require('../../utils/request')
var auth = require('../../utils/auth')

Page({
  data: {
    form: { name: '', studentNo: '', cardNo: '', phone: '', email: '', college: '' },
    saving: false
  },
  onLoad: function () {
    var userInfo = auth.getUserInfo() || {}
    this.setData({
      form: {
        name: userInfo.name || userInfo.student_name || '',
        studentNo: userInfo.student_no || userInfo.studentNo || '',
        cardNo: userInfo.card_no || userInfo.cardNo || '',
        phone: userInfo.phone || '',
        email: userInfo.email || '',
        college: userInfo.college || '敬一书院'
      }
    })
  },
  onNameInput: function (e) { this.setData({ 'form.name': e.detail.value }) },
  onCardNoInput: function (e) { this.setData({ 'form.cardNo': e.detail.value }) },
  onPhoneInput: function (e) { this.setData({ 'form.phone': e.detail.value }) },
  onEmailInput: function (e) { this.setData({ 'form.email': e.detail.value }) },
  onCollegeInput: function (e) { this.setData({ 'form.college': e.detail.value }) },
  onSave: function () {
    var that = this
    if (!this.data.form.name) { wx.showToast({ title: '请输入姓名', icon: 'none' }); return }
    this.setData({ saving: true })
    request.put('/user/profile', this.data.form).then(function (data) {
      that.setData({ saving: false })
      wx.showToast({ title: '保存成功', icon: 'success' })
      var userInfo = auth.getUserInfo() || {}
      Object.assign(userInfo, that.data.form)
      wx.setStorageSync('userInfo', userInfo)
      setTimeout(function () { wx.navigateBack() }, 1000)
    }).catch(function () {
      that.setData({ saving: false })
      var userInfo = auth.getUserInfo() || {}
      Object.assign(userInfo, that.data.form)
      wx.setStorageSync('userInfo', userInfo)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(function () { wx.navigateBack() }, 1000)
    })
  }
})
