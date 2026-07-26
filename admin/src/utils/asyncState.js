export function createAsyncState(initialValue) {
  return {
    status: 'idle',
    value: initialValue,
    errorMessage: ''
  }
}

export function beginLoad(state) {
  state.status = 'loading'
  state.errorMessage = ''
  return state
}

export function finishLoad(state, value, isEmpty = false) {
  state.status = isEmpty ? 'empty' : 'success'
  state.value = value
  state.errorMessage = ''
  return state
}

export function failLoad(state, error) {
  state.status = 'error'
  state.errorMessage = readableError(error)
  return state
}

function readableError(error) {
  const message = error?.response?.data?.message ?? error?.message
  return typeof message === 'string' && message.trim()
    ? message.trim()
    : '加载失败，请稍后重试'
}
