import request from '@/utils/request'

export function getAdmins(params) {
  return request.get('/admin/managers', { params })
}

export function createAdmin(data) {
  return request.post('/admin/managers', data)
}

export function updateAdmin(id, data) {
  return request.put(`/admin/managers/${id}`, data)
}

export function deleteAdmin(id) {
  return request.delete(`/admin/managers/${id}`)
}

export function getLogs(params, options = {}) {
  return request.get('/admin/operation-logs', { ...options, params })
}

export function getAnnouncements(params) {
  return request.get('/admin/announcements', { params })
}

export function createAnnouncement(data) {
  return request.post('/admin/announcements', data)
}

export function updateAnnouncement(id, data) {
  return request.put(`/admin/announcements/${id}`, data)
}

export function deleteAnnouncement(id) {
  return request.delete(`/admin/announcements/${id}`)
}

export function getBackupList(params) {
  return request.get('/admin/backups', { params })
}

export function createBackup() {
  return request.post('/admin/backup')
}

export function verifyBackup(fileName) {
  return request.post(`/admin/backups/${fileName}/verify`)
}
