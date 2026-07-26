var auth = require('../../utils/auth')

var BASE_MENU = [
  { key: 'account', name: '账号信息', desc: '查看当前管理员身份', icon: 'account', tone: 'blue' },
  { key: 'network', name: '连接检查', desc: '检查当前是否能正常连接预约服务', icon: 'network', tone: 'purple' },
  { key: 'password', name: '账号安全', desc: '', icon: 'security', tone: 'gold' },
  { key: 'about', name: '关于系统', desc: '查看系统说明和版本', icon: 'info', tone: 'cyan' },
  { key: 'logout', name: '退出登录', desc: '退出当前管理员账号', icon: 'logout', tone: 'red' }
]

function securityDescription(role) {
  return role === 'super_admin' ? '请在电脑后台管理管理员账号与安全设置' : '如需修改账号或密码，请联系超级管理员'
}

Page({
  data: {
    adminInfo: {},
    avatarInitial: '管',
    roleMap: { admin: '导生管理员', super_admin: '超级管理员', counselor: '书院辅导员' },
    menuList: BASE_MENU.map(function (item) {
      var next = Object.assign({}, item)
      if (item.key === 'password') next.desc = securityDescription('admin')
      return next
    })
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
    var menuList = BASE_MENU.map(function (item) {
      var next = Object.assign({}, item)
      if (item.key === 'password') next.desc = securityDescription(userInfo.role)
      return next
    })
    this.setData({ adminInfo: userInfo, avatarInitial: String(name).slice(0, 1) || '管', menuList: menuList })
  },

  onMenuTap: function (e) {
    var key = e.currentTarget.dataset.key
    switch (key) {
      case 'account': this.showAccountInfo(); break
      case 'network': wx.navigateTo({ url: '/pages/network-settings/network-settings' }); break
      case 'password':
        wx.showToast({ title: securityDescription(auth.getUserRole()), icon: 'none' })
        break
      case 'about':
        wx.showModal({
          title: '关于系统',
          content: '敬一书院功能房预约管理系统，用于预约审核、空间管理和服务通知。',
          showCancel: false
        })
        break
      case 'logout': this.onLogout(); break
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
