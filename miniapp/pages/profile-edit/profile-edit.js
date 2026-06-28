var request = require('../../utils/request')
var auth = require('../../utils/auth')

function trimForm(form) {
  var next = Object.assign({}, form || {})
  Object.keys(next).forEach(function (key) { next[key] = String(next[key] || '').trim() })
  return next
}

function isValidEmail(email) {
  if (!email) return true
  if (email.length > 100) return false
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)
}

Page({
  data: {
    form: { name: '', studentNo: '', cardNo: '', phone: '', email: '', college: '' },
    saving: false
  },
  onLoad: function () {
    var userInfo = auth.getUserInfo() || {}
    this.setData({
      form: {
        name: userInfo.name || userInfo.real_name || userInfo.realName || userInfo.student_name || '',
        studentNo: userInfo.student_no || userInfo.studentNo || userInfo.student_id || '',
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
  validateForm: function (form) {
    if (!form.name) return '请输入姓名'
    if (form.name.length > 50) return '姓名不能超过50字'
    if (form.cardNo && !/^\d{6}$/.test(form.cardNo)) return '一卡通号应为6位数字'
    if (form.phone && !/^1\d{10}$/.test(form.phone)) return '手机号格式不正确'
    if (!isValidEmail(form.email)) return '邮箱格式不正确，请输入类似 name@example.com 的邮箱'
    return ''
  },
  buildPayload: function (form) {
    return {
      name: form.name,
      realName: form.name,
      nickname: form.name,
      cardNo: form.cardNo,
      phone: form.phone,
      email: form.email,
      college: form.college
    }
  },
  onSave: function () {
    var that = this
    if (this.data.saving) return
    var form = trimForm(this.data.form)
    var error = this.validateForm(form)
    if (error) { wx.showToast({ title: error, icon: 'none' }); return }
    this.setData({ saving: true, form: form })
    request.put('/user/profile', this.buildPayload(form)).then(function () {
      that.setData({ saving: false })
      var userInfo = auth.getUserInfo() || {}
      Object.assign(userInfo, form, {
        name: form.name,
        realName: form.name,
        real_name: form.name,
        card_no: form.cardNo,
        cardNo: form.cardNo
      })
      auth.setUserInfo(userInfo)
      wx.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(function () { wx.navigateBack() }, 800)
    }).catch(function (err) {
      that.setData({ saving: false })
      wx.showToast({ title: err && err.message ? err.message : '保存失败，请稍后重试', icon: 'none' })
    })
  }
})
