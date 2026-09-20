import request from '@/utils/request'

export function getDashboard() {
  return request.get('/stats/dashboard')
}

export function getReservations(params) {
  return request.get('/stats/reservations', { params })
}

export function getUsageRate(params) {
  return request.get('/stats/usage-rate', { params })
}

export function getPeakHours(params) {
  return request.get('/stats/peak-hours', { params })
}

export function getNoshow(params) {
  return request.get('/stats/noshow', { params })
}

export function getUsers(params) {
  return request.get('/stats/users', { params })
}

// 后端 /stats/export 返回的是结构化 JSON：{ type, startDate, endDate, rows }，
// 并非二进制文件流。因此不能声明 responseType:'blob'——否则 axios 会把整段 JSON
// 文本原样塞进 Blob，导出文件里就会出现 {"code":200,...} 这样的内容。
export function exportData(params) {
  return request.get('/stats/export', { params })
}
