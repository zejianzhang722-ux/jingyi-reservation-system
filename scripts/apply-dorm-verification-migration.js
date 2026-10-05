const fs = require('fs')
const path = require('path')
require('../server/node_modules/dotenv').config({ path: path.join(__dirname, '../server/.env') })
const mysql = require('../server/node_modules/mysql2/promise')
async function main() {
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '', database: process.env.MYSQL_DATABASE || 'jingyi_reservation' })
  let locked = false
  try {
    const [rows] = await conn.execute("SELECT GET_LOCK('jingyi_dorm_verification_migration', 30) AS acquired")
    if (Number(rows[0].acquired) !== 1) throw new Error('迁移锁不可用')
    locked = true
    const sql = fs.readFileSync(path.join(__dirname, '../server/sql/migrations/20261004_dorm_verification.sql'), 'utf8').replace(/^--.*$/gm, '')
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await conn.query(statement)
    for (const name of ['verification_events', 'reservation_verifications']) await conn.query('SELECT 1 FROM `' + name + '` LIMIT 1')
    console.log('宿管签到与核验记录结构已就绪（不修改现有业务记录）')
  } finally { if (locked) await conn.query("SELECT RELEASE_LOCK('jingyi_dorm_verification_migration')"); await conn.end() }
}
main().catch(e => { console.error(e.code || e.message); process.exitCode = 1 })
