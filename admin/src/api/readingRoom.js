import request from '@/utils/request'

export function getCurrent(params) {
  return request.get('/reading-room/current', { params })
}

export function getHistory(params) {
  return request.get('/reading-room/history', { params })
}
