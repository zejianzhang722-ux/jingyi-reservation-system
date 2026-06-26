const path = require('path');
const response = require('../utils/response');
const logger = require('../config/logger');
const backupService = require('../services/backupService');

const safeBackupPath = function(fileName) {
  const name = path.basename(String(fileName || ''));
  if (!/^[A-Za-z0-9TZ.-]+\.jybak$/.test(name)) {
    const err = new Error('备份文件名无效');
    err.httpStatus = 400;
    throw err;
  }
  return path.join(backupService.backupRoot(), name);
};

const create = async function(req, res) {
  try {
    const result = await backupService.createBackup({
      trigger: 'manual',
      requestedBy: req.user && req.user.id
    });
    return response.success(res, {
      backupId: result.backupId,
      fileName: result.fileName,
      sizeBytes: result.sizeBytes,
      checksum: result.checksum,
      secondaryCopied: result.secondaryCopied,
      createdAt: result.manifest.createdAt
    }, '加密备份已创建并校验');
  } catch (err) {
    logger.error('管理员创建备份失败', { requestId: req.requestId, error: err.message, code: err.code });
    return response.error(res, err.message || '备份失败', err.httpStatus || 500);
  }
};

const list = async function(req, res) {
  try {
    const rows = await backupService.listBackups(req.query.limit);
    return response.success(res, rows);
  } catch (err) {
    return response.error(res, err.message || '获取备份记录失败', 500);
  }
};

const verify = async function(req, res) {
  try {
    const result = await backupService.verifyBackup(safeBackupPath(req.params.fileName));
    return response.success(res, result, '备份完整性校验通过');
  } catch (err) {
    logger.error('管理员校验备份失败', { requestId: req.requestId, fileName: req.params.fileName, error: err.message, code: err.code });
    return response.error(res, err.message || '备份校验失败', err.httpStatus || 422);
  }
};

module.exports = { safeBackupPath, create, list, verify };
