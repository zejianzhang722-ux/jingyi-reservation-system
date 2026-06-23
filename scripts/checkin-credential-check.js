process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = '1'
process.env.CHECKIN_CREDENTIAL_SECRET = 'test-only-checkin-credential-key'
process.env.CHECKIN_CREDENTIAL_TTL_SECONDS = '60'

const fs = require('fs')
const path = require('path')
const redis = require('../server/src/config/redis')
const credentialService = require('../server/src/services/checkinCredentialService')

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms) })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectCredentialError(action, expectedStatus, label) {
  try {
    await action()
  } catch (err) {
    assert(err.httpStatus === expectedStatus, label + ' expected status ' + expectedStatus + ', got ' + err.httpStatus)
    return
  }
  throw new Error(label + ' should fail')
}

async function waitForMockRedis() {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    if (redis.isMock()) return
    await wait(100)
  }
  throw new Error('Redis did not switch to isolated mock mode')
}

function checkClientFlow() {
  const root = path.resolve(__dirname, '..')
  const qrPage = fs.readFileSync(path.join(root, 'miniapp/pages/qrcode/qrcode.js'), 'utf8')
  const adminHome = fs.readFileSync(path.join(root, 'miniapp/pages/admin-home/admin-home.js'), 'utf8')
  const reservationList = fs.readFileSync(path.join(root, 'miniapp/pages/my-reservations/my-reservations.js'), 'utf8')
  const reservationDetail = fs.readFileSync(path.join(root, 'miniapp/pages/reservation-detail/reservation-detail.js'), 'utf8')
  const validator = fs.readFileSync(path.join(root, 'server/src/middleware/validator.js'), 'utf8')

  assert(/scheduleCredentialRefresh/.test(qrPage), 'QR page must automatically rotate credentials')
  assert(/wx\.scanCode/.test(adminHome), 'administrator miniapp must scan dynamic QR codes')
  assert(/payload\.credential/.test(adminHome), 'scanner must submit the signed credential')
  assert(!/request\.post\('\/checkin'/.test(reservationList), 'reservation list must not perform credential-free check-in')
  assert(!/request\.post\('\/checkin'/.test(reservationDetail), 'reservation detail must not perform credential-free check-in')
  assert(/请提供动态签到凭证/.test(validator), 'check-in validator must require a dynamic credential')
}

async function main() {
  await waitForMockRedis()
  checkClientFlow()

  const reservation = { id: 501, user_id: 31, room_id: 7 }
  const first = await credentialService.issue(reservation)
  assert(/^JY1\./.test(first.credential), 'credential must use the JY1 version prefix')
  assert(first.expiresIn >= 30 && first.expiresIn <= 90, 'credential TTL must stay within 30-90 seconds')

  const parsedFirst = credentialService.parseInput(first.credential)
  assert(parsedFirst.payload.rid === 501, 'credential must bind reservation id')
  assert(parsedFirst.payload.uid === 31, 'credential must bind reservation owner')
  assert(parsedFirst.payload.room === 7, 'credential must bind room id')

  const second = await credentialService.issue(reservation)
  assert(second.credential !== first.credential, 'refresh must issue a new credential')
  await expectCredentialError(
    function() { return credentialService.consume(first.credential, reservation) },
    409,
    'previous credential after refresh'
  )

  const tampered = second.credential.slice(0, -1) + (second.credential.endsWith('A') ? 'B' : 'A')
  await expectCredentialError(
    function() { return credentialService.consume(tampered, reservation) },
    403,
    'tampered credential'
  )

  const consumed = await credentialService.consume(second.credential, reservation)
  assert(consumed.n, 'valid credential should be consumed once')
  await expectCredentialError(
    function() { return credentialService.consume(second.credential, reservation) },
    409,
    'replayed credential'
  )

  const third = await credentialService.issue(reservation)
  await expectCredentialError(
    function() {
      return credentialService.consume(third.credential, { id: 501, user_id: 32, room_id: 7 })
    },
    403,
    'credential used by another reservation owner'
  )

  const fourth = await credentialService.issue(reservation)
  const scannedJson = JSON.stringify({
    type: 'jingyi-checkin',
    version: 1,
    reservationId: reservation.id,
    credential: fourth.credential
  })
  await credentialService.consume(scannedJson, reservation)

  await expectCredentialError(
    function() {
      credentialService.validatePayload({
        v: 1,
        rid: 501,
        uid: 31,
        room: 7,
        iat: Math.floor(Date.now() / 1000) - 120,
        exp: Math.floor(Date.now() / 1000) - 60,
        n: 'expired-test-nonce'
      }, reservation)
    },
    410,
    'expired credential'
  )

  console.log('checkin-credential-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err.message)
  process.exit(1)
})
