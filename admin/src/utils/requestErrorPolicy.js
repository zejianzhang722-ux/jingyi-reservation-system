const SAFE_CONFLICT_PATTERNS = [
  /^当前账号不能停用[\u3002！!]?$/,
  /^不能(?:停用当前登录账号|修改当前登录账号的角色)[\u3002！!]?$/,
  /^(?:该)?记录已被处理(?:，请刷新后重试)?[\u3002！!]?$/,
  /^(?:该|部分)?预约已被(?:其他管理员)?处理(?:：\d+|，请刷新后重试)?[\u3002！!]?$/,
  /^(?:该)?(?:记录|预约|数据)?状态(?:已)?(?:发生)?变化(?:，请刷新后重试)?[\u3002！!]?$/
]

function safeConflictMessage(value) {
  const message = String(value || '').trim()
  if (!message || message.length > 80) return ''
  return SAFE_CONFLICT_PATTERNS.some(pattern => pattern.test(message)) ? message : ''
}

export function getErrorPresentation(error = {}) {
  const response = error.response
  const status = Number(response?.status || 0)
  const silentError = error.config?.silentError === true
  let message = '网络连接失败，请检查网络后重试'
  let clearSession = false
  let redirectTo = ''

  if (response) {
    if (status === 401) {
      message = '登录已失效，请重新登录'
      clearSession = true
      redirectTo = '/login'
    } else if (status === 403) {
      message = '当前账号没有权限执行此操作'
    } else if (status === 404) {
      message = '所需内容暂时无法找到，可能已调整'
    } else if (status === 400 || status === 422) {
      message = '提交内容不完整，请检查后重试'
    } else if (status === 409) {
      message = safeConflictMessage(response.data?.message) || '数据已发生变化，请刷新后重试'
    } else if (status === 429) {
      message = '操作过快，请稍后再试'
    } else if (status >= 500) {
      message = '服务暂时不可用，请稍后重试；持续出现请联系系统管理员'
    } else {
      message = '操作未完成，请稍后重试'
    }
  }

  return { message, shouldNotify: !silentError, clearSession, redirectTo }
}
