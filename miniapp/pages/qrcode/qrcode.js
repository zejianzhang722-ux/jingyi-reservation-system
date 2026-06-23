var request = require('../../utils/request')
var util = require('../../utils/util')
var localData = require('../../utils/local-data')

Page({
  data: {
    reservation: null,
    qrCodeUrl: '',
    loading: true,
    countdown: '',
    credentialCountdown: '',
    credentialReference: '',
    credentialError: '',
    refreshing: false,
    isExpired: false
  },

  onLoad: function (options) {
    this._pageVisible = true
    var id = options.id
    if (id) {
      this.loadReservation(id, options)
    }
  },

  onShow: function () {
    this._pageVisible = true
    if (this.data.reservation && !this.data.isExpired && !this.data.loading) {
      this.loadVoucherCode(this.data.reservation.id)
    }
  },

  onHide: function () {
    this._pageVisible = false
    this.clearCredentialTimers()
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
      qrCodeUrl: '',
      voucherCode: ''
    }
  },

  clearCredentialTimers: function () {
    if (this._credentialTimer) {
      clearInterval(this._credentialTimer)
      this._credentialTimer = null
    }
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer)
      this._refreshTimer = null
    }
  },

  scheduleCredentialRefresh: function (expiresAt, refreshAfter) {
    var that = this
    this.clearCredentialTimers()
    var expiry = new Date(expiresAt).getTime()

    function updateCountdown() {
      var diff = expiry - Date.now()
      if (diff <= 0) {
        that.setData({ credentialCountdown: '正在刷新' })
        return
      }
      that.setData({ credentialCountdown: Math.max(1, Math.ceil(diff / 1000)) + '秒' })
    }

    updateCountdown()
    this._credentialTimer = setInterval(updateCountdown, 1000)
    this._refreshTimer = setTimeout(function () {
      if (that._pageVisible && that.data.reservation && !that.data.isExpired) {
        that.loadVoucherCode(that.data.reservation.id)
      }
    }, Math.max(5, Number(refreshAfter) || 45) * 1000)
  },

  loadVoucherCode: function (id) {
    var that = this
    if (this._refreshing || !id || this.data.isExpired) return
    this._refreshing = true
    this.setData({ refreshing: true, credentialError: '' })

    request.get('/reservation/' + id + '/qrcode', {}, { silent: true }).then(function (data) {
      var expiresAt = data.expiresAt || new Date(Date.now() + (Number(data.expiresIn) || 60) * 1000).toISOString()
      that.setData({
        qrCodeUrl: data.qrcode || data.qrCodeUrl || '',
        'reservation.qrCodeUrl': data.qrcode || data.qrCodeUrl || '',
        'reservation.voucherCode': data.code || data.voucherCode || '',
        credentialReference: data.code || data.voucherCode || '',
        credentialError: '',
        refreshing: false
      })
      that.scheduleCredentialRefresh(expiresAt, data.refreshAfter)
    }).catch(function (err) {
      var message = err && err.message ? err.message : '动态凭证加载失败'
      that.setData({
        qrCodeUrl: '',
        credentialError: message,
        refreshing: false,
        credentialCountdown: ''
      })
      that.clearCredentialTimers()
      that._refreshTimer = setTimeout(function () {
        if (that._pageVisible && that.data.reservation && !that.data.isExpired) {
          that.loadVoucherCode(that.data.reservation.id)
        }
      }, 5000)
    }).then(function () {
      that._refreshing = false
    })
  },

  loadReservation: function (id, options) {
    var that = this
    request.get('/reservation/' + id).then(function (data) {
      var reservation = that.transformReservation(data)
      var isExpired = reservation.status === 'completed' || reservation.status === 'cancelled' || reservation.status === 'checked_in'
      that.setData({
        reservation: reservation,
        qrCodeUrl: '',
        isExpired: isExpired,
        loading: false
      })
      if (!isExpired) {
        that.loadVoucherCode(id)
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
        voucherCode: ''
      }
      that.setData({
        reservation: fallback,
        qrCodeUrl: '',
        credentialError: '无法读取预约信息，请检查网络后重试',
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
      this.clearCredentialTimers()
      return
    }

    if (this._timer) clearInterval(this._timer)
    this._timer = setInterval(function () {
      var current = new Date()
      var diff = endTime.getTime() - current.getTime()
      if (diff <= 0) {
        clearInterval(that._timer)
        that.clearCredentialTimers()
        that.setData({ isExpired: true, countdown: '已过期', qrCodeUrl: '' })
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
    this._pageVisible = false
    if (this._timer) clearInterval(this._timer)
    this.clearCredentialTimers()
  },

  onRefreshQRCode: function () {
    if (this.data.reservation && !this.data.isExpired) {
      this.loadVoucherCode(this.data.reservation.id)
    }
  }
})
