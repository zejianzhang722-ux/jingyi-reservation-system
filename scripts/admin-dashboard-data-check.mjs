import assert from 'node:assert/strict';

import {
  formatReservationTrend,
  formatUsageRate,
  formatPeakHours,
  formatNoshowRate,
  formatUserActivity
} from '../admin/src/utils/statsFormatters.js';
import {
  normalizeTimelineResponse,
  buildMiniTimeline,
  getTimelineSlotState
} from '../admin/src/utils/roomTimeline.js';

const reservationRows = [
  { period: '2026-07-01', total: 3, approved: 1, completed: 1, cancelled: 1, noshow: 0 },
  { period: '2026-07-02', total: 2, approved: 1, completed: 0, cancelled: 0, noshow: 1 }
];

assert.deepEqual(formatReservationTrend(reservationRows), {
  dates: ['2026-07-01', '2026-07-02'],
  total: [3, 2],
  used: [2, 1],
  cancelled: [1, 0]
});

const usageRows = [
  { room_name: 'B228自习室', reservation_count: 6, used_days: 3 },
  { room_name: 'C128影音室', reservation_count: 2, used_days: 2 }
];

assert.deepEqual(formatUsageRate(usageRows, 30), {
  rooms: ['B228自习室', 'C128影音室'],
  rates: [20, 7]
});

assert.deepEqual(formatPeakHours([
  { start_time: '09:00', count: 4 },
  { start_time: '14:00', count: 2 }
]), {
  hours: ['09:00', '14:00'],
  counts: [4, 2]
});

assert.deepEqual(formatNoshowRate({
  totalNoshow: 3,
  roomNoshowStats: [
    { name: 'B228自习室', noshow_count: 2 },
    { name: 'C128影音室', noshow_count: 1 }
  ]
}), {
  labels: ['B228自习室', 'C128影音室'],
  rates: [67, 33]
});

assert.deepEqual(formatUserActivity({
  newUsers: [{ date: '2026-07-01', count: 2 }],
  activeUsers: [{ date: '2026-07-01', count: 5 }, { date: '2026-07-02', count: 3 }]
}), {
  dates: ['2026-07-01', '2026-07-02'],
  active: [5, 3],
  newUsers: [2, 0]
});

const timelineResponse = {
  roomId: 1,
  timeline: [
    { time: '09:00', endTime: '09:30', status: 'available', availableCount: 10, totalCount: 12 },
    { time: '09:30', endTime: '10:00', status: 'occupied', availableCount: 0, totalCount: 12 },
    { time: '10:00', endTime: '10:30', status: 'available', availableCount: 6, totalCount: 12 }
  ]
};

const normalized = normalizeTimelineResponse(timelineResponse);
assert.equal(normalized.length, 3);
assert.deepEqual(getTimelineSlotState(normalized[1]), {
  occupied: true,
  label: '占用',
  detail: '09:30-10:00 占用，剩余 0/12'
});
assert.deepEqual(buildMiniTimeline(timelineResponse, 2), [
  { time: '09:00', occupied: false, label: '空闲', detail: '09:00-09:30 空闲，剩余 10/12' },
  { time: '09:30', occupied: true, label: '占用', detail: '09:30-10:00 占用，剩余 0/12' }
]);

console.log('admin dashboard data checks passed');
