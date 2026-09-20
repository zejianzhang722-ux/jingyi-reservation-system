import request from '@/utils/request'

export function snapshot() {
  return request.get('/admin/config/effective')
}
