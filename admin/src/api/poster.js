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

// ── 张贴位置管理 ──────────────────────────────────────────────────────────────
// 历史 Bug：以下 4 个接口此前全部打在 `/poster`（海报申请接口）上，
// 读列表读到的是海报申请、写操作还会误增改删海报申请数据。
// 现统一指向后端新增的 `/poster/positions` 资源（见 server/src/routes/poster.js）。
export function getPositions(params) {
  return request.get('/poster/positions', { params })
}

export function createPosition(data) {
  return request.post('/poster/positions', data)
}

export function updatePosition(id, data) {
  return request.put(`/poster/positions/${id}`, data)
}

export function deletePosition(id) {
  return request.delete(`/poster/positions/${id}`)
}
