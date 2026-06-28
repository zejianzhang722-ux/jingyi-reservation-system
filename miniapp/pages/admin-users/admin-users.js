var request = require('../../utils/request')

function createEmptyForm() {
  return {
    id: '',
    studentNo: '',
    realName: '',
    cardNo: '',
    phone: '',
    college: '',
    major: '',
    grade: '',
    className: '',
    buildingId: '',
    roomNumber: ''
  }
}

function pickUserForm(user) {
  user = user || {}
  return {
    id: user.id || '',
    studentNo: user.student_no || user.student_id || '',
    realName: user.real_name || user.realName || user.name || '',
    cardNo: user.card_no || user.cardNo || '',
    phone: user.phone || '',
    college: user.college || '',
    major: user.major || '',
    grade: user.grade || '',
    className: user.class_name || user.className || '',
    buildingId: user.building_id || user.buildingId || '',
    roomNumber: user.room_number || user.roomNumber || ''
  }
}

Page({
  data: {
    list: [],
    keyword: '',
    filteredList: [],
    showAddForm: false,
    formMode: 'create',
    addForm: createEmptyForm(),
    submittingAdd: false
  },
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
      var name = u.name || u.real_name || u.realName || '?'
      u.avatarInitial = String(name).charAt(0) || '?'
      u.creditDisplay = parseInt(u.credit_score) || 100
      return u
    })
  },
  applyFilter: function (list, keyword) {
    if (!keyword) return list
    var kw = keyword.toLowerCase()
    return list.filter(function (u) {
      return [u.name, u.real_name, u.realName, u.student_no, u.student_id, u.phone, u.card_no, u.room_number].join(' ').toLowerCase().indexOf(kw) >= 0
    })
  },
  onSearch: function (e) {
    var keyword = e.detail.value.trim()
    this.setData({ keyword: keyword, filteredList: this.applyFilter(this.data.list, keyword) })
  },
  onAddUser: function () {
    this.setData({ showAddForm: true, formMode: 'create', addForm: createEmptyForm(), submittingAdd: false })
  },
  onEditUser: function (e) {
    var id = e.currentTarget.dataset.id
    var user = (this.data.list || []).find(function (item) { return String(item.id) === String(id) }) || {}
    this.setData({ showAddForm: true, formMode: 'edit', addForm: pickUserForm(user), submittingAdd: false })
  },
  onCancelAdd: function () {
    if (this.data.submittingAdd) return
    this.setData({ showAddForm: false, addForm: createEmptyForm(), formMode: 'create' })
  },
  onAddInput: function (e) {
    var field = e.currentTarget.dataset.field
    var value = e.detail.value
    this.setData({ ['addForm.' + field]: value })
  },
  validateAddForm: function () {
    var form = this.data.addForm
    if (!String(form.studentNo || '').trim()) return '请输入学号'
    if (!/^\d{9,10}$/.test(String(form.studentNo || '').trim())) return '学号应为9-10位数字'
    if (!String(form.realName || '').trim()) return '请输入姓名'
    if (!String(form.cardNo || '').trim()) return '请输入6位一卡通号'
    if (!/^\d{6}$/.test(String(form.cardNo || '').trim())) return '一卡通号应为6位数字'
    if (form.phone && !/^1\d{10}$/.test(String(form.phone).trim())) return '手机号格式不正确'
    return ''
  },
  submitAddUser: function () {
    var that = this
    var error = this.validateAddForm()
    if (error) { wx.showToast({ title: error, icon: 'none' }); return }
    if (this.data.submittingAdd) return
    var form = Object.assign({}, this.data.addForm)
    Object.keys(form).forEach(function (key) { form[key] = String(form[key] || '').trim() })
    var isEdit = this.data.formMode === 'edit'
    var req = isEdit ? request.put('/user/list/' + form.id, form) : request.post('/user/list', form)
    this.setData({ submittingAdd: true })
    req.then(function () {
      wx.showToast({ title: isEdit ? '宿生已更新' : '宿生已添加', icon: 'success' })
      that.setData({ showAddForm: false, addForm: createEmptyForm(), formMode: 'create', submittingAdd: false })
      that.loadData()
    }).catch(function (err) {
      that.setData({ submittingAdd: false })
      wx.showToast({ title: err && err.message ? err.message : '保存失败', icon: 'none' })
    })
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
          if (isNaN(newScore) || newScore < 0 || newScore > 100) { wx.showToast({ title: '请输入0-100的数字', icon: 'none' }); return }
          request.put('/credit/adjust', { userId: id, score: newScore }).then(function () {
            wx.showToast({ title: '已调整', icon: 'success' })
            that.loadData()
          }).catch(function () { wx.showToast({ title: '调整失败', icon: 'none' }) })
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
          }).catch(function () { wx.showToast({ title: action + '失败', icon: 'none' }) })
        }
      }
    })
  }
})
