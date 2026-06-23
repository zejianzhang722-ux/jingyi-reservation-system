const fs = require('fs')
const path = require('path')
const mysql = require('../server/node_modules/mysql2/promise')

function splitStatements(sql) {
  return sql
    .replace(/^\uFEFF/, '')
    .split(';')
    .map(function(statement) { return statement.trim() })
    .filter(Boolean)
}

function statementLabel(statement) {
  const match = statement.match(/^(CREATE TABLE|INSERT INTO|ALTER TABLE|USE|CREATE DATABASE)\s+(?:IF NOT EXISTS\s+)?`?([\w-]+)?/i)
  return match ? match[1].toUpperCase() + ' ' + (match[2] || '') : statement.slice(0, 80)
}

async function executeStatements(connection, sql, allowDeferredForeignKeys) {
  const deferred = []
  const statements = splitStatements(sql)

  for (const statement of statements) {
    try {
      await connection.query(statement)
    } catch (err) {
      const missingParent = err && (err.errno === 1824 || err.code === 'ER_FK_CANNOT_OPEN_PARENT')
      if (allowDeferredForeignKeys && missingParent && /^CREATE TABLE/i.test(statement)) {
        deferred.push(statement)
        continue
      }
      err.message = statementLabel(statement) + ': ' + err.message
      throw err
    }
  }

  for (const statement of deferred) {
    try {
      await connection.query(statement)
    } catch (err) {
      err.message = statementLabel(statement) + ' (deferred): ' + err.message
      throw err
    }
  }
}

async function main() {
  const database = process.env.MYSQL_DATABASE || 'jingyi_reservation_ci'
  if (!/(test|ci|local|dev|stage)/i.test(database)) {
    throw new Error('Refusing to initialize a database without a safe test name')
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || ''
  })

  try {
    const schemaPath = path.join(__dirname, '../server/sql/schema.sql')
    const seedPath = path.join(__dirname, '../server/sql/seed.sql')
    const replaceDatabase = function(sql) {
      return sql.replace(/jingyi_reservation/g, database)
    }

    await connection.query('DROP DATABASE IF EXISTS `' + database.replace(/`/g, '') + '`')
    await executeStatements(connection, replaceDatabase(fs.readFileSync(schemaPath, 'utf8')), true)
    await executeStatements(connection, replaceDatabase(fs.readFileSync(seedPath, 'utf8')), false)

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
