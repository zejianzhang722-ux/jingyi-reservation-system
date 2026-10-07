var request = require('../../utils/request')
var pageMotion = require('../../utils/page-motion')
var notificationPresenter = require('../../utils/notification-presenter')
var auth = require('../../utils/auth')

Page({
  data: {
    categories: notificationPresenter.categories,
    currentCategory: 'all',
    notifications: [],
    loading: true,
    unreadCount: 0
  },

  onLoad: function () {
    this.loadNotifications()
  },

  onShow: function () {
    pageMotion.replayPageMotion(this)
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
      list = (list || []).map(function (row) { return notificationPresenter.present(row, auth.getUserRole()) })
      ;(list || []).forEach(function (n) {
        if (!n.isRead && !n.is_read) unreadCount++
      })
      that.setData({
        notifications: list || [],
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

    if (item.targetUrl) wx.navigateTo({ url: item.targetUrl })
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
