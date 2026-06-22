var request = require('../../utils/request')

Page({
  data: { list: [], keyword: '', filteredList: [] },
  onLoad: function () { this.loadData() },
  onShow: function () { this.loadData() },
  loadData: function () {
    var that = this
    request.get('/user/list', {}, { silent: true }).then(function (data) {
      var list = data
      if (!Array.isArray(list)) list = data.list || data.users || []
      list = that.enhanceUsers(list)
      that.setData({ list: list, filteredList: that.applyFilter(list, that.data.keyword) })
    }).catch(function () {
      that.setData({ list: [], filteredList: [] })
    })
  },
  enhanceUsers: function (list) {
    return list.map(function (u) {
      u.avatarInitial = (u.name || u.real_name || '?').charAt(0)
      u.creditDisplay = parseInt(u.credit_score) || 100
      return u
    })
  },
  applyFilter: function (list, keyword) {
    if (!keyword) return list
    var kw = keyword.toLowerCase()
    return list.filter(function (u) {
      return (u.name || u.real_name || '').toLowerCase().indexOf(kw) >= 0 ||
        (u.student_no || u.student_id || '').toLowerCase().indexOf(kw) >= 0
    })
  },
  onSearch: function (e) {
    var keyword = e.detail.value.trim()
    this.setData({ keyword: keyword, filteredList: this.applyFilter(this.data.list, keyword) })
  },
  onAdjustCredit: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var currentScore = e.currentTarget.dataset.score
    wx.showModal({
      title: '调整信用分',
      content: '当前信用分: ' + currentScore,
      editable: true,
      placeholderText: '输入新的信用分(0-100)',
      success: function (res) {
        if (res.confirm) {
          var newScore = parseInt(res.content)
          if (isNaN(newScore) || newScore < 0 || newScore > 100) {
            wx.showToast({ title: '请输入0-100的数字', icon: 'none' }); return
          }
          request.put('/credit/adjust', { userId: id, score: newScore }).then(function () {
            wx.showToast({ title: '已调整', icon: 'success' })
            that.loadData()
          }).catch(function () {
            wx.showToast({ title: '调整失败', icon: 'none' })
          })
        }
      }
    })
  },
  onToggleBan: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var status = e.currentTarget.dataset.status
    var action = status === 'banned' ? '解封' : '封禁'
    wx.showModal({
      title: '确认' + action,
      content: '确定要' + action + '该用户？',
      success: function (res) {
        if (res.confirm) {
          var newStatus = status === 'banned' ? 'active' : 'banned'
          request.put('/admin/accounts/' + id, { status: newStatus }).then(function () {
            wx.showToast({ title: action + '成功', icon: 'success' })
            that.loadData()
          }).catch(function () {
            wx.showToast({ title: action + '失败', icon: 'none' })
          })
        }
      }
    })
  }
})
