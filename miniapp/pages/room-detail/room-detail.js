var request = require('../../utils/request')
var localData = require('../../utils/local-data')

function getIconKey(type) {
  var map = {
    study_room: 'study',
    study: 'study',
    seminar_room: 'shared',
    shared_space: 'shared',
    seminar: 'shared',
    discussion: 'shared',
    media_room: 'media',
    media: 'media',
    competition_room: 'competition',
    roadshow_space: 'roadshow',
    dance_room: 'dance',
    reading_room: 'reading',
    multi_purpose_hall: 'multi',
    study_center: 'academic',
    career_center: 'career',
    job_studio: 'career',
    party_room: 'party',
    psychology_room: 'psychology'
  }
  return map[type] || 'room'
}

Page({
  data: { room: null, loading: true },
  onLoad: function (options) {
    var roomId = localData.resolveRoomId(options.roomId)
    if (this.isValidRoomId(roomId)) this.loadRoomDetail(roomId)
    else this.setData({ loading: false })
  },
  isValidRoomId: function (roomId) { return Number(roomId) > 0 },
  normalizeRoom: function (data) {
    if (!data) return data
    var openHour = data.openHour
    var closeHour = data.closeHour
    if (data.open_start_time) openHour = parseInt(data.open_start_time.split(':')[0]) || 8
    if (data.open_end_time) closeHour = parseInt(data.open_end_time.split(':')[0]) || 23
    var devices = data.devices || []
    if (!devices.length && data.facilities) devices = typeof data.facilities === 'string' ? data.facilities.split(',').filter(function (f) { return f }) : (data.facilities || [])
    var name = data.name || ''
    return { id: localData.resolveRoomId(data.id || data.room_id || data.roomId || data.room_number || data.name), name: name, iconKey: getIconKey(data.type || ''), icon: data.icon || '', roomNumber: data.room_number || data.roomNumber || '', building: data.building || data.location || '', capacity: data.capacity || 0, openHour: openHour || 8, closeHour: closeHour || 23, openTimeDisplay: data.open_start_time || ((openHour || 8) < 10 ? '0' + (openHour || 8) : '' + (openHour || 8)) + ':00', closeTimeDisplay: data.open_end_time || ((closeHour || 23) < 10 ? '0' + (closeHour || 23) : '' + (closeHour || 23)) + ':00', devices: devices, rules: data.rules || data.management_rules || '', type: data.type || '', status: data.status || '', need_counselor: data.need_counselor || data.need_counselor_audit || false }
  },
  loadRoomDetail: function (roomId) { var that = this; request.get('/room/' + roomId).then(function (data) { that.applyRoom(data) }).catch(function () { that.applyRoom(localData.getRoomById(roomId)) }) },
  applyRoom: function (data) {
    if (!data) { this.setData({ loading: false }); return }
    var room = this.normalizeRoom(data)
    this.setData({ room: room, loading: false })
    wx.setNavigationBarTitle({ title: room.name || '功能房详情' })
  },
  onReserveTap: function () {
    var room = this.data.room
    if (!room || !this.isValidRoomId(room.id)) { wx.showToast({ title: '房间信息未准备好，请稍后再试', icon: 'none' }); return }
    if (room.type === 'study' || room.type === 'study_room') wx.navigateTo({ url: '/pages/study-room/study-room?roomId=' + room.id })
    else wx.navigateTo({ url: '/pages/room-timeline/room-timeline?roomId=' + room.id })
  },
  onGroupTap: function () {
    var room = this.data.room
    if (!room || !this.isValidRoomId(room.id)) { wx.showToast({ title: '房间信息未准备好，请稍后再试', icon: 'none' }); return }
    if (!(room.status === 'open' || room.status === 'active')) { wx.showToast({ title: '该功能房当前未开放', icon: 'none' }); return }
    wx.navigateTo({ url: '/pages/group-reserve/group-reserve?roomId=' + room.id })
  },
  onViewRules: function () { wx.navigateTo({ url: '/pages/rules/rules?type=' + (this.data.room ? this.data.room.type : '') }) },
  onCompareTap: function () { if (this.data.room) wx.navigateTo({ url: '/pages/room-compare/room-compare?roomId=' + this.data.room.id }) }
})
