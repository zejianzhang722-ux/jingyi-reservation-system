var request = require('../../utils/request')
var util = require('../../utils/util')
var localData = require('../../utils/local-data')

function getIconKey(type) {
  var map = {
    study_room: 'study',
    study: 'study',
    seminar_room: 'shared',
    shared_space: 'shared',
    seminar: 'shared',
    media_room: 'media',
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
  data: {
    type: '',
    keyword: '',
    typeName: '',
    rooms: [],
    loading: true,
    isOffline: false
  },

  onLoad: function (options) {
    var type = options.type ? decodeURIComponent(options.type) : ''
    var keyword = options.keyword ? decodeURIComponent(options.keyword) : ''
    var title = options.title ? decodeURIComponent(options.title) : ''
    this.setData({
      type: type,
      keyword: keyword,
      typeName: title || util.getRoomTypeName(type)
    })
    wx.setNavigationBarTitle({
      title: keyword ? '搜索: ' + keyword : (title || '功能房列表')
    })
    this.initLocalRooms()
    this.fetchRemoteRooms()
  },

  onPullDownRefresh: function () {
    this.fetchRemoteRooms()
    wx.stopPullDownRefresh()
  },

  initLocalRooms: function () {
    var rooms = this.enhanceRooms(localData.filterLocalRooms(this.data.type, this.data.keyword))
    this.setData({
      rooms: rooms,
      loading: false,
      isOffline: true
    })
  },

  fetchRemoteRooms: function () {
    var that = this
    var params = {}
    if (this.data.keyword) params.keyword = this.data.keyword

    request.get('/room', params, { silent: true }).then(function (data) {
      var rooms = Array.isArray(data) ? data : []
      if (rooms.length === 0 && !that.data.keyword) return
      rooms = that.filterRooms(that.enhanceRooms(rooms))
      that.setData({
        rooms: rooms,
        loading: false,
        isOffline: false
      })
    }).catch(function () {})
  },

  enhanceRooms: function (rooms) {
    return (rooms || []).map(function (r) {
      var room = Object.assign({}, r)
      room.typeColor = localData.getTypeColor(r.type) || '#1890FF'
      room.facilities = room.facilities || ''
      room.facilityList = room.facilities ? room.facilities.split(',').filter(function (item) { return item }) : []
      room.statusText = room.status === 'open' || room.status === 'active' ? '开放' : '关闭'
      room.openTimeText = (room.open_start_time || '08:00') + '-' + (room.open_end_time || '22:00')
      room.capacityText = room.capacity ? room.capacity + '人' : '未设置'
      room.iconKey = getIconKey(room.type)
      return room
    })
  },

  filterRooms: function (rooms) {
    if (this.data.type && !this.data.keyword) {
      var types = this.data.type.split(',')
      var typeMap = localData.getTypeMap()
      var allTypes = []
      types.forEach(function (t) {
        if (typeMap[t]) {
          allTypes = allTypes.concat(typeMap[t].types)
        } else {
          allTypes.push(t)
        }
      })
      rooms = rooms.filter(function (r) {
        return allTypes.indexOf(r.type) !== -1
      })
    }
    if (this.data.keyword) {
      var kw = this.data.keyword.toLowerCase()
      rooms = rooms.filter(function (r) {
        return (r.name && r.name.toLowerCase().indexOf(kw) !== -1) ||
               (r.description && r.description.toLowerCase().indexOf(kw) !== -1) ||
               (r.location && r.location.toLowerCase().indexOf(kw) !== -1)
      })
    }
    return rooms
  },

  onRoomTap: function (e) {
    var roomId = e.currentTarget.dataset.id
    if (!roomId) return
    wx.navigateTo({ url: '/pages/room-detail/room-detail?roomId=' + roomId })
  }
})
