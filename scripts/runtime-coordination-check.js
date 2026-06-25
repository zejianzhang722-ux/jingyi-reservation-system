process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_REDIS = 'true'
process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = '1'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const redis = require('../server/src/config/redis')
const distributedLockService = require('../server/src/services/distributedLockService')
const schedulerService = require('../server/src/services/schedulerService')

async function main() {
  const redisState = await redis.ready()
  assert.strictEqual(redisState.mode, 'mock', 'runtime coordination regression must use isolated mock Redis')

  let releaseFirst
  let firstEntered
  const entered = new Promise(function(resolve) { firstEntered = resolve })
  const gate = new Promise(function(resolve) { releaseFirst = resolve })

  const first = distributedLockService.withLock({
    name: 'test-shared-task',
    ttlMs: 5000
  }, async function() {
    firstEntered()
    await gate
    return 'first-complete'
  })

  await entered
  const second = await distributedLockService.withLock({
    name: 'test-shared-task',
    ttlMs: 5000
  }, async function() {
    return 'must-not-run'
  })
  assert.strictEqual(second.acquired, false, 'second concurrent task must skip while the lock is held')

  releaseFirst()
  const firstResult = await first
  assert.strictEqual(firstResult.acquired, true, 'first task must acquire the lock')
  assert.strictEqual(firstResult.value, 'first-complete', 'first task result must be preserved')

  const third = await distributedLockService.withLock({
    name: 'test-shared-task',
    ttlMs: 5000
  }, async function() {
    return 'third-complete'
  })
  assert.strictEqual(third.acquired, true, 'released lock must be available to the next task')

  const owned = await distributedLockService.acquire('test-renew-release', 5000)
  assert.strictEqual(owned.acquired, true, 'lock acquisition must succeed')
  const renewed = await distributedLockService.renew(owned, 7000)
  assert.strictEqual(renewed, true, 'lock owner must be able to renew the lock')
  const forgedRelease = await distributedLockService.release(Object.assign({}, owned, { token: 'forged-token' }))
  assert.strictEqual(forgedRelease, false, 'non-owner token must not release a lock')
  assert.strictEqual(await distributedLockService.release(owned), true, 'lock owner must release the lock')

  await schedulerService.stopScheduler()
  const registered = []
  const cancelled = []
  const fakeSchedule = {
    scheduleJob: function(cron, callback) {
      const job = {
        cron,
        callback,
        cancel: function() { cancelled.push(cron) }
      }
      registered.push(job)
      return job
    }
  }
  const fakeRedis = {
    ready: async function() { return { mode: 'mock' } },
    isMock: function() { return true }
  }
  const fakeLockService = {
    withLock: async function(options, task) {
      return { acquired: true, value: await task(), lockKey: options.name }
    }
  }
  const fakeTasks = [
    { name: 'alpha', cron: '* * * * *', ttlMs: 5000, run: async function() { return 'alpha' } },
    { name: 'beta', cron: '*/5 * * * *', ttlMs: 5000, run: async function() { return 'beta' } }
  ]

  const initialized = await schedulerService.initScheduler({
    scheduleLib: fakeSchedule,
    redisClient: fakeRedis,
    lockService: fakeLockService,
    taskDefinitions: fakeTasks
  })
  const reused = await schedulerService.initScheduler({
    scheduleLib: fakeSchedule,
    redisClient: fakeRedis,
    lockService: fakeLockService,
    taskDefinitions: fakeTasks
  })
  assert.strictEqual(initialized.reused, false, 'first scheduler initialization must register jobs')
  assert.strictEqual(reused.reused, true, 'second scheduler initialization must be ignored')
  assert.strictEqual(registered.length, 2, 'duplicate initialization must not register duplicate jobs')

  const executed = await registered[0].callback()
  assert.strictEqual(executed.status, 'success', 'registered job must run through the lock wrapper')
  assert.strictEqual(executed.value, 'alpha', 'registered job result must be preserved')

  await schedulerService.stopScheduler()
  assert.strictEqual(cancelled.length, 2, 'scheduler shutdown must cancel all registered jobs')

  const appSource = fs.readFileSync(path.join(__dirname, '../server/src/app.js'), 'utf8')
  const workerSource = fs.readFileSync(path.join(__dirname, '../server/src/scheduler-worker.js'), 'utf8')
  const serverPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/package.json'), 'utf8'))
  const schedulerSource = fs.readFileSync(path.join(__dirname, '../server/src/services/schedulerService.js'), 'utf8')
  const redisSource = fs.readFileSync(path.join(__dirname, '../server/src/config/redis.js'), 'utf8')
  assert(/await schedulerService\.initScheduler\(\)/.test(appSource), 'server startup must await scheduler initialization')
  assert(/await schedulerService\.initScheduler\(\)/.test(workerSource), 'dedicated worker must await scheduler initialization')
  assert(/checkDataReadiness\(\)/.test(workerSource), 'dedicated worker must verify production dependencies before scheduling')
  assert.strictEqual(serverPackage.scripts['start:scheduler'], 'node src/scheduler-worker.js', 'server package must expose the scheduler worker command')
  assert(/process\.env\.NODE_ENV === 'production' && mockMode/.test(schedulerSource), 'production scheduler must reject mock Redis')
  assert(/distributedLockService/.test(schedulerSource), 'scheduler jobs must use the distributed lock service')
  assert(/options\.nx && exists/.test(redisSource), 'mock Redis must implement NX semantics for lock tests')
  assert(/redis\.call\('del'/.test(distributedLockService.RELEASE_SCRIPT), 'lock release must compare ownership before delete')

  console.log('runtime-coordination-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
