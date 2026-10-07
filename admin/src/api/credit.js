import request from '@/utils/request'

// options：透传给 request 的额外配置（如 { silentError: true } 关闭全局错误 toast）。
export function getViolations(params, options = {}) {
  return request.get('/credit/violations', { ...options, params })
}

export function createViolation(data) {
  return request.post('/credit/violation', data)
}

export function getBlacklist(params, options = {}) {
  return request.get('/credit/blacklist', { ...options, params })
}

export function getStudentCredit(id) { return request.get('/credit/students/' + encodeURIComponent(id)) }
export function setStudentCredit(id, data) { return request.put('/credit/students/' + encodeURIComponent(id), data) }

export function toggleBan(data) {
  const id = data.userId || data.studentId || data.studentNo
  return request.put('/credit/blacklist/' + id, data)
}

export function getScoreConfig() {
  return request.get('/admin/config')
}

export function updateScoreConfig(data) {
  return request.put('/admin/config', data)
}
