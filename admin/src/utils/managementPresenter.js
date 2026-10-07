export function creditRow(row) {
  return { ...row, userId: row.userId ?? row.id, userName: row.userName || row.real_name || row.nickname || '', studentId: row.studentId || row.student_id || '', creditScore: row.creditScore ?? row.credit_score, banExpiresAt: row.banExpiresAt || row.restricted_until || '' }
}
export function violationRow(row) {
  return { ...row, userName: row.userName || row.real_name || row.nickname || '', studentId: row.studentId || row.student_id || '', deduction: row.deduction ?? Math.abs(Number(row.score || 0)), createdAt: row.createdAt || row.created_at || '', operatorName: row.operatorName || row.operator_name || '系统记录' }
}
export function posterImageUrl(value) {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('/uploads/')) return (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/api\/v1\/?$/, '') + value
  return ''
}
export function posterRow(row) {
  return { ...row, userName: row.userName || row.real_name || row.nickname || '', studentId: row.studentId || row.student_id || '', position: row.position_name || row.position || '', startDate: String(row.startDate || row.start_date || '').slice(0,10), endDate: String(row.endDate || row.end_date || '').slice(0,10), createdAt: row.createdAt || row.created_at || '', imageUrl: posterImageUrl(row.imageUrl || row.image_url) }
}
