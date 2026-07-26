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

export function createLatestRequestCoordinator({ load, onStart, onSuccess, onError, onFinish }) {
  let version = 0

  return {
    async run(...args) {
      const requestVersion = ++version
      onStart?.(...args)
      try {
        const value = await load(...args)
        if (requestVersion === version) onSuccess?.(value, ...args)
        return value
      } catch (error) {
        if (requestVersion === version) onError?.(error, ...args)
        return undefined
      } finally {
        if (requestVersion === version) onFinish?.(...args)
      }
    },
    invalidate() {
      version += 1
    }
  }
}
