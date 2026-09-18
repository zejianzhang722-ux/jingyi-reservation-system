/**
 * 隐私明文访问审计（R-14 合规要求）。
 *
 * 管理员查看明文个人敏感信息（学号 / 手机号 / 姓名）必须留痕。
 * 复用 services/auditTrailService.js 的 record()（哈希链审计日志）。
 *
 * 失败策略：审计写入失败**不阻断**业务响应（与仓库内 createNotificationSafely 的既有风格一致），
 * 但会记录 error 级日志便于告警。若后续要求合规强一致，可改为 fail-closed。
 */

const auditTrailService = require('./auditTrailService');
const maskPresenter = require('../utils/maskPresenter');
const logger = require('../config/logger');

const PLAINTEXT_VIEW_ACTION = 'privacy.plaintext_view';

/**
 * 写入一条「管理员查看明文」审计。
 * @param {import('express').Request} req 请求对象
 * @param {object} [options] 附加信息
 * @param {string} [options.action] 审计 action，默认 privacy.plaintext_view
 * @param {string} [options.targetTable] 目标表
 * @param {number|null} [options.targetId] 目标主键
 * @param {string} [options.description] 描述
 * @param {object} [options.metadata] 元数据
 * @param {number} [options.statusCode] 状态码，默认 200
 * @returns {Promise<boolean>} 是否写入成功
 */
const recordPlaintextAccess = async function(req, options) {
  const settings = options || {};
  try {
    const base = req && req.baseUrl ? req.baseUrl : '';
    const route = req && req.route && req.route.path ? req.route.path : '';
    const fallbackPath = req && (req.path || req.originalUrl || req.url) ? (req.path || req.originalUrl || req.url) : '';
    await auditTrailService.record({
      operatorId: req && req.user ? req.user.id : null,
      requestId: req ? req.requestId : undefined,
      actorRole: req && req.user ? req.user.role : 'system',
      action: settings.action || PLAINTEXT_VIEW_ACTION,
      targetTable: settings.targetTable || '',
      targetId: settings.targetId === undefined ? null : settings.targetId,
      description: settings.description || '管理员查看明文个人敏感信息',
      method: req ? req.method : '',
      path: (base + route) || String(fallbackPath).split('?')[0],
      statusCode: Number(settings.statusCode) || 200,
      metadata: settings.metadata || {}
    });
    return true;
  } catch (err) {
    logger.error('隐私明文访问审计写入失败:', err && err.message ? err.message : err);
    return false;
  }
};

/**
 * 对一组返回给前端的行做「按请求者身份的脱敏」，并在确需明文审计时落一条审计。
 * 这是控制器层统一的出口：所有可能返回学号/手机号/姓名的接口都应经此函数。
 *
 * 行为：
 *  - req 无 req.user（理论上不会）时 viewer 为 null，按 maskPresenter 约定**原样返回**（不改数据）；
 *  - 学生看自己 / 管理员在数据域内看他人 -> 明文，且管理员看他人时落审计；
 *  - 其他情况 -> 掩码。
 *
 * @param {import('express').Request} req 请求对象
 * @param {Array<object>} rows 原始数据行
 * @param {object} [options] 审计信息（targetTable / description / metadata / action）
 * @returns {Promise<Array<object>>} 已按身份处理后的行数组
 */
const maskRowsForRequest = async function(req, rows, options) {
  const settings = options || {};
  const viewer = maskPresenter.viewerFromRequest(req);
  const result = maskPresenter.maskRows(rows, viewer);
  if (result.requiresAudit) {
    await recordPlaintextAccess(req, {
      action: settings.action,
      targetTable: settings.targetTable,
      targetId: settings.targetId,
      description: settings.description,
      metadata: Object.assign({ plaintextCount: result.plaintextCount }, settings.metadata || {})
    });
  }
  return result.rows;
};

module.exports = {
  PLAINTEXT_VIEW_ACTION,
  recordPlaintextAccess,
  maskRowsForRequest
};
