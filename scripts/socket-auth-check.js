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
    id: 'socket-test', handshake: { auth: { token }, headers: {} }, data: {}, emitted: [], joined: [], left: [], handlers: {}, disconnected: false,
    join: function(room) { this.joined.push(room) },
    leave: function(room) { this.left.push(room) },
    emit: function(event, payload) { this.emitted.push({ event, payload }) },
    on: function(event, handler) { this.handlers[event] = handler },
    disconnect: function() { this.disconnected = true }
  }
}

function dependencies(overrides) {
  const settings = overrides || {}
  return {
    jwtLib: {
      verify: function(token) {
        if (token === 'expired') { const err = new Error('expired'); err.name = 'TokenExpiredError'; throw err }
        if (token === 'invalid') throw new Error('invalid')
        if (token === 'refresh') return { id: 7, role: 'admin', tokenType: 'refresh' }
        if (token === 'student') return { id: 1, role: 'student', tokenType: 'access', exp: Math.floor(Date.now() / 1000) + 3600 }
        return { id: 7, role: settings.tokenRole || 'admin', tokenType: 'access', exp: settings.exp || Math.floor(Date.now() / 1000) + 3600 }
      }
    },
    configObject: { jwt: { secret: 'test-secret' } },
    redisClient: { get: async function(key) { return settings.blacklisted && key.endsWith(settings.blacklisted) ? '1' : null } },
    dbClient: {
      query: async function(sql, params) {
        if (sql.includes('FROM admins')) {
          return [[{ id: params[0], username: 'admin-test', real_name: '测试管理员', role: settings.databaseRole || 'admin', building_id: settings.buildingId === undefined ? 2 : settings.buildingId, status: settings.status || 'active' }]]
        }
        if (sql.includes('FROM users')) {
          return [[{ id: params[0], nickname: 'student-test', real_name: '测试学生', role: settings.studentDatabaseRole || 'student', building_id: 2, status: settings.studentStatus || 'active' }]]
        }
        if (sql.includes('FROM rooms')) {
          if (Number(params[0]) === 404) return [[]]
          return [[{ id: Number(params[0]), building_id: settings.roomBuildingId === undefined ? 2 : settings.roomBuildingId }]]
        }
        return [[]]
      }
    },
    isStoredRefreshToken: async function() { return false }
  }
}

async function expectSocketError(action, code, message) {
  let caught = null
  try { await action() } catch (err) { caught = err }
  assert(caught && caught.data && caught.data.code === code, message + ': ' + (caught && caught.message))
}

