Component({
  properties: {
    selected: {
      type: String,
      value: 'home'
    }
  },
  data: {
    items: [
      { key: 'home', text: '首页', icon: '⌂', url: '/pages/admin-home/admin-home' },
      { key: 'manage', text: '管理', icon: '▣', url: '/pages/admin-manage/admin-manage' },
      { key: 'profile', text: '我的', icon: '●', url: '/pages/admin-profile/admin-profile' }
    ]
  },
  methods: {
    onTap: function (e) {
      var item = e.currentTarget.dataset.item
      if (!item || item.key === this.data.selected) return
      wx.reLaunch({ url: item.url })
    }
  }
})
