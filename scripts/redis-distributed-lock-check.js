const { spawn } = require('child_process')

process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_REDIS = 'false'
process.env.REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1'
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379'

async function childMain() {
  const redis = require('../server/src/config/redis')
  const lockService = require('../server/src/services/distributedLockService')
  const state = await redis.ready()
  if (state.mode !== 'redis') throw new Error('child must use real Redis')

  const lock = await lockService.acquire(process.env.LOCK_NAME, 5000)
  if (!lock) {
    console.log('SKIPPED')
    return
  }

  console.log('ACQUIRED')
  await new Promise(function(resolve) { setTimeout(resolve, 600) })
  const released = await lockService.release(lock)
  if (!released) throw new Error('lock owner failed to release its lock')
}

function runChild(lockName) {
  return new Promise(function(resolve, reject) {
    const child = spawn(process.execPath, [__filename], {
      env: Object.assign({}, process.env, {
        LOCK_CHILD_MODE: 'true',
        LOCK_NAME: lockName
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', function(chunk) { stdout += chunk.toString() })
    child.stderr.on('data', function(chunk) { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('exit', function(code) {
      if (code !== 0) {
        reject(new Error('lock child failed: ' + stderr + stdout))
        return
      }
      resolve(stdout)
    })
  })
}

async function parentMain() {
  const redis = require('../server/src/config/redis')
  const state = await redis.ready()
  if (state.mode !== 'redis') throw new Error('real Redis is required for distributed lock regression')

  const lockName = 'ci:cross-process:' + Date.now()
  const key = 'runtime:lock:' + lockName
  await redis.del(key)

  const results = await Promise.all([runChild(lockName), runChild(lockName)])
  const acquired = results.filter(function(output) { return output.includes('ACQUIRED') }).length
  const skipped = results.filter(function(output) { return output.includes('SKIPPED') }).length
  if (acquired !== 1 || skipped !== 1) {
    throw new Error('expected one acquired and one skipped child, got: ' + JSON.stringify(results))
  }
  if (Number(await redis.exists(key)) !== 0) {
    throw new Error('released distributed lock must not remain in Redis')
  }

  console.log('redis-distributed-lock-check passed')
  if (typeof redis.quit === 'function') await redis.quit()
}

const main = process.env.LOCK_CHILD_MODE === 'true' ? childMain : parentMain
main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
