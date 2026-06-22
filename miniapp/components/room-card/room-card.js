Component({
  properties: {
    room: {
      type: Object,
      value: {}
    }
  },

  data: {
    statusColor: '#D9D9D9',
    statusText: '未知',
    freeRate: '0%'
  },

  observers: {
    'room': function (room) {
      if (!room || !room.id) return
      var total = room.totalSlots || room.total_slots || 0
      var free = room.freeSlots || room.free_slots || 0
      var rate = total > 0 ? Math.round((free / total) * 100) : 0
      var color = '#D9D9D9'
      var text = '未知'

      if (rate > 60) {
        color = '#52C41A'
        text = '空闲'
      } else if (rate > 20) {
        color = '#FA8C16'
        text = '紧张'
      } else if (rate >= 0) {
        color = '#FF4D4F'
        text = '已满'
      }

      this.setData({
        statusColor: color,
        statusText: text,
        freeRate: rate + '%'
      })
    }
  },

  methods: {
    onTap: function () {
      this.triggerEvent('tap', { room: this.data.room })
    }
  }
})
