Component({
  properties: {
    selected: {
      type: Number,
      value: 0
    }
  },

  data: {
    list: [
      {
        pagePath: '/pages/index/index',
        text: '首页',
        icon: 'home'
      },
      {
        pagePath: '/pages/my-reservations/my-reservations',
        text: '我的预约',
        icon: 'calendar'
      },
      {
        pagePath: '/pages/notifications/notifications',
        text: '消息',
        icon: 'message'
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        icon: 'user'
      }
    ]
  },

  methods: {
    onTabTap: function (e) {
      var index = e.currentTarget.dataset.index
      var item = this.data.list[index]
      wx.switchTab({
        url: item.pagePath
      })
    }
  }
})
