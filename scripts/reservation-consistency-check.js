const assert = require('assert')

const db = require('../server/src/config/database')
const reservationService = require('../server/src/services/reservationService')
const reservationLifecycleService = require('../server/src/services/reservationLifecycleService')

function formatDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0')
}

function activeSlotCount(reservationId) {
  const tables = require('../server/src/config/mock-db').__tables
  return (tables.reservation_slots || []).filter(function(slot) {
    return Number(slot.reservation_id) === Number(reservationId)
  }).length
}

async function main() {
  await db.ready()
  assert.strictEqual(db.isMock(), true, 'mock consistency regression must use isolated mock data')

  const target = new Date()
  target.setDate(target.getDate() + 3)
  const date = formatDate(target)
  const baseRequest = {
    userId: 1,
    roomId: 8,
    seatId: null,
    date,
    startTime: '18:00',
    endTime: '19:00',
    purpose: '项目研讨',
    participants: 4,
    idempotencyKey: 'local-consistency-' + Date.now()
  }

  const first = await reservationService.createReservation(baseRequest)
  assert(first && first.id, '第一次预约应创建成功')
  assert.strictEqual(activeSlotCount(first.id), 60, '一小时预约应写入60个分钟槽')

  const repeated = await reservationService.createReservation(baseRequest)
  assert.strictEqual(Number(repeated.id), Number(first.id), '相同幂等键和相同参数应返回原预约')
  assert.strictEqual(repeated.idempotent, true, '重复幂等请求应标记为幂等返回')

  let idempotencyConflict = null
  try {
    await reservationService.createReservation(Object.assign({}, baseRequest, { participants: 5 }))
  } catch (err) {
    idempotencyConflict = err
  }
  assert(idempotencyConflict && idempotencyConflict.httpStatus === 409, '相同幂等键不同参数应返回409')

  let slotConflict = null
  try {
    await reservationService.createReservation(Object.assign({}, baseRequest, {
      idempotencyKey: 'local-consistency-conflict-' + Date.now(),
      userId: 2,
      purpose: '冲突测试'
    }))
  } catch (err) {
    slotConflict = err
  }
  assert(slotConflict && slotConflict.httpStatus === 409, '相同房间时间槽冲突应返回409')

  await reservationService.joinWaitlist({
    userId: 2,
    roomId: baseRequest.roomId,
    seatId: baseRequest.seatId,
    date: baseRequest.date,
    startTime: baseRequest.startTime,
    endTime: baseRequest.endTime
  })

  const releaseResult = await reservationLifecycleService.releaseAndPromote({
    reservationId: first.id,
    nextStatus: 'cancelled',
    actorUserId: 1,
    actorRole: 'student',
    allowedCurrentStatuses: ['approved']
  })

  assert.strictEqual(activeSlotCount(first.id), 0, '取消预约后应释放时间槽')
  assert(releaseResult.promotedReservation && releaseResult.promotedReservation.id, '释放后应将候补转为正式预约')
  assert.strictEqual(activeSlotCount(releaseResult.promotedReservation.id), 60, '候补转正也应写入时间槽')

  console.log('reservation-consistency-check passed')
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
