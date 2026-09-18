/**
 * 迁移预检 + 应用脚本：预约审核乐观锁 + 批注轨迹（20260919_reservation_audit.sql，R-02 / T05）
 *
 * 用法：
 *   node scripts/apply-reservation-audit-migration.js
 * 环境变量（与其余 apply-*-migration.js 一致）：
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *
 * 幂等：
 *   - 建表 reservation_audit_trail 使用 CREATE TABLE IF NOT EXISTS；
 *   - reservations.version 先探测 information_schema，缺失才 ALTER（MySQL 8 无 ADD COLUMN IF NOT EXISTS）。
 *   两处均可重复执行，不会报错，也不会改动既有数据。
 * 本脚本**只创建空表结构与可空列，不写入任何业务数据**。
 */

const mysql = require('../server/node_modules/mysql2/promise');

const LOCK_NAME = 'jingyi_reservation_audit_migration';
const TABLE = 'reservation_audit_trail';
const COLUMN = { table: 'reservations', column: 'version' };

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
  if (!(await tableExists(connection, database, 'reservations'))) {
    throw new Error('reservations 表不存在，本迁移依赖 reservations(id)，请先执行 server/sql/schema.sql');
  }
}

async function createAuditTrail(connection) {
  await connection.query(
    'CREATE TABLE IF NOT EXISTS reservation_audit_trail (' +
    'id INT AUTO_INCREMENT PRIMARY KEY,' +
    'reservation_id INT NOT NULL COMMENT \'预约 id\',' +
    'stage ENUM(\'first\',\'counselor\') NOT NULL DEFAULT \'first\' COMMENT \'审核阶段\',' +
    'actor_id INT DEFAULT NULL COMMENT \'操作人管理员 id\',' +
    'actor_role VARCHAR(32) DEFAULT \'\' COMMENT \'操作人角色快照\',' +
    'action ENUM(\'approve\',\'reject\',\'remark\',\'transfer\') NOT NULL COMMENT \'动作\',' +
    'remark VARCHAR(500) DEFAULT \'\' COMMENT \'批注/驳回原因\',' +
    'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
    'KEY idx_reservation_audit_trail_reservation (reservation_id),' +
    'KEY idx_reservation_audit_trail_reservation_created (reservation_id, created_at)' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=\'预约审核批注轨迹（R-02）\''
  );
}

async function addVersionColumn(connection, database) {
  if (await columnExists(connection, database, COLUMN.table, COLUMN.column)) return false;
  await connection.query(
    'ALTER TABLE ' + safeIdentifier(COLUMN.table) +
    ' ADD COLUMN version INT NOT NULL DEFAULT 1 COMMENT \'审核乐观锁版本号（R-02）\''
  );
  return true;
}

async function verify(connection, database) {
  return {
    table: await tableExists(connection, database, TABLE),
    reservationsVersion: await columnExists(connection, database, COLUMN.table, COLUMN.column)
  };
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
    await createAuditTrail(connection);
    const addedColumn = await addVersionColumn(connection, database);
    const state = await verify(connection, database);

    console.log(JSON.stringify({
      migration: 'reservation-audit',
      database,
      addedVersionColumn: addedColumn,
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
