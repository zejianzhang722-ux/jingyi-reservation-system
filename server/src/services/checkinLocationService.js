/**
 * 签到地理围栏服务（架构设计 R-05 / 任务 T06）。
 *
 * 目标：功能房可配置经纬度，签到时可校验「签到人位置 ↔ 功能房位置」的距离，
 * 用于抑制「远程代签 / 不在现场签到」等作弊行为。
 *
 * 分级判定（防误伤优先，宁可放行可追溯、不轻易阻断）：
 *   - `none`     功能房**未配置**经纬度（或配置非法）→ 不启用围栏，正常放行（兼容存量数据）。
 *   - `verified` 提供了可信定位且距离 ≤ 半径 → 校验通过。
 *   - `degraded` 功能房已配置围栏，但本次**定位缺失或精度过低**（> degradeAccuracyMeters）无法可靠判定
 *                → 放行，但落 `geo_verified=0` 并在响应里标记 `degraded=true`，供运营观察后决定收紧。
 *   - `out`      可信定位且距离 > 半径 → 判定越界，**由调用方拒绝签到**（不消费凭证）。
 *
 * 关键顺序约束（R-05）：
 *   调用方（checkinController.checkin）必须在本服务返回 `out` 时**于消费签到凭证之前**拒绝，
 *   以避免「围栏失败却把一次性凭证作废」导致用户无法重试。
 *
 * 幂等 / 兼容：本服务只读取功能房坐标，不写库；写库由调用方负责（`persistColumns` 提供列映射）。
 */

const db = require('../config/database');
const config = require('../config');
const logger = require('../config/logger');
const geo = require('../utils/geo');

const MODES = Object.freeze({
  NONE: 'none',
  VERIFIED: 'verified',
  DEGRADED: 'degraded',
  OUT: 'out'
});

/**
 * 读取围栏配置（带默认值兜底，避免 config 缺块时抛错）。
 * @returns {{radiusMeters: number, degradeAccuracyMeters: number}}
 */
const readGeoConfig = function() {
  const block = (config && config.checkin) || {};
  const radius = Number(block.geoRadiusMeters);
  const degrade = Number(block.degradeAccuracyMeters);
  return {
    radiusMeters: Number.isFinite(radius) && radius > 0 ? radius : 500,
    degradeAccuracyMeters: Number.isFinite(degrade) && degrade > 0 ? degrade : 100
  };
};

/**
 * 给定功能房坐标与本次签到定位，产出围栏判定结果（纯函数，无 IO，便于单测）。
 *
 * @param {object} input
 * @param {*} input.roomLatitude 功能房纬度
 * @param {*} input.roomLongitude 功能房经度
 * @param {*} [input.lat] 签到人纬度
 * @param {*} [input.lng] 签到人经度
 * @param {*} [input.accuracy] 签到人定位精度（米）
 * @param {number} [input.radiusMeters] 允许半径（米）
 * @param {number} [input.degradeAccuracyMeters] 精度降级阈值（米）
 * @returns {{mode: string, distanceM: (number|null), geoVerified: (boolean|null)}}
 */
const evaluate = function(input) {
  const settings = input || {};
  const defaults = readGeoConfig();
  const radiusMeters = Number.isFinite(Number(settings.radiusMeters)) && Number(settings.radiusMeters) > 0
    ? Number(settings.radiusMeters)
    : defaults.radiusMeters;
  const degradeAccuracyMeters =
    Number.isFinite(Number(settings.degradeAccuracyMeters)) && Number(settings.degradeAccuracyMeters) > 0
      ? Number(settings.degradeAccuracyMeters)
      : defaults.degradeAccuracyMeters;

  const roomValid = geo.isValidCoordinate(settings.roomLatitude, settings.roomLongitude);
  if (!roomValid) {
    // 功能房未配置（或配置非法）坐标：不启用围栏。
    return { mode: MODES.NONE, distanceM: null, geoVerified: null };
  }

  const roomLat = geo.normalizeCoordinate(settings.roomLatitude);
  const roomLng = geo.normalizeCoordinate(settings.roomLongitude);

  const clientValid = geo.isValidCoordinate(settings.lat, settings.lng);
  if (!clientValid) {
    // 功能房已配置围栏，但本次未提供有效定位：放行但标记未校验。
    return { mode: MODES.DEGRADED, distanceM: null, geoVerified: false };
  }

  const clientLat = geo.normalizeCoordinate(settings.lat);
  const clientLng = geo.normalizeCoordinate(settings.lng);
  const distanceM = geo.roundMeters(geo.haversineMeters(clientLat, clientLng, roomLat, roomLng));

  const accuracy = geo.normalizeAccuracy(settings.accuracy);
  if (accuracy !== null && accuracy > degradeAccuracyMeters) {
    // 定位精度过低（例如基站/WiFi 粗定位）：无法可靠判定，降级放行。
    return { mode: MODES.DEGRADED, distanceM: distanceM, geoVerified: false };
  }

  if (distanceM !== null && distanceM <= radiusMeters) {
    return { mode: MODES.VERIFIED, distanceM: distanceM, geoVerified: true };
  }

  return { mode: MODES.OUT, distanceM: distanceM, geoVerified: false };
};

