var subscribeMessage = require('../../services/subscribeMessage')

Page({
  data: {
    templateStatus: [],
    configuredCount: 0
  },

  onLoad: function () {
    this.loadStatus()
  },

  loadStatus: function () {
    var list = subscribeMessage.getTemplateStatus()
    var count = list.filter(function(item) { return item.configured }).length
    this.setData({
      templateStatus: list,
      configuredCount: count
    })
  },

  onRequestSubscribe: function () {
    if (this.data.configuredCount === 0) {
      wx.showModal({
        title: '暂不支持订阅提醒',
        content: '当前可在“消息”页查看预约提醒、审核结果和信用分变动。',
        showCancel: false
      })
      return
    }
    subscribeMessage.requestSubscribe(function () {
      wx.showToast({ title: '已更新授权', icon: 'success' })
    })
  },

  onViewMessages: function () {
    wx.switchTab({ url: '/pages/notifications/notifications' })
  }
})
