-- 功能房地理围栏迁移（架构设计 R-05 / 任务 T06）
--
-- 背景：
--   签到（checkins）此前无位置校验，存在「远程代签 / 不在现场签到」的作弊风险。
--   R-05 为功能房（rooms）增加经纬度配置，为签到记录（checkins）增加围栏判定留痕列；
--   由 checkinController.checkin 在消费一次性凭证之前调用 checkinLocationService.verify 判定。
--
-- 幂等性（MySQL 8 **不支持** `ADD COLUMN IF NOT EXISTS`）：
--   本文件对**每一列**独立使用 `information_schema.columns` 探测 + 预处理语句的幂等写法：
--   已存在则执行 `SELECT 1` 空操作，不存在才 `ALTER TABLE ... ADD COLUMN`。可重复执行不报错。
--   与之等价的 Node 脚本：scripts/apply-room-geo-migration.js（先探测后 ALTER，可二选一）。
--
-- 兼容性：只**新增可空列**，不改动既有列语义，也不写入任何业务数据。
--   - rooms.latitude / rooms.longitude 默认 NULL：存量功能房未配置坐标 → 围栏模式为 'none'（不启用），行为与升级前一致。
--   - checkins.geo_mode 默认 'none'；geo_verified / checkin_lat / checkin_lng / geo_distance_m 默认 NULL。
--   - 旧代码写入 checkins 不带这些列时，列取默认值，不影响既有 INSERT。
--
-- 执行前检查：
--   SELECT COUNT(*) FROM rooms;     -- 表须已存在
--   SELECT COUNT(*) FROM checkins;  -- 表须已存在

-- ── rooms.latitude ────────────────────────────────────────────────────────────
SET @rooms_lat_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rooms' AND column_name = 'latitude'
);
SET @rooms_lat_ddl := IF(
  @rooms_lat_exists = 0,
  'ALTER TABLE rooms ADD COLUMN latitude DECIMAL(10,7) DEFAULT NULL COMMENT ''功能房纬度（可空；配置后启用签到地理围栏 R-05）''',
  'SELECT 1'
);
PREPARE stmt_rooms_lat FROM @rooms_lat_ddl;
EXECUTE stmt_rooms_lat;
DEALLOCATE PREPARE stmt_rooms_lat;

-- ── rooms.longitude ───────────────────────────────────────────────────────────
SET @rooms_lng_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rooms' AND column_name = 'longitude'
);
SET @rooms_lng_ddl := IF(
  @rooms_lng_exists = 0,
  'ALTER TABLE rooms ADD COLUMN longitude DECIMAL(10,7) DEFAULT NULL COMMENT ''功能房经度（可空；配置后启用签到地理围栏 R-05）''',
  'SELECT 1'
);
PREPARE stmt_rooms_lng FROM @rooms_lng_ddl;
EXECUTE stmt_rooms_lng;
DEALLOCATE PREPARE stmt_rooms_lng;

-- ── checkins.geo_mode ─────────────────────────────────────────────────────────
SET @checkins_geo_mode_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'checkins' AND column_name = 'geo_mode'
);
SET @checkins_geo_mode_ddl := IF(
  @checkins_geo_mode_exists = 0,
  'ALTER TABLE checkins ADD COLUMN geo_mode ENUM(''none'',''verified'',''degraded'') DEFAULT ''none'' COMMENT ''签到地理围栏判定模式（R-05）''',
  'SELECT 1'
);
PREPARE stmt_checkins_geo_mode FROM @checkins_geo_mode_ddl;
EXECUTE stmt_checkins_geo_mode;
DEALLOCATE PREPARE stmt_checkins_geo_mode;

-- ── checkins.geo_verified ─────────────────────────────────────────────────────
SET @checkins_geo_verified_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'checkins' AND column_name = 'geo_verified'
);
SET @checkins_geo_verified_ddl := IF(
  @checkins_geo_verified_exists = 0,
  'ALTER TABLE checkins ADD COLUMN geo_verified TINYINT(1) DEFAULT NULL COMMENT ''围栏是否可信校验通过（1 通过 / 0 未通过 / NULL 未启用）''',
  'SELECT 1'
);
PREPARE stmt_checkins_geo_verified FROM @checkins_geo_verified_ddl;
EXECUTE stmt_checkins_geo_verified;
DEALLOCATE PREPARE stmt_checkins_geo_verified;

-- ── checkins.checkin_lat ──────────────────────────────────────────────────────
SET @checkins_lat_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'checkins' AND column_name = 'checkin_lat'
);
SET @checkins_lat_ddl := IF(
  @checkins_lat_exists = 0,
  'ALTER TABLE checkins ADD COLUMN checkin_lat DECIMAL(10,7) DEFAULT NULL COMMENT ''签到人维度（本次上报，可空）''',
  'SELECT 1'
);
PREPARE stmt_checkins_lat FROM @checkins_lat_ddl;
EXECUTE stmt_checkins_lat;
DEALLOCATE PREPARE stmt_checkins_lat;

-- ── checkins.checkin_lng ──────────────────────────────────────────────────────
SET @checkins_lng_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'checkins' AND column_name = 'checkin_lng'
);
SET @checkins_lng_ddl := IF(
  @checkins_lng_exists = 0,
  'ALTER TABLE checkins ADD COLUMN checkin_lng DECIMAL(10,7) DEFAULT NULL COMMENT ''签到人经度（本次上报，可空）''',
  'SELECT 1'
);
PREPARE stmt_checkins_lng FROM @checkins_lng_ddl;
EXECUTE stmt_checkins_lng;
DEALLOCATE PREPARE stmt_checkins_lng;

-- ── checkins.geo_distance_m ───────────────────────────────────────────────────
SET @checkins_distance_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'checkins' AND column_name = 'geo_distance_m'
);
SET @checkins_distance_ddl := IF(
  @checkins_distance_exists = 0,
  'ALTER TABLE checkins ADD COLUMN geo_distance_m INT DEFAULT NULL COMMENT ''签到点与功能房的距离（米，可空）''',
  'SELECT 1'
);
PREPARE stmt_checkins_distance FROM @checkins_distance_ddl;
EXECUTE stmt_checkins_distance;
DEALLOCATE PREPARE stmt_checkins_distance;
