import request from '@/utils/request'

export function getList(params) {
  return request.get('/admin/accounts', { params })
}

export function create(data) {
  return request.post('/admin/accounts', data)
}

export function update(id, data) {
  return request.put('/admin/accounts/' + id, data)
}

export function remove(id) {
  return request.delete('/admin/accounts/' + id)
}
