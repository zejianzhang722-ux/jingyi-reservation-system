var request = require('../../utils/request')
var auth = require('../../utils/auth')
var policy = require('../../utils/admin-policy')
var dialog = require('../../utils/dialog')
var STATUS = { open: '开放中', closed: '已关闭', maintenance: '维护中', counselor_only: '联系辅导员预约' }
Page({
  data: { roomId: 0, room: null, reservations: [], loading: true, error: '', canConfigure: false, saving: false },
  hasAccess: function() { return auth.isLoggedIn() && policy.can(auth.getUserRole(), 'roomView') },
  ensureAccess: function() { if (this.hasAccess()) return true; this.setData({ room: null, reservations: [] }); wx.reLaunch({ url: '/pages/login/login' }); return false },
  onLoad: function(options) { this.setData({ roomId: Number(options.roomId) }); },
  onShow: function() { if (this.ensureAccess()) return this.loadData() },
  loadData: function() {
    var that = this; this._version = (this._version || 0) + 1; var version = this._version;
    this.setData({ loading: true, error: '', canConfigure: auth.getUserRole() === 'super_admin' });
    return request.get('/admin/rooms/' + this.data.roomId, {}, { silent: true }).then(function(room) {
      if (version !== that._version || !that.ensureAccess()) return;
      room.baseStatusLabel = STATUS[room.baseStatus];
      room.statusSchedules = (room.statusSchedules || []).map(function(row) { return Object.assign({}, row, { statusLabel: STATUS[row.status] }) });
      room.statusLabel = STATUS[room.status] || '状态待确认';
      room.opening = String(room.open_start_time || '').slice(0,5) + '–' + String(room.open_end_time || '').slice(0,5);
      that.setData({ room: room, loading: false });
    }).catch(function(err) { if (version === that._version) that.setData({ loading: false, error: err.message || '空间详情加载失败' }) });
  },
  onRetry: function() { if (this.ensureAccess()) return this.loadData() },
  onViewReservations: function() {
    if (!this.ensureAccess()) return;
    wx.navigateTo({ url: '/pages/admin-reservation/admin-reservation?roomId=' + this.data.roomId + '&roomName=' + encodeURIComponent(this.data.room.name) });
  },
  onSchedule: function() {
    if (!this.ensureAccess()) return;
    var that = this, date = require('../../utils/util').formatDate(new Date(), 'YYYY-MM-DD');
    request.get('/room/' + this.data.roomId + '/timeline', { date: date }).then(function(data) {
      if (!that.ensureAccess()) return;
      var labels = { available: '可用', occupied: '已预约', checked_in: '使用中', unavailable: '不接受系统预约', myReservation: '已预约' };
      dialog.show(that, { title: '今日时段安排', showCancel: false, confirmText: '关闭', sections: [{ title: date, items: (data.timeline || []).map(function(slot) { return slot.time + '–' + slot.endTime + ' · ' + (labels[slot.status] || '不可用') + (slot.userName ? ' · ' + slot.userName : '') }) }] });
    });
  },
  onStatus: function() {
    if (!this.ensureAccess() || auth.getUserRole() !== 'super_admin' || this.data.saving) return;
    var that = this;
    wx.showActionSheet({ itemList: ['修改长期状态（全部时间段）', '新增定时状态'], success: function(result) {
      that.openStatusForm(result.tapIndex === 1);
    } });
  },
  openStatusForm: function(timed) {
    if (!this.ensureAccess() || auth.getUserRole() !== 'super_admin') return;
    var that = this, room = this.data.room, date = require('../../utils/util').formatDate(new Date(), 'YYYY-MM-DD');
    var state = room.baseStatus || 'open';
    var fields = [{ key: 'status', label: '空间状态', type: 'select', options: Object.keys(STATUS).map(function(value) { return { value: value, label: STATUS[value] } }), value: state, selectedLabel: STATUS[state], required: true }];
    if (timed) fields = fields.concat([
      { key: 'startDate', label: '开始日期', type: 'date', value: date, required: true },
      { key: 'startTime', label: '开始时间', type: 'time', value: '08:00', required: true },
      { key: 'endDate', label: '结束日期', type: 'date', value: date, required: true },
      { key: 'endTime', label: '结束时间', type: 'time', value: '22:00', required: true }
    ]);
    dialog.show(this, { title: timed ? '新增定时状态' : '修改长期状态', content: timed ? '到指定时间自动生效，结束后恢复长期状态。已有预约保留，请按需处理。' : '立即修改长期状态；已有定时安排仍在所选时段生效，可在下方取消。', fields: fields, confirmText: '保存', success: function(result) {
      if (!result.confirm) return;
      var v = result.values;
      if (!timed) return that.saveRoom({ status: v.status });
      var startAt = v.startDate + ' ' + v.startTime, endAt = v.endDate + ' ' + v.endTime;
      if (startAt >= endAt) throw new Error('结束日期、时间须晚于开始');
      var rows = (room.statusSchedules || []).map(function(row) { return { status: row.status, startAt: row.startAt, endAt: row.endAt } });
      rows.push({ status: v.status, startAt: startAt, endAt: endAt });
      return that.saveRoom({ statusSchedules: rows });
    } });
  },
  onCancelStatusSchedule: function(e) {
    if (!this.ensureAccess() || auth.getUserRole() !== 'super_admin') return;
    var that = this, index = Number(e.currentTarget.dataset.index);
    dialog.show(this, { title: '取消定时安排', content: '取消后，这个时段将按长期状态执行。', success: function(result) {
      if (result.confirm) return that.saveRoom({ statusSchedules: that.data.room.statusSchedules.filter(function(row, i) { return i !== index }).map(function(row) { return { status: row.status, startAt: row.startAt, endAt: row.endAt } }) });
    } });
  },
  onEdit: function() {
    if (!this.ensureAccess() || auth.getUserRole() !== 'super_admin') return;
    var that = this, room = this.data.room;
    dialog.show(this, { title: '编辑空间信息', confirmText: '保存', fields: [
      { key: 'name', label: '空间名称', value: room.name, required: true },
      { key: 'capacity', label: '容纳人数', type: 'number', min: 1, max: 10000, value: room.capacity, required: true },
      { key: 'openStartTime', label: '开放时间', type: 'time', value: String(room.open_start_time).slice(0,5), required: true },
      { key: 'openEndTime', label: '关闭时间', type: 'time', value: String(room.open_end_time).slice(0,5), required: true }
    ], success: function(result) {
      if (!result.confirm) return;
      var v = result.values;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.openStartTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.openEndTime) || v.openStartTime >= v.openEndTime) throw new Error('请填写有效时间，关闭时间须晚于开放时间');
      return that.saveRoom({ name: v.name, capacity: Number(v.capacity), openStartTime: v.openStartTime, openEndTime: v.openEndTime });
    } });
  },
  saveRoom: function(body) {
    if (!this.ensureAccess() || auth.getUserRole() !== 'super_admin' || this.data.saving) return Promise.reject(new Error('当前账号无法修改空间'));
    var that = this; this.setData({ saving: true });
    return request.put('/admin/rooms/' + this.data.roomId, body).then(function() { wx.showToast({ title: '已保存', icon: 'success' }); return that.loadData() }).finally(function() { that.setData({ saving: false }) });
  }
})
