var request = require('../../utils/request')
var util = require('../../utils/util')

Page({
  data: {
    roomId: '',
    allRooms: [],
    selectedRooms: [],
    compareResult: [],
    showPicker: false,
    loading: true
  },

  onLoad: function (options) {
    var roomId = options.roomId || ''
    this.setData({ roomId: roomId })
    this.loadAllRooms(roomId)
  },

  normalizeRoom: function (r) {
    if (!r) return r
    var openHour = r.openHour
    var closeHour = r.closeHour
    if (r.open_start_time) {
      openHour = parseInt(r.open_start_time.split(':')[0]) || 8
    }
    if (r.open_end_time) {
      closeHour = parseInt(r.open_end_time.split(':')[0]) || 23
    }
    var devices = r.devices || []
    if (!devices.length && r.facilities) {
      devices = typeof r.facilities === 'string' ? r.facilities.split(',').filter(function (f) { return f }) : (r.facilities || [])
    }
    r.roomNumber = r.room_number || r.roomNumber || ''
    r.openHour = openHour || 8
    r.closeHour = closeHour || 23
    r.devices = devices
    r.freeSlots = r.freeSlots || r.free_slots || 0
    r.totalSlots = r.totalSlots || r.total_slots || 0
    return r
  },

  loadAllRooms: function (roomId) {
    var that = this
    request.get('/room').then(function (data) {
      var rooms = (data || []).map(function (r) { return that.normalizeRoom(r) })
      var selected = []
      if (roomId) {
        var found = rooms.find(function (r) { return r.id === roomId })
        if (found) selected.push(found)
      }
      that.setData({
        allRooms: rooms,
        selectedRooms: selected,
        loading: false
      })
      if (selected.length > 0) {
        that.doCompare()
      }
    }).catch(function () {
      that.setData({ loading: false })
    })
  },

  onAddRoom: function () {
    this.setData({ showPicker: true })
  },

  onPickerSelect: function (e) {
    var index = e.currentTarget.dataset.index
    var room = this.data.allRooms[index]
    var exists = this.data.selectedRooms.find(function (r) { return r.id === room.id })
    if (exists) {
      wx.showToast({ title: '已添加该功能房', icon: 'none' })
      return
    }
    if (this.data.selectedRooms.length >= 3) {
      wx.showToast({ title: '最多对比3个', icon: 'none' })
      return
    }
    var selected = this.data.selectedRooms.concat([room])
    this.setData({ selectedRooms: selected, showPicker: false })
    this.doCompare()
  },

  onRemoveRoom: function (e) {
    var id = e.currentTarget.dataset.id
    var selected = this.data.selectedRooms.filter(function (r) { return r.id !== id })
    this.setData({ selectedRooms: selected })
    this.doCompare()
  },

  onClosePicker: function () {
    this.setData({ showPicker: false })
  },

  doCompare: function () {
    var rooms = this.data.selectedRooms
    if (rooms.length === 0) {
      this.setData({ compareResult: [] })
      return
    }

    var dimensions = [
      { key: 'name', label: '名称' },
      { key: 'roomNumber', label: '房号' },
      { key: 'capacity', label: '容量' },
      { key: 'freeSlots', label: '当前空闲' },
      { key: 'openHour', label: '开放时间' },
      { key: 'devices', label: '设备' }
    ]

    var result = dimensions.map(function (dim) {
      var row = { label: dim.label, values: [] }
      rooms.forEach(function (room) {
        var val = room[dim.key]
        if (dim.key === 'openHour') {
          var oh = room.openHour || 8
          var ch = room.closeHour || 23
          val = (oh < 10 ? '0' + oh : '' + oh) + ':00-' + (ch < 10 ? '0' + ch : '' + ch) + ':00'
        } else if (dim.key === 'devices') {
          val = (room.devices || []).join('、') || '无'
        } else if (dim.key === 'freeSlots') {
          val = (room.freeSlots || 0) + '/' + (room.totalSlots || 0)
        }
        row.values.push(val || '-')
      })
      return row
    })

    this.setData({ compareResult: result })
  }
})
