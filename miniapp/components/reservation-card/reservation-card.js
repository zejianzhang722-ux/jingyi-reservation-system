var util = require('../../utils/util')

Component({
  properties: {
    reservation: {
      type: Object,
      value: {}
    },
    showActions: {
      type: Boolean,
      value: true
    }
  },

  data: {
    statusText: '',
    statusClass: '',
    canCancel: false,
    canCheckIn: false
  },

  observers: {
    'reservation': function (reservation) {
      if (!reservation || !reservation.id) return
      this.setData({
        statusText: util.getStatusText(reservation.status),
        statusClass: util.getStatusClass(reservation.status),
        canCancel: util.canCancel(reservation),
        canCheckIn: util.canCheckIn(reservation)
      })
    }
  },

  methods: {
    onTap: function () {
      this.triggerEvent('tap', { reservation: this.data.reservation })
    },

    onCancel: function () {
      this.triggerEvent('cancel', { reservation: this.data.reservation })
    },

    onCheckIn: function () {
      this.triggerEvent('checkin', { reservation: this.data.reservation })
    },

    onQRCode: function () {
      this.triggerEvent('qrcode', { reservation: this.data.reservation })
    }
  }
})
