var dialog = require('../../utils/dialog')
var request = require('../../utils/request')
var auth = require('../../utils/auth')
var adminPolicy = require('../../utils/admin-policy')

var violationTab = { key: 'violations', name: '违规记录' }
var blacklistTab = { key: 'blacklist', name: '黑名单' }

Page({
  data: {
    activeTab: 'violations',
    tabs: [violationTab],
    violations: [],
    blacklist: [],
    loading: true, keyword: '', filterIndex: 0, filteredViolations: [], filteredBlacklist: [], page: 1, total: 0, hasMore: false, setting: false,
    violationOptions: [{key:'',label:'全部违规类型'},{key:'noshow',label:'预约爽约'},{key:'violation',label:'违规使用'},{key:'poster_violation',label:'海报违规'}],
    creditOptions: [{key:'',label:'全部信用区间'},{key:'warning',label:'60–79分'},{key:'restricted',label:'30–59分'},{key:'strict',label:'0–29分'},{key:'legacy',label:'历史限制记录'}]
  },

  onLoad: function (options) {
    if (!this.ensureAdmin()) return
    var requestedTab = options && options.tab
    this.syncRoleTabs(requestedTab)
    return this.loadData()
  },

  onShow: function () {
    if (!this.ensureAdmin()) return
    if (this.syncRoleTabs()) return this.loadData()
  },

  hasCapability: function (capability) {
    return auth.isLoggedIn() && auth.isAdmin() && adminPolicy.can(auth.getUserRole(), capability)
  },

  invalidateReads: function () {
    this._readVersion = (this._readVersion || 0) + 1
  },

  beginRead: function () {
    this.invalidateReads()
    return this._readVersion
  },

  syncRoleTabs: function (requestedTab) {
    var canManageBlacklist = this.hasCapability('blacklistManage')
    var tabs = canManageBlacklist ? [violationTab, blacklistTab] : [violationTab]
    var currentTab = requestedTab || this.data.activeTab
    var activeTab = tabs.some(function (tab) { return tab.key === currentTab }) ? currentTab : 'violations'
    var previousKeys = this.data.tabs.map(function (tab) { return tab.key }).join(',')
    var nextKeys = tabs.map(function (tab) { return tab.key }).join(',')
    var changed = previousKeys !== nextKeys || this.data.activeTab !== activeTab
    var nextData = { tabs: tabs, activeTab: activeTab }
    if (!canManageBlacklist) { nextData.blacklist = []; nextData.filteredBlacklist = [] }
    if (changed) {
      this.invalidateReads()
      nextData.loading = false
    }
    this.setData(nextData)
    return changed
  },

  clearForLostCapability: function (capability) {
    if (capability === 'blacklistManage' && this.hasCapability('violationView')) {
      this.syncRoleTabs()
      this.setData({ blacklist: [], filteredBlacklist: [], loading: false })
      return
    }
    this.invalidateReads()
    this.setData({ violations: [], blacklist: [], filteredViolations: [], filteredBlacklist: [], loading: false, tabs: [violationTab], activeTab: 'violations' })
  },

  canApplyRead: function (version, capability) {
    if (!this.hasCapability(capability)) {
      this.clearForLostCapability(capability)
      return false
    }
    return version === this._readVersion
  },

  ensureAdmin: function () {
    if (!this.hasCapability('violationView')) {
      this.clearForLostCapability('violationView')
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  onTabTap: function (e) {
    if (!this.ensureAdmin()) return
    this.syncRoleTabs()
    var key = e.currentTarget.dataset.key
    var visible = this.data.tabs.some(function (tab) { return tab.key === key })
    this.setData({ activeTab: visible ? key : 'violations', filterIndex: 0, page: 1 })
    return this.loadData()
  },

  loadData: function () {
    if (this.data.activeTab === 'violations') return this.loadViolations()
    if (this.data.activeTab === 'blacklist' && adminPolicy.can(auth.getUserRole(), 'blacklistManage')) return this.loadBlacklist()
    this.setData({ activeTab: 'violations' })
    return this.loadViolations()
  },

  loadViolations: function () {
    var that = this
    var requestVersion = this.beginRead()
    this.setData({ loading: true })
    return request.get('/credit/violations', { page: this.data.page, pageSize: 20, keyword: this.data.keyword, type: this.data.violationOptions[this.data.filterIndex].key }, { silent: true }).then(function (data) {
      if (!that.canApplyRead(requestVersion, 'violationView')) return
      var list = Array.isArray(data) ? data : (data.list || [])
      that.setData({ violations: that.data.page > 1 ? that.data.violations.concat(list) : list, loading: false, total: Number(data.total || list.length), hasMore: list.length === 20 }); that.filterRecords()
    }).catch(function () {
      if (!that.canApplyRead(requestVersion, 'violationView')) return
      that.setData({ violations: [], filteredViolations: [], loading: false })
      wx.showToast({ title: '违规记录加载失败', icon: 'none' })
    })
  },

  loadBlacklist: function () {
    var that = this
    if (!this.hasCapability('blacklistManage')) {
      this.clearForLostCapability('blacklistManage')
      return Promise.resolve()
    }
    var requestVersion = this.beginRead()
    this.setData({ loading: true })
    return request.get('/credit/blacklist', {}, { silent: true }).then(function (data) {
      if (!that.canApplyRead(requestVersion, 'blacklistManage')) return
      that.setData({ blacklist: Array.isArray(data) ? data : [], loading: false }); that.filterRecords()
    }).catch(function () {
      if (!that.canApplyRead(requestVersion, 'blacklistManage')) return
      that.setData({ blacklist: [], filteredBlacklist: [], loading: false })
      wx.showToast({ title: '黑名单加载失败', icon: 'none' })
    })
  },

  onUnban: function (e) {
    if (!this.ensureBlacklistAction()) return
    var that = this
    var id = e.currentTarget.dataset.id
    dialog.show(this, {
      title: '解除限制',
      content: '清理旧规则留下的限制记录；当前预约权限仍按信用分区间执行。',
      success: function (res) {
        if (!res.confirm) return
        if (!that.ensureBlacklistAction()) return
        request.put('/credit/blacklist/' + id, { action: 'unban' }).then(function () {
          wx.showToast({ title: '已解除', icon: 'success' })
          that.loadBlacklist()
        }).catch(function () {
          wx.showToast({ title: '操作失败', icon: 'none' })
        })
      }
    })
  },

  onSearch: function(e) { this.invalidateReads(); this.setData({ keyword: e.detail.value.trim(), page: 1, loading: false, hasMore: false }); if (this.data.activeTab === 'blacklist') this.filterRecords(); },
  onSearchConfirm: function() { this.setData({ page: 1 }); return this.loadData(); },
  onFilterChange: function(e) { this.setData({ filterIndex: Number(e.detail.value), page: 1 }); if (this.data.activeTab === 'blacklist') this.filterRecords(); else return this.loadData(); },
  onMore: function() { if (!this.data.loading && this.data.hasMore) { this.setData({ page: this.data.page + 1 }); return this.loadViolations(); } },
  filterRecords: function() {
    var kw = this.data.keyword.toLowerCase(), key = this.data.creditOptions[this.data.filterIndex] ? this.data.creditOptions[this.data.filterIndex].key : '';
    this.setData({ filteredViolations: this.data.violations, filteredBlacklist: this.data.blacklist.filter(function(row) {
      var score = Number(row.credit_score), match = !key || (key === 'warning' && score >= 60 && score < 80) || (key === 'restricted' && score >= 30 && score < 60) || (key === 'strict' && score < 30) || (key === 'legacy' && !!row.restricted_until);
      return match && (!kw || String((row.real_name || row.nickname || '') + ' ' + row.student_id).toLowerCase().indexOf(kw) !== -1);
    }) });
  },
  onViewCredit: function(e) {
    if (!this.ensureBlacklistAction()) return;
    var that = this, id = e.currentTarget.dataset.userId || e.currentTarget.dataset.id;
    return request.get('/credit/students/' + id).then(function(data) {
      if (!that.ensureBlacklistAction()) return;
      var student = data.student, permission = data.bookingPermission;
      dialog.show(that, { title: '宿生信用详情', showCancel: false, confirmText: '关闭', sections: [
        { title: (student.real_name || '宿生') + ' · ' + student.student_id, items: ['当前信用分：' + student.credit_score, '预约权限：' + (permission.advanceDays ? '可提前' + permission.advanceDays + '天' : '仅当天') + '，每天同类功能房' + permission.dailyLimit + '次', '允许时段：' + (permission.startTime ? permission.startTime + '–' + permission.endTime : '房间开放时间'), '信用分不影响登录'] },
        { title: '最近信用记录', items: data.logs.length ? data.logs.map(function(log) { return String(log.created_at).slice(0,10) + ' · ' + log.description + ' · ' + (Number(log.score_change) > 0 ? '+' : '') + log.score_change + '分' }) : ['暂无信用记录'] }
      ] });
    });
  },
  onSetCredit: function(e) {
    if (!this.ensureBlacklistAction() || this.data.setting) return;
    var that = this, id = e.currentTarget.dataset.id;
    var row = this.data.blacklist.find(function(item) { return String(item.id) === String(id) });
    dialog.show(this, { title: '设置信用与预约权限', content: '按信用分区间调整预约日期、次数和时段，不限制登录。', confirmText: '保存设置', fields: [
      { key: 'studentId', label: '宿生学号', value: row ? row.student_id : '', placeholder: '输入学号查找宿生', required: true },
      { key: 'score', label: '目标信用分', type: 'number', min: 0, max: 120, value: row ? row.credit_score : '', required: true },
      { key: 'reason', label: '调整原因', placeholder: '例如：核实违规后调整', required: true }
    ], success: function(result) {
      if (!result.confirm) return;
      if (!that.ensureBlacklistAction()) throw new Error('当前账号无设置权限');
      that.setData({ setting: true });
      return request.put('/credit/students/' + result.values.studentId, { score: Number(result.values.score), reason: result.values.reason }).then(function() { wx.showToast({ title: '设置已生效', icon: 'success' }); return that.loadData(); }).finally(function() { that.setData({ setting: false }); });
    } });
  },
  ensureBlacklistAction: function () {
    if (!this.hasCapability('blacklistManage')) {
      this.clearForLostCapability('blacklistManage')
      wx.showToast({ title: '请在电脑后台处理此项功能', icon: 'none' })
      wx.reLaunch({ url: auth.isLoggedIn() && auth.isAdmin() ? '/pages/admin-manage/admin-manage' : '/pages/login/login' })
      return false
    }
    return true
  }
})
