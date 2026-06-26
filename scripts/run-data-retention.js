const db = require('../server/src/config/database')
const backupSchemaService = require('../server/src/services/backupSchemaService')
const dataRetentionService = require('../server/src/services/dataRetentionService')

async function main() {
  await db.ready()
  await backupSchemaService.assertReady()
  const result = await dataRetentionService.runRetention({
    apply: process.env.DATA_RETENTION_APPLY === 'true'
  })
  console.log(JSON.stringify(result, null, 2))
}

main().then(async function() {
  try { await db.close() } catch (err) {}
  process.exit(0)
}).catch(async function(err) {
  console.error(err && err.stack ? err.stack : err)
  try { await db.close() } catch (closeErr) {}
  process.exit(1)
})
