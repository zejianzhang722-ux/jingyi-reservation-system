const path = require('path')
const backupService = require('../server/src/services/backupService')

async function main() {
  const file = process.argv[2] || process.env.BACKUP_FILE
  const targetDatabase = process.argv[3] || process.env.RESTORE_TARGET_DATABASE
  if (!file || !targetDatabase) {
    throw new Error('Usage: ALLOW_RESTORE=true RESTORE_CONFIRM_DATABASE=<db> node scripts/restore-backup.js <backup-file> <target-db>')
  }
  const result = await backupService.restoreBackup(path.resolve(file), {
    targetDatabase,
    restoreUploads: process.env.RESTORE_UPLOADS === 'true',
    targetUploadsDirectory: process.env.RESTORE_UPLOADS_DIR
  })
  console.log(JSON.stringify(result, null, 2))
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
