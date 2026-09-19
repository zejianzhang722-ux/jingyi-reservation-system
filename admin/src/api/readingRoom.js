import request from '@/utils/request'

export function getCurrent(params) {
  return request.get('/reading-room/current', { params })
}

// options：透传给 request 的额外配置（如 { silentError: true } 关闭全局错误 toast）。
export function getHistory(params, options = {}) {
  return request.get('/reading-room/history', { ...options, params })
}
