// Map viewport pixels to half-hour slots using the rendered block's own width.
function selectionAtPoint(start, end, x, rect) {
  start = Number(start)
  end = Number(end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.5) return null
  var hour = start
  if (rect && rect.width > 0 && Number.isFinite(x)) {
    hour += Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * (end - start)
  }
  var first = Math.ceil(start * 2) / 2
  var last = Math.floor(end * 2) / 2
  if (last - first < 0.5) return null
  hour = Math.max(first, Math.min(Math.floor(hour * 2) / 2, last - 0.5))
  return { start: hour, end: Math.min(last, hour + 1) }
}
module.exports = { selectionAtPoint: selectionAtPoint }
