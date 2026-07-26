var request = require('../../utils/request')
var auth = require('../../utils/auth')

Page({
  data: {
    list: [],
    showForm: false,
    form: { title: '', content: '', type: 'normal' },
    typeMap: { normal: '普通通知', urgent: '紧急通知', maintenance: '维护通知' }
  },
  blockMobileAccess: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
    wx.reLaunch({ url: '/pages/admin-manage/admin-manage' })
    return false
  },
  onLoad: function () { this.blockMobileAccess() },
  onShow: function () { this.blockMobileAccess() },
  loadData: function () {
    this.blockMobileAccess()
    return Promise.resolve()
  },
  onAdd: function () {
    this.blockMobileAccess()
  },
  onCancelForm: function () {
    this.setData({ showForm: false })
  },
  onTitleInput: function (e) { this.setData({ 'form.title': e.detail.value }) },
  onContentInput: function (e) { this.setData({ 'form.content': e.detail.value }) },
  onTypeChange: function (e) {
    var types = ['normal', 'urgent', 'maintenance']
    this.setData({ 'form.type': types[e.detail.value] })
  },
  onSubmit: function () {
    this.blockMobileAccess()
  },
  onDelete: function (e) {
    this.blockMobileAccess()
  }
})
