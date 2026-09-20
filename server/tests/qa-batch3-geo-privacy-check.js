/**
 * QA 独立验证 · Batch3（T06 R-05 签到地理围栏 / T07 R-14 剩余 PII 出口收口）
 *
 * 由 QA（严过关）独立编写，强制 mock 模式。
 * 运行：node server/tests/qa-batch3-geo-privacy-check.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ALLOW_MOCK_DB = 'true';
process.env.ALLOW_MOCK_REDIS = 'true';
process.env.MYSQL_PORT = '1';
process.env.MYSQL_HOST = '127.0.0.1';
process.env.REDIS_PORT = '1';
process.env.REDIS_HOST = '127.0.0.1';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(__dirname, '..', 'src');

const db = require(path.join(SRC, 'config', 'database'));
const redis = require(path.join(SRC, 'config', 'redis'));
const mockDb = require(path.join(SRC, 'config', 'mock-db'));
const helpers = require(path.join(SRC, 'utils', 'helpers'));
const geo = require(path.join(SRC, 'utils', 'geo'));
const locationService = require(path.join(SRC, 'services', 'checkinLocationService'));
const credentialService = require(path.join(SRC, 'services', 'checkinCredentialService'));
const checkinController = require(path.join(SRC, 'controllers', 'checkinController'));
const creditController = require(path.join(SRC, 'controllers', 'creditController'));
const accountController = require(path.join(SRC, 'controllers', 'accountController'));
const auditController = require(path.join(SRC, 'controllers', 'auditController'));
const reservationController = require(path.join(SRC, 'controllers', 'reservationController'));
const scopedStatsController = require(path.join(SRC, 'controllers', 'scopedStatsController'));
const maskPresenter = require(path.join(SRC, 'utils', 'maskPresenter'));

let pass = 0;
let fail = 0;
const bugs = [];
const check = function(name, cond, detail) {
  if (cond) pass++;
  else { fail++; console.log('FAIL  ' + name + (detail ? ('  :: ' + detail) : '')); }
};
const eq = function(name, actual, expected) {
  check(name, actual === expected, 'got=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
};
const bug = function(name, detail) { bugs.push(name + ' | ' + detail); console.log('BUG   ' + name + ' | ' + detail); };

const tables = mockDb.__tables;
const findRes = function(id) { return (tables.reservations || []).filter(function(r) { return Number(r.id) === Number(id); })[0]; };
const checkinsOf = function(resId) { return (tables.checkins || []).filter(function(c) { return Number(c.reservation_id) === Number(resId); }); };
const auditCount = function() { return (tables.operation_logs || []).length; };
const findRoom = function(id) { return (tables.rooms || []).filter(function(r) { return Number(r.id) === Number(id); })[0]; };

const makeRes = function() {
  const c = { status: 200, body: null };
  return { c: c, status: function(s) { c.status = s; return this; }, json: function(b) { c.body = b; return this; } };
};
const call = async function(handler, req) { const res = makeRes(); await handler(req, res); return res.c; };
const mkReq = function(user, adminScope, extra) {
  return Object.assign({
    user: user,
    adminScope: adminScope,
    query: {}, params: {}, body: {},
    method: 'GET', baseUrl: '/api/v1', route: { path: '/' },
    requestId: 'qa-batch3', headers: {}
  }, extra || {});
};

// 生成「房间正北 N 米」处的一个坐标（用于精确边界）。
const pointNorth = function(lat, lng, meters) {
  const dLat = (meters / geo.EARTH_RADIUS_METERS) * (180 / Math.PI);
  return { lat: lat + dLat, lng: lng };
};

const allPlain = function(rows, field) { return rows.length > 0 && rows.every(function(r) { return !/\*/.test(String(r[field])); }); };
const allMasked = function(rows, field) { return rows.length > 0 && rows.every(function(r) { return /\*/.test(String(r[field])); }); };

const setResForCheckin = function(id, coords) {
  const r = findRes(id);
  r.status = 'approved';
  r.date = helpers.formatDate(new Date());
  r.start_time = helpers.formatTime(new Date());
  tables.checkins = (tables.checkins || []).filter(function(c) { return Number(c.reservation_id) !== Number(id); });
  const room = findRoom(r.room_id);
  if (coords === null) { delete room.latitude; delete room.longitude; }
  else if (coords) { room.latitude = coords[0]; room.longitude = coords[1]; }
  return r;
};

