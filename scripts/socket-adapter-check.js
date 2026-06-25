process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_REDIS = 'true'
process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = '1'

const assert = require('assert')
const EventEmitter = require('events')
const { Server } = require('../server/node_modules/socket.io')
const adapterService = require('../server/src/services/socketRedisAdapterService')

class FakeRedisClient extends EventEmitter {
  constructor(role) {
    super()
    this.role = role
    this.status = 'ready'
    this.published = []
    this.subscriptions = []
    this.closed = false
  }

  async publish(channel, payload) {
    this.published.push({ channel, payload })
    return 1
  }

  async subscribe(channel) {
    this.subscriptions.push(channel)
    return this.subscriptions.length
  }

  async unsubscribe(channel) {
    this.subscriptions = this.subscriptions.filter(function(item) { return item !== channel })
    return this.subscriptions.length
  }

  async ping() {
    return 'PONG'
  }

  async quit() {
    this.closed = true
    this.status = 'end'
    return 'OK'
  }
}

async function main() {
  const originalOptions = {
    rooms: new Set(['building:2', 'room:8']),
    except: new Set(['socket-1']),
    flags: { volatile: true }
  }
  const encoded = adapterService.encodeBroadcast('instance-a', { type: 2, data: ['room-status-update', { roomId: 8 }] }, originalOptions)
  const decoded = adapterService.decodeBroadcast(encoded)
  assert.strictEqual(decoded.uid, 'instance-a', 'broadcast instance id must be preserved')
  assert.deepStrictEqual(Array.from(decoded.options.rooms), ['building:2', 'room:8'], 'broadcast rooms must survive serialization')
  assert.deepStrictEqual(Array.from(decoded.options.except), ['socket-1'], 'broadcast exclusions must survive serialization')
  assert.strictEqual(decoded.options.flags.volatile, true, 'broadcast flags must survive serialization')

  let invalid = null
  try {
    adapterService.decodeBroadcast(JSON.stringify({ version: 2 }))
  } catch (err) {
    invalid = err
  }
  assert(invalid, 'unsupported broadcast payload must be rejected')

  const publisher = new FakeRedisClient('publisher')
  const subscriber = new FakeRedisClient('subscriber')
  const io = new Server()
  io.adapter(adapterService.createAdapterFactory(publisher, subscriber, {
    prefix: 'test:socket:',
    uid: 'instance-a'
  }))
  const adapter = io.of('/').adapter

  adapter.broadcast(
    { type: 2, data: ['room-status-update', { roomId: 8, status: 'using' }] },
    { rooms: new Set(['building:2']), except: new Set(), flags: {} }
  )
  await new Promise(function(resolve) { setImmediate(resolve) })
  assert.strictEqual(publisher.published.length, 1, 'normal broadcast must be published to Redis')
  assert.strictEqual(publisher.published[0].channel, 'test:socket:/', 'namespace must be part of the Redis channel')

  adapter.broadcast(
    { type: 2, data: ['local-only', {}] },
    { rooms: new Set(), except: new Set(), flags: { local: true } }
  )
  await new Promise(function(resolve) { setImmediate(resolve) })
  assert.strictEqual(publisher.published.length, 1, 'local-only broadcast must not be republished')

  const listenerCountBeforeClose = subscriber.listenerCount('message')
  assert(listenerCountBeforeClose > 0, 'adapter must listen for Redis broadcast messages')
  adapter.close()
  assert.strictEqual(subscriber.listenerCount('message'), listenerCountBeforeClose - 1, 'adapter close must remove its Redis listener')
  io.close()

  await adapterService.closeSocketAdapter()
  const dedicatedPub = new FakeRedisClient('dedicated-publisher')
  const dedicatedSub = new FakeRedisClient('dedicated-subscriber')
  const duplicates = [dedicatedPub, dedicatedSub]
  const fakeRedis = {
    ready: async function() { return { mode: 'redis' } },
    isMock: function() { return false },
    duplicate: function() { return duplicates.shift() }
  }
  const fakeIo = {
    factory: null,
    adapter: function(factory) { this.factory = factory }
  }
  const initialized = await adapterService.initSocketAdapter(fakeIo, {
    redisClient: fakeRedis,
    prefix: 'runtime-test:',
    uid: 'runtime-test-instance'
  })
  assert.strictEqual(initialized.mode, 'redis-broadcast', 'real Redis mode must enable cross-instance broadcasts')
  assert.strictEqual(typeof fakeIo.factory, 'function', 'Socket.IO adapter factory must be registered')
  await adapterService.closeSocketAdapter()
  assert.strictEqual(dedicatedPub.closed, true, 'dedicated publisher must close during shutdown')
  assert.strictEqual(dedicatedSub.closed, true, 'dedicated subscriber must close during shutdown')

  console.log('socket-adapter-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
