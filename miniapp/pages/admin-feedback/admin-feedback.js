var request = require('../../utils/request')

function formatTime(value) {
  if (!value) return ''
  var date = new Date(String(value).replace('T', ' ').replace('Z', '').replace(/-/g, '/'))
  if (isNaN(date.getTime())) return value
  var m = date.getMonth() + 1
  var d = date.getDate()
  var h = date.getHours()
  var min = date.getMinutes()
  return (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d) + ' ' + (h < 10 ? '0' + h : h) + ':' + (min < 10 ? '0' + min : min)
}

function normalizeStatus(item) {
  var status = String(item.status || '').toLowerCase()
  if (status === 'done' || status === 'closed' || status === 'processed') status = 'resolved'
  if (!status) status = item.reply ? 'resolved' : 'pending'
  return status === 'resolved' ? 'resolved' : 'pending'
}

function normalizeFeedback(item) {
  item = item || {}
  var status = normalizeStatus(item)
  return Object.assign({}, item, {
    status: status,
    displayTime: formatTime(item.createdAt || item.created_at || item.createdTime || item.created_time)
  })
}

Page({
  data: { list: [], filterStatus: '', replyId: null, replyContent: '' },
  onLoad: function () { this.loadFeedback() },
  onShow: function () { this.loadFeedback() },
  loadFeedback: function () {
    var that = this
    var status = this.data.filterStatus
    var params = {}
    if (status) params.status = status
    request.get('/feedback', params, { silent: true }).then(function (data) {
      var list = data.list || data.items || data || []
      list = Array.isArray(list) ? list.map(normalizeFeedback) : []
      if (status) {
        list = list.filter(function (item) { return item.status === status })
      }
      that.setData({ list: list })
    }).catch(function () {
      that.setData({ list: [] })
    })
  },
  onFilter: function (e) {
    this.setData({ filterStatus: e.currentTarget.dataset.status })
    this.loadFeedback()
  },
  onReplyInput: function (e) {
    this.setData({ replyContent: e.detail.value })
  },
  showReply: function (e) {
    this.setData({ replyId: e.currentTarget.dataset.id, replyContent: '' })
  },
  cancelReply: function () {
    this.setData({ replyId: null, replyContent: '' })
  },
  submitReply: function () {
    var that = this
    var id = this.data.replyId
    var reply = String(this.data.replyContent || '').trim()
    if (!reply) { wx.showToast({ title: '请输入回复内容', icon: 'none' }); return }
    request.put('/feedback/' + id + '/resolve', { reply: reply }).then(function () {
      wx.showToast({ title: '回复成功', icon: 'success' })
      that.setData({ replyId: null, replyContent: '' })
      that.loadFeedback()
    }).catch(function () {
      wx.showToast({ title: '回复失败', icon: 'none' })
    })
  },
  onResolve: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认处理',
      content: '确定将该反馈标记为已处理？',
      success: function (res) {
        if (res.confirm) {
          request.put('/feedback/' + id + '/resolve', {}).then(function () {
            wx.showToast({ title: '已处理', icon: 'success' })
            that.loadFeedback()
          }).catch(function () {
            wx.showToast({ title: '操作失败', icon: 'none' })
          })
        }
      }
    })
  }
})
