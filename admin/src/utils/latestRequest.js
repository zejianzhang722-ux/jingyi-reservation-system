export function createLatestRequest() {
  let version = 0

  return {
    async run(promise, apply, reject) {
      const requestVersion = ++version
      try {
        const value = await promise
        if (requestVersion === version) apply(value)
      } catch (error) {
        if (requestVersion === version && reject) reject(error)
      }
    },
    invalidate() {
      version += 1
    }
  }
}
