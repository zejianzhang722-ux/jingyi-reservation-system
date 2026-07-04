function normalizeSlot(slot) {
  const status = slot?.status || (slot?.occupied ? 'occupied' : 'available');
  return {
    time: slot?.time || slot?.startTime || '',
    endTime: slot?.endTime || '',
    status,
    availableCount: Number(slot?.availableCount ?? slot?.available_count ?? 0),
    totalCount: Number(slot?.totalCount ?? slot?.total_count ?? 0),
    userName: slot?.userName || slot?.real_name || slot?.nickname || ''
  };
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


