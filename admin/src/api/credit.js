import request from '@/utils/request'

export function getViolations(params) {
  return request.get('/credit/violations', { params })
}

export function createViolation(data) {
  return request.post('/credit/violation', data)
}

export function getBlacklist(params) {
  return request.get('/credit/blacklist', { params })
}

export function toggleBan(data) {
  return request.put('/credit/blacklist/' + data.userId, data)
}

export function getScoreConfig() {
  return request.get('/admin/config')
}

export function updateScoreConfig(data) {
  return request.put('/admin/config', data)
}
