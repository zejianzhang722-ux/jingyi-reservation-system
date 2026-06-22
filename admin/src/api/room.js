import request from '@/utils/request'

export function getList(params) {
  return request.get('/admin/rooms', { params })
}

export function getDetail(id) {
  return request.get(`/admin/rooms/${id}`)
}

export function create(data) {
  return request.post('/admin/rooms', data)
}

export function update(id, data) {
  return request.put(`/admin/rooms/${id}`, data)
}

export function deleteRoom(id) {
  return request.delete(`/admin/rooms/${id}`)
}

export function getTimeline(id, params) {
  return request.get(`/room/${id}/timeline`, { params })
}

export function getSeats(roomId, params) {
  return request.get(`/room/${roomId}/seats`, { params })
}

export function createSeats(roomId, data) {
  return request.post('/admin/seats/batch', data)
}

export function updateSeat(roomId, seatId, data) {
  return request.put(`/admin/seats/${seatId}`, data)
}

export function deleteSeat(roomId, seatId) {
  return request.delete(`/admin/seats/${seatId}`)
}

export function updateRules(roomId, data) {
  return request.put(`/admin/rooms/${roomId}`, data)
}

export function getBuildings(params) {
  return request.get('/admin/buildings', { params })
}

export function createBuilding(data) {
  return request.post('/admin/buildings', data)
}

export function updateBuilding(id, data) {
  return request.put(`/admin/buildings/${id}`, data)
}

export function deleteBuilding(id) {
  return request.delete(`/admin/buildings/${id}`)
}
