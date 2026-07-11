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

export function exportData(params) {
  return request.get('/stats/export', { params, responseType: 'blob' })
}
