import request from '@/utils/request'

// 团队预约（组团预约）。学生端接口与小程序共用同一套后端路由 /api/v1/groups。
// 注意：管理端目前还没有组团预约页面，本模块为下一步接入预留。

export function create(data) {
  return request.post('/groups', data)
}

export function listMine(params) {
  return request.get('/groups/mine', { params })
}

export function listPending(params) {
  return request.get('/groups/pending', { params })
}

export function detail(id) {
  return request.get('/groups/' + id)
}

export function join(id) {
  return request.post('/groups/' + id + '/join')
}

export function leave(id) {
  return request.post('/groups/' + id + '/leave')
}

export function dissolve(id) {
  return request.delete('/groups/' + id)
}

export function approve(id) {
  return request.put('/groups/' + id + '/approve')
}

export function reject(id, data) {
  return request.put('/groups/' + id + '/reject', data)
}
