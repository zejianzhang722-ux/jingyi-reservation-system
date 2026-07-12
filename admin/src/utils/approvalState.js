const GENERIC_REASONS = new Set(['批量退回', '退回', '不通过'])

export function normalizeRejectionReason(value) {
  const reason = String(value || '').trim()
  if (!reason) throw new Error('请输入退回原因')
  if (GENERIC_REASONS.has(reason)) throw new Error('请填写具体的退回原因')
  return reason
}

export function createActionLock(onChange = () => {}) {
  let owner = null
  return {
    get locked() { return owner !== null },
    acquire() {
      if (owner !== null) return null
      owner = Symbol('approval-action')
      onChange(true)
      return owner
    },
    release(token) {
      if (token !== owner) return false
      owner = null
      onChange(false)
      return true
    }
  }
}

export function isConfirmationCancel(error) {
  return error === 'cancel' || error === 'close' || error?.message === 'cancel' || error?.message === 'close'
}

export async function runLockedConfirmedAction(lock, { confirm, action, onSuccess, onError, onStateChange } = {}) {
  const token = lock.acquire()
  if (!token) return false
  onStateChange?.(true)
  try {
    await confirm?.()
    await action?.()
    await onSuccess?.()
    return true
  } catch (error) {
    if (!isConfirmationCancel(error)) await onError?.(error)
    return false
  } finally {
    onStateChange?.(false)
    lock.release(token)
  }
}
