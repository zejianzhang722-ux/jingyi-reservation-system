const { spawn } = require('child_process')

const PORT = Number(process.env.SECURITY_TEST_PORT || 3201)
const BASE_URL = 'http://127.0.0.1:' + PORT + '/api/v1'

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms) })
}

function startServer() {
  const child = spawn(process.execPath, ['src/app.js'], {
    cwd: __dirname + '/../server',
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: 'test',
      ENABLE_SCHEDULER: 'false',
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: '1',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let output = ''
  child.stdout.on('data', function(chunk) { output += chunk.toString() })
  child.stderr.on('data', function(chunk) { output += chunk.toString() })
  child.output = function() { return output }
  return child
}

async function stopServer(child) {
  if (!child || child.killed) return
  child.kill()
  await wait(500)
}

async function waitForHealth(child) {
  const deadline = Date.now() + Number(process.env.SECURITY_HEALTH_TIMEOUT_MS || 45000)
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('server exited early:\n' + child.output())
    }
    try {
      const res = await fetch(BASE_URL + '/health')
      const json = await res.json()
      if (res.status === 200 && json.code === 200) return
    } catch (err) {}
    await wait(300)
  }
  throw new Error('server did not become healthy:\n' + child.output())
}

async function api(path, options) {
  const res = await fetch(BASE_URL + path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, options || {}))
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(path + ' returned non-JSON: ' + text.slice(0, 120))
  }
  return { status: res.status, json: json }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function expectStatus(result, status, label) {
  assert(result.status === status, label + ' HTTP status expected ' + status + ', got ' + result.status)
  assert(Number(result.json.code) === status, label + ' body code expected ' + status + ', got ' + result.json.code)
}

async function loginStudent(studentNo, cardNo) {
  const result = await api('/auth/login/student', {
    method: 'POST',
    body: JSON.stringify({ studentNo: studentNo, cardNo: cardNo })
  })
  expectStatus(result, 200, 'student login')
  return result.json.data
}

async function loginAdmin(username, password) {
  const result = await api('/auth/login/admin-miniapp', {
    method: 'POST',
    body: JSON.stringify({ username: username, password: password })
  })
  expectStatus(result, 200, username + ' login')
  return result.json.data
}

function authHeaders(token) {
  return { Authorization: 'Bearer ' + token }
}

function jsonAuthHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
}

function futureDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