const main = async function() {
  await db.ready();
  await redis.ready();
  eq('数据库已回退 mock', db.isMock(), true);
  eq('Redis 已回退 mock', redis.isMock(), true);

  // ============================================================
  // A) geo 纯函数
  // ============================================================
  eq('geo: isValidCoordinate(0,0) 为合法', geo.isValidCoordinate(0, 0), true);
  eq('geo: isValidCoordinate(91,0) 非法', geo.isValidCoordinate(91, 0), false);
  eq('geo: isValidCoordinate(0,181) 非法', geo.isValidCoordinate(0, 181), false);
  eq('geo: isValidCoordinate(null,0) 非法', geo.isValidCoordinate(null, 0), false);
  eq('geo: isValidCoordinate("",0) 非法', geo.isValidCoordinate('', 0), false);
  eq('geo: isValidCoordinate("abc",0) 非法', geo.isValidCoordinate('abc', 0), false);
  eq('geo: isValidCoordinate(false,0) 非法', geo.isValidCoordinate(false, 0), false);
  eq('geo: normalizeCoordinate("")->null', geo.normalizeCoordinate(''), null);
  eq('geo: normalizeCoordinate(0)->0', geo.normalizeCoordinate(0), 0);
  eq('geo: normalizeCoordinate("30")->30', geo.normalizeCoordinate('30'), 30);
  eq('geo: normalizeAccuracy(-1)->null', geo.normalizeAccuracy(-1), null);
  eq('geo: normalizeAccuracy(0)->0', geo.normalizeAccuracy(0), 0);
  eq('geo: haversineMeters 非法坐标->null', geo.haversineMeters(null, 0, 0, 0), null);
  eq('geo: roundMeters(null)->null', geo.roundMeters(null), null);

  // ============================================================
  // B) evaluate 四模式 + 边界
  // ============================================================
  eq('evaluate: 房间未配置 -> none', locationService.evaluate({ roomLatitude: null, roomLongitude: null, lat: 30, lng: 120 }).mode, 'none');
  eq('evaluate: 房间坐标越界 -> none', locationService.evaluate({ roomLatitude: 91, roomLongitude: 200, lat: 30, lng: 120 }).mode, 'none');
  const noLoc = locationService.evaluate({ roomLatitude: 30, roomLongitude: 120 });
  eq('evaluate: 缺定位 -> degraded', noLoc.mode, 'degraded');
  eq('evaluate: 缺定位 geoVerified=false', noLoc.geoVerified, false);
  eq('evaluate: accuracy=101 -> degraded', locationService.evaluate({ roomLatitude: 30, roomLongitude: 120, lat: 30, lng: 120, accuracy: 101 }).mode, 'degraded');
  eq('evaluate: accuracy=100(阈值) -> 不降级', locationService.evaluate({ roomLatitude: 30, roomLongitude: 120, lat: 30, lng: 120, accuracy: 100 }).mode, 'verified');
  const p500 = pointNorth(30, 120, 500);
  const e500 = locationService.evaluate({ roomLatitude: 30, roomLongitude: 120, lat: p500.lat, lng: p500.lng });
  eq('evaluate: 恰好500m -> verified(<=边界)', e500.mode, 'verified');
  eq('evaluate: 恰好500m distanceM=500', e500.distanceM, 500);
  const p501 = pointNorth(30, 120, 501);
  const e501 = locationService.evaluate({ roomLatitude: 30, roomLongitude: 120, lat: p501.lat, lng: p501.lng });
  eq('evaluate: 501m -> out', e501.mode, 'out');
  eq('evaluate: 501m distanceM=501', e501.distanceM, 501);
  eq('evaluate: 定位(0,0)对房间(0,0) -> verified', locationService.evaluate({ roomLatitude: 0, roomLongitude: 0, lat: 0, lng: 0 }).mode, 'verified');
  eq('evaluate: 定位越界(91) -> degraded', locationService.evaluate({ roomLatitude: 30, roomLongitude: 120, lat: 91, lng: 120 }).mode, 'degraded');
  eq('evaluate: 负坐标合法 -> verified', locationService.evaluate({ roomLatitude: -30, roomLongitude: -120, lat: -30, lng: -120 }).mode, 'verified');

  // ============================================================
  // C) persistColumns / responseFlags / readClientLocation
  // ============================================================
  const pcV = locationService.persistColumns({ mode: 'verified', distanceM: 12.4, lat: 30, lng: 120 });
  eq('persist: verified geo_verified=1', pcV.geo_verified, 1);
  eq('persist: verified geo_distance_m=12', pcV.geo_distance_m, 12);
  eq('persist: verified checkin_lat=30', pcV.checkin_lat, 30);
  const pcD = locationService.persistColumns({ mode: 'degraded', distanceM: null, lat: null, lng: null });
  eq('persist: degraded geo_verified=0', pcD.geo_verified, 0);
  eq('persist: degraded checkin_lat=null', pcD.checkin_lat, null);
  const pcN = locationService.persistColumns({ mode: 'none', distanceM: null, lat: null, lng: null });
  eq('persist: none geo_verified=null', pcN.geo_verified, null);
  eq('persist: none geo_mode=none', pcN.geo_mode, 'none');
  const rfD = locationService.responseFlags({ mode: 'degraded' });
  eq('flags: degraded -> degraded=true', rfD.degraded, true);
  eq('flags: degraded -> geoVerified=false', rfD.geoVerified, false);
  eq('flags: none -> geoVerified=null', locationService.responseFlags({ mode: 'none' }).geoVerified, null);
  eq('readClientLocation: 平铺 latitude', locationService.readClientLocation({ latitude: 30, longitude: 120 }).lat, 30);
  eq('readClientLocation: 别称 lat', locationService.readClientLocation({ lat: '31', lng: '121' }).lat, 31);
  eq('readClientLocation: 嵌套 location', locationService.readClientLocation({ location: { latitude: 32, longitude: 122 } }).lat, 32);

  // ============================================================
  // D) 关键不变式：越界不消费凭证 + 四模式全链路
  // ============================================================
  // D1: 越界失败后同一凭证仍可用于正确坐标签到（证明 consume 在围栏之后）
  tables.checkins = [];
  setResForCheckin(1, [30, 120]);
  const cred1 = (await credentialService.issue(findRes(1))).credential;
  const out = await call(checkinController.checkin, {
    user: { id: 1, role: 'student' }, params: {},
    body: { reservationId: 1, credential: cred1, latitude: 31, longitude: 121 }
  });
  eq('越界签到 -> 409', out.status, 409);
  eq('越界 businessCode=CHECKIN_GEOFENCE_OUT', out.body.businessCode, 'CHECKIN_GEOFENCE_OUT');
  check('越界响应带 distanceM', !!(out.body.data && typeof out.body.data.distanceM === 'number'), JSON.stringify(out.body));
  eq('越界未写 checkin', checkinsOf(1).length, 0);
  eq('越界后预约仍 approved', findRes(1).status, 'approved');
  const reuse = await call(checkinController.checkin, {
    user: { id: 1, role: 'student' }, params: {},
    body: { reservationId: 1, credential: cred1, latitude: 30, longitude: 120 }
  });
  eq('同一凭证正确坐标签到 -> 200（凭证未被越界消费）', reuse.status, 200);
  eq('成功签到后预约 checked_in', findRes(1).status, 'checked_in');
  eq('成功写入 1 条 checkin', checkinsOf(1).length, 1);

  // D2: 负向对照——consume 确实具破坏性（二次 consume 被拒）
  setResForCheckin(2, [30, 120]);
  const cred2 = (await credentialService.issue(findRes(2))).credential;
  await credentialService.consume(cred2, findRes(2));
  let replayRejected = false;
  try { await credentialService.consume(cred2, findRes(2)); } catch (e) { replayRejected = true; }
  check('凭证二次 consume 被拒（证明 consume 破坏性）', replayRejected);

  // D3: degraded 全链路（房间已配置，但未上报定位）
  setResForCheckin(3, [30, 120]);
  const cred3 = (await credentialService.issue(findRes(3))).credential;
  const deg = await call(checkinController.checkin, {
    user: { id: 2, role: 'student' }, params: {},
    body: { reservationId: 3, credential: cred3 }
  });
  eq('degraded 签到 -> 200', deg.status, 200);
  eq('degraded 响应 degraded=true', deg.body.data && deg.body.data.degraded, true);
  eq('degraded 响应 geoVerified=false', deg.body.data && deg.body.data.geoVerified, false);
  eq('degraded 落库 geo_mode=degraded', (checkinsOf(3)[0] || {}).geo_mode, 'degraded');
  eq('degraded 落库 geo_verified=0', Number((checkinsOf(3)[0] || {}).geo_verified), 0);

  // D4: verified 全链路
  setResForCheckin(12, [30, 120]);
  const cred12 = (await credentialService.issue(findRes(12))).credential;
  const ver = await call(checkinController.checkin, {
    user: { id: 1, role: 'student' }, params: {},
    body: { reservationId: 12, credential: cred12, latitude: 30, longitude: 120, accuracy: 20 }
  });
  eq('verified 签到 -> 200', ver.status, 200);
  eq('verified 响应 geoVerified=true', ver.body.data && ver.body.data.geoVerified, true);
  eq('verified 落库 geo_mode=verified', (checkinsOf(12)[0] || {}).geo_mode, 'verified');
  eq('verified 落库 geo_verified=1', Number((checkinsOf(12)[0] || {}).geo_verified), 1);
  eq('verified 落库 checkin_lat', Number((checkinsOf(12)[0] || {}).checkin_lat), 30);
  eq('verified 落库 geo_distance_m', Number((checkinsOf(12)[0] || {}).geo_distance_m), 0);

  // D5: none 全链路（房间未配置坐标 -> 不启用围栏）
  setResForCheckin(4, null);
  const cred4 = (await credentialService.issue(findRes(4))).credential;
  const non = await call(checkinController.checkin, {
    user: { id: 1, role: 'student' }, params: {},
    body: { reservationId: 4, credential: cred4, latitude: 30, longitude: 120 }
  });
  eq('none 签到 -> 200', non.status, 200);
  eq('none 响应 geoMode=none', non.body.data && non.body.data.geoMode, 'none');
  eq('none 落库 geo_mode=none', (checkinsOf(4)[0] || {}).geo_mode, 'none');
  eq('none 落库 geo_verified=NULL', (checkinsOf(4)[0] || {}).geo_verified, null);

  // D6: 列缺失 fail-open（模拟迁移未应用：rooms 无 latitude 列）
  setResForCheckin(5, [30, 120]);
  const cred5 = (await credentialService.issue(findRes(5))).credential;
  const origQuery = db.query;
  db.query = function(sql, params) {
    if (/SELECT latitude,\s*longitude FROM rooms/i.test(sql)) {
      return Promise.reject(new Error("Unknown column 'latitude' in 'field list'"));
    }
    return origQuery.call(db, sql, params);
  };
  let soft;
  try {
    soft = await call(checkinController.checkin, {
      user: { id: 2, role: 'student' }, params: {},
      body: { reservationId: 5, credential: cred5, latitude: 30, longitude: 120 }
    });
  } finally {
    db.query = origQuery;
  }
  eq('列缺失 fail-open -> 200（不 500）', soft.status, 200);
  eq('列缺失按 none 处理', soft.body.data && soft.body.data.geoMode, 'none');

  // ============================================================
  // E) room_geo 迁移静态复核
  // ============================================================
  const stripComments = function(t) { return t.split('\n').filter(function(l) { return !/^\s*--/.test(l); }).join('\n'); };
  const geoSql = fs.readFileSync(path.join(ROOT, 'server', 'sql', 'migrations', '20260920_room_geo.sql'), 'utf8');
  const geoScript = fs.readFileSync(path.join(ROOT, 'scripts', 'apply-room-geo-migration.js'), 'utf8');
  const GEO_COLS = ['latitude', 'longitude', 'geo_mode', 'geo_verified', 'checkin_lat', 'checkin_lng', 'geo_distance_m'];

  check('room_geo 用 information_schema 探测', /information_schema\.columns/.test(geoSql));
  check('room_geo 幂等 PREPARE/EXECUTE', /PREPARE\s+\w+/.test(geoSql) && /EXECUTE\s+\w+/.test(geoSql));
  check('room_geo 空操作分支 SELECT 1', /'SELECT 1'/.test(geoSql));
  eq('room_geo（去注释）无裸 CREATE TABLE', (stripComments(geoSql).match(/CREATE\s+TABLE\b/gi) || []).length, 0);
  check('room_geo（去注释）无 INSERT/UPDATE/DELETE', !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(stripComments(geoSql)));
  check('room_geo 覆盖 7 列 ADD COLUMN', GEO_COLS.every(function(c) { return new RegExp('ADD COLUMN ' + c + '\\b', 'i').test(geoSql); }));
  check('apply-room-geo 用 columnExists 预检', /columnExists/.test(geoScript));
  check('apply-room-geo 用 GET_LOCK 串行', /GET_LOCK/.test(geoScript));
  check('apply-room-geo 列清单完整', GEO_COLS.every(function(c) { return new RegExp("'" + c + "'").test(geoScript); }));

  let migrateNote = '';
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'apply-room-geo-migration.js')], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
      env: Object.assign({}, process.env, { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '3306', MYSQL_USER: 'root', MYSQL_PASSWORD: '', MYSQL_DATABASE: 'jingyi_reservation' })
    });
    migrateNote = '成功';
  } catch (err) {
    const text = String((err && (err.stdout || err.stderr)) || err.message || err);
    migrateNote = /Access denied|ER_ACCESS_DENIED/i.test(text) ? '凭据被拒(未复验)' : text.split('\n')[0];
  }
  console.log('NOTE  room_geo 迁移真实执行：apply-room-geo-migration.js=' + migrateNote);

  // ============================================================
  // F) 路由/前端证据（creditController 回归依据）
  // ============================================================
  const idxJs = fs.readFileSync(path.join(SRC, 'routes', 'index.js'), 'utf8');
  const creditRoute = fs.readFileSync(path.join(SRC, 'routes', 'credit.js'), 'utf8');
  const adminRoutesVue = fs.readFileSync(path.join(ROOT, 'admin', 'src', 'router', 'adminRoutes.js'), 'utf8');
  const violationsVue = fs.readFileSync(path.join(ROOT, 'admin', 'src', 'views', 'Credit', 'Violations.vue'), 'utf8');
  const creditCtrlSrc = fs.readFileSync(path.join(SRC, 'controllers', 'creditController.js'), 'utf8');
  const scopedStatsSrc = fs.readFileSync(path.join(SRC, 'controllers', 'scopedStatsController.js'), 'utf8');

  const creditMount = (idxJs.match(/router\.use\('\/credit'[^\n]*/i) || [''])[0];
  check('修复后：/credit 挂载仍不含 loadAdminScope（中间件挂在 /violations 行）', creditMount.indexOf('loadAdminScope') === -1, creditMount);
  check('修复后：GET /credit/violations 以 auth 起头并追加 loadAdminScope', /router\.get\('\/violations',\s*auth,[\s\S]{0,80}loadAdminScope/.test(creditRoute));
  check('证据：违规记录页 roleGroups.allAdmins（含普通 admin）', /credit\/violations'[\s\S]{0,220}roleGroups\.allAdmins/.test(adminRoutesVue));
  check('证据：前端违规记录展示 studentId / userName 列', /prop="studentId"/.test(violationsVue) && /prop="userName"/.test(violationsVue));
  const violSelect = (creditCtrlSrc.match(/SELECT v\.\*[\s\S]{0,120}FROM violations/) || [''])[0];
  check('修复后：violationList SELECT 投影含 building_id', violSelect.length > 0 && violSelect.indexOf('building_id') !== -1, violSelect);
  const pendingSelect = (scopedStatsSrc.match(/SELECT r\.id, r\.status, r\.purpose[\s\S]{0,120}room_name/) || [''])[0];
  check('修复后：dashboard 待办 SELECT 投影含 building_id', pendingSelect.length > 0 && pendingSelect.indexOf('building_id') !== -1, pendingSelect);

  // ============================================================
  // G) T07 R-14 出口行为
  // ============================================================
  tables.violations = [
    { id: 1, user_id: 1, type: 'misuse', description: 'desc1', score: -10, related_id: null, created_by: 2, created_at: '2026-01-01 10:00:00' },
    { id: 2, user_id: 2, type: 'noshow', description: 'desc2', score: -20, related_id: 1, created_by: 2, created_at: '2026-01-02 10:00:00' }
  ];
  const vReq = function(user, adminScope) { return mkReq(user, adminScope, { query: { page: 1, pageSize: 20 }, route: { path: '/violations' } }); };

  let before = auditCount();
  const vSuper = await call(creditController.violationList, vReq({ id: 2, role: 'super_admin', scopeType: 'global' }, undefined));
  eq('violationList(超管) -> 200', vSuper.status, 200);
  check('violationList(超管) 学号/姓名全明文', allPlain(vSuper.body.data.list, 'student_id') && allPlain(vSuper.body.data.list, 'real_name'));
  check('violationList(超管) 落审计', auditCount() > before);

  const vCoun = await call(creditController.violationList, vReq({ id: 3, role: 'counselor', scopeType: 'global' }, undefined));
  check('violationList(辅导员) 学号明文', allPlain(vCoun.body.data.list, 'student_id'));

  const vGlob = await call(creditController.violationList, vReq({ id: 1, role: 'admin', scopeType: 'global', buildingId: null }, undefined));
  check('violationList(全局 admin) 学号明文', allPlain(vGlob.body.data.list, 'student_id'));

  const vBuild = await call(creditController.violationList, vReq({ id: 4, role: 'admin', scopeType: 'building', buildingId: 1 }, undefined));
  const vBuildRows = (vBuild.body.data.list) || [];
  const userBuilding = function(uid) { const u = (tables.users || []).filter(function(x) { return Number(x.id) === Number(uid); })[0]; return u ? Number(u.building_id) : null; };
  const vBuildIn = vBuildRows.filter(function(r) { return userBuilding(r.user_id) === 1; });
  const vBuildOut = vBuildRows.filter(function(r) { return userBuilding(r.user_id) !== 1; });
  // 修复后：违规查询投影含 building_id（不做行级 WHERE 过滤，仍返回全量由出口按域掩码），故楼栋 admin 域内行明文、域外行掩码。
  check('violationList(楼栋 admin) 本楼行明文', vBuildIn.length > 0 && allPlain(vBuildIn, 'student_id'));
  check('violationList(楼栋 admin) 非本楼行被掩码', vBuildOut.length > 0 && allMasked(vBuildOut, 'student_id'));
  const vNoScope = await call(creditController.violationList, vReq({ id: 9, role: 'admin' }, undefined));
  check('violationList(无域 admin) 学号被掩码', allMasked(vNoScope.body.data.list, 'student_id'));

  // 修复后：按真实行形状（投影已含 building_id）经 maskPresenter 判定违规记录三态 + 无域掩码，不依赖 mock 的 users.* 合并 artifact。
  const realRowIn = { id: 1, user_id: 1, type: 'misuse', student_id: '2024001001', real_name: '张三', building_id: 1 };
  const visSuper = maskPresenter.resolveVisibility(realRowIn, { id: 2, role: 'super_admin', scopeType: 'global' });
  eq('maskPresenter：真实行 + 超管 -> 明文(admin_global)', visSuper.masked === false && visSuper.scope === 'admin_global', true);
  const visGlobal = maskPresenter.resolveVisibility(realRowIn, { id: 1, role: 'admin', scopeType: 'global', buildingId: null });
  eq('maskPresenter：真实行 + 全局 admin -> 明文', visGlobal.masked, false);
  const visBuildIn = maskPresenter.resolveVisibility(realRowIn, { id: 4, role: 'admin', scopeType: 'building', buildingId: 1 });
  eq('maskPresenter：真实行 + 楼栋域内 admin -> 明文(admin_building)', visBuildIn.masked === false && visBuildIn.scope === 'admin_building', true);
  const visBuildOut = maskPresenter.resolveVisibility(realRowIn, { id: 5, role: 'admin', scopeType: 'building', buildingId: 2 });
  eq('maskPresenter：真实行 + 楼栋域外 admin -> 掩码(admin_out_of_scope)', visBuildOut.masked === true && visBuildOut.scope === 'admin_out_of_scope', true);
  const visNoScope = maskPresenter.resolveVisibility(realRowIn, { id: 9, role: 'admin' });
  eq('maskPresenter：真实行 + 无域 admin -> 掩码', visNoScope.masked, true);

  // getAccounts（超管）
  before = auditCount();
  const acc = await call(accountController.getAccounts, mkReq({ id: 2, role: 'super_admin', scopeType: 'global' }, undefined, { query: { page: 1, pageSize: 20 }, route: { path: '/accounts' } }));
  eq('accountController.getAccounts(超管) -> 200', acc.status, 200);
  check('getAccounts(超管) 手机号明文', allPlain(acc.body.data.list, 'phone'));
  check('getAccounts(超管) 落审计', auditCount() > before);

  // pendingList（楼栋管理员：域内明文、域外掩码）
  const pl = await call(auditController.pendingList, mkReq({ id: 4, role: 'admin', scopeType: 'building', buildingId: 1 }, { isGlobal: false, buildingId: 1, role: 'admin' }, { query: { page: 1, pageSize: 50 }, route: { path: '/pending' } }));
  eq('auditController.pendingList(楼栋 admin) -> 200', pl.status, 200);
  const plRows = (pl.body.data.list) || [];
  const inDomain = plRows.filter(function(r) { return Number(r.building_id) === 1; });
  const outDomain = plRows.filter(function(r) { return Number(r.building_id) !== 1; });
  check('pendingList 行带 building_id', plRows.length > 0 && plRows[0].building_id !== undefined);
  check('pendingList 数据域内明文', inDomain.length > 0 && allPlain(inDomain, 'student_id'));
  check('pendingList 数据域外掩码', outDomain.length === 0 || allMasked(outDomain, 'student_id'));

  // reservationController.detail：学生看自己（明文、不审计）
  before = auditCount();
  const dSelf = await call(reservationController.detail, mkReq({ id: 2, role: 'student' }, undefined, { params: { id: '3' }, route: { path: '/:id' } }));
  eq('detail 学生看自己 -> 200', dSelf.status, 200);
  eq('detail 学生看自己学号明文', String(dSelf.body.data.student_id), '2024001002');
  eq('detail 学生看自己不落审计', auditCount(), before);
  // 超管（明文 + 审计）
  before = auditCount();
  const dAdmin = await call(reservationController.detail, mkReq({ id: 100, role: 'super_admin', scopeType: 'global' }, { isGlobal: true, buildingId: null, role: 'super_admin' }, { params: { id: '3' }, route: { path: '/:id' } }));
  eq('detail 超管 -> 200', dAdmin.status, 200);
  eq('detail 超管学号明文', String(dAdmin.body.data.student_id), '2024001002');
  check('detail 超管落审计', auditCount() > before);

  // scopedStats.exportData：超管明文+审计；楼栋管理员按域但被掩码（关联发现）
  before = auditCount();
  const exSuper = await call(scopedStatsController.exportData, mkReq({ id: 2, role: 'super_admin', scopeType: 'global' }, { isGlobal: true, buildingId: null, role: 'super_admin' }, { query: { type: 'users', startDate: '2020-01-01', endDate: '2030-01-01' }, route: { path: '/export' } }));
  eq('exportData(超管,users) -> 200', exSuper.status, 200);
  const exRows = ((exSuper.body.data || {}).rows) || [];
  check('exportData(超管) 学号明文', exRows.length > 0 && allPlain(exRows, 'student_id'));
  check('exportData(超管) 落审计', auditCount() > before);

  const exBuild = await call(scopedStatsController.exportData, mkReq({ id: 4, role: 'admin', scopeType: 'building', buildingId: 1 }, { isGlobal: false, buildingId: 1, role: 'admin' }, { query: { type: 'users', startDate: '2020-01-01', endDate: '2030-01-01' }, route: { path: '/export' } }));
  const exBuildRows = ((exBuild.body.data || {}).rows) || [];
  // 修复后：exportData 已按 WHERE u.building_id=? 过滤且投影含 building_id，楼栋 admin 域内行应为明文。
  check('exportData(楼栋 admin) 域内学号明文', exBuildRows.length > 0 && allPlain(exBuildRows, 'student_id'), 'rows=' + exBuildRows.length);

  console.log('qa-batch3-geo-privacy-check: PASS=' + pass + ' FAIL=' + fail);
  if (bugs.length) { console.log('--- BUG/缺口 ---'); bugs.forEach(function(x) { console.log('  • ' + x); }); }
  if (fail > 0) process.exit(1);
};

main().catch(function(err) { console.error('SMOKE ERROR:', err && err.stack ? err.stack : err); process.exit(1); });
