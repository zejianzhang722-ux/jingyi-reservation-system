/**
 * 地理计算纯函数（架构设计 R-05 地理围栏）。
 *
 * 设计约束：
 *  - 本模块**不依赖任何其它模块**（不 require db / config / logger），保证可被任意层安全引用而不产生循环依赖。
 *  - 只提供无副作用的纯函数：坐标校验与 haversine 距离，便于单测直接覆盖。
 *  - 一切非法输入（NaN / 越界 / 空串 / 对象）统一归一为 `null`，调用方据 null 判定「未配置 / 未提供」。
 */

// WGS-84 常用球面半径（米）。签到围栏为百米级，球面近似误差可忽略。
const EARTH_RADIUS_METERS = 6371000;

/**
 * 角度转弧度。
 * @param {number} degrees 角度
 * @returns {number} 弧度
 */
function toRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

/**
 * 归一化坐标输入为有限数字，非法返回 null。
 * 注意：空串 / null / undefined / 布尔 / 对象一律视为「未提供」，避免 `Number('')===0` 被误当作真实坐标。
 * @param {*} value 原始值
 * @returns {number|null}
 */
function normalizeCoordinate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'object') return null;
  const text = String(value).trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 判断是否为合法经纬度对（纬度 [-90,90]，经度 [-180,180]）。
 * @param {*} latitude 纬度
 * @param {*} longitude 经度
 * @returns {boolean}
 */
function isValidCoordinate(latitude, longitude) {
  const lat = normalizeCoordinate(latitude);
  const lng = normalizeCoordinate(longitude);
  if (lat === null || lng === null) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * 归一化精度输入：非负有限数字，非法返回 null。
 * @param {*} value 原始精度（米）
 * @returns {number|null}
 */
function normalizeAccuracy(value) {
  const parsed = normalizeCoordinate(value);
  if (parsed === null) return null;
  return parsed >= 0 ? parsed : null;
}

/**
 * haversine 球面距离（米）。
 * @param {number} lat1 点 1 纬度
 * @param {number} lng1 点 1 经度
 * @param {number} lat2 点 2 纬度
 * @param {number} lng2 点 2 经度
 * @returns {number|null} 距离（米）；任一坐标非法时返回 null
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const aLat = normalizeCoordinate(lat1);
  const aLng = normalizeCoordinate(lng1);
  const bLat = normalizeCoordinate(lat2);
  const bLng = normalizeCoordinate(lng2);
  if (aLat === null || aLng === null || bLat === null || bLng === null) return null;

  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * sinLng * sinLng;
  const clamped = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(clamped));
}

/**
 * 距离取整（米）。null 透传，避免调用方对 null 做 Math.round 得到 NaN。
 * @param {number|null} distance 原始距离
 * @returns {number|null}
 */
function roundMeters(distance) {
  if (distance === null || distance === undefined) return null;
  const parsed = Number(distance);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

module.exports = {
  EARTH_RADIUS_METERS,
  toRadians,
  normalizeCoordinate,
  normalizeAccuracy,
  isValidCoordinate,
  haversineMeters,
  roundMeters
};
