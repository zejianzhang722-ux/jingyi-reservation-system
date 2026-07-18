Component({
  properties: {
    selected: { type: String, value: 'home' }
  },
  data: {
    items: [
      { key: 'home', text: '审批', iconPath: '/images/tab-reservation.png', selectedIconPath: '/images/tab-reservation-active.png', url: '/pages/admin-home/admin-home' },
      { key: 'manage', text: '管理', iconPath: '/images/tab-home.png', selectedIconPath: '/images/tab-home-active.png', url: '/pages/admin-manage/admin-manage' },
      { key: 'profile', text: '我的', iconPath: '/images/tab-profile.png', selectedIconPath: '/images/tab-profile-active.png', url: '/pages/admin-profile/admin-profile' }
    ]
  },
  methods: {
    onTap: function (e) {
      var item = e.currentTarget.dataset.item
      if (!item || item.key === this.data.selected) return
      wx.redirectTo({ url: item.url })
    }
  }
})
