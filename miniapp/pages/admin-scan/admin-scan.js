var auth = require('../../utils/auth')
var roleModel = require('../../utils/role-model')
var dormPage = require('../../utils/dorm-page')

// 只读复用宿管扫码工厂，本页仅做「导生会层级」入口校验，不修改工厂实现
var page = dormPage('scan')
var definition = Object.assign({}, page, {
  ensureGuideAccess: function () {
    var role = auth.getUserRole()
    // 未登录回登录页；已登录但非导生会层级（宿管/学生）回各自工作台
    if (!auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    if (!roleModel.isGuideRole(role)) {
      wx.reLaunch({ url: roleModel.homePath(role) })
      return false
    }
    return true
  },
  onLoad: function (options) {
    if (!this.ensureGuideAccess()) return
    page.onLoad.call(this, options)
  }
})

// 返回页面和执行核验前重查账号，避免切换账号后旧页面继续提交。
;['onShow', 'scan', 'preview', 'confirm', 'retry', 'send', 'resolve'].forEach(function (method) {
  definition[method] = function () {
    if (!this.ensureGuideAccess()) return
    return page[method].apply(this, arguments)
  }
})
Page(definition)
