const localData = require('../miniapp/utils/local-data')
const mockDb = require('../server/src/config/mock-db')

const tables = mockDb.__tables
const errors = []

function fail(message) {
  errors.push(message)
}

function byId(rows) {
  const map = new Map()
  rows.forEach((row) => map.set(Number(row.id), row))
  return map
}

const localRooms = localData.getLocalRooms()
const serverRooms = tables.rooms || []
const serverUsers = tables.users || []
const serverSeats = tables.seats || []
const reservations = tables.reservations || []
const creditLogs = tables.credits_log || []

const localRoomIds = new Set(localRooms.map((room) => Number(room.id)))
const serverRoomIds = new Set(serverRooms.map((room) => Number(room.id)))
const serverUserIds = new Set(serverUsers.map((user) => Number(user.id)))
const serverSeatIds = new Set(serverSeats.map((seat) => Number(seat.id)))
const usersById = byId(serverUsers)

localRoomIds.forEach((id) => {
  if (!serverRoomIds.has(id)) fail(`前端本地房间 ${id} 在后端模拟房间中不存在`)
})

serverRoomIds.forEach((id) => {
  if (!localRoomIds.has(id)) fail(`后端模拟房间 ${id} 在前端本地房间中不存在`)
})

reservations.forEach((reservation) => {
  if (!serverUserIds.has(Number(reservation.user_id))) {
    fail(`预约 ${reservation.id} 引用了不存在的用户 ${reservation.user_id}`)
  }
  if (!serverRoomIds.has(Number(reservation.room_id))) {
    fail(`预约 ${reservation.id} 引用了不存在的功能房 ${reservation.room_id}`)
  }
  if (reservation.seat_id && !serverSeatIds.has(Number(reservation.seat_id))) {
    fail(`预约 ${reservation.id} 引用了不存在的座位 ${reservation.seat_id}`)
  }
})

creditLogs.forEach((log) => {
  if (!serverUserIds.has(Number(log.user_id))) {
    fail(`信用记录 ${log.id} 引用了不存在的用户 ${log.user_id}`)
  }
  if (log.description === undefined || String(log.description).trim() === '') {
    fail(`信用记录 ${log.id} 缺少加减分原因`)
  }
})

serverUsers.forEach((user) => {
  const logs = creditLogs.filter((log) => Number(log.user_id) === Number(user.id))
  if (logs.length > 0) {
    const latest = logs[logs.length - 1]
    if (latest.score_after !== undefined && Number(latest.score_after) !== Number(user.credit_score)) {
      fail(`用户 ${user.id} 当前信用分与信用记录不一致`)
    }
  }
})

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('test-data-consistency-check passed')
