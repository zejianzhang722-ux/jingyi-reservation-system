process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'true'
process.env.ALLOW_MOCK_REDIS = 'true'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'
process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = '1'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const socketAuthService = require('../server/src/services/socketAuthService')

function fakeSocket(token) {
  return {
    id: 'socket-test',
    handshake: { auth: { token }, headers: {} },
    data: {},
    emitted: [],
    joined: [],
    left: [],
    handlers: {},
    join: function(room) { this.joined.push(room) },
    leave: function(room) { this.left.push(room) },
    emit: function(event, payload) { this.emitted.push({ event, payload }) },
    on: function(event, handler) { this.handlers[event] = handler }
  }
}

function dependencies(overrides) {
  const settings = overrides || {}
  return {
    jwtLib: {
      verify: function(token) {
        if (token === 'expired') {
          const err = new Error('expired')
          err.name = 'TokenExpiredError'
          throw err
        }
        if (token === 'invalid') throw new Error('invalid')
        if (token === 'refresh') return { id: 7, role: 'admin', tokenType: 'refresh' }
        if (token === 'student') return { id: 1, role: 'student', tokenType: 'access' }
        return { id: 7, role: settings.tokenRole || 'admin', tokenType: 'access' }
      }
    },
    configObject: { jwt: { secret: 'test-secret' } },
    redisClient: {
      get: async function(key) {
        return settings.blacklisted && key.endsWith(settings.blacklisted) ? '1' : null
      }
    },
    dbClient: {
      query: async function(sql, params) {
        if (sql.includes('FROM admins')) {
          return [[{
            id: params[0],
            username: 'admin-test',
            real_name: '测试管理员',
            role: settings.databaseRole || 'admin',
            building_id: settings.buildingId === undefined ? 2 : settings.buildingId,
            status: settings.status || 'active'
          }]]
        }
        if (sql.includes('FROM rooms')) {
          if (Number(params[0]) === 404) return [[]]
          return [[{ id: Number(params[0]), building_id: settings.roomBuildingId || 2 }]]
        }
        return [[]]
      }
    },
    isStoredRefreshToken: async function() { return false }
  }
}

async function expectSocketError(action, code, message) {
  let caught = null
  try {
    await action()
  } catch (err) {
    caught = err
  }
  assert(caught && caught.data && caught.data.code === code, message + ': ' + (caught && caught.message))
}

async function main() {
  const authenticatedSocket = fakeSocket('access-token')
  const principal = await socketAuthService.authenticateSocket(authenticatedSocket, dependencies())
  assert.strictEqual(principal.id, 7, 'authenticated administrator id must be attached')
  assert.strictEqual(principal.buildingId, 2, 'administrator building scope must come from the database')
  assert.strictEqual(authenticatedSocket.data.user.role, 'admin', 'authenticated role must be attached to socket data')

  await expectSocketError(function() {
    return socketAuthService.authenticateSocket(fakeSocket(''), dependencies())
  }, 'SOCKET_TOKEN_REQUIRED', 'missing token must be rejected')

  await expectSocketError(function() {
    return socketAuthService.authenticateSocket(fakeSocket('refresh'), dependencies())
  }, 'SOCKET_REFRESH_TOKEN_REJECTED', 'refresh token must be rejected')

  await expectSocketError(function() {
    return socketAuthService.authenticateSocket(fakeSocket('access-token'), dependencies({ blacklisted: 'access-token' }))
  }, 'SOCKET_TOKEN_REVOKED', 'blacklisted token must be rejected')

  await expectSocketError(function() {
    return socketAuthService.authenticateSocket(fakeSocket('student'), dependencies())
  }, 'SOCKET_ROLE_FORBIDDEN', 'student must not connect to administrator monitoring socket')

  await expectSocketError(function() {
    return socketAuthService.authenticateSocket(fakeSocket('access-token'), dependencies({ databaseRole: 'counselor' }))
  }, 'SOCKET_ROLE_CHANGED', 'database role changes must invalidate existing socket role claims')

  const adminSocket = fakeSocket('access-token')
  adminSocket.data.user = { id: 7, role: 'admin', buildingId: 2 }
  assert.strictEqual(
    await socketAuthService.authorizeRoom(adminSocket, 'building:2', dependencies()),
    'building:2',
    'administrator must join own building room'
  )
  assert.strictEqual(
    await socketAuthService.authorizeRoom(adminSocket, 'room:8', dependencies({ roomBuildingId: 2 })),
    'room:8',
    'administrator must join a room in own building'
  )

  await expectSocketError(function() {
    return socketAuthService.authorizeRoom(adminSocket, 'monitor:all', dependencies())
  }, 'SOCKET_ROOM_FORBIDDEN', 'non-super administrator must not join global monitor room')

  await expectSocketError(function() {
    return socketAuthService.authorizeRoom(adminSocket, 'building:3', dependencies())
  }, 'SOCKET_ROOM_FORBIDDEN', 'administrator must not join another building')

  await expectSocketError(function() {
    return socketAuthService.authorizeRoom(adminSocket, 'room:9', dependencies({ roomBuildingId: 3 }))
  }, 'SOCKET_ROOM_FORBIDDEN', 'administrator must not join another building room')

  const superSocket = fakeSocket('access-token')
  superSocket.data.user = { id: 1, role: 'super_admin', buildingId: null }
  assert.strictEqual(
    await socketAuthService.authorizeRoom(superSocket, 'monitor:all', dependencies()),
    'monitor:all',
    'super administrator must join global monitor room'
  )

  const quotaSocket = fakeSocket('access-token')
  quotaSocket.data.roomEventTimestamps = []
  for (let index = 0; index < socketAuthService.ROOM_EVENT_LIMIT; index++) {
    socketAuthService.consumeRoomEventQuota(quotaSocket)
  }
  let rateLimited = null
  try {
    socketAuthService.consumeRoomEventQuota(quotaSocket)
  } catch (err) {
    rateLimited = err
  }
  assert(rateLimited && rateLimited.data.code === 'SOCKET_RATE_LIMITED', 'room event rate limit must reject excessive operations')

  const appSource = fs.readFileSync(path.join(__dirname, '../server/src/app.js'), 'utf8')
  const monitorSource = fs.readFileSync(path.join(__dirname, '../admin/src/views/Room/Monitor.vue'), 'utf8')
  assert(/socketAuthService\.configureSocketServer\(io\)/.test(appSource), 'server must configure authenticated Socket.IO handlers')
  assert(!/socket\.join\(room\)/.test(appSource), 'server entry point must not retain unrestricted room joins')
  assert(/auth: \(callback\) => callback\(\{ token: localStorage\.getItem\('token'\)/.test(monitorSource), 'admin monitor must provide the current access token on every connection')
  assert(/connect_error/.test(monitorSource), 'admin monitor must display socket authentication failures')

  console.log('socket-auth-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
