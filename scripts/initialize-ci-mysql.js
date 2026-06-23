const fs = require('fs')
const path = require('path')
const mysql = require('../server/node_modules/mysql2/promise')

async function main() {
  const database = process.env.MYSQL_DATABASE || 'jingyi_reservation_ci'
  if (!/(test|ci|local|dev|stage)/i.test(database)) {
    throw new Error('Refusing to initialize a database without a safe test name')
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    multipleStatements: true
  })

  try {
    const schemaPath = path.join(__dirname, '../server/sql/schema.sql')
    const seedPath = path.join(__dirname, '../server/sql/seed.sql')
    const replaceDatabase = function(sql) {
      return sql.replace(/jingyi_reservation/g, database)
    }

    await connection.query('DROP DATABASE IF EXISTS `' + database.replace(/`/g, '') + '`')
    await connection.query(replaceDatabase(fs.readFileSync(schemaPath, 'utf8')))
    await connection.query(replaceDatabase(fs.readFileSync(seedPath, 'utf8')))

    const [tables] = await connection.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = ?',
      [database]
    )
    if (!tables.some(function(row) { return row.TABLE_NAME === 'reservation_slots' || row.table_name === 'reservation_slots' })) {
      throw new Error('reservation_slots table was not created')
    }

    console.log('initialize-ci-mysql passed: ' + database)
  } finally {
    await connection.end()
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
