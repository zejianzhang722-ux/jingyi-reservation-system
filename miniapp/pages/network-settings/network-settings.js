var request = require('../../utils/request')

Page({
  data: {
    baseUrl: '',
    lanHost: '',
    port: '3000',
    customBaseUrl: '',
    testStatus: '',
    testMessage: '尚未测试连接'
  },

  onLoad: function () {
    var savedConfig = wx.getStorageSync('networkConfig') || {}
    this.setData({
      baseUrl: request.getBaseUrl(),
      lanHost: savedConfig.lanHost || '',
      port: savedConfig.port || '3000',
      customBaseUrl: wx.getStorageSync('customBaseUrl') || ''
    })
  },

  onLanHostInput: function (e) {
    this.setData({ lanHost: e.detail.value.trim() })
  },

  onPortInput: function (e) {
    this.setData({ port: e.detail.value.trim() || '3000' })
  },

  onCustomUrlInput: function (e) {
    this.setData({ customBaseUrl: e.detail.value.trim() })
  },

  onSaveLan: function () {
    if (!this.data.lanHost) {
      wx.showToast({ title: '请填写电脑 IP', icon: 'none' })
      return
    }
    var baseUrl = request.setNetworkConfig({
      lanHost: this.data.lanHost,
      port: this.data.port || '3000'
    })
    this.setData({ baseUrl: baseUrl, customBaseUrl: '', testMessage: '已保存局域网地址', testStatus: '' })
  },

  onSaveCustom: function () {
    if (!this.data.customBaseUrl) {
      wx.showToast({ title: '请填写接口地址', icon: 'none' })
      return
    }
    request.setBaseUrl(this.data.customBaseUrl)
    this.setData({ baseUrl: request.getBaseUrl(), testMessage: '已保存完整地址', testStatus: '' })
  },

  onReset: function () {
    wx.removeStorageSync('networkConfig')
    wx.removeStorageSync('customBaseUrl')
    request.setNetworkConfig({})
    this.setData({
      baseUrl: request.getBaseUrl(),
      lanHost: '',
      port: '3000',
      customBaseUrl: '',
      testStatus: '',
      testMessage: '已恢复默认地址'
    })
  },

  onTest: function () {
    var that = this
    that.setData({ testStatus: 'testing', testMessage: '正在测试连接...' })
    request.testConnection().then(function () {
      that.setData({ testStatus: 'success', testMessage: '连接正常' })
    }).catch(function (err) {
      that.setData({ testStatus: 'fail', testMessage: err.message || '连接失败' })
    })
  }
})
