/**
 * 预约状态 → 展示映射（管理端统一出口，Batch4 · R-12 一致性批二）。
 *
 * 设计依据：v1.1 第七节「状态标签体系（7 态）」。
 * 核心诉求：`counselor_pending`（待辅导员审核）与 `pending`（待审核）在列表快速扫视时必须色相可区分，
 * 因此前者使用 `primary`（蓝）而非琥珀系 `warning`，避免与「待审核」混淆。
 *
 * 说明：Element Plus 标签不支持「同一 type 内再细分色相」，故在框架内置 type 中选取可区分项；
 * 与设计稿给出的橙色 hex（#FFEDD5/#C2410C）略有出入，属框架能力约束下的等价落地（详见 Batch4 报告）。
 * 本文件为唯一来源，避免状态→tagType 映射在各页面重复分散。
 */

/** 预约状态 → { label, type } 映射（label 沿用现有文案，保持向后兼容）。 */
export const RESERVATION_STATUS_MAP = Object.freeze({
  pending: { label: '待审核', type: 'warning' },
  counselor_pending: { label: '辅导员审核', type: 'primary' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  checked_in: { label: '使用中', type: 'info' },
  completed: { label: '已完成', type: 'info' },
  noshow: { label: '已爽约', type: 'danger' },
  cancelled: { label: '已取消', type: 'info' }
})

/** 缺省状态元信息（未知状态兜底）。 */
const UNKNOWN_STATUS = Object.freeze({ label: '状态待确认', type: 'info' })

/**
 * 读取状态元信息。
 * @param {string} status 预约状态
 * @returns {{label: string, type: string}}
 */
export function reservationStatusMeta(status) {
  return RESERVATION_STATUS_MAP[status] || UNKNOWN_STATUS
}

/**
 * 读取状态中文文案。
 * @param {string} status 预约状态
 * @returns {string}
 */
export function reservationStatusLabel(status) {
  return reservationStatusMeta(status).label
}

/**
 * 读取状态对应的 Element Plus 标签 type。
 * @param {string} status 预约状态
 * @returns {string}
 */
export function reservationStatusType(status) {
  return reservationStatusMeta(status).type
}
