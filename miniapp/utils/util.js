function formatDate(date, format) {
  if (!date) date = new Date()
  if (typeof date === 'string') date = new Date(date)
  if (typeof date === 'number') date = new Date(date)

  var o = {
    'M+': date.getMonth() + 1,
    'D+': date.getDate(),
    'h+': date.getHours(),
    'm+': date.getMinutes(),
    's+': date.getSeconds()
  }

  if (/(Y+)/.test(format)) {
    format = format.replace(RegExp.$1, (date.getFullYear() + '').substr(4 - RegExp.$1.length))
  }

  for (var k in o) {
    if (new RegExp('(' + k + ')').test(format)) {
      format = format.replace(RegExp.$1, (RegExp.$1.length === 1) ? (o[k]) : (('00' + o[k]).substr(('' + o[k]).length)))
    }
  }

  return format
}

function formatTime(hour, minute) {
  hour = hour || 0
  minute = minute || 0
  return (hour < 10 ? '0' + hour : '' + hour) + ':' + (minute < 10 ? '0' + minute : '' + minute)
}

function getWeekDay(date) {
  if (typeof date === 'string') date = new Date(date)
  var days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return days[date.getDay()]
}

function getDateList(days) {
  days = days || 4
  var list = []
  for (var i = 0; i < days; i++) {
    var d = new Date()
    d.setDate(d.getDate() + i)
    list.push({
      date: formatDate(d, 'YYYY-MM-DD'),
      display: formatDate(d, 'MM/DD'),
      weekday: i === 0 ? '今天' : (i === 1 ? '明天' : getWeekDay(d)),
      isToday: i === 0
    })
  }
  return list
}

function calcDuration(startHour, endHour) {
  return endHour - startHour
}

function getCreditColor(score) {
  if (score >= 80) return 'credit-green'
  if (score >= 60) return 'credit-yellow'
  return 'credit-red'
}

function getCreditColorValue(score) {
  if (score >= 80) return '#52C41A'
  if (score >= 60) return '#FA8C16'
  return '#FF4D4F'
}

function getStatusText(status) {
  var map = {
    pending: '待审核',
    approved: '已通过',
    using: '使用中',
    completed: '已完成',
    cancelled: '已取消',
    noshow: '已爽约'
  }
  return map[status] || status
}

function getStatusClass(status) {
  return 'status-' + status
}

function isTimeConflict(start1, end1, start2, end2) {
  return start1 < end2 && start2 < end1
}

function canCancel(reservation) {
  if (reservation.status !== 'pending' && reservation.status !== 'approved' && reservation.status !== 'counselor_pending') return false
  var now = new Date()
  var startTime = reservation.startTime || reservation.start_time
  var date = new Date(reservation.date + 'T' + startTime)
  var diff = date.getTime() - now.getTime()
  return diff > 3 * 60 * 60 * 1000
}

function canCheckIn(reservation) {
  if (reservation.status !== 'approved') return false
  var now = new Date()
  var startTime = reservation.startTime || reservation.start_time
  var date = new Date(reservation.date + 'T' + startTime)
  var diff = now.getTime() - date.getTime()
  var beforeStart = date.getTime() - now.getTime()
  return beforeStart <= 30 * 60 * 1000 && diff <= 15 * 60 * 1000
}

function getRoomTypeIcon(type) {
  var map = {
    study: 'study',
    discussion: 'shared',
    media: 'media',
    competition: 'competition',
    roadshow: 'roadshow',
    dance: 'dance',
    multi: 'multi',
    reading: 'reading',
    other: 'room',
    poster: 'poster'
  }
  return map[type] || 'room'
}

function getRoomTypeName(type) {
  var map = {
    study: '自习室',
    discussion: '研讨室',
    media: '影音室',
    competition: '备赛间',
    roadshow: '路演空间',
    dance: '舞蹈室',
    multi: '多功能厅',
    reading: '阅览室',
    other: '其他',
    poster: '海报栏'
  }
  return map[type] || type
}

function throttle(fn, delay) {
  var lastTime = 0
  return function () {
    var now = Date.now()
    if (now - lastTime >= delay) {
      lastTime = now
      fn.apply(this, arguments)
    }
  }
}

module.exports = {
  formatDate: formatDate,
  formatTime: formatTime,
  getWeekDay: getWeekDay,
  getDateList: getDateList,
  calcDuration: calcDuration,
  getCreditColor: getCreditColor,
  getCreditColorValue: getCreditColorValue,
  getStatusText: getStatusText,
  getStatusClass: getStatusClass,
  isTimeConflict: isTimeConflict,
  canCancel: canCancel,
  canCheckIn: canCheckIn,
  getRoomTypeIcon: getRoomTypeIcon,
  getRoomTypeName: getRoomTypeName,
  throttle: throttle
}
