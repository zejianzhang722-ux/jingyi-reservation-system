const config = require('../config');
const db = require('../config/database');
const logger = require('../config/logger');

// 可由 system_config 覆盖的信用参数。扣分统一以正数存储，加载时转为负数。
const CREDIT_KEYS = [
  'initialScore', 'maxScore', 'goodThreshold',
  'warningThreshold', 'restrictThreshold', 'banThreshold',
  'restrictDays', 'banDays',
  'noshowPenalty', 'violationPenalty', 'goodReward', 'feedbackReward'
];
const PENALTY_KEYS = ['noshowPenalty', 'violationPenalty'];

// 可由 system_config 覆盖的预约参数。
const RESERVATION_NUMERIC_KEYS = [
  'advanceDays', 'cancelBeforeHours', 'lateMinutes', 'noshowCountLimit', 'noshowPauseDays'
];
const RESERVATION_STRING_KEYS = ['advanceStartTime', 'advanceEndTime'];

const BOUNDS = {
  initialScore: [0, 200],
  maxScore: [50, 200],
  goodThreshold: [0, 200],
  warningThreshold: [0, 200],
  restrictThreshold: [0, 200],
  banThreshold: [0, 200],
  restrictDays: [0, 365],
  banDays: [0, 365],
  noshowPenalty: [0, 100],
  violationPenalty: [0, 100],
  goodReward: [0, 50],
  feedbackReward: [0, 50],
  advanceDays: [0, 30],
  cancelBeforeHours: [0, 72],
  lateMinutes: [1, 120],
  noshowCountLimit: [1, 20],
  noshowPauseDays: [0, 365]
};

let refreshTimer = null;
let lastLoadedAt = null;

const parseValue = function(raw) {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (err) {
    return text;
  }
};

const clamp = function(key, value) {
  const bounds = BOUNDS[key];
  if (!bounds) return value;
  return Math.min(bounds[1], Math.max(bounds[0], value));
};

const applyNumericSection = function(section, source, keys) {
  let changed = 0;
  keys.forEach(function(key) {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === '') return;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return;
    const normalized = PENALTY_KEYS.indexOf(key) !== -1
      ? -Math.abs(clamp(key, Math.abs(numeric)))
      : clamp(key, numeric);
    if (section[key] === normalized) return;
    section[key] = normalized;
    changed += 1;
  });
  return changed;
};

const applyStringSection = function(section, source, keys) {
  let changed = 0;
  keys.forEach(function(key) {
    const raw = source[key];
    if (raw === undefined || raw === null) return;
    const text = String(raw).trim();
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return;
    const normalized = text.slice(0, 5);
    if (section[key] === normalized) return;
    section[key] = normalized;
    changed += 1;
  });
  return changed;
};

const loadRuntimeConfig = async function() {
  if (db.isMock()) return { loaded: 0, mode: 'mock' };
  try {
    const [rows] = await db.query(
      "SELECT config_key, config_value FROM system_config WHERE config_key IN ('credit', 'reservation')"
    );
    let changed = 0;
    rows.forEach(function(row) {
      const value = parseValue(row.config_value);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      if (row.config_key === 'credit') {
        changed += applyNumericSection(config.credit, value, CREDIT_KEYS);
      }
      if (row.config_key === 'reservation') {
        changed += applyNumericSection(config.reservation, value, RESERVATION_NUMERIC_KEYS);
        changed += applyStringSection(config.reservation, value, RESERVATION_STRING_KEYS);
      }
    });
    lastLoadedAt = new Date().toISOString();
    if (changed > 0) logger.info('运行时配置已刷新，覆盖字段数: ' + changed);
    return { loaded: changed, mode: 'mysql' };
  } catch (err) {
    // 配置读取失败不应阻断业务，继续使用代码默认值。
    logger.error('加载运行时配置失败，继续使用默认参数:', err && err.message);
    return { loaded: 0, mode: 'error' };
  }
};

const startAutoRefresh = function(intervalMs) {
  if (refreshTimer) return { started: false, intervalMs: 0 };
  const interval = Math.max(5000, Number(intervalMs) || 30000);
  refreshTimer = setInterval(function() {
    loadRuntimeConfig().catch(function(err) {
      logger.error('定时刷新运行时配置失败:', err && err.message);
    });
  }, interval);
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
  logger.info('运行时配置定时刷新已启动，间隔毫秒: ' + interval);
  return { started: true, intervalMs: interval };
};

const stopAutoRefresh = function() {
  if (!refreshTimer) return { stopped: false };
  clearInterval(refreshTimer);
  refreshTimer = null;
  return { stopped: true };
};

const snapshot = function() {
  return {
    credit: Object.assign({}, config.credit),
    reservation: Object.assign({}, config.reservation),
    loadedAt: lastLoadedAt
  };
};

module.exports = {
  CREDIT_KEYS,
  RESERVATION_NUMERIC_KEYS,
  RESERVATION_STRING_KEYS,
  BOUNDS,
  parseValue,
  loadRuntimeConfig,
  startAutoRefresh,
  stopAutoRefresh,
  snapshot
};
