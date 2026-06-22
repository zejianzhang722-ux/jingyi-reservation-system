var request = require('../../utils/request')
var util = require('../../utils/util')
var localData = require('../../utils/local-data')

Page({
  data: {
    reservation: null,
    qrCodeUrl: '',
    loading: true,
    countdown: '',
    isExpired: false
  },

  onLoad: function (options) {
    var id = options.id
    if (id) {
      this.loadReservation(id, options)
    }
  },

  normalizeSeatName: function (data) {
    var value = data.seat_name || data.seatName || ''
    var roomName = data.room_name || data.roomName || ''
    var roomCode = ''
    var match = String(roomName).match(/[A-Z]\d{3}/)
    if (match) roomCode = match[0]
    if (/^[A-Z]\d{3}$/.test(String(value)) && value !== roomCode) return ''
    return value
  },

  transformReservation: function (data) {
    if (!data) return data
    return {
      id: data.id,
      roomId: data.room_id || data.roomId || '',
      roomName: data.room_name || data.roomName || '',
      roomNumber: '',
      date: data.date || '',
      startTime: data.start_time || data.startTime || '',
      endTime: data.end_time || data.endTime || '',
      seatName: this.normalizeSeatName(data),
      status: data.status || '',
      userName: data.real_name || data.userName || data.nickname || '',
      qrCodeUrl: data.qrCodeUrl || data.qr_code_url || data.qrcode || '',
      voucherCode: data.voucherCode || data.voucher_code || data.reservation_code || ''
    }
  },

  loadVoucherCode: function (id) {
    var that = this
    request.get('/reservation/' + id + '/qrcode', {}, { silent: true }).then(function (data) {
      that.setData({
        qrCodeUrl: data.qrcode || data.qrCodeUrl || '',
        'reservation.qrCodeUrl': data.qrcode || data.qrCodeUrl || '',
        'reservation.voucherCode': data.code || data.voucherCode || that.data.reservation.voucherCode || ''
      })
    }).catch(function () {})
  },

  loadReservation: function (id, options) {
    var that = this
    request.get('/reservation/' + id).then(function (data) {
      var reservation = that.transformReservation(data)
      var isExpired = reservation.status === 'completed' || reservation.status === 'cancelled'
      that.setData({
        reservation: reservation,
        qrCodeUrl: reservation.qrCodeUrl || '',
        isExpired: isExpired,
        loading: false
      })
      that.loadVoucherCode(id)
      if (!isExpired) {
        that.startCountdown(reservation)
      }
    }).catch(function () {
      var room = options.roomId ? localData.getRoomById(options.roomId) : null
      var fallback = {
        id: id,
        roomId: options.roomId || '',
        roomName: options.roomName || (room ? room.name : '功能房'),
        date: options.date || util.formatDate(new Date(), 'YYYY-MM-DD'),
        startTime: options.startTime || '09:00',
        endTime: options.endTime || '11:00',
        status: options.status || 'approved',
        userName: options.userName || '当前用户',
        qrCodeUrl: '',
        voucherCode: options.voucherCode || ('JY' + Date.now().toString().slice(-8) + id)
      }
      that.setData({
        reservation: fallback,
        qrCodeUrl: '',
        isExpired: false,
        loading: false
      })
      that.startCountdown(fallback)
    })
  },

  startCountdown: function (reservation) {
    var that = this
    var endTime = new Date(reservation.date + 'T' + reservation.endTime)
    var now = new Date()

    if (now >= endTime) {
      this.setData({ isExpired: true, countdown: '已过期' })
      return
    }

    this._timer = setInterval(function () {
      var now = new Date()
      var diff = endTime.getTime() - now.getTime()
      if (diff <= 0) {
        clearInterval(that._timer)
        that.setData({ isExpired: true, countdown: '已过期' })
        return
      }
      var hours = Math.floor(diff / (1000 * 60 * 60))
      var minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      var seconds = Math.floor((diff % (1000 * 60)) / 1000)
      that.setData({
        countdown: (hours > 0 ? hours + '时' : '') + minutes + '分' + seconds + '秒'
      })
    }, 1000)
  },

  onUnload: function () {
    if (this._timer) {
      clearInterval(this._timer)
    }
  },

  onRefreshQRCode: function () {
    if (this.data.reservation) {
      this.loadReservation(this.data.reservation.id)
    }
  }
})
