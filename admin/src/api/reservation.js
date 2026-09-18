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

/**
 * 获取预约审核轨迹（一审 / 二审批注，只读，入口已脱敏）。
 * 后端：GET /api/v1/reservation/:id/trail（见 server/src/controllers/reservationTrailController.js）
 * @param {number|string} id 预约 id
 * @returns {Promise<{code:number,message:string,data:Array}>} data 为轨迹数组
 */
export function getReservationTrail(id) {
  return request.get(`/reservation/${id}/trail`)
}
