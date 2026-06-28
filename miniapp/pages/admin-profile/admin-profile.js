var auth = require('../../utils/auth')

Page({
  data: {
    adminInfo: {},
    avatarInitial: '管',
    roleMap: { admin: '导生管理员', super_admin: '超级管理员', counselor: '书院辅导员' },
    menuList: [
      { key: 'account', name: '账号信息', desc: '查看当前管理员身份', icon: 'account', tone: 'blue' },
      { key: 'network', name: '连接状态', desc: '查看当前服务连接与网络提醒', icon: 'network', tone: 'cyan' },
      { key: 'password', name: '账号安全', desc: '查看账号安全提醒', icon: 'security', tone: 'gold' },
      { key: 'about', name: '关于系统', desc: '查看系统说明和版本', icon: 'info', tone: 'cyan' },
      { key: 'logout', name: '退出登录', desc: '退出当前管理员账号', icon: 'logout', tone: 'red' }
    ]
  },

  onLoad: function () {
    if (!this.ensureAdmin()) return
    this.loadAdminInfo()
  },

  onShow: function () {
    if (!this.ensureAdmin()) return
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTabList()
      this.getTabBar().setData({ selected: 2 })
    }
    this.loadAdminInfo()
  },

  ensureAdmin: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  loadAdminInfo: function () {
    var userInfo = auth.getUserInfo() || {}
    var name = userInfo.name || userInfo.realName || userInfo.real_name || userInfo.username || '管理员'
    this.setData({
      adminInfo: userInfo,
      avatarInitial: String(name).slice(0, 1) || '管'
    })
  },

  onMenuTap: function (e) {
    var key = e.currentTarget.dataset.key
    switch (key) {
      case 'account':
        this.showAccountInfo()
        break
      case 'network':
        this.showNetworkInfo()
        break
      case 'password':
        wx.showToast({ title: '请联系书院管理员处理账号安全事项', icon: 'none' })
        break
      case 'about':
        wx.showModal({
          title: '关于系统',
          content: '敬一书院功能房预约管理系统，用于预约审核、空间管理和服务通知。',
          showCancel: false
        })
        break
      case 'logout':
        this.onLogout()
        break
    }
  },

  showAccountInfo: function () {
    var info = this.data.adminInfo || {}
    wx.showModal({
      title: '账号信息',
      content: '姓名：' + (info.name || info.realName || info.real_name || info.username || '管理员') +
        '\n角色：' + (this.data.roleMap[info.role] || info.role || '管理员') +
        '\n账号：' + (info.username || '-'),
      showCancel: false
    })
  },

  showNetworkInfo: function () {
    wx.showModal({
      title: '连接状态',
      content: '当前正在使用系统配置的安全连接。若页面长时间无响应，请检查网络后重新进入。',
      showCancel: false
    })
  },

  onLogout: function () {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出当前管理员账号吗？',
      success: function (res) {
        if (res.confirm) {
          auth.logout()
          wx.reLaunch({ url: '/pages/login/login' })
        }
      }
    })
  }
})
