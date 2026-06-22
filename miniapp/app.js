App({
  globalData: {
    userInfo: null,
    token: null,
    refreshToken: null,
    mockMode: true
  },

  onLaunch: function () {
    var token = wx.getStorageSync('token')
    if (token) {
      this.globalData.token = token
      this.globalData.refreshToken = wx.getStorageSync('refreshToken')
      this.globalData.userInfo = wx.getStorageSync('userInfo')
    }
  }
})
