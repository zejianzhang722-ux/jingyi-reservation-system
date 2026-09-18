/**
 * 迁移预检 + 应用脚本：补签工单表 + checkins 关联列（20260919_supplement_request.sql，R-08 / T04）
 *
 * 用法：
 *   node scripts/apply-supplement-migration.js
 * 环境变量（与其余 apply-*-migration.js 一致）：
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *
 * 幂等：
 *   - 建表 supplement_requests 使用 CREATE TABLE IF NOT EXISTS；
 *   - checkins.supplement_request_id、supplement_requests.review_remark 先探测 information_schema，缺失才 ALTER。
 *   各处均可重复执行，不会报错，也不会改动既有数据。
 * 本脚本**只创建空表结构与可空列，不写入任何业务数据**。
 */

const mysql = require('../server/node_modules/mysql2/promise');

const LOCK_NAME = 'jingyi_supplement_migration';
const TABLE = 'supplement_requests';
const COLUMN = { table: 'checkins', column: 'supplement_request_id' };
const REVIEW_COLUMN = { table: 'supplement_requests', column: 'review_remark' };

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
  if (!(await tableExists(connection, database, 'checkins'))) {
    throw new Error('checkins 表不存在，本迁移需为 checkins 增加 supplement_request_id，请先执行 server/sql/schema.sql');
  }
}

async function createSupplementRequests(connection) {
  await connection.query(
    'CREATE TABLE IF NOT EXISTS supplement_requests (' +
    'id INT AUTO_INCREMENT PRIMARY KEY,' +
    'reservation_id INT NOT NULL COMMENT \'预约 id\',' +
    'applicant_id INT NOT NULL COMMENT \'申请人管理员 id\',' +
    'type ENUM(\'signin\',\'signout\') NOT NULL COMMENT \'补签类型\',' +
    'reason VARCHAR(255) NOT NULL COMMENT \'补签原因\',' +
    'status ENUM(\'pending\',\'approved\',\'rejected\') NOT NULL DEFAULT \'pending\' COMMENT \'工单状态\',' +
    'reviewer_id INT DEFAULT NULL COMMENT \'审核人管理员 id\',' +
    'reviewed_at DATETIME DEFAULT NULL COMMENT \'审核时间\',' +
    'review_remark VARCHAR(255) DEFAULT NULL COMMENT \'审核意见（approve/reject 均可填，无意见为 NULL）\',' +
    'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
    'KEY idx_supplement_reservation (reservation_id),' +
    'KEY idx_supplement_status (status, created_at)' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=\'补签工单（R-08）\''
  );
}

async function addSupplementRequestColumn(connection, database) {
  if (await columnExists(connection, database, COLUMN.table, COLUMN.column)) return false;
  await connection.query(
    'ALTER TABLE ' + safeIdentifier(COLUMN.table) +
    ' ADD COLUMN supplement_request_id INT DEFAULT NULL COMMENT \'关联补签工单 id（R-08）\''
  );
  return true;
}

async function addReviewRemarkColumn(connection, database) {
  if (await columnExists(connection, database, REVIEW_COLUMN.table, REVIEW_COLUMN.column)) return false;
  await connection.query(
    'ALTER TABLE ' + safeIdentifier(REVIEW_COLUMN.table) +
    ' ADD COLUMN review_remark VARCHAR(255) DEFAULT NULL COMMENT \'审核意见（approve/reject 均可填，无意见为 NULL）\''
  );
  return true;
}

async function verify(connection, database) {
  return {
    table: await tableExists(connection, database, TABLE),
    checkinsSupplementRequestId: await columnExists(connection, database, COLUMN.table, COLUMN.column),
    supplementReviewRemark: await columnExists(connection, database, REVIEW_COLUMN.table, REVIEW_COLUMN.column)
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
    await createSupplementRequests(connection);
    const addedCheckinColumn = await addSupplementRequestColumn(connection, database);
    const addedReviewRemarkColumn = await addReviewRemarkColumn(connection, database);
    const state = await verify(connection, database);

    console.log(JSON.stringify({
      migration: 'supplement-request',
      database,
      addedCheckinColumn,
      addedReviewRemarkColumn,
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