async function main() {
  let server = startServer()
  try {
    await waitForHealth(server)

    const student = await loginStudent('2024001001', '200001')
    const student2 = await loginStudent('2024001002', '200002')
    const admin = await loginAdmin('admin', 'admin123')
    const counselor = await loginAdmin('counselor', 'counselor123')
    const superAdmin = await loginAdmin('superadmin', 'super123')

    for (let i = 0; i < 12; i++) {
      const repeatedStudentLogin = await api('/auth/login/student', {
        method: 'POST',
        body: JSON.stringify(i % 2 === 0
          ? { studentNo: '2024001001', cardNo: '200001' }
          : { studentNo: '2024001002', cardNo: '200002' })
      })
      expectStatus(repeatedStudentLogin, 200, 'repeated valid student login should not be rate limited')
    }

    expectStatus(await api('/user/profile', { headers: authHeaders(student.token) }), 200, 'access token business request')
    expectStatus(await api('/user/profile', { headers: authHeaders(student.refreshToken) }), 401, 'refresh token rejected on business request')
    expectStatus(await api('/user/profile'), 401, 'missing token')
    expectStatus(await api('/auth/login/student', { method: 'POST', body: JSON.stringify({}) }), 400, 'parameter error')
    expectStatus(await api('/reservation/999999', { headers: authHeaders(student.token) }), 404, 'not found')

    const refreshed = await api('/auth/refresh', {
      method: 'POST',
      headers: jsonAuthHeaders(student.token),
      body: JSON.stringify({ refreshToken: student.refreshToken })
    })
    expectStatus(refreshed, 200, 'refresh token rotation')
    assert(refreshed.json.data.token && refreshed.json.data.refreshToken, 'refresh should return new tokens')
    expectStatus(await api('/auth/refresh', {
      method: 'POST',
      headers: jsonAuthHeaders(refreshed.json.data.token),
      body: JSON.stringify({ refreshToken: student.refreshToken })
    }), 401, 'old refresh token rejected after rotation')
    expectStatus(await api('/auth/refresh', {
      method: 'POST',
      headers: jsonAuthHeaders(refreshed.json.data.token),
      body: JSON.stringify({})
    }), 401, 'missing refresh token')

    expectStatus(await api('/reservation/pending', { headers: authHeaders(student.token) }), 403, 'student pending list forbidden')
    expectStatus(await api('/reservation/pending-count', { headers: authHeaders(student.token) }), 403, 'student pending count forbidden')
    expectStatus(await api('/reservation/7/approve', { method: 'PUT', headers: authHeaders(student.token) }), 403, 'student approve forbidden')
    expectStatus(await api('/reservation/7/reject', {
      method: 'PUT',
      headers: jsonAuthHeaders(student.token),
      body: JSON.stringify({ reason: 'no' })
    }), 403, 'student reject forbidden')

    expectStatus(await api('/reservation/pending', { headers: authHeaders(admin.token) }), 200, 'admin pending list')
    expectStatus(await api('/reservation/5/approve', { method: 'PUT', headers: authHeaders(admin.token) }), 403, 'admin cannot approve counselor pending')
    expectStatus(await api('/reservation/10/approve', { method: 'PUT', headers: authHeaders(counselor.token) }), 403, 'counselor cannot approve normal pending')

    expectStatus(await api('/reservation/7/approve', { method: 'PUT', headers: authHeaders(admin.token) }), 200, 'admin approves pending')
    expectStatus(await api('/reservation/7/approve', { method: 'PUT', headers: authHeaders(admin.token) }), 409, 'duplicate approval conflict')
    expectStatus(await api('/reservation/5/approve', { method: 'PUT', headers: authHeaders(counselor.token) }), 200, 'counselor approves counselor pending')

    const counselorReservation = await api('/reservation', {
      method: 'POST',
      headers: jsonAuthHeaders(student2.token),
      body: JSON.stringify({
        roomId: 11,
        date: futureDate(2),
        startTime: '08:00',
        endTime: '09:00',
        purpose: 'security test',
        participants: 3
      })
    })
    expectStatus(counselorReservation, 200, 'create counselor pending reservation')
    assert(counselorReservation.json.data.status === 'counselor_pending', 'new reservation should require counselor approval')
    expectStatus(await api('/reservation/' + counselorReservation.json.data.id + '/approve', {
      method: 'PUT',
      headers: authHeaders(superAdmin.token)
    }), 200, 'super admin approves counselor pending')

    expectStatus(await api('/checkin/status/1', { headers: authHeaders(student.token) }), 200, 'student own checkin status')
    expectStatus(await api('/checkin/status/2', { headers: authHeaders(student.token) }), 403, 'student cannot see other checkin status')
    expectStatus(await api('/checkin/checkout', {
      method: 'POST',
      headers: jsonAuthHeaders(student.token),
      body: JSON.stringify({ reservationId: 2 })
    }), 403, 'student cannot checkout other reservation')
    expectStatus(await api('/checkin/current/1', { headers: authHeaders(student.token) }), 403, 'student cannot see current room users')
    expectStatus(await api('/checkin/current/1', { headers: authHeaders(admin.token) }), 200, 'admin can see current room users')
    expectStatus(await api('/checkin/manual', {
      method: 'POST',
      headers: jsonAuthHeaders(admin.token),
      body: JSON.stringify({ reservationId: 1, userId: 999999 })
    }), 200, 'admin manual checkin')
    const currentAfterManualCheckin = await api('/checkin/current/1', { headers: authHeaders(admin.token) })
    expectStatus(currentAfterManualCheckin, 200, 'admin manual checkin keeps reservation owner')
    const manualRecord = (currentAfterManualCheckin.json.data || []).find(function(item) {
      return Number(item.reservation_id) === 1
    })
    assert(manualRecord && Number(manualRecord.user_id) === 1, 'manual checkin should record reservation owner, not request userId')
    expectStatus(await api('/checkin/checkout', {
      method: 'POST',
      headers: jsonAuthHeaders(student.token),
      body: JSON.stringify({ reservationId: 1 })
    }), 200, 'student can checkout own reservation')

    let sawRateLimit = false
    for (let i = 0; i < 12; i++) {
      const limited = await api('/auth/login/student', {
        method: 'POST',
        body: JSON.stringify({ studentNo: '2024999999', cardNo: '999999' })
      })
      if (limited.status === 429) {
        assert(Number(limited.json.code) === 429, 'rate limit body code should be 429')
        sawRateLimit = true
        break
      }
    }
    assert(sawRateLimit, 'auth rate limit should eventually return HTTP 429')

    console.log('security-runtime-check passed')
  } finally {
    await stopServer(server)
  }
}

main().catch(function(err) {
  console.error(err.message)
  process.exit(1)
})
