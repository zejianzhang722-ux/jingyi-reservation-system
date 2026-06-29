var request = require('../../utils/request')
var auth = require('../../utils/auth')

function pad(value) { return value < 10 ? '0' + value : '' + value }
function formatDate(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) }
function defaultStartDate() { var d = new Date(); d.setDate(d.getDate() - 30); return formatDate(d) }
function todayDate() { return formatDate(new Date()) }
function formatPercent(value) { var n = Number(value); if (isNaN(n)) return '0%'; return n + '%' }
function pickList(data) { if (Array.isArray(data)) return data; return (data && (data.list || data.reservations || data.items || data.records)) || [] }
function pickCount(data) { if (!data) return 0; if (typeof data.pendingCount === 'number') return data.pendingCount; if (typeof data.count === 'number') return data.count; if (typeof data.total === 'number') return data.total; return 0 }
function mapPendingItem(row) { return { id: row.id, tag: row.status === 'counselor_pending' ? '辅导员审核' : '待审核', text: (row.userName || row.user_name || row.real_name || '') + ' 申请 ' + (row.roomName || row.room_name || '') + (row.purpose ? ' - ' + row.purpose : ''), time: row.date + ' ' + row.start_time } }
function htmlCell(value) { return '<td>' + String(value === undefined || value === null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</td>' }
function buildExcelHtml(rows) { return '<html><head><meta charset="utf-8"></head><body><table border="1">' + rows.map(function (row) { return '<tr>' + row.map(htmlCell).join('') + '</tr>' }).join('') + '</table></body></html>' }
function writeAndOpenExcel(filename, rows) { var fs = wx.getFileSystemManager(); var path = wx.env.USER_DATA_PATH + '/' + filename; fs.writeFile({ filePath: path, data: buildExcelHtml(rows), encoding: 'utf8', success: function () { wx.openDocument({ filePath: path, fileType: 'xls', showMenu: true, success: function () { wx.showToast({ title: '已生成Excel', icon: 'success' }) }, fail: function () { wx.showToast({ title: '文件已生成', icon: 'none' }) } }) }, fail: function () { wx.showToast({ title: '导出失败', icon: 'none' }) } }) }
function statusLabel(status) { var map = { pending: '待审核', counselor_pending: '辅导员审核', approved: '已通过', checked_in: '使用中', completed: '已完成', cancelled: '已取消', noshow: '爽约', rejected: '已拒绝', active: '正常', banned: '封禁' }; return map[status] || status || '' }
function exportTypeLabel(type) { var map = { reservations: '预约明细', users: '宿生数据', violations: '违规记录' }; return map[type] || '统计数据' }
function rowDate(row, type) { var value = type === 'users' ? row.created_at : (row.date || row.created_at); return String(value || '').slice(0, 10) }
function filterRows(rows, filters) { return (rows || []).filter(function (row) { var date = rowDate(row, filters.exportType); if (date && filters.startDate && date < filters.startDate) return false; if (date && filters.endDate && date > filters.endDate) return false; if (filters.exportType === 'reservations' && filters.status && String(row.status || '') !== String(filters.status)) return false; return true }) }
function rowsForExport(type, rows, filters) {
  var title = exportTypeLabel(type)
  var result = [[title], ['导出时间', formatDate(new Date())], ['筛选日期', filters.startDate + ' 至 ' + filters.endDate], ['状态筛选', filters.status ? statusLabel(filters.status) : '全部'], []]
  if (type === 'users') {
    result.push(['ID', '学号', '姓名', '学院', '信用分', '状态', '创建时间'])
    rows.forEach(function (r) { result.push([r.id, r.student_id || r.student_no || '', r.real_name || r.name || '', r.college || '', r.credit_score || '', statusLabel(r.status), r.created_at || '']) })
  } else if (type === 'violations') {
    result.push(['ID', '学号', '姓名', '违规类型', '描述', '扣分', '时间'])
    rows.forEach(function (r) { result.push([r.id, r.student_id || '', r.real_name || '', r.type || '', r.description || '', r.score || '', r.created_at || '']) })
  } else {
    result.push(['ID', '学号', '姓名', '功能房', '日期', '开始时间', '结束时间', '状态', '用途', '创建时间'])
    rows.forEach(function (r) { result.push([r.id, r.student_id || '', r.real_name || '', r.room_name || '', r.date || '', r.start_time || '', r.end_time || '', statusLabel(r.status), r.purpose || '', r.created_at || '']) })
  }
  return result
}

Page({
  data: {
    loading: true,
    exporting: false,
    filters: { startDate: defaultStartDate(), endDate: todayDate(), exportType: 'reservations', status: '' },
    exportTypeIndex: 0,
    statusIndex: 0,
    exportTypeOptions: [
      { value: 'reservations', label: '预约明细' },
      { value: 'users', label: '宿生数据' },
      { value: 'violations', label: '违规记录' }
    ],
    statusOptions: [
      { value: '', label: '全部状态' },
      { value: 'pending', label: '待审核' },
      { value: 'counselor_pending', label: '辅导员审核' },
      { value: 'approved', label: '已通过' },
      { value: 'checked_in', label: '使用中' },
      { value: 'completed', label: '已完成' },
      { value: 'cancelled', label: '已取消' },
      { value: 'noshow', label: '爽约' },
      { value: 'rejected', label: '已拒绝' }
    ],
    dashboard: { todayReservations: 0, pendingCount: 0, usingCount: 0, noshowCount: 0, usageRanking: { rooms: [], rates: [] }, roomTypeStats: [], pendingItems: [] },
    usageRows: [],
    noshow: { totalNoshow: 0, topNoshowUsers: [], roomNoshowStats: [] },
    creditDistribution: []
  },

  onLoad: function () { if (!this.ensureAdmin()) return; this.loadData() },
  ensureAdmin: function () { if (!auth.isLoggedIn() || !auth.isAdmin()) { wx.reLaunch({ url: '/pages/login/login' }); return false } return true },
  queryParams: function () { return { startDate: this.data.filters.startDate, endDate: this.data.filters.endDate } },

  loadData: function () {
    var that = this
    var params = this.queryParams()
    this.setData({ loading: true })
    Promise.all([
      request.get('/stats/dashboard', params, { silent: true }),
      request.get('/stats/usage-rate', params, { silent: true }),
      request.get('/stats/noshow', params, { silent: true }),
      request.get('/stats/users', params, { silent: true }),
      request.get('/reservation/pending-count', {}, { silent: true }),
      request.get('/reservation/pending', {}, { silent: true })
    ]).then(function (results) {
      var dashboard = results[0] || {}
      var days = Math.max(1, Math.ceil((new Date(that.data.filters.endDate) - new Date(that.data.filters.startDate)) / 86400000) || 30)
      var usageRows = (results[1] || []).slice(0, 8).map(function (item) { return Object.assign({}, item, { displayRate: formatPercent(Math.min(100, Math.round((Number(item.reservation_count) || 0) / days * 100))) }) })
      var userStats = results[3] || {}
      var pendingList = pickList(results[5])
      dashboard.pendingCount = pickCount(results[4])
      dashboard.pendingItems = pendingList.slice(0, 10).map(mapPendingItem)
      that.setData({ loading: false, dashboard: Object.assign({}, that.data.dashboard, dashboard), usageRows: usageRows, noshow: results[2] || that.data.noshow, creditDistribution: userStats.creditDistribution || [] })
    }).catch(function () { that.setData({ loading: false }); wx.showToast({ title: '统计数据加载失败', icon: 'none' }) })
  },

  onStartDateChange: function (e) { this.setData({ 'filters.startDate': e.detail.value }); if (this.data.filters.startDate > this.data.filters.endDate) this.setData({ 'filters.endDate': e.detail.value }); this.loadData() },
  onEndDateChange: function (e) { this.setData({ 'filters.endDate': e.detail.value }); if (this.data.filters.endDate < this.data.filters.startDate) this.setData({ 'filters.startDate': e.detail.value }); this.loadData() },
  onExportTypeChange: function (e) { var index = Number(e.detail.value) || 0; var option = this.data.exportTypeOptions[index] || this.data.exportTypeOptions[0]; this.setData({ exportTypeIndex: index, 'filters.exportType': option.value, statusIndex: option.value === 'reservations' ? this.data.statusIndex : 0, 'filters.status': option.value === 'reservations' ? this.data.filters.status : '' }) },
  onStatusChange: function (e) { var index = Number(e.detail.value) || 0; var option = this.data.statusOptions[index] || this.data.statusOptions[0]; this.setData({ statusIndex: index, 'filters.status': option.value }) },
  onResetFilters: function () { this.setData({ filters: { startDate: defaultStartDate(), endDate: todayDate(), exportType: 'reservations', status: '' }, exportTypeIndex: 0, statusIndex: 0 }); this.loadData() },

  onExport: function () {
    var that = this
    if (this.data.exporting) return
    var filters = Object.assign({}, this.data.filters)
    if (!filters.startDate || !filters.endDate || filters.startDate > filters.endDate) { wx.showToast({ title: '请选择有效日期范围', icon: 'none' }); return }
    var params = { type: filters.exportType, startDate: filters.startDate, endDate: filters.endDate }
    this.setData({ exporting: true })
    request.get('/stats/export', params, { silent: true }).then(function (data) {
      var rows = filterRows(data.rows || [], filters)
      if (!rows.length) { that.setData({ exporting: false }); wx.showToast({ title: '当前筛选无可导出数据', icon: 'none' }); return }
      writeAndOpenExcel('数据统计-' + exportTypeLabel(filters.exportType) + '-' + filters.startDate + '_' + filters.endDate + '.xls', rowsForExport(filters.exportType, rows, filters))
      that.setData({ exporting: false })
    }).catch(function (err) { that.setData({ exporting: false }); wx.showToast({ title: err && err.message ? err.message : '导出失败', icon: 'none' }) })
  },

  onRefresh: function () { this.loadData() }
})