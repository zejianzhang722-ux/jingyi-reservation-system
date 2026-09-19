import request from '@/utils/request'

export function manualCheckin(data) {
  return request.post('/checkin/manual', data)
}

export function manualCheckout(data) {
  return request.post('/checkin/checkout', data)
}

// BUG#3：签到面板改为拉取管理员数据域内的全部在场签到列表（分页）。
export function getCurrentList(params) {
  return request.get('/checkin/current', { params })
}

// BUG#3：巡查是「写操作」（标记某条在场签到缺席 → 爽约 + 扣分），需传入 reservationId；不再作为列表接口。
export function submitPatrol(data) {
  return request.post('/checkin/patrol', data)
}
