Component({
  data: {
    selected: 0,
    nativeTabPaths: [
      '/pages/index/index',
      '/pages/my-reservations/my-reservations',
      '/pages/notifications/notifications',
      '/pages/profile/profile'
    ],
    studentList: [
      { pagePath: '/pages/index/index', text: '首页', icon: 'home', iconPath: '/images/tab-home.png', selectedIconPath: '/images/tab-home-active.png', badge: 0 },
      { pagePath: '/pages/my-reservations/my-reservations', text: '预约', icon: 'calendar', iconPath: '/images/tab-reservation.png', selectedIconPath: '/images/tab-reservation-active.png', badge: 0 },
      { pagePath: '/pages/notifications/notifications', text: '消息', icon: 'message', iconPath: '/images/tab-message.png', selectedIconPath: '/images/tab-message-active.png', badge: 0 },
      { pagePath: '/pages/profile/profile', text: '我的', icon: 'user', iconPath: '/images/tab-profile.png', selectedIconPath: '/images/tab-profile-active.png', badge: 0 }
    ],
    list: []
  },
  lifetimes: { attached: function () { this.switchTabList() } },
  pageLifetimes: { show: function () { this.switchTabList() } },
  methods: {
    switchTabList: function () {
      var currentPaths = this.data.list.map(function (item) { return item.pagePath }).join(',')
      var targetPaths = this.data.studentList.map(function (item) { return item.pagePath }).join(',')
      if (currentPaths !== targetPaths) this.setData({ list: this.data.studentList })
    },
    onTabTap: function (e) {
      var index = e.currentTarget.dataset.index
      var path = e.currentTarget.dataset.path
      this.switchTabList()
      this.setData({ selected: index })
      if (this.data.nativeTabPaths.indexOf(path) !== -1) wx.switchTab({ url: path })
    }
  }
})
