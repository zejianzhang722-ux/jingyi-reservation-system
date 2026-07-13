import request from '@/utils/request'

export function getPending(params) {
  return request.get('/audit/pending', { params })
}

export async function getPendingCount(params) {
  const response = await request.get('/reservation/pending-count', { params })
  const count = Number(response?.data?.count)
  return Number.isFinite(count) && count > 0 ? count : 0
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

export function getAll(params, options = {}) {
  return request.get('/reservation', { ...options, params })
}

export function getDetail(id) {
  return request.get(`/reservation/${id}`)
}

export function getCounselorPending(params) {
  return request.get('/audit/counselor/pending', { params })
}
