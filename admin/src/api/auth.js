import request from '@/utils/request'

export function login(data) {
  return request.post('/auth/login/admin', data)
}

export function refresh() {
  return request.post('/auth/refresh')
}

export function logout() {
  return request.post('/auth/logout')
}
