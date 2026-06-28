var util = require('../../utils/util')

Component({
  properties: {
    seats: { type: Array, value: [] },
    timeline: { type: Array, value: [] },
    myReservations: { type: Array, value: [] },
    openHour: { type: Number, value: 8 },
    closeHour: { type: Number, value: 23 },
    maxHours: { type: Number, value: 4 },
    mode: { type: String, value: 'seat' },
    isToday: { type: Boolean, value: true }
  },

  data: {
    hours: [], hourWidth: 80, halfHourWidth: 40, seatLabelWidth: 120,
    scrollLeft: 0, selectedSeat: null, selectedStart: null, selectedEnd: null,
    isSelecting: false, touchStartX: 0, touchStartHour: 0,
    processedTimeline: [], currentHour: 0
  },

  observers: {
    'openHour, closeHour': function (openHour, closeHour) { this.buildHours(openHour, closeHour) },
    'seats, timeline, myReservations': function (seats, timeline, myReservations) { this.processTimelineData(seats, timeline, myReservations) }
  },

  lifetimes: {
    attached: function () {
      var now = new Date()
      this.setData({ currentHour: now.getHours() + now.getMinutes() / 60 })
      var props = this.properties
      this.buildHours(props.openHour, props.closeHour)
      this.processTimelineData(props.seats, props.timeline, props.myReservations)
    },
    ready: function () {
      if (this.data.processedTimeline.length === 0) {
        var props = this.properties
        this.processTimelineData(props.seats, props.timeline, props.myReservations)
      }
    }
  },

  pageLifetimes: {
    show: function () {
      var props = this.properties
      if (this.data.processedTimeline.length === 0 && props.seats && props.seats.length > 0) this.processTimelineData(props.seats, props.timeline, props.myReservations)
    }
  },

  methods: {
    buildHours: function (openHour, closeHour) {
      var hours = []
      for (var i = openHour; i < closeHour; i++) {
        hours.push({ value: i, hour: i, min: 0, label: i % 2 === 0 ? util.formatTime(i, 0) : '', isHalf: false })
        hours.push({ value: i + 0.5, hour: i, min: 30, label: '', isHalf: true })
      }
      hours.push({ value: closeHour, hour: closeHour, min: 0, label: closeHour % 2 === 0 ? util.formatTime(closeHour, 0) : '', isHalf: false })
      var halfHourWidth = 64
      var totalWidth = (closeHour - openHour) * halfHourWidth * 2
      this.setData({ hours: hours, totalWidth: totalWidth, halfHourWidth: halfHourWidth })
    },

    processTimelineData: function (seats, timeline, myReservations) {
      var processed = []
      var that = this
      if (this.data.mode === 'seat') {
        seats.forEach(function (seat) {
          var blocks = that.buildBlocks(seat.id, timeline, myReservations)
          processed.push({ seatId: seat.id, seatName: seat.name || ('座位' + seat.id), blocks: blocks })
        })
      } else {
        var blocks = this.buildBlocks(null, timeline, myReservations)
        processed.push({ seatId: null, seatName: '', blocks: blocks })
      }
      this.setData({ processedTimeline: processed })
    },

    buildBlocks: function (seatId, timeline, myReservations) {
      var blocks = []
      var openHour = this.data.openHour
      var closeHour = this.data.closeHour
      var that = this
      var occupiedSlots = []

      timeline.forEach(function (r) {
        if (seatId && r.seatId !== seatId) return
        var start = Math.max(r.startHour, openHour)
        var end = Math.min(r.endHour, closeHour)
        occupiedSlots.push({ start: start, end: end, isMine: r.isMine || false, isPending: r.isPending || r.status === 'pending' })
      })

      myReservations.forEach(function (r) {
        if (seatId && r.seatId !== seatId) return
        var exists = occupiedSlots.some(function (o) { return o.start === r.startHour && o.end === r.endHour && o.isMine })
        if (!exists) occupiedSlots.push({ start: Math.max(r.startHour, openHour), end: Math.min(r.endHour, closeHour), isMine: true, isPending: false })
      })

      occupiedSlots.sort(function (a, b) { return a.start - b.start })
      var currentTime = openHour
      var now = new Date()
      var currentHourVal = this.data.isToday ? (now.getHours() + now.getMinutes() / 60) : -1

      occupiedSlots.forEach(function (slot) {
        if (currentTime < slot.start) {
          var freeEnd = slot.start
          if (currentHourVal > currentTime) {
            if (currentHourVal < freeEnd) {
              if (currentHourVal > currentTime) blocks.push({ type: 'unavailable', start: currentTime, end: currentHourVal })
              blocks.push({ type: 'free', start: currentHourVal, end: freeEnd })
            } else {
              blocks.push({ type: 'unavailable', start: currentTime, end: freeEnd })
            }
          } else {
            blocks.push({ type: 'free', start: currentTime, end: freeEnd })
          }
        }
        blocks.push({ type: slot.isMine ? 'mine' : (slot.isPending ? 'pending' : 'occupied'), start: slot.start, end: slot.end })
        currentTime = slot.end
      })

      if (currentTime < closeHour) {
        if (currentHourVal > currentTime) {
          if (currentHourVal < closeHour) {
            blocks.push({ type: 'unavailable', start: currentTime, end: currentHourVal })
            blocks.push({ type: 'free', start: currentHourVal, end: closeHour })
          } else {
            blocks.push({ type: 'ended', start: currentTime, end: closeHour })
          }
        } else {
          blocks.push({ type: 'free', start: currentTime, end: closeHour })
        }
      }

      return blocks.map(function (block) {
        var left = (block.start - openHour) * that.data.halfHourWidth * 2
        var width = (block.end - block.start) * that.data.halfHourWidth * 2
        return { type: block.type, start: block.start, end: block.end, left: left, width: Math.max(width, 4), style: 'left:' + left + 'rpx;width:' + Math.max(width, 4) + 'rpx' }
      })
    },

    onBlockTouchStart: function (e) {
      var seatId = e.currentTarget.dataset.seatId
      var touch = e.touches[0]
      var scrollLeft = this.data.scrollLeft || 0
      var offsetLeft = touch.clientX - (this.data.seatLabelWidth / 2)
      var hour = this.data.openHour + (offsetLeft + scrollLeft) / (this.data.halfHourWidth * 2)
      hour = Math.max(this.data.openHour, Math.min(hour, this.data.closeHour))
      var row = this.data.processedTimeline.find(function (r) { return String(r.seatId) === String(seatId) })
      if (!row) return
      var clickedBlock = null
      for (var i = 0; i < row.blocks.length; i++) { var block = row.blocks[i]; if (hour >= block.start && hour < block.end) { clickedBlock = block; break } }
      if (!clickedBlock || clickedBlock.type !== 'free') return
      this.setData({ isSelecting: true, selectedSeat: seatId, selectedStart: Math.floor(hour * 2) / 2, selectedEnd: Math.ceil(hour * 2) / 2, touchStartX: touch.clientX, touchStartHour: hour })
    },

    onBlockTouchMove: function (e) {
      if (!this.data.isSelecting) return
      var touch = e.touches[0]
      var scrollLeft = this.data.scrollLeft || 0
      var offsetLeft = touch.clientX - (this.data.seatLabelWidth / 2)
      var hour = this.data.openHour + (offsetLeft + scrollLeft) / (this.data.halfHourWidth * 2)
      hour = Math.max(this.data.openHour, Math.min(hour, this.data.closeHour))
      var start = Math.min(this.data.touchStartHour, hour)
      var end = Math.max(this.data.touchStartHour, hour)
      var duration = end - start
      if (duration > this.data.maxHours) end = start + this.data.maxHours
      start = Math.round(start * 2) / 2
      end = Math.round(end * 2) / 2
      if (end <= start) end = start + 0.5
      this.setData({ selectedStart: start, selectedEnd: end })
    },

    onBlockTouchEnd: function () {
      if (!this.data.isSelecting) return
      this.setData({ isSelecting: false })
      var startHour = Math.round(this.data.selectedStart * 2) / 2
      var endHour = Math.round(this.data.selectedEnd * 2) / 2
      if (endHour <= startHour) endHour = startHour + 0.5
      this.triggerEvent('selecttime', { seatId: this.data.selectedSeat, startHour: Math.floor(startHour), startMin: (startHour % 1 >= 0.5) ? 30 : 0, endHour: Math.floor(endHour), endMin: (endHour % 1 >= 0.5) ? 30 : 0 })
    },

    onBlockTap: function (e) {
      var seatId = e.currentTarget.dataset.seatId
      var row = this.data.processedTimeline.find(function (r) { return String(r.seatId) === String(seatId) })
      if (row) seatId = row.seatId
      var blockType = e.currentTarget.dataset.type
      var blockStart = Number(e.currentTarget.dataset.start)
      var blockEnd = Number(e.currentTarget.dataset.end)
      if (blockType !== 'free') return
      this.setData({ selectedSeat: seatId, selectedStart: Math.floor(blockStart * 2) / 2, selectedEnd: Math.ceil(blockEnd * 2) / 2 })
      var rawStartH = Math.floor(blockStart * 2) / 2
      var rawEndH = Math.ceil(blockEnd * 2) / 2
      this.triggerEvent('selecttime', { seatId: seatId, startHour: Math.floor(rawStartH), startMin: (rawStartH % 1 >= 0.5) ? 30 : 0, endHour: Math.floor(rawEndH), endMin: (rawEndH % 1 >= 0.5) ? 30 : 0 })
    },

    scrollToCurrentTime: function () { if (!this.data.isToday) return; var now = new Date(); var currentHourVal = now.getHours() + now.getMinutes() / 60; var scrollLeft = Math.max(0, (currentHourVal - this.data.openHour) * this.data.halfHourWidth * 2 - 100); this.setData({ scrollLeft: scrollLeft }) },
    onScroll: function (e) { this.setData({ scrollLeft: e.detail.scrollLeft }) },
    getBlockClass: function (type) { var map = { free: 'timeline-block-free', occupied: 'timeline-block-occupied', pending: 'timeline-block-pending', mine: 'timeline-block-mine', unavailable: 'timeline-block-unavailable' }; return 'timeline-block ' + (map[type] || '') }
  }
})
