process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_REDIS = 'false'

const assert = require('assert')
const crypto = require('crypto')
const { Server } = require('../server/node_modules/socket.io')
const redis = require('../server/src/config/redis')
const distributedLockService = require('../server/src/services/distributedLockService')
const adapterService = require('../server/src/services/socketRedisAdapterService')

async function connect(client) {
  if (client.status === 'wait') await client.connect()
  await client.ping()
}

async function close(client) {
  if (!client) return
  try {
    if (client.status !== 'end') await client.quit()
  } catch (err) {
    if (typeof client.disconnect === 'function') client.disconnect()
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(function(resolve) { setTimeout(resolve, 25) })
  }
  throw new Error('Timed out waiting for Redis cross-instance broadcast')
}

async function main() {
  const state = await redis.ready()
  assert.strictEqual(state.mode, 'redis', 'real Redis service is required for runtime integration checks')

  const lockName = 'integration-' + crypto.randomUUID()
  const first = await distributedLockService.acquire(lockName, 5000)
  assert.strictEqual(first.acquired, true, 'first real Redis lock acquisition must succeed')
  const second = await distributedLockService.acquire(lockName, 5000)
  assert.strictEqual(second.acquired, false, 'second real Redis lock acquisition must be rejected')
  assert.strictEqual(
    await distributedLockService.release(Object.assign({}, first, { token: 'forged' })),
    false,
    'real Redis lock must reject a forged release token'
  )
  assert.strictEqual(await distributedLockService.release(first), true, 'real Redis lock owner must release the lock')
  const reacquired = await distributedLockService.acquire(lockName, 5000)
  assert.strictEqual(reacquired.acquired, true, 'released real Redis lock must be reacquirable')
  await distributedLockService.release(reacquired)

  const clients = [redis.duplicate(), redis.duplicate(), redis.duplicate(), redis.duplicate()]
  await Promise.all(clients.map(connect))
  const ioA = new Server()
  const ioB = new Server()
  const prefix = 'runtime:test:' + crypto.randomUUID() + ':'
  ioA.adapter(adapterService.createAdapterFactory(clients[0], clients[1], {
    prefix,
    uid: 'instance-a'
  }))
  ioB.adapter(adapterService.createAdapterFactory(clients[2], clients[3], {
    prefix,
    uid: 'instance-b'
  }))
  await Promise.all([ioA.of('/').adapter.ready, ioB.of('/').adapter.ready])

  const received = []
  const fakeSocket = {
    id: 'remote-socket',
    client: {
      writeToEngine: function(encodedPackets, options) {
        received.push({ encodedPackets, options })
      }
    },
    notifyOutgoingListeners: function() {}
  }
  ioB.of('/').sockets.set(fakeSocket.id, fakeSocket)
  ioB.of('/').adapter.addAll(fakeSocket.id, new Set([fakeSocket.id, 'building:2']))

  ioA.to('building:2').emit('room-status-update', { roomId: 8, status: 'using' })
  await waitFor(function() { return received.length > 0 }, 3000)
  assert(received[0].encodedPackets.length > 0, 'remote Socket.IO instance must encode the Redis broadcast for its local client')

  ioA.of('/').adapter.close()
  ioB.of('/').adapter.close()
  ioA.close()
  ioB.close()
  await Promise.all(clients.map(close))
  if (typeof redis.quit === 'function') await redis.quit()

  console.log('redis-runtime-integration-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(async function(err) {
  console.error(err && err.stack ? err.stack : err)
  try {
    if (typeof redis.quit === 'function') await redis.quit()
  } catch (closeErr) {}
  process.exit(1)
})
