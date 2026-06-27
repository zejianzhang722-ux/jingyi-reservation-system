var request = require('../../utils/request')
var util = require('../../utils/util')
var localData = require('../../utils/local-data')

Page({
  data: {
    roomId: '',
    room: null,
    selectedDate: '',
    timeline: [],
    seats: [],
    myReservations: [],
    showTimePicker: false,
    selectedStartHour: null,
    selectedStartMin: 0,
    selectedEndHour: null,
    selectedEndMin: 0,
    openHour: 8,
    closeHour: 23,
    maxHours: 4,
    loading: true,
    startHourList: [],
    endHourList: [],
    startHourIndex: 0,
    endHourIndex: 0,
    selectedStartTimeStr: '',
    selectedEndTimeStr: '',
    durationStr: '',
    isStudyRoom: false,
    selectedSeat: null,
    isToday: true,
    showRulesModal: true,
    rulesContent: '',
    rulesScrolledToBottom: false,
    rulesCountdown: 5,
    rulesAgreed: false,
    rulesTimer: null
  },

  onLoad: function (options) {
    var roomIdentity = options.roomId || options.roomName || options.room || options.name || options.roomCode || options.room_number || ''
    var roomId = this.normalizeRoomId(roomIdentity)
    if (!this.ensureRoomIdReady(roomId)) {
      return
    }
    this.setData({ roomId: roomId })
    var roomType = options.roomType ? decodeURIComponent(options.roomType) : ''
    var rulesContent = localData.getRulesByRoomType(roomType)
    this.setData({
      rulesContent: rulesContent,
      showRulesModal: true,
      rulesScrolledToBottom: false,
      rulesCountdown: 5,
      rulesAgreed: false
    })
    this.startRulesCountdown()
    this.loadRoomInfo(roomId)
    var today = util.formatDate(new Date(), 'YYYY-MM-DD')
    this.setData({ selectedDate: today, isToday: true })
  },

  normalizeRoomId: function (value) {
    var roomId = Number(localData.resolveRoomId(value))
    return Number.isFinite(roomId) && roomId > 0 ? roomId : 0
  },

  ensureRoomIdReady: function (roomId) {
    if (this.normalizeRoomId(roomId || this.data.roomId)) return true
    this.setData({ loading: false })
    wx.showToast({ title: '房间信息未准备好，请返回重新选择', icon: 'none' })
    return false
  },

  loadRoomInfo: function (roomId) {
    roomId = this.normalizeRoomId(roomId)
    if (!this.ensureRoomIdReady(roomId)) return
    var that = this
    request.get('/room/' + roomId).then(function (data) {
      var openEnd = data.open_end_time || '23:00'
      var closeH = parseInt(openEnd.split(':')[0])
      var closeM = parseInt(openEnd.split(':')[1])
      if (closeM > 0) closeH = closeH + 1
      that.setData({
        room: data,
        rulesContent: localData.getRulesByRoomType(data.type),
        openHour: parseInt((data.open_start_time || '08:00').split(':')[0]),
        closeHour: closeH,
        maxHours: data.max_duration ? Math.floor(data.max_duration / 60) : 4,
        isStudyRoom: data.type === 'study_room' || data.type === 'study'
      })
      wx.setNavigationBarTitle({ title: data.name || '预约' })
      that.computeHourLists()
      that.loadTimeline()
    }).catch(function () {
      var data = localData.getRoomById(roomId)
      if (data) {
        var openEnd = data.open_end_time || '23:00'
        var closeH = parseInt(openEnd.split(':')[0])
        var closeM = parseInt(openEnd.split(':')[1])
        if (closeM > 0) closeH = closeH + 1
        that.setData({
          room: data,
          rulesContent: localData.getRulesByRoomType(data.type),
          openHour: parseInt((data.open_start_time || '08:00').split(':')[0]),
          closeHour: closeH,
          maxHours: data.max_duration ? Math.floor(data.max_duration / 60) : 4,
          isStudyRoom: data.type === 'study_room' || data.type === 'study'
        })
        wx.setNavigationBarTitle({ title: data.name || '预约' })
        that.computeHourLists()
        that.loadTimeline()
      } else {
        that.setData({ loading: false })
      }
    })
  },

  loadTimeline: function () {
    var roomId = this.normalizeRoomId(this.data.roomId)
    if (!this.ensureRoomIdReady(roomId)) return Promise.resolve()
    var that = this
    return request.get('/room/' + roomId + '/timeline', { date: this.data.selectedDate }).then(function (data) {
      var apiTimeline = data.timeline || []
      var seats = []
      var reservations = []
      if (apiTimeline.length > 0 && apiTimeline[0].seats) {
        var seatMap = {}
        apiTimeline.forEach(function (slot) {
          if (slot.seats) {
            slot.seats.forEach(function (s) {
              if (!seatMap[s.seatId]) {
                seatMap[s.seatId] = { id: s.seatId, name: String(s.seatNumber), seatId: s.seatId }
              }
              if (s.status === 'occupied' || s.status === 'myReservation') {
                var startH = parseInt(slot.time.split(':')[0])
                var startM = parseInt(slot.time.split(':')[1])
                var endH = parseInt(slot.endTime.split(':')[0])
                var endM = parseInt(slot.endTime.split(':')[1])
                reservations.push({
                  seatId: s.seatId,
                  startHour: startH + startM / 60,
                  endHour: endH + endM / 60,
                  isMine: s.status === 'myReservation'
                })
              }
            })
          }
        })
        seats = Object.values(seatMap)
      } else {
        apiTimeline.forEach(function (slot) {
          if (slot.status === 'occupied' || slot.status === 'myReservation') {
            var startH = parseInt(slot.time.split(':')[0])
            var startM = parseInt(slot.time.split(':')[1])
            var endH = parseInt(slot.endTime.split(':')[0])
            var endM = parseInt(slot.endTime.split(':')[1])
            reservations.push({
              seatId: null,
              startHour: startH + startM / 60,
              endHour: endH + endM / 60,
              isMine: slot.status === 'myReservation'
            })
          }
        })
      }
      that.setData({
        timeline: reservations,
        seats: seats,
        myReservations: reservations.filter(function (r) { return r.isMine }),
        loading: false
      })
      that.scrollToCurrentTime()
    }).catch(function () {
      var fallbackData = localData.generateLocalTimeline(roomId, that.data.selectedDate)
      var seats = fallbackData.seats || []
      var apiTimeline = fallbackData.timeline || []
      var reservations = []
      if (apiTimeline.length > 0 && apiTimeline[0].seats) {
        var seatMap = {}
        apiTimeline.forEach(function (slot) {
          if (slot.seats) {
            slot.seats.forEach(function (s) {
              if (!seatMap[s.seatId]) {
                seatMap[s.seatId] = { id: s.seatId, name: String(s.seatNumber), seatId: s.seatId }
              }
            })
          }
        })
        seats = Object.values(seatMap)
      }
      that.setData({
        timeline: reservations,
        seats: seats,
        myReservations: [],
        loading: false
      })
      that.scrollToCurrentTime()
    })
  },

  filterPastSlots: function (timeline) {
    var today = util.formatDate(new Date(), 'YYYY-MM-DD')
    if (this.data.selectedDate !== today) return timeline
    var now = new Date()
    var currentHour = now.getHours()
    var currentMin = now.getMinutes()
    return timeline.filter(function (slot) {
      var timeStr = slot.start_time || slot.time || ''
      if (!timeStr) return true
      var parts = timeStr.split(':')
      var slotHour = parseInt(parts[0])
      var slotMin = parseInt(parts[1])
      return slotHour > currentHour || (slotHour === currentHour && slotMin >= currentMin)
    })
  },

  computeHourLists: function () {
    var startHourList = []
    for (var i = this.data.openHour; i < this.data.closeHour; i++) {
      startHourList.push((i < 10 ? '0' + i : '' + i) + ':00')
      startHourList.push((i < 10 ? '0' + i : '' + i) + ':30')
    }
    var endHourList = []
    var startH = this.data.selectedStartHour != null ? this.data.selectedStartHour : this.data.openHour
    var startM = this.data.selectedStartMin || 0
    var startTotalMin = startH * 60 + startM
    for (var i = this.data.openHour; i <= this.data.closeHour; i++) {
      if (i * 60 > startTotalMin) endHourList.push((i < 10 ? '0' + i : '' + i) + ':00')
      if (i * 60 + 30 > startTotalMin && i < this.data.closeHour) endHourList.push((i < 10 ? '0' + i : '' + i) + ':30')
    }
    var startIdx = 0
    for (var i = 0; i < startHourList.length; i++) {
      var parts = startHourList[i].split(':')
      if (parseInt(parts[0]) === startH && parseInt(parts[1]) === startM) {
        startIdx = i
        break
      }
    }
    this.setData({
      startHourList: startHourList,
      endHourList: endHourList,
      startHourIndex: startIdx,
      endHourIndex: 0
    })
    this.updateTimeDisplay()
  },

  updateTimeDisplay: function () {
    var startH = this.data.selectedStartHour != null ? this.data.selectedStartHour : this.data.openHour
    var startM = this.data.selectedStartMin || 0
    var endH = this.data.selectedEndHour != null ? this.data.selectedEndHour : startH + 1
    var endM = this.data.selectedEndMin || 0
    var startStr = (startH < 10 ? '0' + startH : '' + startH) + ':' + (startM < 10 ? '0' : '') + startM
    var endStr = (endH < 10 ? '0' + endH : '' + endH) + ':' + (endM < 10 ? '0' : '') + endM
    var durationMin = (endH * 60 + endM) - (startH * 60 + startM)
    var hours = Math.floor(durationMin / 60)
    var mins = durationMin % 60
    var durationStr = ''
    if (hours > 0) durationStr += hours + '小时'
    if (mins > 0) durationStr += mins + '分钟'
    if (durationMin <= 0) durationStr = '0分钟'
    this.setData({
      selectedStartTimeStr: startStr,
      selectedEndTimeStr: endStr,
      durationStr: durationStr
    })
  },

  onDateChange: function (e) {
    var today = util.formatDate(new Date(), 'YYYY-MM-DD')
    this.setData({
      selectedDate: e.detail.date,
      isToday: e.detail.date === today,
      loading: true
    })
    if (this.ensureRoomIdReady()) this.loadTimeline()
  },

  onTimelineSelect: function (e) {
    var detail = e.detail
    var startH = Math.floor(detail.startHour)
    var startM = detail.startMin || 0
    var endH = Math.floor(detail.endHour)
    var endM = detail.endMin || 0
    var startTotal = startH * 60 + startM
    var endTotal = endH * 60 + endM
    var maxMin = this.data.maxHours * 60
    if (endTotal - startTotal > maxMin) {
      endTotal = startTotal + maxMin
      endH = Math.floor(endTotal / 60)
      endM = endTotal % 60
    }
    if (endTotal - startTotal > 60) {
      endTotal = startTotal + 60
      endH = Math.floor(endTotal / 60)
      endM = endTotal % 60
    }
    this.setData({
      showTimePicker: true,
      selectedSeat: detail.seatId || null,
      selectedStartHour: startH,
      selectedStartMin: startM,
      selectedEndHour: endH,
      selectedEndMin: endM
    })
    this.computeHourLists()
  },

  onStartHourChange: function (e) {
    var idx = Number(e.detail.value)
    var selected = this.data.startHourList[idx]
    if (!selected) return
    var parts = selected.split(':')
    this.setData({
      selectedStartHour: parseInt(parts[0]),
      selectedStartMin: parseInt(parts[1])
    })
    this.computeHourLists()
  },

  onEndHourChange: function (e) {
    var idx = Number(e.detail.value)
    var selected = this.data.endHourList[idx]
    if (!selected) return
    var parts = selected.split(':')
    this.setData({
      selectedEndHour: parseInt(parts[0]),
      selectedEndMin: parseInt(parts[1])
    })
    this.updateTimeDisplay()
  },

  onConfirmTime: function () {
    var startTotalMin = this.data.selectedStartHour * 60 + (this.data.selectedStartMin || 0)
    var endTotalMin = this.data.selectedEndHour * 60 + (this.data.selectedEndMin || 0)
    var durationMin = endTotalMin - startTotalMin
    if (durationMin > this.data.maxHours * 60) {
      wx.showToast({ title: '超出单次预约时长上限（' + this.data.maxHours + '小时），请重新选择', icon: 'none' })
      return
    }
    if (durationMin < 30) {
      wx.showToast({ title: '预约时长不能少于30分钟', icon: 'none' })
      return
    }
    var seatName = ''
    var that = this
    if (this.data.isStudyRoom && this.data.selectedSeat) {
      this.data.seats.forEach(function (s) {
        if (s.id === that.data.selectedSeat) {
          seatName = s.name
        }
      })
    }
    this.setData({ showTimePicker: false })
    var url = '/pages/reservation-confirm/reservation-confirm?roomId=' + this.data.roomId +
      '&date=' + this.data.selectedDate +
      '&startHour=' + this.data.selectedStartHour +
      '&startMin=' + (this.data.selectedStartMin || 0) +
      '&endHour=' + this.data.selectedEndHour +
      '&endMin=' + (this.data.selectedEndMin || 0)
    if (this.data.isStudyRoom && this.data.selectedSeat) {
      url += '&seatId=' + this.data.selectedSeat + '&seatName=' + encodeURIComponent(seatName)
    }
    wx.navigateTo({ url: url })
  },

  onCancelTime: function () {
    this.setData({ showTimePicker: false })
  },

  scrollToCurrentTime: function () {
    var today = util.formatDate(new Date(), 'YYYY-MM-DD')
    if (this.data.selectedDate !== today) return
    var timeline = this.selectComponent('.timeline-section timeline')
    if (timeline && timeline.scrollToCurrentTime) {
      timeline.scrollToCurrentTime()
    }
  },

  onPullDownRefresh: function () {
    if (this.ensureRoomIdReady()) this.loadTimeline()
    wx.stopPullDownRefresh()
  },

  startRulesCountdown: function () {
    var that = this
    if (that.data.rulesTimer) clearInterval(that.data.rulesTimer)
    var timer = setInterval(function () {
      var count = that.data.rulesCountdown - 1
      if (count <= 0) {
        clearInterval(timer)
        that.setData({ rulesCountdown: 0 })
      } else {
        that.setData({ rulesCountdown: count })
      }
    }, 1000)
    that.setData({ rulesTimer: timer })
  },

  onRulesScrollToLower: function () {
    if (!this.data.rulesScrolledToBottom) {
      this.setData({ rulesScrolledToBottom: true })
    }
  },

  onRulesAgreeChange: function () {
    if (!this.data.rulesScrolledToBottom) {
      wx.showToast({ title: '请先阅读完管理制度', icon: 'none' })
      return
    }
    if (this.data.rulesCountdown > 0) {
      wx.showToast({ title: '请阅读至少5秒', icon: 'none' })
      return
    }
    this.setData({ rulesAgreed: !this.data.rulesAgreed })
  },

  onRulesConfirm: function () {
    if (!this.data.rulesAgreed) {
      wx.showToast({ title: '请勾选确认', icon: 'none' })
      return
    }
    if (this.data.rulesTimer) clearInterval(this.data.rulesTimer)
    this.setData({ showRulesModal: false })
  },

  onRulesCancel: function () {
    if (this.data.rulesTimer) clearInterval(this.data.rulesTimer)
    wx.navigateBack()
  },

  onUnload: function () {
    if (this.data.rulesTimer) clearInterval(this.data.rulesTimer)
  }
})
