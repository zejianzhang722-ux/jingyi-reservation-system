var dialog = require('../../utils/dialog')
var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

Page({
  data: {
    list: [],
    loading: false,
    loadingMore: false,
    error: '',
    loadMoreError: '',
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: false,
    processingIds: {},
    statusMap: {
      pending: '待审核',
      approved: '已通过',
      rejected: '已拒绝',
      cleaned: '已清理',
      expired: '已过期',
      violation: '违规'
    }
  },

  hasAccess: function () {
    return auth.isLoggedIn() && auth.isAdmin() && adminPolicy.can(auth.getUserRole(), 'posterReview')
  },

  clearSensitiveData: function () {
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    this.setData({
      list: [],
      loading: false,
      loadingMore: false,
      error: '',
      loadMoreError: '',
      page: 1,
      total: 0,
      hasMore: false,
      processingIds: {}
    })
  },

  ensureAccess: function () {
    if (this.hasAccess()) return true
    this.clearSensitiveData()
    if (auth.isLoggedIn() && auth.isAdmin()) {
      wx.showToast({ title: '当前账号无海报审核权限', icon: 'none' })
      wx.reLaunch({ url: '/pages/admin-manage/admin-manage' })
    } else {
      wx.reLaunch({ url: '/pages/login/login' })
    }
    return false
  },

  onLoad: function () {
    this.ensureAccess()
  },

  onShow: function () {
    if (!this.ensureAccess()) return
    return this.loadData()
  },

  loadData: function (options) {
    if (!this.ensureAccess()) return Promise.resolve()
    options = options || {}
    var append = !!options.append
    var requestedPage = append ? (options.page || this.data.page + 1) : 1
    var that = this
    this._listRequestVersion = (this._listRequestVersion || 0) + 1
    var requestVersion = this._listRequestVersion
    if (append) this.setData({ loadingMore: true, loadMoreError: '' })
    else this.setData({ loading: true, loadingMore: false, error: '', loadMoreError: '' })
    return request.get('/poster', {
      status: 'pending',
      page: requestedPage,
      pageSize: this.data.pageSize
    }, { silent: true }).then(function (data) {
      if (requestVersion !== that._listRequestVersion) return
      if (!that.hasAccess()) {
        that.ensureAccess()
        return
      }
      var pageList = Array.isArray(data) ? data : ((data && data.list) || [])
      if (!Array.isArray(pageList)) pageList = [];
      pageList = pageList.map(function(item) { return Object.assign({}, item, { previewUrl: that.imageUrl(item.image_url || item.imageUrl), imageFailed: false }) })
      var previousLength = append ? that.data.list.length : 0
      var list = append ? that.data.list.concat(pageList) : pageList.slice()
      var seenIds = {}
      list = list.filter(function (item) {
        if (!item || item.id === undefined || item.id === null) return true
        var key = String(item.id)
        if (seenIds[key]) return false
        seenIds[key] = true
        return true
      })
      var responsePage = parseInt(data && data.page, 10)
      var responsePageSize = parseInt(data && data.pageSize, 10)
      var responseTotal = Number(data && data.total)
      var hasResponseTotal = data && data.total !== undefined && data.total !== null && !isNaN(responseTotal)
      var page = isNaN(responsePage) ? requestedPage : Math.max(requestedPage, responsePage)
      var pageSize = isNaN(responsePageSize) || responsePageSize < 1 ? that.data.pageSize : responsePageSize
      var total = hasResponseTotal ? responseTotal : list.length
      var hasMore = append
        ? pageList.length >= pageSize && list.length > previousLength && (!hasResponseTotal || list.length < responseTotal)
        : (hasResponseTotal ? list.length < responseTotal : pageList.length >= pageSize)
      that.setData({
        list: list,
        loading: false,
        loadingMore: false,
        error: '',
        loadMoreError: '',
        page: page,
        pageSize: pageSize,
        total: total,
        hasMore: hasMore
      })
    }).catch(function () {
      if (requestVersion !== that._listRequestVersion) return
      if (!that.hasAccess()) {
        that.ensureAccess()
        return
      }
      if (append) {
        that.setData({
          loadingMore: false,
          loadMoreError: '更多海报暂时未能加载'
        })
        return
      }
      that.setData({
        list: [],
        loading: false,
        loadingMore: false,
        error: '海报审核暂时未能加载',
        loadMoreError: '',
        page: 1,
        total: 0,
        hasMore: false
      })
    })
  },

  onRetry: function () {
    return this.loadData()
  },

  onLoadMore: function () {
    if (!this.ensureAccess() || this.data.loading || this.data.loadingMore || !this.data.hasMore) return Promise.resolve()
    return this.loadData({ append: true, page: this.data.page + 1 })
  },

  isProcessing: function (id) {
    return !!this.data.processingIds[id]
  },

  setProcessing: function (id, processing) {
    var next = Object.assign({}, this.data.processingIds)
    if (processing) next[id] = true
    else delete next[id]
    this.setData({ processingIds: next })
  },

  finishProcessing: function (id) {
    if (this.hasAccess()) this.setProcessing(id, false)
  },

  submitDecision: function (id, action, body, successTitle) {
    if (!this.ensureAccess() || this.isProcessing(id)) return Promise.resolve()
    var that = this
    this.setProcessing(id, true)
    return request.post('/poster/' + id + '/' + action, body || {}).then(function () {
      if (!that.hasAccess()) {
        that.ensureAccess()
        return
      }
      wx.showToast({ title: successTitle, icon: 'success' })
      return that.loadData()
    }, function () {
      if (!that.hasAccess()) {
        that.ensureAccess()
        return
      }
      wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' })
    }).then(function () {
      that.finishProcessing(id)
    }, function () {
      that.finishProcessing(id)
    })
  },

  imageUrl: function(value) {
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (String(value).indexOf('/uploads/') === 0) return request.getBaseUrl().replace(/\/api\/v1\/?$/, '') + value;
    return '';
  },
  onImageError: function(e) { var id = e.currentTarget.dataset.id; this.setData({ list: this.data.list.map(function(item) { return String(item.id) === String(id) ? Object.assign({}, item, { imageFailed: true }) : item }) }); },
  onPreview: function(e) { if (!this.ensureAccess()) return; var row = this.data.list.find(function(item) { return String(item.id) === String(e.currentTarget.dataset.id) }); if (row && row.previewUrl && !row.imageFailed) wx.previewImage({ current: row.previewUrl, urls: [row.previewUrl] }); },
  onViewDetail: function(e) {
    if (!this.ensureAccess()) return;
    var row = this.data.list.find(function(item) { return String(item.id) === String(e.currentTarget.dataset.id) }); if (!row) return;
    dialog.show(this, { title: row.title || '海报申请详情', imageUrl: row.previewUrl, showCancel: false, confirmText: '关闭', sections: [
      { title: '投放申请', items: ['申请人：' + (row.real_name || row.nickname || '未填写'), '申请组织：' + (row.organization || '未填写'), '投放位置：' + (row.position_name || row.position || '未填写'), '投放日期：' + String(row.start_date || '').slice(0,10) + ' 至 ' + String(row.end_date || '').slice(0,10), '联系信息：' + (row.contact_name || '未填写') + ' ' + (row.contact_phone || '')] },
      { title: '内容说明', items: [row.description || '未填写内容说明', row.previewUrl ? '点击海报图片可放大查看。' : '申请人未上传海报图片，可填写理由退回补充。'] }
    ] });
  },
  onApprove: function (e) {
    if (!this.ensureAccess()) return
    var that = this
    var id = e.currentTarget.dataset.id
    if (this.isProcessing(id)) return
    dialog.show(this, {
      title: '通过海报申请',
      content: ((this.data.list.find(function(item) { return String(item.id) === String(id) }) || {}).previewUrl ? '' : '该申请未提供海报图片。') + '确认通过这份海报投放申请？',
      success: function (res) {
        if (!res.confirm) return
        if (!that.ensureAccess() || that.isProcessing(id)) return
        that.submitDecision(id, 'approve', {}, '已通过')
      }
    })
  },

  onReject: function (e) {
    if (!this.ensureAccess()) return
    var that = this
    var id = e.currentTarget.dataset.id
    if (this.isProcessing(id)) return
    dialog.show(this, {
      title: '拒绝海报申请',
      reasons: ['未提供海报图片', '图片内容需调整', '投放时间需调整', '申请信息不完整'],
      content: '请输入拒绝理由',
      editable: true,
      placeholderText: '请说明需要修改的内容',
      success: function (res) {
        if (!res.confirm) return
        if (!that.ensureAccess() || that.isProcessing(id)) return
        var reason = String(res.content || '').trim()
        if (!reason) {
          wx.showToast({ title: '请填写拒绝理由', icon: 'none' })
          return
        }
        that.submitDecision(id, 'reject', { reason: reason }, '已拒绝')
      }
    })
  }
})
