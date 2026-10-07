const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '../server/.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(MYSQL_(?:HOST|PORT|USER|PASSWORD|DATABASE))\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}
const mysql = require('../server/node_modules/mysql2/promise');
async function main() {
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '', database: process.env.MYSQL_DATABASE || 'jingyi_reservation' });
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../server/sql/migrations/20261006_admin_notifications.sql'), 'utf8');
    await connection.query(sql);
    await connection.query('SELECT id, admin_id, dedupe_key FROM admin_notifications LIMIT 1');
    console.log('管理员通知存储已就绪，学生消息保持独立。');
  } finally { await connection.end(); }
}
main().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
