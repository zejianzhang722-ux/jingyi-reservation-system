const path = require('path')
const backupService = require('../server/src/services/backupService')

async function main() {
  const file = process.argv[2] || process.env.BACKUP_FILE
  if (!file) throw new Error('Usage: node scripts/verify-backup.js <backup-file>')
  const result = await backupService.verifyBackup(path.resolve(file))
  console.log(JSON.stringify(result, null, 2))
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
