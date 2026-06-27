var request = require('../../utils/request')
var util = require('../../utils/util')
var auth = require('../../utils/auth')

function cacheBust(url) {
  if (!url) return ''
  return url + (url.indexOf('?') === -1 ? '?t=' : '&t=') + Date.now()
}

function pickAvatarFromResponse(payload) {
  payload = payload || {}
  return payload.avatar || payload.avatarUrl || payload.url || ''
}

Page({
  data: {
    userInfo: null,
    avatarUrl: '/images/default-avatar.png',
    avatarFallbackText: '我',
    avatarLoadError: false,
    avatarUploading: false,
    creditScore: 100,
    creditColor: 'credit-green',
    creditColorValue: '#52C41A',
    menuList: [
      { key: 'editProfile', name: '个人信息编辑', icon: 'profile', tone: 'blue' },
      { key: 'creditDetail', name: '信用分明细', icon: 'star', tone: 'gold' },
      { key: 'usageStats', name: '使用统计', icon: 'chart', tone: 'green' },
      { key: 'rules', name: '管理制度', icon: 'document', tone: 'blue' },
      { key: 'feedback', name: '帮助反馈', icon: 'chat', tone: 'cyan' },
      { key: 'network', name: '网络设置', icon: 'network', tone: 'purple' },
      { key: 'subscribe', name: '订阅消息管理', icon: 'bell', tone: 'gold' },
      { key: 'about', name: '关于系统', icon: 'info', tone: 'gray' },
      { key: 'logout', name: 'logout', name: '退出登录', icon: 'logout', tone: 'red' }
    ]
  },

  onLoad: function () {
    if (auth.isLoggedIn() && auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/admin-profile/admin-profile' })
      return
    }
    this.loadUserInfo()
  },

  onShow: function () {
    if (auth.isLoggedIn() && auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/admin-profile/admin-profile' })
      return
    }
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      var isAdmin = auth.isAdmin()
      this.getTabBar().switchTabList()
      this.getTabBar().setData({ selected: isAdmin ? 2 : 3 })
    }
    if (!this.data.avatarUploading) this.loadUserInfo()
  },

  applyUserInfo: function (userInfo) {
    userInfo = auth.setUserInfo(userInfo || {})
    var score = Number(userInfo.credit_score !== undefined ? userInfo.credit_score : userInfo.creditScore)
    if (isNaN(score)) score = 100
    var name = userInfo.name || userInfo.real_name || userInfo.realName || userInfo.nickname || '我'
    var avatar = auth.normalizeAssetUrl(userInfo.avatar || userInfo.avatarUrl || '')
    var avatarUrl = avatar ? cacheBust(avatar) : '/images/default-avatar.png'
    this.setData({
      userInfo: userInfo,
      avatarUrl: avatarUrl,
      avatarFallbackText: String(name).slice(0, 1) || '我',
      avatarLoadError: false,
      creditScore: score,
      creditColor: util.getCreditColor(score),
      creditColorValue: util.getCreditColorValue(score)
    })
  },

  loadUserInfo: function () {
    var that = this
    request.get('/user/profile', {}, { silent: true }).then(function (data) {
      if (!that.data.avatarUploading) that.applyUserInfo(data)
    }).catch(function () {
      var cached = auth.getUserInfo()
      if (cached && !that.data.avatarUploading) that.applyUserInfo(cached)
    })
  },

  onMenuTap: function (e) {
    var key = e.currentTarget.dataset.key
    switch (key) {
      case 'editProfile': wx.navigateTo({ url: '/pages/profile-edit/profile-edit' }); break
      case 'creditDetail': wx.navigateTo({ url: '/pages/credit-detail/credit-detail' }); break
      case 'usageStats': wx.navigateTo({ url: '/pages/credit-detail/credit-detail?tab=stats' }); break
      case 'rules': wx.navigateTo({ url: '/pages/rules/rules' }); break
      case 'feedback': wx.navigateTo({ url: '/pages/feedback/feedback' }); break
      case 'network': wx.navigateTo({ url: '/pages/network-settings/network-settings' }); break
      case 'subscribe': wx.navigateTo({ url: '/pages/subscribe-settings/subscribe-settings' }); break
      case 'about': wx.showModal({ title: '关于系统', content: '敬一书院功能房预约管理系统 v1.0.0', showCancel: false }); break
      case 'logout':
        wx.showModal({
          title: '确认退出',
          content: '确定要退出登录吗？',
          success: function (res) { if (res.confirm) auth.logout() }
        })
        break
    }
  },

  onChooseAvatar: function (e) {
    if (this.data.avatarUploading) {
      wx.showToast({ title: '头像正在上传，请稍候', icon: 'none' })
      return
    }
    var avatarUrl = e && e.detail ? e.detail.avatarUrl : ''
    if (avatarUrl) {
      this._avatarRetried = false
      this.uploadAvatar(avatarUrl)
      return
    }
    wx.showToast({ title: '未选择头像', icon: 'none' })
  },

  onAvatarLoadError: function () {
    if (this.data.avatarUploading) return
    if (this._localAvatarPreview) {
      this.setData({ avatarLoadError: false, avatarUrl: this._localAvatarPreview })
      return
    }
    if (this.data.avatarUrl !== '/images/default-avatar.png') {
      this.setData({ avatarLoadError: false, avatarUrl: '/images/default-avatar.png' })
      return
    }
    this.setData({ avatarLoadError: true })
  },

  applyUploadedAvatar: function (avatar, localPreview) {
    var normalizedAvatar = auth.normalizeAssetUrl(avatar)
    if (!normalizedAvatar) return false
    var userInfo = auth.setUserInfo(Object.assign({}, this.data.userInfo || {}, { avatar: normalizedAvatar }))
    var name = userInfo.name || userInfo.real_name || userInfo.realName || userInfo.nickname || '我'
    this._localAvatarPreview = localPreview || ''
    this.setData({
      userInfo: userInfo,
      avatarUrl: localPreview || cacheBust(normalizedAvatar),
      avatarFallbackText: String(name).slice(0, 1) || '我',
      avatarLoadError: false,
      avatarUploading: false
    })
    return true
  },

  uploadAvatar: function (filePath) {
    var that = this
    if (!filePath) {
      wx.showToast({ title: '未选择头像图片', icon: 'none' })
      return
    }
    if (this.data.avatarUploading && !this._avatarRetried) {
      wx.showToast({ title: '头像正在上传，请稍候', icon: 'none' })
      return
    }
    if (!this._avatarRetried) {
      this._previousAvatarUrl = this.data.avatarUrl
      this._localAvatarPreview = filePath
      this.setData({ avatarUploading: true, avatarLoadError: false, avatarUrl: filePath })
    }
    wx.showLoading({ title: '上传中...' })
    wx.uploadFile({
      url: request.getBaseUrl() + '/user/avatar',
      filePath: filePath,
      name: 'avatar',
      formData: { purpose: 'avatar' },
      header: { Authorization: 'Bearer ' + auth.getToken(), Accept: 'application/json' },
      success: function (res) {
        var data = {}
        try {
          data = JSON.parse(res.data)
        } catch (e) {
          that.restoreAvatarAfterFailure('头像上传接口返回异常')
          return
        }

        if ((res.statusCode === 401 || data.code === 401) && !that._avatarRetried) {
          that._avatarRetried = true
          request.refreshAccessToken().then(function () { that.uploadAvatar(filePath) }).catch(function () {
            that.restoreAvatarAfterFailure('登录状态已失效，请重新登录')
            request.clearAuthAndRedirect()
          })
          return
        }

        if (res.statusCode >= 200 && res.statusCode < 300 && (data.code === 0 || data.code === 200)) {
          var avatar = pickAvatarFromResponse(data.data)
          if (!that.applyUploadedAvatar(avatar, filePath)) {
            that.restoreAvatarAfterFailure('头像地址异常，请重新上传')
            return
          }
          wx.showToast({ title: '头像更新成功', icon: 'success' })
          that._avatarRetried = false
          return
        }

        that.restoreAvatarAfterFailure(data.message || '上传失败')
      },
      fail: function () { that.restoreAvatarAfterFailure('上传失败') },
      complete: function () { wx.hideLoading() }
    })
  },

  restoreAvatarAfterFailure: function (message) {
    this._avatarRetried = false
    this._localAvatarPreview = ''
    this.setData({ avatarUploading: false, avatarLoadError: false, avatarUrl: this._previousAvatarUrl || '/images/default-avatar.png' })
    wx.showToast({ title: message || '上传失败', icon: 'none' })
  }
})
