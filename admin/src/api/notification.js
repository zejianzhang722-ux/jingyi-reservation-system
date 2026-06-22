import request from '@/utils/request'

export function getNotifications(params) {
  return request.get('/notification', { params })
}

export function markRead(id) {
  return request.put(`/notification/${id}/read`)
}

export function markAllRead() {
  return request.put('/notification/read-all')
}

export function getUnreadCount() {
  return request.get('/notification/unread-count')
}
