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

function canonicalCategory(value) {
  var key = String(value || '').trim().toLowerCase()
  var map = {
    approve: 'audit', approval: 'audit', reservation_audit: 'audit', reservation_review: 'audit', audit_notice: 'audit',
    use_reminder: 'reminder', usage_reminder: 'reminder', reservation_reminder: 'reminder', checkin_reminder: 'reminder',
    noshow: 'noshow_warning', no_show: 'noshow_warning', no_show_warning: 'noshow_warning', noshow_warning: 'noshow_warning',
    credit_change: 'credit', credit_update: 'credit', poster_notice: 'poster', announcement: 'system', system_notice: 'system', violation_notice: 'violation'
  }
  return map[key] || key
}

function inferCategory(item) {
  item = item || {}
  var direct = item.category || item.type || item.notificationType || item.notification_type || item.eventType || item.event_type
  var key = canonicalCategory(direct)
  if (key) return key
  var text = [item.title, item.content, item.message, item.body].join(' ')
  if (/审核|通过|驳回|拒绝|审批/.test(text)) return 'audit'
  if (/提醒|签到|开始|即将|使用/.test(text)) return 'reminder'
  if (/爽约|未签到|逾期|警告/.test(text)) return 'noshow_warning'
  if (/信用|扣分|加分|积分/.test(text)) return 'credit'
  if (/海报|张贴|宣传/.test(text)) return 'poster'
  if (/违规|违约|处罚/.test(text)) return 'violation'
  return 'system'
}

function normalizeNotification(item) {
  item = item || {}
  var rawTime = item.timeAgo || item.createdAt || item.created_at
  var category = inferCategory(item)
  return Object.assign({}, item, { category: category, displayTime: formatNotificationTime(rawTime) })
}

function withCategoryCounts(categories, list) {
  var counts = { all: 0 }
  ;(list || []).forEach(function (n) {
    if (!n.isRead && !n.is_read) {
      counts.all++
      counts[n.category] = (counts[n.category] || 0) + 1
    }
  })
  return categories.map(function (item) {
    return Object.assign({}, item, { unread: counts[item.key] || 0 })
  })
}

Page({
  data: {
    categories: [
      { key: 'all', name: '全部', unread: 0 },
      { key: 'audit', name: '审核通知', unread: 0 },
      { key: 'reminder', name: '使用提醒', unread: 0 },
      { key: 'noshow_warning', name: '爽约警告', unread: 0 },
      { key: 'credit', name: '信用变动', unread: 0 },
      { key: 'poster', name: '海报通知', unread: 0 },
      { key: 'system', name: '系统公告', unread: 0 },
      { key: 'violation', name: '违规提醒', unread: 0 }
    ],
    currentCategory: 'all', notifications: [], loading: true, unreadCount: 0, allNotifications: []
  },

  onLoad: function () { this.loadNotifications() },
  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTabList()
      this.getTabBar().setData({ selected: 2 })
    }
    this.loadNotifications()
  },
  onPullDownRefresh: function () { this.loadNotifications(); wx.stopPullDownRefresh() },

  loadNotifications: function () {
    var that = this
    var currentCategory = this.data.currentCategory
    var params = {}
    if (currentCategory !== 'all') { params.category = currentCategory; params.type = currentCategory }

    var listReq = request.get('/notification', params, { silent: true })
    var allReq = currentCategory === 'all' ? listReq : request.get('/notification', { pageSize: 100 }, { silent: true })

    Promise.all([listReq, allReq]).then(function (results) {
      var data = results[0]
      var allData = results[1]
      var rawList = data && data.list ? data.list : (Array.isArray(data) ? data : [])
      var rawAll = allData && allData.list ? allData.list : (Array.isArray(allData) ? allData : rawList)
      var normalizedList = (rawList || []).map(function (n) { return normalizeNotification(n) })
      var allNotifications = (rawAll || []).map(function (n) { return normalizeNotification(n) })
      var filteredList = currentCategory === 'all' ? normalizedList : normalizedList.filter(function (n) { return n.category === currentCategory })
      var unreadCount = 0
      filteredList.forEach(function (n) { if (!n.isRead && !n.is_read) unreadCount++ })
      that.setData({ notifications: filteredList, allNotifications: allNotifications, categories: withCategoryCounts(that.data.categories, allNotifications), loading: false, unreadCount: unreadCount })
    }).catch(function () { that.setData({ loading: false, notifications: [], unreadCount: 0 }) })
  },

  onCategoryChange: function (e) {
    var key = e.currentTarget.dataset.key
    this.setData({ currentCategory: key, loading: true })
    this.loadNotifications()
  },

  onNotificationTap: function (e) {
    var id = e.currentTarget.dataset.id
    var item = this.data.notifications.find(function (n) { return n.id === id })
    if (!item) return
    if (!item.isRead && !item.is_read) this.markAsRead(id)
    if (item.relatedId || item.related_id) {
      var relatedId = item.relatedId || item.related_id
      if (item.category === 'audit' || item.category === 'reminder') wx.navigateTo({ url: '/pages/reservation-detail/reservation-detail?id=' + relatedId })
      else if (item.category === 'credit') wx.navigateTo({ url: '/pages/credit-detail/credit-detail' })
    }
  },

  markAsRead: function (id) {
    request.put('/notification/' + id + '/read', {}, { silent: true }).then(function () {})
    var notifications = this.data.notifications
    var allNotifications = this.data.allNotifications
    notifications.forEach(function (n) { if (n.id === id) { n.isRead = true; n.is_read = true } })
    allNotifications.forEach(function (n) { if (n.id === id) { n.isRead = true; n.is_read = true } })
    this.setData({ notifications: notifications, allNotifications: allNotifications, categories: withCategoryCounts(this.data.categories, allNotifications), unreadCount: Math.max(0, this.data.unreadCount - 1) })
  },

  onMarkAllRead: function () {
    var that = this
    request.put('/notification/read-all', {}, { silent: true }).then(function () {
      that.loadNotifications()
      wx.showToast({ title: '已全部标记为已读', icon: 'success' })
    })
  }
})
