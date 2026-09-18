/**
 * 迁移预检 + 应用脚本：功能房地理围栏列（20260920_room_geo.sql，R-05 / T06）
 *
 * 用法：
 *   node scripts/apply-room-geo-migration.js
 * 环境变量（与其余 apply-*-migration.js 一致）：
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *
 * 幂等：
 *   - rooms.latitude / rooms.longitude，checkins.geo_mode / geo_verified / checkin_lat / checkin_lng / geo_distance_m
 *     均先探测 information_schema，缺失才 ALTER TABLE ... ADD COLUMN；已存在则跳过。
 *   - 全过程在一次 GET_LOCK 串行锁内完成，避免与其它迁移并发。
 *   - 本脚本**只新增可空列，不写入任何业务数据**，不改动既有列语义。
 *
 * 与 server/sql/migrations/20260920_room_geo.sql 等价，可任选其一执行。
 */

const mysql = require('../server/node_modules/mysql2/promise');

const LOCK_NAME = 'jingyi_room_geo_migration';

const ROOMS_COLUMNS = [
  { column: 'latitude', ddl: 'ALTER TABLE `rooms` ADD COLUMN latitude DECIMAL(10,7) DEFAULT NULL COMMENT \'功能房纬度（可空；配置后启用签到地理围栏 R-05）\'' },
  { column: 'longitude', ddl: 'ALTER TABLE `rooms` ADD COLUMN longitude DECIMAL(10,7) DEFAULT NULL COMMENT \'功能房经度（可空；配置后启用签到地理围栏 R-05）\'' }
];

const CHECKINS_COLUMNS = [
  { column: 'geo_mode', ddl: 'ALTER TABLE `checkins` ADD COLUMN geo_mode ENUM(\'none\',\'verified\',\'degraded\') DEFAULT \'none\' COMMENT \'签到地理围栏判定模式（R-05）\'' },
  { column: 'geo_verified', ddl: 'ALTER TABLE `checkins` ADD COLUMN geo_verified TINYINT(1) DEFAULT NULL COMMENT \'围栏是否可信校验通过（1 通过 / 0 未通过 / NULL 未启用）\'' },
  { column: 'checkin_lat', ddl: 'ALTER TABLE `checkins` ADD COLUMN checkin_lat DECIMAL(10,7) DEFAULT NULL COMMENT \'签到人维度（本次上报，可空）\'' },
  { column: 'checkin_lng', ddl: 'ALTER TABLE `checkins` ADD COLUMN checkin_lng DECIMAL(10,7) DEFAULT NULL COMMENT \'签到人经度（本次上报，可空）\'' },
  { column: 'geo_distance_m', ddl: 'ALTER TABLE `checkins` ADD COLUMN geo_distance_m INT DEFAULT NULL COMMENT \'签到点与功能房的距离（米，可空）\'' }
];

function safeIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Unsafe database identifier');
  return '`' + value + '`';
}

async function tableExists(connection, database, table) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [database, table]
  );
  return Number(rows[0].count) > 0;
}

async function columnExists(connection, database, table, column) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
    [database, table, column]
  );
  return Number(rows[0].count) > 0;
}

async function assertPreconditions(connection, database) {
  if (!(await tableExists(connection, database, 'rooms'))) {
    throw new Error('rooms 表不存在，本迁移依赖 rooms(id) 增加经纬度列，请先执行 server/sql/schema.sql');
  }
  if (!(await tableExists(connection, database, 'checkins'))) {
    throw new Error('checkins 表不存在，本迁移需为 checkins 增加围栏留痕列，请先执行 server/sql/schema.sql');
  }
}

async function addColumns(connection, database, table, columns) {
  const added = [];
  for (const entry of columns) {
    if (await columnExists(connection, database, table, entry.column)) continue;
    await connection.query(entry.ddl);
    added.push(entry.column);
  }
  return added;
}

async function verify(connection, database) {
  const rooms = {};
  for (const entry of ROOMS_COLUMNS) {
    rooms[entry.column] = await columnExists(connection, database, 'rooms', entry.column);
  }
  const checkins = {};
  for (const entry of CHECKINS_COLUMNS) {
    checkins[entry.column] = await columnExists(connection, database, 'checkins', entry.column);
  }
  return { rooms, checkins };
}

async function main() {
  const database = process.env.MYSQL_DATABASE || 'jingyi_reservation';
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database
  });

  let lockHeld = false;
  try {
    await connection.query('USE ' + safeIdentifier(database));
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [LOCK_NAME]);
    if (Number(lockRows[0].acquired) !== 1) throw new Error('Could not acquire migration lock');
    lockHeld = true;

    await assertPreconditions(connection, database);
    const addedRooms = await addColumns(connection, database, 'rooms', ROOMS_COLUMNS);
    const addedCheckins = await addColumns(connection, database, 'checkins', CHECKINS_COLUMNS);
    const state = await verify(connection, database);

    console.log(JSON.stringify({
      migration: 'room-geo',
      database,
      addedRooms,
      addedCheckins,
      state,
      status: 'ready'
    }, null, 2));
  } finally {
    if (lockHeld) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch (err) {}
    }
    await connection.end();
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
