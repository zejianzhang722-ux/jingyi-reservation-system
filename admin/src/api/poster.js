import request from '@/utils/request'

export function getPending(params) {
  return request.get('/poster', { params })
}

export function approve(id, data) {
  return request.post(`/poster/${id}/approve`, data)
}

export function reject(id, data) {
  return request.post(`/poster/${id}/reject`, data)
}

export function markClean(id) {
  return request.post(`/poster/${id}/clean`)
}

export function markViolation(id, data) {
  return request.post(`/poster/${id}/violation`, data)
}

export function getPositions(params) {
  return request.get('/poster', { params })
}

export function createPosition(data) {
  return request.post('/poster', data)
}

export function updatePosition(id, data) {
  return request.put(`/poster/${id}`, data)
}

export function deletePosition(id) {
  return request.delete(`/poster/${id}`)
}
