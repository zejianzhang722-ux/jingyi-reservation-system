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

function pickList(data) {
  if (Array.isArray(data)) return data
  return data && (data.list || data.items || data.records || data.posters) || []
}

function normalizePoster(item) {
  item = item || {}
  return Object.assign({}, item, {
    applicantName: item.real_name || item.realName || item.nickname || item.user_name || '宿生',
    studentNo: item.student_no || item.student_id || item.studentNo || '',
    displayTime: formatTime(item.created_at || item.createdAt),
    displayDate: (item.start_date || item.startDate || '-') + ' 至 ' + (item.end_date || item.endDate || '-'),
    displayPosition: item.position || item.locationName || item.location_name || '未指定位置'
  })
}

Page({
  data: {
    list: [],
    status: '',
    loading: false,
    statusMap: { pending: '待审核', approved: '已通过', rejected: '已驳回', cleaned: '已清理', violation: '违规' },
    tabs: [
      { key: '', name: '全部' },
      { key: 'pending', name: '待审核' },
      { key: 'approved', name: '已通过' },
      { key: 'rejected', name: '已驳回' },
      { key: 'cleaned', name: '已清理' },
      { key: 'violation', name: '违规' }
    ]
  },

  onLoad: function () { this.loadData() },
  onShow: function () { this.loadData() },

  loadData: function () {
    var that = this
    var params = { pageSize: 50 }
    if (this.data.status) params.status = this.data.status
    this.setData({ loading: true })
    request.get('/poster', params, { silent: true }).then(function (data) {
      that.setData({ list: pickList(data).map(normalizePoster), loading: false })
    }).catch(function () { that.setData({ list: [], loading: false }) })
  },

  onFilter: function (e) {
    this.setData({ status: e.currentTarget.dataset.status || '' })
    this.loadData()
  },

  onPreviewImage: function (e) {
    var url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  onApprove: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var position = e.currentTarget.dataset.position || ''
    wx.showModal({
      title: '通过海报申请',
      content: '可补充或确认张贴位置',
      editable: true,
      placeholderText: position || '如 B座1楼公告栏',
      success: function (res) {
        if (!res.confirm) return
        var finalPosition = String(res.content || position || '').trim()
        if (!finalPosition) { wx.showToast({ title: '请填写张贴位置', icon: 'none' }); return }
        request.post('/poster/' + id + '/approve', { position: finalPosition }).then(function () {
          wx.showToast({ title: '已通过', icon: 'success' })
          that.loadData()
        }).catch(function (err) { wx.showToast({ title: err && err.message ? err.message : '操作失败', icon: 'none' }) })
      }
    })
  },

  onReject: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '驳回申请',
      content: '请填写驳回原因',
      editable: true,
      placeholderText: '如 内容不清晰、时间不合规等',
      success: function (res) {
        if (!res.confirm) return
        var reason = String(res.content || '').trim()
        if (!reason) { wx.showToast({ title: '请填写驳回原因', icon: 'none' }); return }
        request.post('/poster/' + id + '/reject', { reason: reason }).then(function () {
          wx.showToast({ title: '已驳回', icon: 'success' })
          that.loadData()
        }).catch(function (err) { wx.showToast({ title: err && err.message ? err.message : '操作失败', icon: 'none' }) })
      }
    })
  },

  onClean: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({ title: '标记清理', content: '确认该海报已下架或清理？', success: function (res) {
      if (!res.confirm) return
      request.post('/poster/' + id + '/clean', {}).then(function () { wx.showToast({ title: '已清理', icon: 'success' }); that.loadData() }).catch(function (err) { wx.showToast({ title: err && err.message ? err.message : '操作失败', icon: 'none' }) })
    } })
  },

  onViolation: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({ title: '标记违规', content: '确认该海报违规并扣分？', success: function (res) {
      if (!res.confirm) return
      request.post('/poster/' + id + '/violation', {}).then(function () { wx.showToast({ title: '已标记违规', icon: 'success' }); that.loadData() }).catch(function (err) { wx.showToast({ title: err && err.message ? err.message : '操作失败', icon: 'none' }) })
    } })
  }
})
