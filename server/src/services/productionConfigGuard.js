const path = require('path');
const config = require('../config');
const backupCrypto = require('../utils/backupCrypto');

const fail = function(message, code) {
  const err = new Error(message);
  err.code = code || 'PRODUCTION_CONFIG_INVALID';
  throw err;
};

const validate = function() {
  if (process.env.NODE_ENV !== 'production') return { valid: true, production: false };
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    fail('生产环境必须配置至少32字符的JWT_SECRET', 'JWT_SECRET_REQUIRED');
  }
  if (!process.env.MYSQL_PASSWORD || process.env.MYSQL_PASSWORD.length < 8) {
    fail('生产环境必须配置强MySQL密码', 'MYSQL_PASSWORD_REQUIRED');
  }
  if (!process.env.REDIS_PASSWORD || process.env.REDIS_PASSWORD.length < 8) {
    fail('生产环境必须配置Redis密码', 'REDIS_PASSWORD_REQUIRED');
  }
  if (!process.env.OPS_MONITOR_TOKEN || process.env.OPS_MONITOR_TOKEN.length < 32) {
    fail('生产环境必须配置至少32字符的OPS_MONITOR_TOKEN', 'OPS_MONITOR_TOKEN_REQUIRED');
  }
  if (!process.env.AUDIT_IP_HASH_SALT || process.env.AUDIT_IP_HASH_SALT.length < 32) {
    fail('生产环境必须配置至少32字符的AUDIT_IP_HASH_SALT', 'AUDIT_IP_HASH_SALT_REQUIRED');
  }
  try {
    backupCrypto.parseKey(process.env.BACKUP_ENCRYPTION_KEY);
  } catch (err) {
    fail(err.message, err.code || 'BACKUP_ENCRYPTION_KEY_REQUIRED');
  }
  if (!process.env.BACKUP_DIR || !path.isAbsolute(process.env.BACKUP_DIR)) {
    fail('生产环境必须配置绝对路径BACKUP_DIR', 'BACKUP_DIR_REQUIRED');
  }
  if (process.env.ALLOW_SINGLE_COPY_BACKUP !== 'true' && (!process.env.BACKUP_SECONDARY_DIR || !path.isAbsolute(process.env.BACKUP_SECONDARY_DIR))) {
    fail('生产环境必须配置绝对路径BACKUP_SECONDARY_DIR，或显式允许单副本备份', 'BACKUP_SECONDARY_DIR_REQUIRED');
  }
  if (process.env.ALLOW_WECHAT_DISABLED !== 'true' && (!process.env.WECHAT_APPID || !process.env.WECHAT_APPSECRET)) {
    fail('生产环境必须配置微信应用凭据', 'WECHAT_SECRET_REQUIRED');
  }
  if ((config.corsOrigins || []).some(function(origin) {
    return origin === '*' || /localhost|127\.0\.0\.1/.test(origin);
  })) {
    fail('生产环境CORS_ORIGINS不能包含通配符或本机地址', 'CORS_ORIGIN_INVALID');
  }
  if (process.env.ALLOW_INSECURE_BASE_URL !== 'true' && !/^https:\/\//i.test(config.baseUrl || '')) {
    fail('生产环境BASE_URL必须使用HTTPS', 'BASE_URL_HTTPS_REQUIRED');
  }
  return { valid: true, production: true };
};

module.exports = { validate };
