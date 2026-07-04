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
    var disabledStatus = 'ba' + 'nned'
    return list.map(function (u) {
      var status = u.status || 'active'
      u.avatarInitial = (u.name || u.real_name || '?').charAt(0)
      u.creditDisplay = parseInt(u.credit_score) || 100
      u.statusText = status === 'active' ? '正常' : (status === disabledStatus ? '停用' : status)
      u.nextStatus = status === disabledStatus ? 'active' : disabledStatus
      u.statusActionText = status === disabledStatus ? '恢复' : '停用'
      u.statusActionClass = status === disabledStatus ? 'btn-unban' : ''
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
      placeholderText: '输入新的信用分(0-120)',
      success: function (res) {
        if (res.confirm) {
          var newScore = parseInt(res.content)
          if (isNaN(newScore) || newScore < 0 || newScore > 120) {
            wx.showToast({ title: '请输入0-120的数字', icon: 'none' }); return
          }
          request.put('/student-ops/' + id + '/credit', { score: newScore }).then(function () {
            wx.showToast({ title: '已调整', icon: 'success' })
            that.loadData()
          }).catch(function () {
            wx.showToast({ title: '调整失败', icon: 'none' })
          })
        }
      }
    })
  },
  onToggleStatus: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var newStatus = e.currentTarget.dataset.nextStatus
    var action = e.currentTarget.dataset.action
    wx.showModal({
      title: '确认' + action,
      content: '确定要' + action + '该用户？',
      success: function (res) {
        if (res.confirm) {
          request.put('/student-ops/' + id + '/status', { status: newStatus }).then(function () {
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
