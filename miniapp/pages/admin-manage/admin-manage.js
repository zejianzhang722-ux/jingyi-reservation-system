var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

var CATALOG = [
  {
    title: '工作台与统计',
    items: [
      { key: 'pending', name: '待审核', desc: '处理普通待审核预约', icon: 'approve', tone: 'gold', capability: 'ordinaryApproval' },
      { key: 'counselorPending', name: '辅导员重点审核', desc: '处理需要辅导员重点审核的预约', icon: 'approve', tone: 'red', capability: 'counselorApproval' },
      { key: 'stats', name: '数据统计', desc: '查看预约、使用、爽约和信用概览', icon: 'chart', tone: 'blue', capability: 'statsView' }
    ]
  },
  {
    title: '预约与空间',
    items: [
      { key: 'reservation', name: '全部预约', desc: '查看、搜索和处理预约记录', icon: 'calendar', tone: 'blue', capability: 'reservationView' },
      { key: 'rooms', name: '空间状态', desc: '查看房间分类、容量和开放状态', icon: 'room', tone: 'green', capability: 'roomView' }
    ]
  },
  {
    title: '宿生与信用',
    items: [
      { key: 'users', name: '宿生查询', desc: '查看宿生资料、状态和信用分', icon: 'users', tone: 'purple', capability: 'residentView' },
      { key: 'violations', name: '违规记录', desc: '查看宿生违规记录', icon: 'credit', tone: 'red', capability: 'violationView' },
      { key: 'blacklist', name: '黑名单', desc: '管理信用黑名单', icon: 'credit', tone: 'red', capability: 'blacklistManage' }
    ]
  },
  {
    title: '运营审核',
    items: [
      { key: 'feedback', name: '反馈', desc: '处理宿生反馈和回复', icon: 'feedback', tone: 'cyan', capability: 'feedbackManage' },
      { key: 'poster', name: '海报审核', desc: '审核移动端活动海报', icon: 'announcement', tone: 'gold', capability: 'posterReview' }
    ]
  }
]

Page({
  data: {
    groups: []
  },

  ensureAdmin: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  onLoad: function () {
    if (!this.ensureAdmin()) return
    this.refreshGroups()
  },

  onShow: function () {
    if (!this.ensureAdmin()) return
    this.refreshGroups()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTabList()
      this.getTabBar().setData({ selected: 1 })
    }
  },

  refreshGroups: function () {
    var role = auth.getUserRole()
    var groups = CATALOG.map(function (group) {
      return {
        title: group.title,
        items: group.items.filter(function (item) {
          return adminPolicy.can(role, item.capability)
        })
      }
    }).filter(function (group) {
      return group.items.length > 0
    })
    this.setData({ groups: groups })
  },

  onItemTap: function (e) {
    var key = e.currentTarget.dataset.key
    var routes = {
      pending: '/pages/admin-home/admin-home?queueType=' + adminPolicy.queueType(auth.getUserRole(), 'admin'),
      counselorPending: '/pages/admin-home/admin-home?queueType=' + adminPolicy.queueType(auth.getUserRole(), 'counselor'),
      stats: '/pages/admin-stats/admin-stats',
      reservation: '/pages/admin-reservation/admin-reservation',
      rooms: '/pages/admin-rooms/admin-rooms',
      users: '/pages/admin-users/admin-users',
      violations: '/pages/admin-credit/admin-credit?tab=violations',
      blacklist: '/pages/admin-credit/admin-credit?tab=blacklist',
      feedback: '/pages/admin-feedback/admin-feedback',
      poster: '/pages/admin-poster/admin-poster'
    }
    if (routes[key]) {
      wx.navigateTo({ url: routes[key] })
    }
  },

  goToReservationList: function () { wx.navigateTo({ url: '/pages/admin-reservation/admin-reservation' }) },
  goToPendingApprove: function () { wx.navigateTo({ url: '/pages/admin-home/admin-home' }) },
  goToRoomManage: function () { wx.navigateTo({ url: '/pages/admin-rooms/admin-rooms' }) },
  goToUserManage: function () { wx.navigateTo({ url: '/pages/admin-users/admin-users' }) },
  goToCreditManage: function () { wx.navigateTo({ url: '/pages/admin-credit/admin-credit' }) },
  goToStatsOverview: function () { wx.navigateTo({ url: '/pages/admin-stats/admin-stats' }) },
  goToFeedback: function () { wx.navigateTo({ url: '/pages/admin-feedback/admin-feedback' }) },
  goToAnnouncement: function () { wx.navigateTo({ url: '/pages/admin-announcement/admin-announcement' }) }
})
