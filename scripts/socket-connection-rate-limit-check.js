process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_REDIS = 'true'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const service = require('../server/src/services/socketConnectionRateLimitService')

function fakeRedis() {
  const values = new Map()
  const expiries = new Map()
  return {
    set: async function(key, value, mode, ttl, nx) {
      if (mode !== 'EX' || nx !== 'NX') throw new Error('unexpected set options')
      if (values.has(key)) return null
      values.set(key, Number(value))
      expiries.set(key, Number(ttl))
      return 'OK'
    },
    incr: async function(key) {
      const next = Number(values.get(key) || 0) + 1
      values.set(key, next)
      return next
    },
    ttl: async function(key) {
      return expiries.has(key) ? expiries.get(key) : -1
    },
    expire: async function(key, seconds) {
      expiries.set(key, Number(seconds))
      return 1
    }
  }
}

async function main() {
  const directSocket = { handshake: { address: '10.0.0.8', headers: {} } }
  assert.strictEqual(service.normalizeAddress(directSocket), '10.0.0.8', 'direct socket address must be used by default')
  assert(service.connectionKey('10.0.0.8').startsWith('runtime:socket:connect:'), 'connection key must use the runtime prefix')
  assert(!service.connectionKey('10.0.0.8').includes('10.0.0.8'), 'connection key must not expose the raw client address')

  process.env.SOCKET_TRUST_PROXY = 'true'
  const proxySocket = {
    handshake: {
      address: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.4, 127.0.0.1' }
    }
  }
  assert.strictEqual(service.normalizeAddress(proxySocket), '203.0.113.4', 'trusted proxy mode must use the first forwarded address')
  delete process.env.SOCKET_TRUST_PROXY

  const redisClient = fakeRedis()
  const first = await service.consume(directSocket, { redisClient, maxAttempts: 2, windowSeconds: 60 })
  const second = await service.consume(directSocket, { redisClient, maxAttempts: 2, windowSeconds: 60 })
  assert.strictEqual(first.count, 1, 'first connection attempt must initialize the window')
  assert.strictEqual(second.count, 2, 'second connection attempt must increment the window')

  let limited = null
  try {
    await service.consume(directSocket, { redisClient, maxAttempts: 2, windowSeconds: 60 })
  } catch (err) {
    limited = err
  }
  assert(limited && limited.data.code === 'SOCKET_CONNECTION_RATE_LIMITED', 'excessive connection attempts must be rejected')

  let unavailable = null
  try {
    await service.consume(directSocket, {
      redisClient: {
        set: async function() { throw new Error('redis unavailable') }
      }
    })
  } catch (err) {
    unavailable = err
  }
  assert(unavailable && unavailable.data.code === 'SOCKET_RATE_LIMIT_DEPENDENCY_UNAVAILABLE', 'rate-limit dependency failure must fail closed')

  const appSource = fs.readFileSync(path.join(__dirname, '../server/src/app.js'), 'utf8')
  const limiterIndex = appSource.indexOf('socketConnectionRateLimitService.configure(io)')
  const authIndex = appSource.indexOf('socketAuthService.configureSocketServer(io)')
  assert(limiterIndex !== -1 && authIndex !== -1 && limiterIndex < authIndex, 'connection rate limiting must run before Socket.IO authentication')

  console.log('socket-connection-rate-limit-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
