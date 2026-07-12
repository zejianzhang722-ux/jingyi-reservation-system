const GENERIC_REASONS = new Set(['批量退回', '退回', '不通过'])

export function normalizeRejectionReason(value) {
  const reason = String(value || '').trim()
  if (!reason) throw new Error('请输入退回原因')
  if (GENERIC_REASONS.has(reason)) throw new Error('请填写具体的退回原因')
  return reason
}
