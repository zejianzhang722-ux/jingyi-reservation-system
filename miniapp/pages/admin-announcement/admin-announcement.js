var request = require('../../utils/request')

function emptyForm() {
  return { id: '', title: '', content: '', type: 'normal', isTop: false, target: 'all' }
}

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

function normalizeAnnouncement(item) {
  item = item || {}
  item.displayTime = formatTime(item.created_at || item.createdAt)
  item.isTop = item.is_top === 1 || item.isTop === true
  return item
}

Page({
  data: {
    list: [],
    showForm: false,
    formMode: 'create',
    form: emptyForm(),
    submitting: false,
    typeMap: { normal: '普通通知', notice: '普通通知', urgent: '紧急通知', maintenance: '维护通知' },
    targetMap: { all: '全体宿生', student: '宿生', admin: '管理员' }
  },
  onLoad: function () { this.loadData() },
  onShow: function () { this.loadData() },
  loadData: function () {
    var that = this
    request.get('/admin/announcements', {}, { silent: true }).then(function (data) {
      var list = data
      if (!Array.isArray(list)) list = data.list || data.announcements || []
      list = list.map(normalizeAnnouncement)
      that.setData({ list: list })
    }).catch(function () { that.setData({ list: [] }) })
  },
  onAdd: function () {
    this.setData({ showForm: true, formMode: 'create', form: emptyForm(), submitting: false })
  },
  onEdit: function (e) {
    var id = e.currentTarget.dataset.id
    var item = (this.data.list || []).find(function (n) { return String(n.id) === String(id) }) || {}
    this.setData({
      showForm: true,
      formMode: 'edit',
      submitting: false,
      form: {
        id: item.id || '',
        title: item.title || '',
        content: item.content || '',
        type: item.type || 'normal',
        isTop: item.isTop || item.is_top === 1,
        target: item.target || 'all'
      }
    })
  },
  onCancelForm: function () {
    if (this.data.submitting) return
    this.setData({ showForm: false, form: emptyForm() })
  },
  onTitleInput: function (e) { this.setData({ 'form.title': e.detail.value }) },
  onContentInput: function (e) { this.setData({ 'form.content': e.detail.value }) },
  onTypeChange: function (e) {
    var types = ['normal', 'urgent', 'maintenance']
    this.setData({ 'form.type': types[e.detail.value] })
  },
  onTargetChange: function (e) {
    var targets = ['all', 'student', 'admin']
    this.setData({ 'form.target': targets[e.detail.value] })
  },
  onTopChange: function (e) {
    this.setData({ 'form.isTop': !!e.detail.value })
  },
  onSubmit: function () {
    var that = this
    var form = Object.assign({}, this.data.form)
    form.title = String(form.title || '').trim()
    form.content = String(form.content || '').trim()
    if (!form.title) { wx.showToast({ title: '请输入标题', icon: 'none' }); return }
    if (!form.content) { wx.showToast({ title: '请输入内容', icon: 'none' }); return }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    var payload = { title: form.title, content: form.content, type: form.type, isTop: !!form.isTop, target: form.target }
    var isEdit = this.data.formMode === 'edit'
    var req = isEdit ? request.put('/admin/announcements/' + form.id, payload) : request.post('/admin/announcements', payload)
    req.then(function () {
      wx.showToast({ title: isEdit ? '已保存' : '发布成功', icon: 'success' })
      that.setData({ showForm: false, form: emptyForm(), submitting: false })
      that.loadData()
    }).catch(function (err) {
      that.setData({ submitting: false })
      wx.showToast({ title: err && err.message ? err.message : '保存失败', icon: 'none' })
    })
  },
  onToggleTop: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var isTop = e.currentTarget.dataset.top === true || e.currentTarget.dataset.top === 'true'
    request.put('/admin/announcements/' + id, { isTop: !isTop }).then(function () {
      wx.showToast({ title: !isTop ? '已置顶' : '已取消置顶', icon: 'success' })
      that.loadData()
    }).catch(function () { wx.showToast({ title: '操作失败', icon: 'none' }) })
  },
  onDelete: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '确定删除该公告？',
      success: function (res) {
        if (res.confirm) {
          request.delete('/admin/announcements/' + id).then(function () {
            wx.showToast({ title: '已删除', icon: 'success' })
            that.loadData()
          }).catch(function () { wx.showToast({ title: '删除失败', icon: 'none' }) })
        }
      }
    })
  }
})
