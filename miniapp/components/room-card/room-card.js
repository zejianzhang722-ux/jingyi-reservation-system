var bookingPolicy = require('../../utils/room-booking-policy')
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
    showAvailability: true,
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

      var policy = bookingPolicy.forRoom(room)
      if (policy.counselorOnly) { color = '#FA8C16'; text = '仅辅导员预约' }
      else if (room.status === 'closed' || room.status === 'maintenance' || room.status === 'counselor_only') { color = '#999999'; text = room.status === 'maintenance' ? '维护中' : room.status === 'counselor_only' ? '仅辅导员预约' : '关闭' }
      else if (bookingPolicy.blockReason(room, policy.groupOnly ? 'group' : 'personal')) { color = '#999999'; text = '关闭' }
      this.setData({
        statusColor: color,
        statusText: text,
        showAvailability: ['closed', 'maintenance', 'counselor_only'].indexOf(room.status) < 0 && !policy.counselorOnly && !bookingPolicy.blockReason(room, policy.groupOnly ? 'group' : 'personal'),
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
