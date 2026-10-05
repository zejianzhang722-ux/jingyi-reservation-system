var auth = require('./auth')
var request = require('./request')
function key() { return 'mini_' + Date.now() + '_' + Math.random().toString(36).slice(2) }
var labels = { ready: '待确认', passed: '签到成功', duplicate: '已签到', exception: '现场异常', rejected: '核验失败' }
var statusLabels = { approved: '待签到', checked_in: '使用中 · 已签到', completed: '已完成', pending: '待审核', pending_counselor: '待辅导员审核', cancelled: '已取消', rejected: '未通过', noshow: '未到场' }
function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) }
module.exports = function (section) { return {
  data: { me: null, credential: '', result: null, identity: false, note: '', busy: false, error: '', records: [], page: 1, total: 0, reservationId: '', outcomeIndex: 0, outcomes: ['全部', '签到成功', '重复核验', '现场异常', '核验失败'], canResolve: false, uncertain: false },
  onLoad: function () {
    this.setData({ section: section, sectionTitle: { home: '宿管工作台', reservations: '预约查询', scan: '扫码办理签到', records: '签到记录', spaces: '空间监控' }[section], spaces: [], spaceFilter: 0, spaceFilters: ['全部房间', '使用中', '待签到', '无使用记录', '未开放'], spaceSearch: '', spaceError: '' })
    if (!auth.isLoggedIn() || !auth.isAdmin()) { wx.reLaunch({ url: '/pages/login/login' }); return }
    var self = this
    this.setData({ reservationDate: today(), reservations: [], reservationPage: 1, reservationTotal: 0, reservationSearch: '', reservationStatusIndex: 0, reservationStatuses: ['全部预约', '待签到', '使用中 · 已签到', '已完成'], summary: { total: 0, waiting: 0, checkedIn: 0, finished: 0 }, reservationError: '' })
    request.get('/verification/me').then(function (me) { self.setData({ me: me, canResolve: me.canResolve }); self.refreshSection() }).catch(function (e) { self.setData({ error: e.message || '岗位权限加载失败，请重新登录' }) })
  },
  openSection: function (e) { var paths = { reservations: 'dorm-reservations', scan: 'dorm-scan', records: 'dorm-records', spaces: 'dorm-spaces' }; var next = paths[e.currentTarget.dataset.section]; if (next) wx.navigateTo({ url: '/pages/' + next + '/' + next }) },
  refreshSection: function () { if (!this.data.me) return Promise.resolve(); return section === 'spaces' ? this.loadSpaces() : section === 'records' ? this.loadRecords(true) : (section === 'home' || section === 'reservations') ? this.loadReservations() : Promise.resolve() },
  loadSpaces: function () { var self = this; return request.get('/verification/spaces', {}, { silent: true }).then(function (r) { self._spaces = r.list; self.setData({ spaceSummary: r.summary, spaceUpdatedAt: new Date(r.updatedAt).toLocaleTimeString(), spaceError: '' }); self.filterSpaces() }).catch(function () { self.setData({ spaceError: '空间状态更新失败，请刷新；仍失败请联系书院导生会会长团' }) }) },
  spaceFilterChange: function (e) { this.setData({ spaceFilter: Number(e.detail.value) }); this.filterSpaces() },
  filterSpaces: function () { var status = ['', 'in_use', 'awaiting', 'idle', 'closed'][this.data.spaceFilter], search = this.data.spaceSearch.trim().toLowerCase(); this.setData({ spaces: (this._spaces || []).filter(function (room) { return (!status || room.state === status) && (!search || (room.name + ' ' + room.location).toLowerCase().indexOf(search) >= 0) }) }) },
  onShow: function () { var self = this; this._visible = true; this.refreshSection(); clearInterval(this._timer); this._timer = setInterval(function () { if (self._visible) self.refreshSection() }, 15000) },
  onHide: function () { this._visible = false; clearInterval(this._timer) },
  onUnload: function () { this.onHide() },
  onPullDownRefresh: function () { this.refreshSection().finally(function () { wx.stopPullDownRefresh() }) },
  reservationDateChange: function (e) { this.setData({ reservationDate: e.detail.value, reservationPage: 1 }); this.loadReservations() },
  reservationStatusChange: function (e) { this.setData({ reservationStatusIndex: Number(e.detail.value), reservationPage: 1 }); this.loadReservations() },
  searchReservations: function () { this.setData({ reservationPage: 1 }); this.loadReservations() },
  previousReservations: function () { if (this.data.reservationPage > 1) { this.setData({ reservationPage: this.data.reservationPage - 1 }); this.loadReservations() } },
  nextReservations: function () { if (this.data.reservationPage * 6 < this.data.reservationTotal) { this.setData({ reservationPage: this.data.reservationPage + 1 }); this.loadReservations() } },
  loadReservations: function () {
    if (!this.data.reservationDate) return Promise.resolve()
    var self = this; var version = this._reservationVersion = (this._reservationVersion || 0) + 1
    return request.get('/verification/reservations', { date: this.data.reservationDate, status: ['', 'approved', 'checked_in', 'completed'][this.data.reservationStatusIndex], q: this.data.reservationSearch, page: this.data.reservationPage, pageSize: 6 }, { silent: true }).then(function (r) {
      if (version !== self._reservationVersion) return
      self.setData({ reservations: r.list.map(function (item) { item.label = statusLabels[item.status] || item.status; return item }), reservationTotal: r.total, summary: r.summary || { total: 0, waiting: 0, checkedIn: 0, finished: 0 }, reservationError: '' })
    }).catch(function () { if (version === self._reservationVersion) self.setData({ reservations: [], reservationError: '预约加载失败，请下拉刷新' }) })
  },
  input: function (e) { var next = {}; next[e.currentTarget.dataset.field] = e.detail.value; this.setData(next) },
  identity: function (e) { this.setData({ identity: e.detail.value.indexOf('yes') >= 0 }) },
  scan: function () {
    if (this.data.busy || this.data.uncertain) return
    var self = this
    wx.scanCode({ onlyFromCamera: true, scanType: ['qrCode'], success: function (r) { self.setData({ credential: r.result }); self.preview() }, fail: function (e) {
      if (String(e.errMsg).indexOf('cancel') >= 0) return
      self.setData({ error: '扫码失败，请允许使用相机并重扫宿生最新预约码；仍失败请联系书院导生会会长团' })
      request.post('/verification/failure', { requestId: key(), reason: 'scan_failed' }, { silent: true }).catch(function () {})
    } })
  },
  preview: function () {
    if (this.data.busy || !this.data.credential.trim()) return
    if (this.data.uncertain) { this.setData({ error: '请先重试上次操作，确认签到结果' }); return }
    var self = this
    this._credential = this.data.credential.trim(); this._pending = null
    this.setData({ busy: true, error: '', result: null, identity: false, note: '' })
    request.post('/verification/preview', { credential: this._credential, requestId: key() }).then(function (r) { self.setData({ result: r }) }).catch(function (e) { self.setData({ error: e.message || '读取失败，请重试' }) }).finally(function () { self.setData({ busy: false }); self.loadRecords() })
  },
  pass: function () { this.confirm('pass') },
  exception: function () { this.confirm('exception') },
  retry: function () { if (this._pending) this.send(this._pending) },
  confirm: function (decision) {
    if (this.data.busy || this.data.uncertain) return
    if (decision === 'pass' && (!this.data.identity || !this.data.result || !this.data.result.eligible || this.data.result.verified)) return
    if (decision === 'exception' && this.data.note.trim().length < 2) { this.setData({ error: '请填写至少两字的异常说明' }); return }
    var self = this
    this._pending = { credential: this._credential, requestId: key(), identityConfirmed: this.data.identity, decision: decision, note: this.data.note.trim() }
    if (decision === 'exception') { this.send(this._pending); return }
    this.setData({ busy: true })
    wx.getLocation({ type: 'wgs84', success: function (r) { self._pending.location = { latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy } }, complete: function () { self.setData({ busy: false }); self.send(self._pending) } })
  },
  send: function (payload) {
    if (this.data.busy) return
    var self = this; this.setData({ busy: true, error: '' })
    request.post('/verification/confirm', payload).then(function (r) { self._pending = null; self.setData({ result: r, uncertain: false }); wx.showToast({ title: r.checkedIn ? '已签到' : '结果已登记', icon: 'none' }) }).catch(function (e) { self.setData({ uncertain: true, error: '未确认提交结果，请点击重试查询原结果：' + (e.message || '网络异常') }) }).finally(function () { self.setData({ busy: false }); self.loadRecords(); self.loadReservations() })
  },
  filter: function (e) { this.setData({ outcomeIndex: Number(e.detail.value), page: 1 }); this.loadRecords() },
  search: function () { this.setData({ page: 1 }); this.loadRecords() },
  previous: function () { if (this.data.page > 1) { this.setData({ page: this.data.page - 1 }); this.loadRecords() } },
  next: function () { if (this.data.page * 20 < this.data.total) { this.setData({ page: this.data.page + 1 }); this.loadRecords() } },
  loadRecords: function (silent) {
    var self = this; var version = this._version = (this._version || 0) + 1
    return request.get('/verification/records', { page: this.data.page, outcome: ['', 'passed', 'duplicate', 'exception', 'rejected'][this.data.outcomeIndex], reservationId: this.data.reservationId }, { silent: true }).then(function (r) {
      if (version !== self._version) return
      self.setData({ records: r.list.map(function (row) { row.label = labels[row.outcome]; row.needsResolve = ['exception', 'rejected'].indexOf(row.outcome) >= 0 && !row.resolvedAt; return row }), total: r.total })
    }).catch(function () { if (!silent) self.setData({ error: '记录查询失败，请下拉刷新重试' }) })
  },
  resolve: function (e) {
    if (!this.data.canResolve) return
    var self = this; var id = e.currentTarget.dataset.id
    wx.showModal({ title: '跟进异常', editable: true, placeholderText: '填写处理经过和结论（2至500字）', success: function (r) { if (r.confirm && r.content && r.content.trim().length >= 2) request.post('/verification/records/' + id + '/resolve', { note: r.content.trim() }).then(function () { self.loadRecords() }) } })
  },
  logout: function () { auth.logout() }
} }
