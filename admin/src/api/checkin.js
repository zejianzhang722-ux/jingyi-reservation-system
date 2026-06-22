import request from '@/utils/request'

export function manualCheckin(data) {
  return request.post('/checkin/manual', data)
}

export function manualCheckout(data) {
  return request.post('/checkin/checkout', data)
}

export function getCurrentList(params) {
  return request.get('/checkin/status/0', { params })
}

export function getPatrolList(params) {
  return request.post('/checkin/patrol', params)
}
