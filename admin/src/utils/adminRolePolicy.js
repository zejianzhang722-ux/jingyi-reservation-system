export const ROLE_LABELS = {
  super_admin: '超级管理员',
  admin: '管理员',
  counselor: '辅导员'
}

export const ROLE_NAV_PRIORITY = {
  super_admin: ['Dashboard', 'ReservationPending', 'CounselorPending', 'RoomMonitor', 'RoomManage', 'SystemLogs', 'SystemBackup'],
  admin: ['Dashboard', 'ReservationPending', 'CheckinManage', 'ReservationAll', 'ReadingRoomLogs', 'RoomMonitor'],
  counselor: ['Dashboard', 'CounselorPending', 'ReservationPending', 'CheckinManage', 'ReservationAll']
}

export const ROLE_DASHBOARD_COPY = {
  super_admin: {
    title: '系统运营总览',
    description: '关注待办审批、空间运行与系统安全。',
    metrics: ['今日预约', '全部待审核', '使用中空间', '今日异常']
  },
  admin: {
    title: '日常运营工作台',
    description: '优先处理审批、签到与房间管理。',
    metrics: ['今日预约', '运营待审核', '当前使用中', '需跟进异常']
  },
  counselor: {
    title: '辅导员审批工作台',
    description: '集中处理需要辅导员确认的预约。',
    metrics: ['今日相关预约', '待辅导员审核', '当前使用中', '学生异常']
  }
}

export const ROLE_SHORTCUTS = {
  super_admin: [
    { name: 'ReservationPending', title: '预约审核', destination: '/reservation/pending' },
    { name: 'RoomMonitor', title: '空间监控', destination: '/room/monitor' },
    { name: 'SystemLogs', title: '操作日志', destination: '/system/logs' },
    { name: 'SystemBackup', title: '数据备份', destination: '/system/backup' }
  ],
  admin: [
    { name: 'ReservationPending', title: '预约审核', destination: '/reservation/pending' },
    { name: 'CheckinManage', title: '签到核销', destination: '/checkin/manage' },
    { name: 'RoomMonitor', title: '空间监控', destination: '/room/monitor' }
  ],
  counselor: [
    { name: 'CounselorPending', title: '辅导员审核', destination: '/reservation/counselor' },
    { name: 'ReservationPending', title: '预约审核', destination: '/reservation/pending' },
    { name: 'ReservationAll', title: '全部预约', destination: '/reservation/all' }
  ]
}

export function getRoleLabel(role) {
  return ROLE_LABELS[role] || '管理员'
}

export function resolveRoleDestination(destination, role) {
  const shortcuts = ROLE_SHORTCUTS[role] || ROLE_SHORTCUTS.admin
  const fallback = role === 'counselor' ? '/reservation/counselor' : '/reservation/pending'
  return shortcuts.some(item => item.destination === destination) ? destination : fallback
}

const region = (valid, nextValue, previousValue) => ({
  status: valid ? (Array.isArray(nextValue) && nextValue.length === 0 ? 'empty' : 'success') : 'error',
  value: valid ? nextValue : previousValue
})

export function mergeDashboardPayload(previous, data, role) {
  const metricKeys = ['todayReservations', 'pendingCount', 'usingCount', 'noshowCount']
  const isNonNegativeNumber = value => Number.isFinite(value) && value >= 0
  const metricsValid = metricKeys.every(key => isNonNegativeNumber(data?.[key]))
  const pendingValid = Array.isArray(data?.pendingItems)
  const trendLists = [data?.trend?.dates, data?.trend?.reservations, data?.trend?.used, data?.trend?.noshow]
  const trendValid = trendLists.every(Array.isArray) &&
    trendLists.every(items => items.length === trendLists[0].length) &&
    trendLists[0].every(date => typeof date === 'string' && date.trim()) &&
    trendLists.slice(1).every(items => items.every(isNonNegativeNumber))
  const roomTypesValid = Array.isArray(data?.roomTypeStats) && data.roomTypeStats.every(item =>
    typeof item?.name === 'string' && item.name.trim() && isNonNegativeNumber(item.value))
  const rankingRooms = data?.usageRanking?.rooms
  const rankingRates = data?.usageRanking?.rates
  const rankingValid = Array.isArray(rankingRooms) && Array.isArray(rankingRates) &&
    rankingRooms.length === rankingRates.length &&
    rankingRooms.every(room => typeof room === 'string' && room.trim()) &&
    rankingRates.every(rate => isNonNegativeNumber(rate) && rate <= 100)

  return {
    metrics: region(metricsValid, metricKeys.map(key => data[key]), previous.metrics),
    pending: region(pendingValid, pendingValid
      ? data.pendingItems.map(item => ({ ...item, destination: resolveRoleDestination(item.destination, role) }))
      : previous.pending, previous.pending),
    trend: region(trendValid, data?.trend, previous.trend),
    roomTypes: region(roomTypesValid, data?.roomTypeStats, previous.roomTypes),
    ranking: region(rankingValid, data?.usageRanking, previous.ranking)
  }
}

export function sortRoutesForRole(routes, role) {
  const priorities = new Map((ROLE_NAV_PRIORITY[role] || []).map((name, index) => [name, index]))
  return routes
    .map((route, index) => ({ route, index }))
    .sort((left, right) => {
      const leftPriority = priorities.get(left.route.name) ?? Number.MAX_SAFE_INTEGER
      const rightPriority = priorities.get(right.route.name) ?? Number.MAX_SAFE_INTEGER
      return leftPriority - rightPriority || left.index - right.index
    })
    .map(item => item.route)
}
