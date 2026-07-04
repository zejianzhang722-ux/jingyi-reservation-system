function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeRows(rows) {
  if (Array.isArray(rows)) return rows;
  return [];
}

export function formatReservationTrend(rows) {
  const list = normalizeRows(rows);
  return {
    dates: list.map(row => row.period || row.date || ''),
    total: list.map(row => toNumber(row.total)),
    used: list.map(row => toNumber(row.approved) + toNumber(row.completed) + toNumber(row.checked_in)),
    cancelled: list.map(row => toNumber(row.cancelled))
  };
}

export function formatUsageRate(rows, days = 30) {
  const list = normalizeRows(rows);
  const denominator = Math.max(1, toNumber(days) || 30);
  return {
    rooms: list.map(row => row.room_name || row.name || ''),
    rates: list.map(row => Math.min(100, Math.round((toNumber(row.reservation_count) / denominator) * 100)))
  };
}

export function formatPeakHours(rows) {
  const list = normalizeRows(rows);
  return {
    hours: list.map(row => row.start_time || row.hour || ''),
    counts: list.map(row => toNumber(row.count))
  };
}

export function formatNoshowRate(data) {
  const rows = normalizeRows(data?.roomNoshowStats);
  const total = toNumber(data?.totalNoshow) || rows.reduce((sum, row) => sum + toNumber(row.noshow_count), 0);
  return {
    labels: rows.map(row => row.name || row.room_name || ''),
    rates: rows.map(row => (total > 0 ? Math.round((toNumber(row.noshow_count) / total) * 100) : 0))
  };
}

export function formatUserActivity(data) {
  const activeRows = normalizeRows(data?.activeUsers);
  const newRows = normalizeRows(data?.newUsers);
  const dates = Array.from(new Set([
    ...activeRows.map(row => row.date),
    ...newRows.map(row => row.date)
  ].filter(Boolean))).sort();

  const activeMap = new Map(activeRows.map(row => [row.date, toNumber(row.count)]));
  const newMap = new Map(newRows.map(row => [row.date, toNumber(row.count)]));

  return {
    dates,
    active: dates.map(date => activeMap.get(date) || 0),
    newUsers: dates.map(date => newMap.get(date) || 0)
  };
}

export function getRangeDays(startDate, endDate) {
  if (!startDate || !endDate) return 30;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 30;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}
