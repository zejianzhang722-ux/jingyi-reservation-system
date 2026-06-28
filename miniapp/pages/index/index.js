var request = require('../../utils/request')
var auth = require('../../utils/auth')
var util = require('../../utils/util')
var localData = require('../../utils/local-data')

Page({
  data: {
    userInfo: null,
    creditScore: 100,
    creditColorValue: '#52C41A',
    searchKeyword: '',
    categories: [],
    currentCategory: '',
    loading: true,
    isOffline: false,
    announcementText: ''
  },
  onLoad: function () {
    if (!auth.isLoggedIn()) { wx.redirectTo({ url: '/pages/login/login' }); return }
    if (auth.isAdmin()) { wx.reLaunch({ url: '/pages/admin-home/admin-home' }); return }
    this.loadUserInfo(); this.loadCategories(); this.loadAnnouncements()
  },
  onShow: function () {
    if (auth.isLoggedIn() && auth.isAdmin()) { wx.reLaunch({ url: '/pages/admin-home/admin-home' }); return }
    if (typeof this.getTabBar === 'function' && this.getTabBar()) { this.getTabBar().switchTabList(); this.getTabBar().setData({ selected: 0 }) }
    if (auth.isLoggedIn()) { this.loadUserInfo(); this.loadCategories(); this.loadAnnouncements() }
  },
  onPullDownRefresh: function () { this.loadCategories(); wx.stopPullDownRefresh() },
  loadUserInfo: function () {
    var that = this; var userInfo = auth.getUserInfo()
    if (userInfo) { var score = userInfo.credit_score || userInfo.creditScore || 100; this.setData({ userInfo: userInfo, creditScore: score, creditColorValue: util.getCreditColorValue(score) }) }
    request.get('/user/profile', {}, { silent: true }).then(function (data) { var freshUser = auth.setUserInfo(data); var freshScore = Number(freshUser.credit_score !== undefined ? freshUser.credit_score : freshUser.creditScore); if (isNaN(freshScore)) freshScore = 100; that.setData({ userInfo: freshUser, creditScore: freshScore, creditColorValue: util.getCreditColorValue(freshScore) }) }).catch(function () {})
  },
  mapCategory: function (cat, key, rooms, localCategories) {
    var catRooms = rooms.filter(function (r) { return cat.types.indexOf(r.type) !== -1 })
    if (catRooms.length === 0) return null
    var freeCount = catRooms.filter(function (r) { return r.status === 'open' || r.status === 'active' }).length
    var localCat = localCategories.find(function (c) { return c.key === key })
    var name = cat.name || (localCat && localCat.name) || '功能房'
    return { key: key, name: name, iconKey: key, color: cat.color, count: catRooms.length, freeCount: freeCount, types: cat.types }
  },
  loadCategories: function () {
    var that = this
    var localCategories = localData.getLocalCategories().map(function (item) { var name = item.name || '功能房'; return Object.assign({}, item, { name: name, iconKey: item.key }) })
    that.setData({ categories: localCategories, loading: false, isOffline: true })
    request.get('/room', {}, { silent: true }).then(function (data) {
      var rooms = Array.isArray(data) ? data : []
      if (rooms.length === 0) return
      var typeMap = localData.getTypeMap(); var categories = []
      for (var key in typeMap) { var category = that.mapCategory(typeMap[key], key, rooms, localCategories); if (category) categories.push(category) }
      if (categories.length === 0) return
      that.setData({ categories: categories, isOffline: false })
    }).catch(function () {})
  },
  loadAnnouncements: function () {
    var that = this
    request.get('/room/announcements', {}, { silent: true }).then(function (data) { var announcements = Array.isArray(data) ? data : []; var texts = announcements.map(function (a) { return a.title + (a.content ? '：' + a.content : '') }); that.setData({ announcementText: texts.join('    ') }) }).catch(function () { that.setData({ announcementText: '欢迎使用敬一书院功能房预约系统，请按需预约并准时签到。' }) })
  },
  onSearchTap: function () { wx.navigateTo({ url: '/pages/room-list/room-list' }) },
  onGroupListTap: function () { wx.navigateTo({ url: '/pages/group-list/group-list' }) },
  onSearchInput: function (e) { this.setData({ searchKeyword: e.detail.value }) },
  onSearch: function () { var keyword = this.data.searchKeyword.trim(); if (keyword) wx.navigateTo({ url: '/pages/room-list/room-list?keyword=' + encodeURIComponent(keyword) }) },
  onCategoryTap: function (e) { var key = e.currentTarget.dataset.key; var category = this.data.categories.find(function (c) { return c.key === key }); if (category) wx.navigateTo({ url: '/pages/room-list/room-list?type=' + encodeURIComponent(category.types.join(',')) + '&title=' + encodeURIComponent(category.name) }) },
  onAvatarTap: function () { wx.navigateTo({ url: '/pages/profile/profile' }) }
})
