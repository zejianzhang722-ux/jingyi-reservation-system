var app = getApp()
var auth = require('../../utils/auth')
var request = require('../../utils/request')

Page({
  data: {
    loginMode: 'student',
    studentId: '',
    cardNo: '',
    username: '',
    password: '',
    submitting: false,
    showServerConfig: false,
    currentServerUrl: '',
    serverOptions: [],
    customServerUrl: ''
  },

  onLoad: function () {
    this.refreshCurrentServer()
  },

  refreshCurrentServer: function() {
    var current = request.getBaseUrl ? request.getBaseUrl() : ''
    this.setData({ currentServerUrl: current })
  },

  toggleServerConfig: function() {
    this.setData({ showServerConfig: !this.data.showServerConfig })
    this.refreshCurrentServer()
  },

  selectServer: function(e) {
    var url = e.currentTarget.dataset.url
    request.setBaseUrl(url)
    this.refreshCurrentServer()
    wx.showToast({ title: '服务器地址已更新', icon: 'success' })
  },

  onCustomServerInput: function(e) {
    this.setData({ customServerUrl: e.detail.value })
  },

  useCustomServer: function() {
    var url = this.data.customServerUrl.trim()
    if (!url) {
      wx.showToast({ title: '请输入服务器地址', icon: 'none' })
      return
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      wx.showToast({ title: '地址需要以http://或https://开头', icon: 'none' })
      return
    }
    request.setBaseUrl(url)
    this.refreshCurrentServer()
    wx.showToast({ title: '服务器地址已更新', icon: 'success' })
  },

  switchMode: function (e) {
    this.setData({
      loginMode: e.currentTarget.dataset.mode,
      studentId: '',
      cardNo: '',
      username: '',
      password: ''
    })
  },

  onStudentIdInput: function (e) {
    this.setData({ studentId: e.detail.value })
  },

  onCardNoInput: function (e) {
    this.setData({ cardNo: e.detail.value })
  },

  onUsernameInput: function (e) {
    this.setData({ username: e.detail.value })
  },

  onPasswordInput: function (e) {
    this.setData({ password: e.detail.value })
  },

  onLogin: function () {
    var that = this
    if (this.data.loginMode === 'student') {
      this.doStudentLogin()
    } else {
      this.doAdminLogin()
    }
  },

  doStudentLogin: function () {
    var that = this
    var studentId = this.data.studentId.trim()
    var cardNo = this.data.cardNo.trim()

    if (!studentId) {
      wx.showToast({ title: '请输入学号', icon: 'none' })
      return
    }
    if (!/^\d{9,10}$/.test(studentId)) {
      wx.showToast({ title: '学号应为9-10位数字', icon: 'none' })
      return
    }
    if (!cardNo) {
      wx.showToast({ title: '请输入一卡通卡号', icon: 'none' })
      return
    }
    if (!/^\d{6}$/.test(cardNo)) {
      wx.showToast({ title: '一卡通卡号应为6位数字', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    request.post('/auth/login/student', {
      studentNo: studentId,
      cardNo: cardNo
    }, { silent: true }).then(function (data) {
      that.setData({ submitting: false })
      if (data && data.token) {
        auth.setAuthData(data)
      }
      wx.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(function () {
        wx.switchTab({ url: '/pages/index/index' })
      }, 800)
    }).catch(function (err) {
      that.setData({ submitting: false })
      var msg = err.message || '登录失败，请重试'
      if (msg.indexOf('网络连接失败') >= 0) {
        wx.showModal({
          title: '网络连接失败',
          content: '暂时无法连接预约服务，请确认网络可用后重试。',
          showCancel: false,
          confirmText: '我知道了'
        })
      } else {
        wx.showToast({ title: msg, icon: 'none' })
      }
    })
  },

  doAdminLogin: function () {
    var that = this
    var username = this.data.username.trim()
    var password = this.data.password.trim()

    if (!username) {
      wx.showToast({ title: '请输入管理员账号', icon: 'none' })
      return
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    request.post('/auth/login/admin-miniapp', {
      username: username,
      password: password
    }, { silent: true }).then(function (data) {
      that.setData({ submitting: false })
      if (data && data.token) {
        auth.setAuthData(data)
      }
      var role = (data.userInfo && data.userInfo.role) || ''
      var roleNameMap = { super_admin: '超级管理员', admin: '导生管理员', counselor: '书院辅导员' }
      var roleName = roleNameMap[role] || '管理员'
      wx.showToast({ title: roleName + '登录成功', icon: 'success' })
      setTimeout(function () {
        wx.reLaunch({ url: '/pages/admin-home/admin-home' })
      }, 800)
    }).catch(function (err) {
      that.setData({ submitting: false })
      var msg = err.message || '账号或密码错误'
      if (msg.indexOf('网络连接失败') >= 0) {
        wx.showModal({
          title: '网络连接失败',
          content: '暂时无法连接预约服务，请确认网络可用后重试。',
          showCancel: false,
          confirmText: '我知道了'
        })
      } else {
        wx.showToast({ title: msg, icon: 'none' })
      }
    })
  }
})
