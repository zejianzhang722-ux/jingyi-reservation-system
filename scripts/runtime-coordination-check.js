process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_REDIS = 'true'
process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = '1'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const redis = require('../server/src/config/redis')
const lockService = require('../server/src/services/distributedLockService')
const schedulerService = require('../server/src/services/schedulerService')

async function main() {
  const redisState = await redis.ready()
  assert.strictEqual(redisState.mode, 'mock', 'runtime coordination regression must use isolated mock Redis')
  lockService.clearMockLocks()

  const firstLock = await lockService.acquire('test:exclusive', 5000)
  assert(firstLock, 'first lock acquisition must succeed')
  const duplicateLock = await lockService.acquire('test:exclusive', 5000)
  assert.strictEqual(duplicateLock, null, 'second lock acquisition must be skipped')

  const forgedRelease = await lockService.release({
    key: firstLock.key,
    token: 'forged-token',
    mock: true
  })
  assert.strictEqual(forgedRelease, false, 'a different owner must not release the lock')
  assert.strictEqual(await lockService.extend(firstLock, 6000), true, 'lock owner must be able to extend the lock')
  assert.strictEqual(await lockService.release(firstLock), true, 'lock owner must release the lock')

  let successfulRuns = 0
  const definition = {
    name: 'test-once-per-window',
    windowMs: 60000,
    lockTtlMs: 90000,
    run: async function() {
      successfulRuns += 1
      return successfulRuns
    }
  }
  const fireDate = new Date('2026-06-25T08:00:10.000Z')
  const firstExecution = await schedulerService.runCoordinatedTask(definition, fireDate)
  const secondExecution = await schedulerService.runCoordinatedTask(definition, fireDate)
  assert.strictEqual(firstExecution.acquired, true, 'first task in one time window must run')
  assert.strictEqual(firstExecution.retained, true, 'successful scheduler lock must be retained for the window')
  assert.strictEqual(secondExecution.skipped, true, 'duplicate task in the same time window must be skipped')
  assert.strictEqual(successfulRuns, 1, 'task body must run exactly once in one time window')

  let failedRuns = 0
  const retryableDefinition = {
    name: 'test-failure-retry',
    windowMs: 60000,
    lockTtlMs: 90000,
    run: async function() {
      failedRuns += 1
      if (failedRuns === 1) throw new Error('expected failure')
      return 'recovered'
    }
  }
  let expectedFailure = null
  try {
    await schedulerService.runCoordinatedTask(retryableDefinition, fireDate)
  } catch (err) {
    expectedFailure = err
  }
  assert(expectedFailure, 'failed task must surface its error')
  const retried = await schedulerService.runCoordinatedTask(retryableDefinition, fireDate)
  assert.strictEqual(retried.acquired, true, 'failed task must release its lock so the window can retry')
  assert.strictEqual(failedRuns, 2, 'failed task must be retried exactly once in this regression')

  const names = schedulerService.taskDefinitions.map(function(task) { return task.name })
  assert.strictEqual(new Set(names).size, names.length, 'scheduler task names must be unique')
  const endReminder = schedulerService.taskDefinitions.find(function(task) {
    return task.name === 'reservation-end-reminder'
  })
  const waitlistExpiry = schedulerService.taskDefinitions.find(function(task) {
    return task.name === 'waitlist-expiry'
  })
  assert.strictEqual(endReminder.cron, '* * * * *', 'ending reminders must run every minute')
  assert.strictEqual(waitlistExpiry.cron, '*/10 * * * *', 'waitlist expiry must run every ten minutes')

  const schedulerSource = fs.readFileSync(
    path.join(__dirname, '../server/src/services/schedulerService.js'),
    'utf8'
  )
  const appSource = fs.readFileSync(path.join(__dirname, '../server/src/app.js'), 'utf8')
  assert(/runExclusive/.test(schedulerSource), 'all scheduler jobs must use the distributed lock wrapper')
  assert(/retainOnSuccess:\s*true/.test(schedulerSource), 'successful scheduler windows must retain their lock')
  assert(/if \(initialized\)/.test(schedulerSource), 'scheduler must prevent duplicate in-process initialization')
  assert(/await initScheduler\(\)/.test(appSource), 'server startup must await scheduler initialization')

  const initialized = await schedulerService.initScheduler()
  const duplicateInitialization = await schedulerService.initScheduler()
  assert.strictEqual(initialized.initialized, true, 'first scheduler initialization must register jobs')
  assert.strictEqual(duplicateInitialization.initialized, false, 'second scheduler initialization must be ignored')
  assert.strictEqual(
    schedulerService.getSchedulerState().jobs.length,
    schedulerService.taskDefinitions.length,
    'all task definitions must be registered exactly once'
  )
  assert.strictEqual(
    schedulerService.stopScheduler(),
    schedulerService.taskDefinitions.length,
    'scheduler shutdown must cancel every registered job'
  )

  console.log('runtime-coordination-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  try { schedulerService.stopScheduler() } catch (stopErr) {}
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
