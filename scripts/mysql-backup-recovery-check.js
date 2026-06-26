process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'false'
process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString('base64')
process.env.ALLOW_RESTORE = 'true'
process.env.DATA_RETENTION_APPLY = 'true'
process.env.RETENTION_AUDIT_DAYS = '30'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const mysql = require('../server/node_modules/mysql2/promise')
const db = require('../server/src/config/database')
const backupSchemaService = require('../server/src/services/backupSchemaService')
const backupService = require('../server/src/services/backupService')
const dataRetentionService = require('../server/src/services/dataRetentionService')

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-backup-check-'))
  const backupDir = path.join(workspace, 'primary')
  const secondaryDir = path.join(workspace, 'secondary')
  const uploadsDir = path.join(workspace, 'uploads')
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.writeFileSync(path.join(uploadsDir, 'recovery-marker.txt'), 'restore me')
  process.env.BACKUP_DIR = backupDir
  process.env.BACKUP_SECONDARY_DIR = secondaryDir
  process.env.UPLOADS_DIR = uploadsDir
  process.env.BACKUP_RETENTION_DAYS = '1'
  process.env.BACKUP_MIN_KEEP = '1'

  await db.ready()
  await backupSchemaService.assertReady()
  const targetDatabase = 'jingyi_restore_ci_' + Date.now().toString(36)
  process.env.RESTORE_CONFIRM_DATABASE = targetDatabase

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jingyi_reservation',
    dateStrings: true
  })

  try {
    const [sourceRooms] = await connection.query('SELECT COUNT(*) AS count FROM rooms')
    const [sourceReservations] = await connection.query('SELECT COUNT(*) AS count FROM reservations')
    const backup = await backupService.createBackup({ trigger: 'drill' })
    assert(fs.existsSync(backup.filePath), 'encrypted backup must exist')
    assert(fs.existsSync(backup.filePath + '.sha256'), 'backup checksum sidecar must exist')
    assert(fs.existsSync(path.join(secondaryDir, backup.fileName)), 'secondary backup copy must exist')
    assert.strictEqual(backup.secondaryCopied, true)

    const verification = await backupService.verifyBackup(backup.filePath)
    assert.strictEqual(verification.valid, true)
    assert.strictEqual(verification.manifest.components.database.sha256.length, 64)
    assert(verification.manifest.components.uploads, 'uploads component must be included')

    const restoredUploads = path.join(workspace, 'restored-uploads')
    const restored = await backupService.restoreBackup(backup.filePath, {
      targetDatabase,
      restoreUploads: true,
      targetUploadsDirectory: restoredUploads
    })
    assert.strictEqual(restored.validation.ready, true)
    assert.strictEqual(fs.readFileSync(path.join(restoredUploads, 'recovery-marker.txt'), 'utf8'), 'restore me')

    const [restoredRooms] = await connection.query('SELECT COUNT(*) AS count FROM `' + targetDatabase + '`.rooms')
    const [restoredReservations] = await connection.query('SELECT COUNT(*) AS count FROM `' + targetDatabase + '`.reservations')
    assert.strictEqual(Number(restoredRooms[0].count), Number(sourceRooms[0].count), 'restored room count must match')
    assert.strictEqual(Number(restoredReservations[0].count), Number(sourceReservations[0].count), 'restored reservation count must match')

    const requestId = 'retention-ci-' + Date.now()
    await connection.execute(
      "INSERT INTO operation_logs (operator_id,request_id,actor_role,action,target_table,target_id,description,method,path,status_code,outcome,ip_hash,user_agent,metadata,prev_hash,entry_hash,created_at) " +
      "VALUES (NULL,?,'system','retention_ci','system',NULL,'retention test','INTERNAL','',200,'success','','',JSON_OBJECT(),NULL,NULL,'2020-01-01 00:00:00')",
      [requestId]
    )
    const archived = await dataRetentionService.archiveTable('operation_logs', { apply: true, limit: 10000 })
    assert(archived.archived >= 1, 'old operation log must be archived')
    assert(archived.deleted >= 1, 'old operation log must be deleted after encrypted archive is durable')
    assert(fs.existsSync(path.join(dataRetentionService.archiveRoot(), archived.fileName)), 'retention archive must exist')
    const [remaining] = await connection.execute('SELECT COUNT(*) AS count FROM operation_logs WHERE request_id=?', [requestId])
    assert.strictEqual(Number(remaining[0].count), 0)

    const [runs] = await connection.execute('SELECT status,checksum_sha256,secondary_copied FROM backup_runs WHERE backup_id=?', [backup.backupId])
    assert.strictEqual(runs[0].status, 'success')
    assert.strictEqual(runs[0].checksum_sha256, backup.checksum)
    assert.strictEqual(Number(runs[0].secondary_copied), 1)

    console.log('mysql-backup-recovery-check passed')
  } finally {
    try { await connection.query('DROP DATABASE IF EXISTS `' + targetDatabase + '`') } catch (err) {}
    await connection.end()
    await db.close()
    fs.rmSync(workspace, { recursive: true, force: true })
  }
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
