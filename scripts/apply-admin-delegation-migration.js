/**
 * 迁移预检 + 应用脚本：管理端临时授权 + 岗位交接（20260918_admin_delegation.sql）
 *
 * 用法：
 *   node scripts/apply-admin-delegation-migration.js
 * 环境变量（与其余 apply-*-migration.js 一致）：
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *
 * 幂等：两张表均使用 CREATE TABLE IF NOT EXISTS；重复执行不会报错，也不会改动既有数据。
 * 本脚本**只创建空表结构，不写入任何业务数据**。
 */

const mysql = require('../server/node_modules/mysql2/promise');

const LOCK_NAME = 'jingyi_admin_delegation_migration';
const TABLES = ['admin_capability_grants', 'admin_handover'];

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
  if (!(await tableExists(connection, database, 'admins'))) {
    throw new Error('admins 表不存在，本迁移依赖 admins(id) 外键，请先执行 server/sql/schema.sql');
  }
  // 岗位交接依赖 admins.status（active/disabled）；缺失时不予静默继续。
  const hasStatus = await columnExists(connection, database, 'admins', 'status');
  if (!hasStatus) {
    throw new Error(
      'admins.status 缺失：请在 server/sql/migrations/20260918_admin_delegation.sql 末尾追加幂等 ALTER 后再执行本脚本'
    );
  }
}

async function createCapabilityGrants(connection) {
  await connection.query(
    'CREATE TABLE IF NOT EXISTS admin_capability_grants (' +
    'id INT AUTO_INCREMENT PRIMARY KEY,' +
    'admin_id INT NOT NULL COMMENT \'被授权的管理员 id\',' +
    'capability ENUM(\'audit\',\'checkin\',\'data_export\',\'rule_config\') NOT NULL COMMENT \'能力项\',' +
    'granted_by INT DEFAULT NULL COMMENT \'执行授权的管理员 id\',' +
    'valid_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT \'授权生效时间\',' +
    'valid_to DATETIME NOT NULL COMMENT \'授权失效时间\',' +
    'status ENUM(\'active\',\'expired\',\'revoked\') NOT NULL DEFAULT \'active\' COMMENT \'授权状态\',' +
    'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
    'KEY idx_admin_capability_expiry (capability, valid_to),' +
    'KEY idx_admin_capability_admin (admin_id, status),' +
    'CONSTRAINT fk_admin_cap_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,' +
    'CONSTRAINT fk_admin_cap_granted_by FOREIGN KEY (granted_by) REFERENCES admins(id) ON DELETE SET NULL' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=\'管理员临时能力授权（带有效期）\''
  );
}

async function createHandover(connection) {
  await connection.query(
    'CREATE TABLE IF NOT EXISTS admin_handover (' +
    'id INT AUTO_INCREMENT PRIMARY KEY,' +
    'admin_id INT NOT NULL COMMENT \'交接标的（= 离任方账号）\',' +
    'from_user INT NOT NULL COMMENT \'离任方管理员 id\',' +
    'to_user INT NOT NULL COMMENT \'新任持有人管理员 id\',' +
    'status ENUM(\'pending\',\'accepted\',\'revoked\') NOT NULL DEFAULT \'pending\' COMMENT \'交接状态\',' +
    'initiated_by INT DEFAULT NULL COMMENT \'发起交接的管理员 id\',' +
    'accepted_at DATETIME DEFAULT NULL COMMENT \'接受交接时间\',' +
    'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
    'KEY idx_admin_handover_status (status, created_at),' +
    'KEY idx_admin_handover_from (from_user),' +
    'KEY idx_admin_handover_to (to_user),' +
    'CONSTRAINT fk_admin_handover_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,' +
    'CONSTRAINT fk_admin_handover_from FOREIGN KEY (from_user) REFERENCES admins(id) ON DELETE CASCADE,' +
    'CONSTRAINT fk_admin_handover_to FOREIGN KEY (to_user) REFERENCES admins(id) ON DELETE CASCADE' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=\'管理员岗位交接\''
  );
}

async function verify(connection, database) {
  const result = {};
  for (const table of TABLES) {
    result[table] = await tableExists(connection, database, table);
  }
  return result;
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
    await createCapabilityGrants(connection);
    await createHandover(connection);
    const tables = await verify(connection, database);

    console.log(JSON.stringify({
      migration: 'admin-delegation',
      database,
      tables,
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