async function main() {
  const authenticatedSocket = fakeSocket('access-token')
  const principal = await socketAuthService.authenticateSocket(authenticatedSocket, dependencies())
  assert.strictEqual(principal.id, 7)
  assert.strictEqual(principal.kind, 'admin')
  assert.strictEqual(principal.buildingId, 2)
  await socketAuthService.validateLiveSession(authenticatedSocket, dependencies())

  await expectSocketError(function() { return socketAuthService.authenticateSocket(fakeSocket(''), dependencies()) }, 'SOCKET_TOKEN_REQUIRED', 'missing token must be rejected')
  await expectSocketError(function() { return socketAuthService.authenticateSocket(fakeSocket('refresh'), dependencies()) }, 'SOCKET_REFRESH_TOKEN_REJECTED', 'refresh token must be rejected')
  await expectSocketError(function() { return socketAuthService.authenticateSocket(fakeSocket('access-token'), dependencies({ blacklisted: 'access-token' })) }, 'SOCKET_TOKEN_REVOKED', 'blacklisted token must be rejected')
  await expectSocketError(function() { return socketAuthService.authenticateSocket(fakeSocket('access-token'), dependencies({ databaseRole: 'counselor' })) }, 'SOCKET_ROLE_CHANGED', 'database role changes must invalidate claims')
  await expectSocketError(function() { return socketAuthService.validateLiveSession(authenticatedSocket, dependencies({ buildingId: 3 })) }, 'SOCKET_SCOPE_CHANGED', 'building scope changes must invalidate live sessions')

  const studentSocket = fakeSocket('student')
  const student = await socketAuthService.authenticateSocket(studentSocket, dependencies())
  assert.strictEqual(student.kind, 'student', 'students must connect for private notifications')
  assert.strictEqual(await socketAuthService.authorizeRoom(studentSocket, 'user:1', dependencies()), 'user:1', 'student must access own private notification room')
  await expectSocketError(function() { return socketAuthService.authorizeRoom(studentSocket, 'user:2', dependencies()) }, 'SOCKET_ROOM_FORBIDDEN', 'student must not access another user room')
  await expectSocketError(function() { return socketAuthService.authorizeRoom(studentSocket, 'monitor:all', dependencies()) }, 'SOCKET_ROOM_FORBIDDEN', 'student must not access monitoring rooms')
  await expectSocketError(function() { return socketAuthService.validateLiveSession(studentSocket, dependencies({ studentStatus: 'banned' })) }, 'SOCKET_ACCOUNT_DISABLED', 'disabled student session must be rejected')

  const expiredLiveSocket = fakeSocket('access-token')
  await socketAuthService.authenticateSocket(expiredLiveSocket, dependencies())
  expiredLiveSocket.data.tokenClaims.exp = Math.floor(Date.now() / 1000) - 1
  await expectSocketError(function() { return socketAuthService.validateLiveSession(expiredLiveSocket, dependencies()) }, 'SOCKET_TOKEN_EXPIRED', 'expired session must be rejected')

  const adminSocket = fakeSocket('access-token')
  adminSocket.data.user = { id: 7, kind: 'admin', role: 'admin', buildingId: 2 }
  assert.strictEqual(await socketAuthService.authorizeRoom(adminSocket, 'building:2', dependencies()), 'building:2')
  assert.strictEqual(await socketAuthService.authorizeRoom(adminSocket, 'room:8', dependencies({ roomBuildingId: 2 })), 'room:8')
  await expectSocketError(function() { return socketAuthService.authorizeRoom(adminSocket, 'user:7', dependencies()) }, 'SOCKET_ROOM_FORBIDDEN', 'administrator must not impersonate a student notification room')
  await expectSocketError(function() { return socketAuthService.authorizeRoom(adminSocket, 'monitor:all', dependencies()) }, 'SOCKET_ROOM_FORBIDDEN', 'non-super admin must not join global monitor')
  await expectSocketError(function() { return socketAuthService.authorizeRoom(adminSocket, 'building:3', dependencies()) }, 'SOCKET_ROOM_FORBIDDEN', 'admin must not join another building')

  const unscoped = fakeSocket('access-token')
  unscoped.data.user = { id: 8, kind: 'admin', role: 'admin', buildingId: null }
  await expectSocketError(function() { return socketAuthService.authorizeRoom(unscoped, 'room:8', dependencies()) }, 'SOCKET_BUILDING_SCOPE_REQUIRED', 'unscoped admin must not subscribe to rooms')

  const superSocket = fakeSocket('access-token')
  superSocket.data.user = { id: 1, kind: 'admin', role: 'super_admin', buildingId: null }
  assert.strictEqual(await socketAuthService.authorizeRoom(superSocket, 'monitor:all', dependencies()), 'monitor:all')
  assert.strictEqual(await socketAuthService.authorizeRoom(superSocket, 'building:2', dependencies()), 'building:2')

  const quotaSocket = fakeSocket('access-token')
  quotaSocket.data.roomEventTimestamps = []
  for (let index = 0; index < socketAuthService.ROOM_EVENT_LIMIT; index++) socketAuthService.consumeRoomEventQuota(quotaSocket)
  let limited = null
  try { socketAuthService.consumeRoomEventQuota(quotaSocket) } catch (err) { limited = err }
  assert(limited && limited.data.code === 'SOCKET_RATE_LIMITED')

  const appSource = fs.readFileSync(path.join(__dirname, '../server/src/app.js'), 'utf8')
  const monitorSource = fs.readFileSync(path.join(__dirname, '../admin/src/views/Room/Monitor.vue'), 'utf8')
  const authSource = fs.readFileSync(path.join(__dirname, '../server/src/services/socketAuthService.js'), 'utf8')
  assert(/socketAuthService\.configureSocketServer\(io\)/.test(appSource))
  assert(/socket\.join\('user:' \+ user\.id\)/.test(authSource), 'student sockets must join only their private notification room')
  assert(/startSessionGuard\(socket, settings\)/.test(authSource))
  assert(/auth: \(callback\) => callback\(\{ token: localStorage\.getItem\('token'\)/.test(monitorSource))
  assert(/connect_error/.test(monitorSource))

  console.log('socket-auth-check passed')
}

main().then(function() { process.exit(0) }).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
