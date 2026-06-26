process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'false'
process.env.AUDIT_IP_HASH_SALT = 'mysql-audit-test-salt-with-more-than-32-characters'

const assert = require('assert')
const mysql = require('../server/node_modules/mysql2/promise')
const db = require('../server/src/config/database')
const auditTrailService = require('../server/src/services/auditTrailService')
const auditSchemaService = require('../server/src/services/auditSchemaService')

const ADMIN_USERNAME = 'observability_audit_ci'
const REQUEST_PREFIX = 'obs-ci-'
const LEGACY_ACTION = 'observability_legacy_ci'

async function main() {
  const dbState = await db.ready()
  assert.strictEqual(dbState.mode, 'mysql', 'real MySQL is required for observability audit integration')
  const schemaState = await auditSchemaService.assertReady()
  assert.strictEqual(schemaState.ready, true, 'audit schema migration must be applied')

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jingyi_reservation',
    dateStrings: true
  })

  let adminId = null
  try {
    await connection.execute('DELETE FROM operation_logs WHERE request_id LIKE ? OR action = ?', [REQUEST_PREFIX + '%', LEGACY_ACTION])
    await connection.execute('DELETE FROM admins WHERE username = ?', [ADMIN_USERNAME])
    const [adminResult] = await connection.execute(
      "INSERT INTO admins (username,password,real_name,role,status,created_at,updated_at) VALUES (?,?,?,'super_admin','active',NOW(),NOW())",
      [ADMIN_USERNAME, 'not-used-in-test', 'Observability Audit CI']
    )
    adminId = adminResult.insertId

    const first = await auditTrailService.record({
      operatorId: adminId,
      requestId: REQUEST_PREFIX + '0001',
      actorRole: 'super_admin',
      action: 'http.post.admin.rooms',
      targetTable: 'rooms',
      targetId: 101,
      description: 'mysql audit first',
      method: 'POST',
      path: '/api/v1/admin/rooms',
      statusCode: 200,
      ip: '198.51.100.10',
      userAgent: 'mysql-observability-check',
      metadata: { body: { room: 'A101', password: 'redact-me' } }
    })
    const second = await auditTrailService.record({
      operatorId: adminId,
      requestId: REQUEST_PREFIX + '0002',
      actorRole: 'super_admin',
      action: 'http.put.admin.rooms_id',
      targetTable: 'rooms',
      targetId: 101,
      description: 'mysql audit second',
      method: 'PUT',
      path: '/api/v1/admin/rooms/:id',
      statusCode: 409,
      ip: '198.51.100.10',
      userAgent: 'mysql-observability-check',
      metadata: { body: { status: 'closed' } }
    })
    assert.strictEqual(second.prev_hash, first.entry_hash, 'MySQL audit rows must form a hash chain')

    await connection.execute(
      'INSERT INTO operation_logs (operator_id,action,target_table,target_id,description,created_at) VALUES (?,?,?,?,?,NOW())',
      [adminId, LEGACY_ACTION, 'rooms', 101, 'legacy insert compatibility']
    )

    const third = await auditTrailService.record({
      operatorId: adminId,
      requestId: REQUEST_PREFIX + '0003',
      actorRole: 'super_admin',
      action: 'http.delete.admin.rooms_id',
      targetTable: 'rooms',
      targetId: 101,
      description: 'mysql audit third',
      method: 'DELETE',
      path: '/api/v1/admin/rooms/:id',
      statusCode: 200,
      metadata: {}
    })
    assert.strictEqual(third.prev_hash, second.entry_hash, 'legacy unhashed insert must not break the MySQL hash chain')

    let [rows] = await connection.execute(
      'SELECT * FROM operation_logs WHERE request_id LIKE ? OR action = ? ORDER BY id',
      [REQUEST_PREFIX + '%', LEGACY_ACTION]
    )
    let verification = auditTrailService.verifyRows(rows)
    assert.strictEqual(verification.valid, true, 'MySQL audit chain must verify')
    assert.strictEqual(verification.checked, 3, 'three hashed MySQL rows must be checked')
    assert.strictEqual(verification.unhashed, 1, 'legacy MySQL row must be reported as unhashed')

    const firstRow = rows.find(function(row) { return row.request_id === REQUEST_PREFIX + '0001' })
    const metadata = typeof firstRow.metadata === 'string' ? JSON.parse(firstRow.metadata) : firstRow.metadata
    assert.strictEqual(metadata.body.password, '[redacted]', 'sensitive MySQL audit metadata must be redacted')
    assert.strictEqual(firstRow.ip_hash.length, 64, 'MySQL audit IP hash must be SHA-256 length')
    assert.notStrictEqual(firstRow.ip_hash, '198.51.100.10', 'raw IP must not be stored')

    await connection.execute('UPDATE operation_logs SET description = ? WHERE request_id = ?', [
      'tampered description',
      REQUEST_PREFIX + '0002'
    ])
    ;[rows] = await connection.execute(
      'SELECT * FROM operation_logs WHERE request_id LIKE ? OR action = ? ORDER BY id',
      [REQUEST_PREFIX + '%', LEGACY_ACTION]
    )
    verification = auditTrailService.verifyRows(rows)
    assert.strictEqual(verification.valid, false, 'database tampering must invalidate the audit chain')
    assert(verification.problems.some(function(problem) { return problem.issue === 'entry_hash_mismatch' }), 'tampering must produce hash mismatch')

    await connection.execute('UPDATE operation_logs SET description = ? WHERE request_id = ?', [
      'mysql audit second',
      REQUEST_PREFIX + '0002'
    ])
    ;[rows] = await connection.execute(
      'SELECT * FROM operation_logs WHERE request_id LIKE ? OR action = ? ORDER BY id',
      [REQUEST_PREFIX + '%', LEGACY_ACTION]
    )
    assert.strictEqual(auditTrailService.verifyRows(rows).valid, true, 'restored row must make audit chain valid')

    await connection.execute('DELETE FROM admins WHERE id = ?', [adminId])
    const [preserved] = await connection.execute(
      'SELECT COUNT(*) AS count,SUM(operator_id IS NULL) AS null_operators FROM operation_logs WHERE request_id LIKE ? OR action = ?',
      [REQUEST_PREFIX + '%', LEGACY_ACTION]
    )
    assert.strictEqual(Number(preserved[0].count), 4, 'administrator deletion must preserve all audit rows')
    assert.strictEqual(Number(preserved[0].null_operators), 4, 'preserved audit rows must detach deleted administrator')
    adminId = null

    console.log('mysql-observability-audit-check passed')
  } finally {
    try { await connection.execute('DELETE FROM operation_logs WHERE request_id LIKE ? OR action = ?', [REQUEST_PREFIX + '%', LEGACY_ACTION]) } catch (err) {}
    if (adminId) {
      try { await connection.execute('DELETE FROM admins WHERE id = ?', [adminId]) } catch (err) {}
    }
    try { await connection.execute('DELETE FROM admins WHERE username = ?', [ADMIN_USERNAME]) } catch (err) {}
    await connection.end()
    await db.close()
  }
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
