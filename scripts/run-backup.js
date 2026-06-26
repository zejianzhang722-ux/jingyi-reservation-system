const db = require('../server/src/config/database')
const backupSchemaService = require('../server/src/services/backupSchemaService')
const backupService = require('../server/src/services/backupService')

async function main() {
  await db.ready()
  await backupSchemaService.assertReady()
  const result = await backupService.createBackup({ trigger: process.env.BACKUP_TRIGGER || 'scheduled' })
  console.log(JSON.stringify({
    backupId: result.backupId,
    fileName: result.fileName,
    sizeBytes: result.sizeBytes,
    checksum: result.checksum,
    secondaryCopied: result.secondaryCopied
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
