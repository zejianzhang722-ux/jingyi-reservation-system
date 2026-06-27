var request = require('../../utils/request')
var util = require('../../utils/util')

function parseTime(value) {
  if (!value) return null
  if (value instanceof Date) return value
  var text = String(value).replace('T', ' ').replace('Z', '')
  var date = new Date(text.replace(/-/g, '/'))
  if (isNaN(date.getTime())) date = new Date(value)
  return isNaN(date.getTime()) ? null : date
}

function formatNotificationTime(value) {
  var date = parseTime(value)
  if (!date) return value || ''
  var now = new Date()
  var diff = now.getTime() - date.getTime()
  if (diff >= 0 && diff < 60 * 1000) return '刚刚'
  if (diff >= 0 && diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前'
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + '小时前'
  var y = date.getFullYear()
  var m = date.getMonth() + 1
  var d = date.getDate()
  var hh = date.getHours()
  var mm = date.getMinutes()
  var prefix = now.getFullYear() === y ? '' : y + '-'
  return prefix + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d) + ' ' + (hh < 10 ? '0' + hh : hh) + ':' + (mm < 10 ? '0' + mm : mm)
}

function normalizeNotification(item) {
  item = item || {}
  var rawTime = item.timeAgo || item.createdAt || item.created_at
  return Object.assign({}, item, {
    displayTime: formatNotificationTime(rawTime)
  })
}

Page({
  data: {
    categories: [
      { key: 'all', name: '全部' },
      { key: 'audit', name: '审核通知' },
      { key: 'reminder', name: '使用提醒' },
      { key: 'noshow_warning', name: '爽约警告' },
      { key: 'credit', name: '信用变动' },
      { key: 'poster', name: '海报通知' },
      { key: 'system', name: '系统公告' },
      { key: 'violation', name: '违规提醒' }
    ],
    currentCategory: 'all',
    notifications: [],
    loading: true,
    unreadCount: 0
  },

  onLoad: function () {
    this.loadNotifications()
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTabList()
      this.getTabBar().setData({ selected: 2 })
    }
    this.loadNotifications()
  },

  onPullDownRefresh: function () {
    this.loadNotifications()
    wx.stopPullDownRefresh()
  },

  loadNotifications: function () {
    var that = this
    var params = {}
    if (this.data.currentCategory !== 'all') {
      params.category = this.data.currentCategory
    }

    request.get('/notification', params, { silent: true }).then(function (data) {
      var list = data && data.list ? data.list : (Array.isArray(data) ? data : [])
      var unreadCount = 0
      list = (list || []).map(function (n) {
        if (!n.isRead && !n.is_read) unreadCount++
        return normalizeNotification(n)
      })
      that.setData({
        notifications: list,
        loading: false,
        unreadCount: unreadCount
      })
    }).catch(function () {
      that.setData({ loading: false, notifications: [] })
    })
  },

  onCategoryChange: function (e) {
    var key = e.currentTarget.dataset.key
    this.setData({
      currentCategory: key,
      loading: true
    })
    this.loadNotifications()
  },

  onNotificationTap: function (e) {
    var id = e.currentTarget.dataset.id
    var item = this.data.notifications.find(function (n) { return n.id === id })
    if (!item) return

    if (!item.isRead && !item.is_read) {
      this.markAsRead(id)
    }

    if (item.relatedId || item.related_id) {
      var relatedId = item.relatedId || item.related_id
      if (item.category === 'audit' || item.category === 'reminder') {
        wx.navigateTo({ url: '/pages/reservation-detail/reservation-detail?id=' + relatedId })
      } else if (item.category === 'credit') {
        wx.navigateTo({ url: '/pages/credit-detail/credit-detail' })
      }
    }
  },

  markAsRead: function (id) {
    request.put('/notification/' + id + '/read', {}, { silent: true }).then(function () {})
    var notifications = this.data.notifications
    notifications.forEach(function (n) {
      if (n.id === id) {
        n.isRead = true
        n.is_read = true
      }
    })
    this.setData({
      notifications: notifications,
      unreadCount: Math.max(0, this.data.unreadCount - 1)
    })
  },

  onMarkAllRead: function () {
    var that = this
    request.put('/notification/read-all', {}, { silent: true }).then(function () {
      that.loadNotifications()
      wx.showToast({ title: '已全部标记为已读', icon: 'success' })
    })
  }
})
