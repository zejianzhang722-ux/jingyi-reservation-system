process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_REDIS = 'false'

const assert = require('assert')
const crypto = require('crypto')
const http = require('http')
const { Server } = require('../server/node_modules/socket.io')
const { io: createClient } = require('../admin/node_modules/socket.io-client')
const redis = require('../server/src/config/redis')
const distributedLockService = require('../server/src/services/distributedLockService')
const adapterService = require('../server/src/services/socketRedisAdapterService')

async function connectRedis(client) {
  if (client.status === 'wait') await client.connect()
  await client.ping()
}

async function closeRedis(client) {
  if (!client) return
  try {
    if (client.status !== 'end') await client.quit()
  } catch (err) {
    if (typeof client.disconnect === 'function') client.disconnect()
  }
}

function listen(server) {
  return new Promise(function(resolve, reject) {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', function() {
      server.removeListener('error', reject)
      resolve(server.address())
    })
  })
}

function waitForClientConnection(client) {
  return new Promise(function(resolve, reject) {
    const timeout = setTimeout(function() {
      reject(new Error('Timed out waiting for Socket.IO client connection'))
    }, 5000)
    client.once('connect', function() {
      clearTimeout(timeout)
      resolve()
    })
    client.once('connect_error', function(err) {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

function waitForEvent(client, eventName, timeoutMs) {
  return new Promise(function(resolve, reject) {
    const timeout = setTimeout(function() {
      client.off(eventName, onEvent)
      reject(new Error('Timed out waiting for Redis cross-instance broadcast'))
    }, timeoutMs)
    const onEvent = function(payload) {
      clearTimeout(timeout)
      resolve(payload)
    }
    client.once(eventName, onEvent)
  })
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
  let ioA = null
  let ioB = null
  let httpServerB = null
  let socketClient = null
  try {
    await Promise.all(clients.map(connectRedis))
    ioA = new Server()
    httpServerB = http.createServer()
    ioB = new Server(httpServerB, { transports: ['websocket'] })
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

    ioB.on('connection', function(socket) {
      socket.join('building:2')
    })
    const address = await listen(httpServerB)
    socketClient = createClient('http://127.0.0.1:' + address.port, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000
    })
    await waitForClientConnection(socketClient)

    const eventPromise = waitForEvent(socketClient, 'room-status-update', 5000)
    ioA.to('building:2').emit('room-status-update', { roomId: 8, status: 'using' })
    const payload = await eventPromise
    assert.deepStrictEqual(
      payload,
      { roomId: 8, status: 'using' },
      'remote Socket.IO instance must deliver the Redis broadcast to its local client'
    )

    console.log('redis-runtime-integration-check passed')
  } finally {
    if (socketClient) socketClient.close()
    if (ioA && ioA.of('/').adapter && typeof ioA.of('/').adapter.close === 'function') {
      ioA.of('/').adapter.close()
    }
    if (ioB && ioB.of('/').adapter && typeof ioB.of('/').adapter.close === 'function') {
      ioB.of('/').adapter.close()
    }
    if (ioB) ioB.close()
    if (httpServerB && httpServerB.listening) {
      await new Promise(function(resolve) { httpServerB.close(resolve) })
    }
    await Promise.all(clients.map(closeRedis))
    if (typeof redis.quit === 'function') await redis.quit()
  }
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
