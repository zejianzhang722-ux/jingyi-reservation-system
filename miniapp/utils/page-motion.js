function replayPageMotion(page, schedule) {
  if (!page || typeof page.setData !== 'function') return

  page.setData({ pageMotionActive: false })
  var runNext = schedule
  if (!runNext && typeof wx !== 'undefined' && typeof wx.nextTick === 'function') {
    runNext = wx.nextTick
  }
  if (!runNext) {
    runNext = function (callback) { setTimeout(callback, 16) }
  }

  runNext(function () {
    page.setData({ pageMotionActive: true })
  })
}

module.exports = {
  replayPageMotion: replayPageMotion
}
