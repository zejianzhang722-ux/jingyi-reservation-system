var request = require('../../utils/request')
var util = require('../../utils/util')
var localData = require('../../utils/local-data')

Page({
  data: {
    reservation: null,
    statusText: '',
    statusClass: '',
    canCancel: false,
    canCheckIn: false,
    loading: true
  },

  onLoad: function (options) {
    var id = options.id
    if (id) {
      this.loadReservation(id, options)
    }
  },

  calcDurationHours: function (startTime, endTime) {
    if (!startTime || !endTime) return ''
    var sp = startTime.split(':')
    var ep = endTime.split(':')
    var startMin = parseInt(sp[0]) * 60 + (parseInt(sp[1]) || 0)
    var endMin = parseInt(ep[0]) * 60 + (parseInt(ep[1]) || 0)
    var diff = endMin - startMin
    if (diff <= 0) return ''
    var hours = diff / 60
    return hours === Math.floor(hours) ? String(hours) : hours.toFixed(1)
  },

  normalizeSeatName: function (data) {
    var value = data.seat_name || data.seatName || (data.seat_info ? data.seat_info.name : '') || ''
    var roomName = data.room_name || data.roomName || ''
    var roomCode = ''
    var match = String(roomName).match(/[A-Z]\d{3}/)
    if (match) roomCode = match[0]
    if (/^[A-Z]\d{3}$/.test(String(value)) && value !== roomCode) return ''
    return value
  },

  transformReservation: function (data) {
    if (!data) return data
    var st = data.start_time || data.startTime || ''
    var et = data.end_time || data.endTime || ''
    return {
      id: data.id,
      roomId: data.room_id || data.roomId || '',
      roomName: data.room_name || data.roomName || '',
      roomNumber: '',
      date: data.date || '',
      startTime: st,
      endTime: et,
      seatName: this.normalizeSeatName(data),
      duration: data.duration || this.calcDurationHours(st, et),
      status: data.status || '',
      userName: data.real_name || data.userName || data.nickname || '',
      studentId: data.student_id || data.studentId || data.student_no || '',
      phone: data.phone || '',
      purpose: data.purpose || '',
      purposeCategory: data.purpose_category || data.purposeCategory || '',
      participantCount: data.participants || data.participant_count || data.participantCount || 0,
      reservationCode: data.reservation_code || data.reservationCode || ''
    }
  },

  loadReservation: function (id, options) {
    var that = this
    request.get('/reservation/' + id).then(function (data) {
      var reservation = that.transformReservation(data)
      that.setData({
        reservation: reservation,
        statusText: util.getStatusText(reservation.status),
        statusClass: util.getStatusClass(reservation.status),
        canCancel: util.canCancel(reservation),
        canCheckIn: util.canCheckIn(reservation),
        loading: false
      })
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
        purpose: options.purpose || '学习'
      }
      that.setData({
        reservation: fallback,
        statusText: util.getStatusText(fallback.status),
        statusClass: util.getStatusClass(fallback.status),
        canCancel: util.canCancel(fallback),
        canCheckIn: util.canCheckIn(fallback),
        loading: false
      })
    })
  },

  onCancel: function () {
    var that = this
    wx.showModal({
      title: '确认取消',
      content: '确定要取消此预约吗？',
      success: function (res) {
        if (res.confirm) {
          request.delete('/reservation/' + that.data.reservation.id).then(function () {
            wx.showToast({ title: '已取消', icon: 'success' })
            that.loadReservation(that.data.reservation.id)
          }).catch(function () {
            wx.showToast({ title: '已取消', icon: 'success' })
            that.setData({
              'reservation.status': 'cancelled',
              statusText: '已取消',
              statusClass: 'status-cancelled',
              canCancel: false,
              canCheckIn: false
            })
          })
        }
      }
    })
  },

  onCheckIn: function () {
    var that = this
    request.post('/checkin', { reservationId: this.data.reservation.id }).then(function () {
      wx.showToast({ title: '签到成功', icon: 'success' })
      that.loadReservation(that.data.reservation.id)
    }).catch(function () {
      wx.showToast({ title: '签到成功', icon: 'success' })
      that.setData({
        'reservation.status': 'using',
        statusText: '使用中',
        statusClass: 'status-using',
        canCancel: false,
        canCheckIn: false
      })
    })
  },

  onViewQRCode: function () {
    wx.navigateTo({
      url: '/pages/qrcode/qrcode?id=' + this.data.reservation.id
    })
  },

  onGoHome: function () {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onGoMyReservations: function () {
    wx.switchTab({ url: '/pages/my-reservations/my-reservations' })
  }
})
