var request = require('../../utils/request')

Page({
  data: {
    list: [],
    showForm: false,
    form: { title: '', content: '', type: 'normal' },
    typeMap: { normal: '普通通知', urgent: '紧急通知', maintenance: '维护通知' }
  },
  onLoad: function () { this.loadData() },
  onShow: function () { this.loadData() },
  loadData: function () {
    var that = this
    request.get('/admin/announcements', {}, { silent: true }).then(function (data) {
      var list = data
      if (!Array.isArray(list)) list = data.list || data.announcements || []
      that.setData({ list: list })
    }).catch(function () {
      that.setData({ list: [] })
    })
  },
  onAdd: function () {
    this.setData({ showForm: true, form: { title: '', content: '', type: 'normal' } })
  },
  onCancelForm: function () {
    this.setData({ showForm: false })
  },
  onTitleInput: function (e) { this.setData({ 'form.title': e.detail.value }) },
  onContentInput: function (e) { this.setData({ 'form.content': e.detail.value }) },
  onTypeChange: function (e) {
    var types = ['normal', 'urgent', 'maintenance']
    this.setData({ 'form.type': types[e.detail.value] })
  },
  onSubmit: function () {
    var that = this
    if (!this.data.form.title) { wx.showToast({ title: '请输入标题', icon: 'none' }); return }
    if (!this.data.form.content) { wx.showToast({ title: '请输入内容', icon: 'none' }); return }
    request.post('/admin/announcements', this.data.form).then(function () {
      wx.showToast({ title: '发布成功', icon: 'success' })
      that.setData({ showForm: false })
      that.loadData()
    }).catch(function () {
      wx.showToast({ title: '发布失败', icon: 'none' })
    })
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
