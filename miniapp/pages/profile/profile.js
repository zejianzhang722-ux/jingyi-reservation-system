var request = require('../../utils/request')
var util = require('../../utils/util')
var auth = require('../../utils/auth')

Page({
  data: {
    userInfo: null,
    avatarUrl: '/images/default-avatar.png',
    avatarFallbackText: '我',
    avatarLoadError: false,
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
      { key: 'logout', name: '退出登录', icon: 'logout', tone: 'red' }
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
    this.loadUserInfo()
  },

  applyUserInfo: function (userInfo) {
    userInfo = auth.setUserInfo(userInfo || {})
    var score = Number(userInfo.credit_score !== undefined ? userInfo.credit_score : userInfo.creditScore)
    if (isNaN(score)) score = 100
    var name = userInfo.name || userInfo.real_name || userInfo.realName || userInfo.nickname || '我'
    var avatar = userInfo.avatar || ''
    var avatarUrl = avatar ? avatar + (avatar.indexOf('?') === -1 ? '?t=' : '&t=') + Date.now() : '/images/default-avatar.png'
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
      that.applyUserInfo(data)
    }).catch(function () {
      var cached = auth.getUserInfo()
      if (cached) that.applyUserInfo(cached)
    })
  },

  onMenuTap: function (e) {
    var key = e.currentTarget.dataset.key
    switch (key) {
      case 'editProfile':
        wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
        break
      case 'creditDetail':
        wx.navigateTo({ url: '/pages/credit-detail/credit-detail' })
        break
      case 'usageStats':
        wx.navigateTo({ url: '/pages/credit-detail/credit-detail?tab=stats' })
        break
      case 'rules':
        wx.navigateTo({ url: '/pages/rules/rules' })
        break
      case 'feedback':
        wx.navigateTo({ url: '/pages/feedback/feedback' })
        break
      case 'network':
        wx.navigateTo({ url: '/pages/network-settings/network-settings' })
        break
      case 'subscribe':
        wx.navigateTo({ url: '/pages/subscribe-settings/subscribe-settings' })
        break
      case 'about':
        wx.showModal({
          title: '关于系统',
          content: '敬一书院功能房预约管理系统 v1.0.0',
          showCancel: false
        })
        break
      case 'logout':
        wx.showModal({
          title: '确认退出',
          content: '确定要退出登录吗？',
          success: function (res) {
            if (res.confirm) auth.logout()
          }
        })
        break
    }
  },

  onChooseAvatar: function (e) {
    var avatarUrl = e && e.detail ? e.detail.avatarUrl : ''
    if (avatarUrl) {
      this._avatarRetried = false
      this.uploadAvatar(avatarUrl)
      return
    }
    this.onAvatarTap()
  },

  onAvatarTap: function () {
    var that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        var tempFilePath = res.tempFiles[0].tempFilePath
        that._avatarRetried = false
        that.cropAndUploadAvatar(tempFilePath)
      }
    })
  },

  cropAndUploadAvatar: function (filePath) {
    var that = this
    if (typeof wx.cropImage === 'function') {
      wx.cropImage({
        src: filePath,
        cropScale: '1:1',
        success: function (res) {
          that.uploadAvatar(res.tempFilePath || filePath)
        },
        fail: function () {
          wx.showToast({ title: '已取消裁切，使用原图上传', icon: 'none' })
          that.uploadAvatar(filePath)
        }
      })
    } else {
      wx.showToast({ title: '当前微信版本不支持裁切，将直接上传', icon: 'none' })
      that.uploadAvatar(filePath)
    }
  },

  onAvatarLoadError: function () {
    if (this.data.avatarUrl !== '/images/default-avatar.png') {
      this.setData({
        avatarLoadError: false,
        avatarUrl: '/images/default-avatar.png'
      })
      return
    }
    this.setData({ avatarLoadError: true })
  },

  uploadAvatar: function (filePath) {
    var that = this
    if (!filePath) {
      wx.showToast({ title: '未选择头像图片', icon: 'none' })
      return
    }
    wx.showLoading({ title: '上传中...' })
    wx.uploadFile({
      url: request.getBaseUrl() + '/user/avatar',
      filePath: filePath,
      name: 'avatar',
      header: {
        Authorization: 'Bearer ' + auth.getToken()
      },
      success: function (res) {
        var data = {}
        try {
          data = JSON.parse(res.data)
        } catch (e) {
          wx.showToast({ title: '头像上传接口返回异常', icon: 'none' })
          return
        }

        if ((res.statusCode === 401 || data.code === 401) && !that._avatarRetried) {
          that._avatarRetried = true
          request.refreshAccessToken().then(function () {
            that.uploadAvatar(filePath)
          }).catch(function () {
            request.clearAuthAndRedirect()
          })
          return
        }

        if (data.code === 0 || data.code === 200) {
          if (data.data && data.data.avatar) {
            var userInfo = auth.setUserInfo(Object.assign({}, that.data.userInfo || {}, { avatar: data.data.avatar }))
            var name = userInfo.name || userInfo.real_name || userInfo.realName || userInfo.nickname || '我'
            that.setData({
              userInfo: userInfo,
              avatarUrl: userInfo.avatar + (userInfo.avatar.indexOf('?') === -1 ? '?t=' : '&t=') + Date.now(),
              avatarFallbackText: String(name).slice(0, 1) || '我',
              avatarLoadError: false
            })
          }
          wx.showToast({ title: '头像更新成功', icon: 'success' })
          that._avatarRetried = false
          that.loadUserInfo()
        } else {
          wx.showToast({ title: data.message || '上传失败', icon: 'none' })
        }
      },
      fail: function () {
        wx.showToast({ title: '上传失败', icon: 'none' })
      },
      complete: function () {
        wx.hideLoading()
      }
    })
  }
})