/**
 * 读取功能房经纬度（迁移未应用 / 查询失败时安全降级为「未配置」，绝不阻断签到主流程）。
 * @param {number} roomId 功能房 id
 * @returns {Promise<{latitude: (number|null), longitude: (number|null)}>}
 */
const loadRoomLocation = async function(roomId) {
  const normalizedRoomId = Number(roomId);
  if (!Number.isInteger(normalizedRoomId) || normalizedRoomId <= 0) {
    return { latitude: null, longitude: null };
  }
  try {
    const [rows] = await db.query('SELECT latitude, longitude FROM rooms WHERE id = ?', [normalizedRoomId]);
    if (!rows || !rows.length) return { latitude: null, longitude: null };
    return {
      latitude: geo.normalizeCoordinate(rows[0].latitude),
      longitude: geo.normalizeCoordinate(rows[0].longitude)
    };
  } catch (err) {
    // 例如迁移尚未应用（rooms 无 latitude/longitude 列）——按「未配置围栏」处理，保证蓝绿期可用。
    logger.warn('读取功能房地理坐标失败（按未配置围栏处理）:', err && err.message ? err.message : err);
    return { latitude: null, longitude: null };
  }
};

/**
 * 校验一次签到的地理围栏。
 * @param {object} input
 * @param {number} input.roomId 功能房 id
 * @param {*} [input.lat] 签到人纬度
 * @param {*} [input.lng] 签到人经度
 * @param {*} [input.accuracy] 定位精度（米）
 * @returns {Promise<{mode: string, distanceM: (number|null), geoVerified: (boolean|null)}>}
 */
const verify = async function(input) {
  const settings = input || {};
  const room = await loadRoomLocation(settings.roomId);
  return evaluate({
    roomLatitude: room.latitude,
    roomLongitude: room.longitude,
    lat: settings.lat,
    lng: settings.lng,
    accuracy: settings.accuracy
  });
};

/**
 * 把判定结果映射为 checkins 表的持久化列值（写库由调用方在同一事务完成）。
 *  - `none`     → geo_mode='none'，geo_verified=NULL，距离/坐标尽量留痕（可能为空）。
 *  - `verified` → geo_verified=1。
 *  - 其它       → geo_verified=0。
 * @param {object} input
 * @param {string} input.mode 判定模式
 * @param {*} [input.distanceM] 距离（米）
 * @param {*} [input.lat] 签到人纬度
 * @param {*} [input.lng] 签到人经度
 * @returns {{geo_mode: string, geo_verified: (number|null), checkin_lat: (number|null), checkin_lng: (number|null), geo_distance_m: (number|null)}}
 */
const persistColumns = function(input) {
  const settings = input || {};
  const mode = settings.mode || MODES.NONE;
  let geoVerified = null;
  if (mode === MODES.VERIFIED) geoVerified = 1;
  else if (mode === MODES.DEGRADED || mode === MODES.OUT) geoVerified = 0;

  const lat = geo.isValidCoordinate(settings.lat, settings.lng) ? geo.normalizeCoordinate(settings.lat) : null;
  const lng = geo.isValidCoordinate(settings.lat, settings.lng) ? geo.normalizeCoordinate(settings.lng) : null;
  const distanceM = geo.roundMeters(settings.distanceM);

  return {
    geo_mode: mode,
    geo_verified: geoVerified,
    checkin_lat: lat,
    checkin_lng: lng,
    geo_distance_m: distanceM
  };
};

/**
 * 把判定结果映射为响应体里的围栏标记（供前端提示）。
 * @param {object} result verify()/evaluate() 的返回值
 * @returns {{geoMode: string, geoVerified: (boolean|null), degraded: boolean}}
 */
const responseFlags = function(result) {
  const mode = (result && result.mode) || MODES.NONE;
  return {
    geoMode: mode,
    geoVerified: mode === MODES.VERIFIED ? true : (mode === MODES.DEGRADED ? false : null),
    degraded: mode === MODES.DEGRADED
  };
};

/**
 * 从请求体解析签到定位。兼容两种入参形态：
 *   - 平铺：`{ latitude, longitude, accuracy }`（亦接受 `lat` / `lng` 别名）
 *   - 嵌套：`{ location: { latitude, longitude, accuracy } }`
 * @param {object} body 请求体
 * @returns {{lat: (number|null), lng: (number|null), accuracy: (number|null)}}
 */
const readClientLocation = function(body) {
  const source = body && typeof body === 'object' ? body : {};
  const nested = source.location && typeof source.location === 'object' ? source.location : {};
  const rawLat = source.latitude !== undefined ? source.latitude
    : (source.lat !== undefined ? source.lat : nested.latitude);
  const rawLng = source.longitude !== undefined ? source.longitude
    : (source.lng !== undefined ? source.lng : nested.longitude);
  const rawAccuracy = source.accuracy !== undefined ? source.accuracy : nested.accuracy;
  return {
    lat: geo.normalizeCoordinate(rawLat),
    lng: geo.normalizeCoordinate(rawLng),
    accuracy: geo.normalizeAccuracy(rawAccuracy)
  };
};

module.exports = {
  MODES,
  evaluate,
  verify,
  loadRoomLocation,
  persistColumns,
  responseFlags,
  readClientLocation,
  readGeoConfig
};
