const db = require('../server/src/config/database')
const backupSchemaService = require('../server/src/services/backupSchemaService')
const backupService = require('../server/src/services/backupService')

async function main() {
  await db.ready()
  await backupSchemaService.assertReady()
  const suffix = Date.now().toString(36)
  const targetDatabase = 'jingyi_drill_' + suffix
  const startedAt = Date.now()
  const backup = await backupService.createBackup({ trigger: 'drill' })
  process.env.ALLOW_RESTORE = 'true'
  process.env.RESTORE_CONFIRM_DATABASE = targetDatabase
  const restored = await backupService.restoreBackup(backup.filePath, { targetDatabase, restoreUploads: false })
  const rtoSeconds = Math.ceil((Date.now() - startedAt) / 1000)
  await db.query('DROP DATABASE `' + backupService.safeIdentifier(targetDatabase, '演练数据库') + '`')
  console.log(JSON.stringify({
    success: true,
    backupId: backup.backupId,
    targetDatabase,
    validation: restored.validation,
    rtoSeconds,
    rpoSeconds: 0
  }, null, 2))
}

main().then(async function() {
  try { await db.close() } catch (err) {}
  process.exit(0)
}).catch(async function(err) {
  console.error(err && err.stack ? err.stack : err)
  try { await db.close() } catch (closeErr) {}
  process.exit(1)
})
