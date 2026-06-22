import request from '@/utils/request'

export function getPending(params) {
  return request.get('/audit/pending', { params })
}

export function approve(id, data) {
  return request.post(`/audit/${id}/approve`, data)
}

export function reject(id, data) {
  return request.post(`/audit/${id}/reject`, data)
}

export function batchAudit(data) {
  return request.post('/audit/batch', data)
}

export function getAll(params) {
  return request.get('/reservation', { params })
}

export function getDetail(id) {
  return request.get(`/reservation/${id}`)
}

export function getCounselorPending(params) {
  return request.get('/audit/counselor/pending', { params })
}
