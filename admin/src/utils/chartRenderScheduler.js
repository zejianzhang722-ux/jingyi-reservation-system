export function createChartRenderScheduler(requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame) {
  const pending = new Set()
  let active = true

  return {
    schedule(render) {
      if (!active) return null
      const id = requestFrame(() => {
        pending.delete(id)
        if (active) render()
      })
      pending.add(id)
      return id
    },
    cancelAll() {
      pending.forEach(cancelFrame)
      pending.clear()
    },
    destroy() {
      active = false
      this.cancelAll()
    }
  }
}
