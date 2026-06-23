process.env.NODE_ENV = 'production'
process.env.ALLOW_MOCK_DB = 'false'
process.env.ALLOW_MOCK_REDIS = 'false'

const assert = require('assert')
const db = require('../server/src/config/database')
const redis = require('../server/src/config/redis')

async function main() {
  const dbState = await db.ready()
  const redisState = await redis.ready()

  assert.strictEqual(dbState.mode, 'mysql', 'production readiness must use MySQL')
  assert.strictEqual(redisState.mode, 'redis', 'production readiness must use Redis')
  assert.strictEqual(db.isMock(), false, 'production database must never use mock mode')
  assert.strictEqual(redis.isMock(), false, 'production Redis must never use in-memory mock mode')

  const [rows] = await db.query('SELECT 1 AS ready')
  assert.strictEqual(Number(rows[0].ready), 1, 'production MySQL query must succeed')
  assert.strictEqual(await redis.ping(), 'PONG', 'production Redis ping must succeed')

  console.log('production-data-readiness-check passed')
}

main().then(async function() {
  try { await redis.quit() } catch (err) {}
  process.exit(0)
}).catch(async function(err) {
  console.error(err && err.stack ? err.stack : err)
  try { await redis.quit() } catch (quitErr) {}
  process.exit(1)
})
