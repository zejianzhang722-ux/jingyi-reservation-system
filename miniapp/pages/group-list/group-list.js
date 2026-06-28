var request = require('../../utils/request')

function pickList(data) {
  if (Array.isArray(data)) return data
  return data && (data.list || data.items || data.groups || data.records) || []
}
function normalizeGroup(item) {
  item = item || {}
  var current = Number(item.currentMembers || item.current_members || item.member_count || 0)
  var max = Number(item.maxMembers || item.max_members || 0)
  var status = item.status || 'open'
  return Object.assign({}, item, {
    roomName: item.roomName || item.room_name || '功能房',
    creatorName: item.creatorName || item.creator_name || '宿生',
    startTime: String(item.startTime || item.start_time || item.startHour || '').slice(0, 5),
    endTime: String(item.endTime || item.end_time || item.endHour || '').slice(0, 5),
    maxMembers: max,
    currentMembers: current,
    progressText: current + '/' + max,
    progressPercent: max ? Math.min(100, Math.round(current * 100 / max)) : 0,
    isFull: status === 'full' || (max > 0 && current >= max),
    status: status
  })
}

Page({
  data: {
    list: [],
    loading: true,
    tab: 'open',
    statusMap: { open: '招募中', full: '已满员', submitted: '已提交', cancelled: '已取消', closed: '已关闭' },
    tabs: [
      { key: 'open', name: '可加入' },
      { key: 'mine', name: '我的组团' },
      { key: 'submitted', name: '已提交' }
    ]
  },

  onLoad: function () { this.loadData() },
  onShow: function () { this.loadData() },
  onPullDownRefresh: function () { this.loadData().finally(function () { wx.stopPullDownRefresh() }) },

  buildParams: function () {
    if (this.data.tab === 'mine') return { mine: 1, status: 'all' }
    if (this.data.tab === 'submitted') return { status: 'submitted' }
    return { status: 'open' }
  },

  loadData: function () {
    var that = this
    this.setData({ loading: true })
    return request.get('/groups', this.buildParams(), { silent: true }).then(function (data) {
      that.setData({ list: pickList(data).map(normalizeGroup), loading: false })
    }).catch(function () {
      that.setData({ list: [], loading: false })
    })
  },

  onTabTap: function (e) {
    this.setData({ tab: e.currentTarget.dataset.tab || 'open' })
    this.loadData()
  },

  onOpenGroup: function (e) {
    var id = e.currentTarget.dataset.id
    var mode = this.data.tab === 'open' ? 'join' : 'detail'
    wx.navigateTo({ url: '/pages/group-reserve/group-reserve?mode=' + mode + '&groupId=' + id })
  },

  onCreateTap: function () {
    wx.navigateTo({ url: '/pages/room-list/room-list' })
  }
})
