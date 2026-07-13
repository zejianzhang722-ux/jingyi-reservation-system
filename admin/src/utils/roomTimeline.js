function normalizeSlot(slot) {
  const status = slot?.status || (slot?.occupied ? 'occupied' : 'available');
  return {
    time: slot?.time || slot?.startTime || '',
    endTime: slot?.endTime || '',
    status,
    availableCount: Number(slot?.availableCount ?? slot?.available_count ?? 0),
    totalCount: Number(slot?.totalCount ?? slot?.total_count ?? 0),
    userName: slot?.userName || slot?.real_name || slot?.nickname || '',
    purpose: slot?.purpose || '',
    reservationId: slot?.reservationId ?? slot?.reservation_id ?? null
  };
}

const timelineStatus = {
  available: { key: 'available', label: '空闲' },
  free: { key: 'available', label: '空闲' },
  open: { key: 'available', label: '空闲' },
  occupied: { key: 'reserved', label: '已预约' },
  reserved: { key: 'reserved', label: '已预约' },
  myReservation: { key: 'reserved', label: '已预约' },
  using: { key: 'using', label: '使用中' },
  maintenance: { key: 'maintenance', label: '维护' }
}

export function buildTimelineView(data) {
  const slots = normalizeTimelineResponse(data).map(slot => {
    const state = timelineStatus[slot.status] || timelineStatus.available
    return {
      ...slot,
      status: state.key,
      label: state.label,
      timeRange: slot.endTime ? `${slot.time}-${slot.endTime}` : slot.time
    }
  })
  const reservationCount = slots.filter(slot => slot.status === 'reserved' || slot.status === 'using').length

  return {
    slots,
    summary: {
      total: slots.length,
      reservationCount,
      isAllAvailable: slots.every(slot => slot.status === 'available')
    },
    emptyState: slots.length ? null : {
      title: '今日全天空闲',
      description: '当前没有预约或维护安排'
    }
  }
}

export function normalizeTimelineResponse(data) {
  if (Array.isArray(data)) return data.map(normalizeSlot);
  if (Array.isArray(data?.timeline)) return data.timeline.map(normalizeSlot);
  if (Array.isArray(data?.slots)) return data.slots.map(normalizeSlot);
  return [];
}

export function getTimelineSlotState(slot) {
  const normalized = normalizeSlot(slot);
  const occupied = normalized.status === 'occupied' || normalized.status === 'myReservation';
  const label = occupied ? '占用' : '空闲';
  const timeRange = normalized.endTime ? `${normalized.time}-${normalized.endTime}` : normalized.time;
  const capacity = normalized.totalCount > 0 ? `，剩余 ${normalized.availableCount}/${normalized.totalCount}` : '';
  const user = normalized.userName ? `（${normalized.userName}）` : '';

  return {
    occupied,
    label,
    detail: `${timeRange} ${label}${user}${capacity}`
  };
}

export function buildMiniTimeline(data, limit = 8) {
  return normalizeTimelineResponse(data).slice(0, limit).map(slot => {
    const state = getTimelineSlotState(slot);
    return {
      time: slot.time,
      occupied: state.occupied,
      label: state.label,
      detail: state.detail
    };
  });
}


