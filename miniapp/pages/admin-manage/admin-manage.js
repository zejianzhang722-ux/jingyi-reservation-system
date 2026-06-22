var auth = require('../../utils/auth')

Page({
  data: {
    groups: [
      {
        title: '工作台与统计',
        items: [
          { key: 'pending', name: '待审核', desc: '处理待审核预约', icon: 'approve', tone: 'gold' },
          { key: 'stats', name: '数据统计', desc: '查看预约、使用、爽约和信用概览', icon: 'chart', tone: 'blue' }
        ]
      },
      {
        title: '预约与空间',
        items: [
          { key: 'reservation', name: '全部预约', desc: '查看、搜索和处理预约记录', icon: 'calendar', tone: 'blue' },
          { key: 'rooms', name: '功能房管理', desc: '查看房间分类、容量和开放状态', icon: 'room', tone: 'green' }
        ]
      },
      {
        title: '宿生与信用',
        items: [
          { key: 'users', name: '宿生管理', desc: '查看宿生资料、状态和信用分', icon: 'users', tone: 'purple' },
          { key: 'credit', name: '信用管理', desc: '查看违规记录、黑名单和信用配置', icon: 'credit', tone: 'red' }
        ]
      },
      {
        title: '运营发布',
        items: [
          { key: 'feedback', name: '反馈管理', desc: '处理宿生反馈和回复', icon: 'feedback', tone: 'cyan' },
          { key: 'announcement', name: '公告管理', desc: '发布、归档和维护公告', icon: 'announcement', tone: 'gold' }
        ]
      }
    ]
  },

  ensureAdmin: function () {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  onLoad: function () {
    this.ensureAdmin()
  },

  onShow: function () {
    if (!this.ensureAdmin()) return
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTabList()
      this.getTabBar().setData({ selected: 1 })
    }
  },

  onItemTap: function (e) {
    var key = e.currentTarget.dataset.key
    var routes = {
      pending: '/pages/admin-home/admin-home',
      stats: '/pages/admin-stats/admin-stats',
      reservation: '/pages/admin-reservation/admin-reservation',
      rooms: '/pages/admin-rooms/admin-rooms',
      users: '/pages/admin-users/admin-users',
      credit: '/pages/admin-credit/admin-credit',
      feedback: '/pages/admin-feedback/admin-feedback',
      announcement: '/pages/admin-announcement/admin-announcement'
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
