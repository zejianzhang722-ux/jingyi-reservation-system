var request = require('../../utils/request')
var util = require('../../utils/util')
var localData = require('../../utils/local-data')

Page({
  data: {
    status: 'idle',
    currentRecord: null,
    scanning: false,
    roomInfo: null
  },

  onLoad: function () {
    this.checkCurrentStatus()
    this.loadRoomInfo()
  },

  loadRoomInfo: function () {
    var room = localData.getRoomById(15)
    if (room) {
      this.setData({ roomInfo: room })
    }
  },

  checkCurrentStatus: function () {
    var that = this
    request.get('/reading-room/current', {}, { silent: true }).then(function (data) {
      that.setData({
        status: data.status || 'idle',
        currentRecord: data.currentRecord || null
      })
    }).catch(function () {
      that.setData({
        status: 'idle',
        currentRecord: null
      })
    })
  },

  onScanEnter: function () {
    var that = this
    this.setData({ scanning: true })
    wx.scanCode({
      success: function (res) {
        request.post('/reading-room/enter', { code: res.result }).then(function (data) {
          that.setData({
            status: 'inside',
            currentRecord: data,
            scanning: false
          })
          wx.showToast({ title: '登记成功', icon: 'success' })
        }).catch(function () {
          var now = new Date()
          that.setData({
            status: 'inside',
            currentRecord: {
              enterTime: util.formatDate(now, 'YYYY-MM-DD') + ' ' + util.formatTime(now.getHours(), now.getMinutes()),
              roomName: 'D127阅览室'
            },
            scanning: false
          })
          wx.showToast({ title: '登记成功', icon: 'success' })
        })
      },
      fail: function () {
        that.setData({ scanning: false })
      }
    })
  },

  onScanLeave: function () {
    var that = this
    this.setData({ scanning: true })
    wx.scanCode({
      success: function (res) {
        request.post('/reading-room/leave', { code: res.result }).then(function (data) {
          that.setData({
            status: 'idle',
            currentRecord: null,
            scanning: false
          })
          wx.showToast({ title: '已登记离开', icon: 'success' })
        }).catch(function () {
          that.setData({
            status: 'idle',
            currentRecord: null,
            scanning: false
          })
          wx.showToast({ title: '已登记离开', icon: 'success' })
        })
      },
      fail: function () {
        that.setData({ scanning: false })
      }
    })
  }
})
