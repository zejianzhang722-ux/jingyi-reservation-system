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

    let student = await loginStudent('2024001001', '200001')
    let student2 = await loginStudent('2024001002', '200002')
    const admin = await loginAdmin('admin', 'admin123')
    const counselor = await loginAdmin('counselor', 'counselor123')
    const superAdmin = await loginAdmin('superadmin', 'super123')
    const buildingAdmin = await loginAdmin('building_admin', 'admin123')

    assert(admin.userInfo.scopeType === 'global' && !admin.userInfo.buildingId, 'guide administrator fixture must support global scope')
    assert(counselor.userInfo.scopeType === 'global' && !counselor.userInfo.buildingId, 'counselor fixture must be global')
    assert(superAdmin.userInfo.scopeType === 'global' && !superAdmin.userInfo.buildingId, 'super administrator fixture must remain global')
    assert(buildingAdmin.userInfo.scopeType === 'building' && Number(buildingAdmin.userInfo.buildingId) === 1, 'building guide fixture must be scoped to one building')

    expectStatus(await api('/stats/dashboard', { headers: authHeaders(admin.token) }), 200, 'admin dashboard scope')
    expectStatus(await api('/stats/dashboard', { headers: authHeaders(counselor.token) }), 200, 'counselor dashboard scope')
    expectStatus(await api('/stats/dashboard', { headers: authHeaders(superAdmin.token) }), 200, 'super administrator dashboard scope')
    expectStatus(await api('/stats/dashboard', { headers: authHeaders(buildingAdmin.token) }), 200, 'building guide dashboard scope')

    expectStatus(await api('/admin/accounts', { headers: authHeaders(admin.token) }), 403, 'guide cannot manage accounts')
    expectStatus(await api('/admin/accounts', { headers: authHeaders(counselor.token) }), 403, 'counselor cannot manage accounts')
    expectStatus(await api('/admin/accounts', { headers: authHeaders(superAdmin.token) }), 200, 'super administrator can manage accounts')
    expectStatus(await api('/admin/accounts', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ accountType: 'manager', username: 'scope_missing', password: 'test1234', realName: '范围未设置', role: 'admin' })
    }), 400, 'guide creation requires explicit scope')
    expectStatus(await api('/admin/accounts', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ username: 'missing_account_type', password: 'test1234', realName: '缺少类型', role: 'admin', scopeType: 'global' })
    }), 400, 'unified account creation requires account type')
    expectStatus(await api('/admin/accounts', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ accountType: 'unknown', username: 'invalid_account_type', password: 'test1234', realName: '类型错误', role: 'admin', scopeType: 'global' })
    }), 400, 'unknown account type is rejected')
    expectStatus(await api('/admin/accounts', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ accountType: 'student', username: 'mismatched_student', password: 'test1234', realName: '类型错配', role: 'admin', buildingId: 1 })
    }), 400, 'student account type rejects manager role')
    expectStatus(await api('/admin/accounts', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ accountType: 'manager', username: 'mismatched_manager', password: 'test1234', realName: '类型错配', role: 'student' })
    }), 400, 'manager account type rejects student role')
    const createdStudentAccount = await api('/admin/accounts', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ accountType: 'student', username: '2024999001', password: '299001', realName: '测试宿生', role: 'student', buildingId: 1 })
    })
    expectStatus(createdStudentAccount, 200, 'student account type creates student')
    assert(createdStudentAccount.json.data.accountType === 'student', 'student create response should keep student account type')
    expectStatus(await api('/admin/accounts', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ accountType: 'manager', username: 'scope_global', password: 'test1234', realName: '全院导生', role: 'admin', scopeType: 'global' })
    }), 200, 'super administrator creates global guide')
    const createdManagerAccount = await api('/admin/accounts', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ accountType: 'manager', username: 'scope_building', password: 'test1234', realName: '楼栋导生', role: 'admin', scopeType: 'building', buildingId: 2 })
    })
    expectStatus(createdManagerAccount, 200, 'super administrator creates building guide')
    assert(createdManagerAccount.json.data.accountType === 'manager', 'manager create response should use manager account type')
    const legacyManagerAccount = await api('/admin/managers', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ username: 'legacy_manager', password: 'test1234', realName: '兼容入口', role: 'admin' })
    })
    expectStatus(legacyManagerAccount, 200, 'legacy manager creation remains compatible without account type')
    assert(legacyManagerAccount.json.data.accountType === 'manager', 'legacy manager response should use manager account type')
    const managerList = await api('/admin/accounts?accountType=manager&pageSize=100', { headers: authHeaders(superAdmin.token) })
    expectStatus(managerList, 200, 'manager account list')
    assert(managerList.json.data.list.length > 0, 'manager account list should not be empty')
    assert(managerList.json.data.list.every(function(item) { return item.accountType === 'manager' && item.role !== 'student' }), 'manager account list must contain managers only')
    const studentList = await api('/admin/accounts?accountType=student&pageSize=100', { headers: authHeaders(superAdmin.token) })
    expectStatus(studentList, 200, 'student account list')
    assert(studentList.json.data.list.length > 0, 'student account list should not be empty')
    assert(studentList.json.data.list.every(function(item) { return item.accountType === 'student' && item.role === 'student' }), 'student account list must contain students only')

    const accountList = await api('/admin/accounts?accountType=manager&role=admin&pageSize=100', { headers: authHeaders(superAdmin.token) })
    expectStatus(accountList, 200, 'super administrator reads guide scopes')
    const createdGlobal = accountList.json.data.list.find(function(item) { return item.username === 'scope_global' })
    const createdBuilding = accountList.json.data.list.find(function(item) { return item.username === 'scope_building' })
    assert(createdGlobal && createdGlobal.scopeType === 'global' && !createdGlobal.buildingId, 'global guide scope must persist')
    assert(createdBuilding && createdBuilding.scopeType === 'building' && Number(createdBuilding.buildingId) === 2, 'building guide scope must persist')
    assert(createdGlobal.scopeLabel === '\u5168\u9662', 'global guide should display full-college scope')
    assert(createdBuilding.buildingName === 'C\u5ea7' && createdBuilding.scopeLabel === 'C\u5ea7', 'building guide should display the real building name')

    const importedAccounts = await api('/account-batch', {
      method: 'POST',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ rows: [
        { accountType: 'manager', username: 'import_global_guide', password: 'test1234', realName: '\u5168\u9662\u5bfc\u751f', role: 'admin', scopeType: 'global' },
        { accountType: 'manager', username: 'import_building_guide', password: 'test1234', realName: '\u697c\u680b\u5bfc\u751f', role: 'admin', scopeType: 'building', buildingName: 'C\u5ea7' },
        { accountType: 'manager', username: 'import_counselor', password: 'test1234', realName: '\u5bfc\u5165\u8f85\u5bfc\u5458', role: 'counselor', scopeType: 'building', buildingName: 'B\u5ea7' },
        { accountType: 'student', username: '2024999011', password: '299011', realName: '\u5bfc\u5165\u5bbf\u751f', role: 'student', scopeType: 'global', buildingName: 'B\u5ea7' },
        { '\u8d26\u53f7\u7c7b\u578b': '\u7ba1\u7406\u8d26\u53f7', '\u8d26\u53f7': 'import_building_id', '\u5bc6\u7801': 'test1234', '\u59d3\u540d': '\u697c\u680b\u7f16\u53f7\u5bfc\u751f', '\u89d2\u8272': '\u5bfc\u751f\u7ba1\u7406\u5458', '\u7ba1\u7406\u8303\u56f4': '\u6307\u5b9a\u697c\u680b', '\u697c\u680bID': 3 },
        { accountType: 'manager', username: 'import_unknown_building', password: 'test1234', realName: '\u672a\u77e5\u697c\u680b', role: 'admin', scopeType: 'building', buildingName: '\u4e0d\u5b58\u5728\u697c\u680b' },
        { accountType: 'manager', username: 'import_missing_scope', password: 'test1234', realName: '\u7f3a\u5c11\u8303\u56f4', role: 'admin' },
        { accountType: 'unknown', username: 'import_unknown_type', password: 'test1234', realName: '\u7c7b\u578b\u9519\u8bef', role: 'admin', scopeType: 'global' }
      ] })
    })
    expectStatus(importedAccounts, 200, 'batch account import')
    assert(importedAccounts.json.data.successCount === 5 && importedAccounts.json.data.failCount === 3, 'batch import should accept valid scope rows and reject invalid rows individually')
    const unknownBuildingFailure = importedAccounts.json.data.results.find(function(item) { return item.username === 'import_unknown_building' })
    const missingScopeFailure = importedAccounts.json.data.results.find(function(item) { return item.username === 'import_missing_scope' })
    assert(unknownBuildingFailure && unknownBuildingFailure.status === 'failed' && /\u697c\u680b/.test(unknownBuildingFailure.reason), 'unknown building should report a clear row error')
    assert(missingScopeFailure && missingScopeFailure.status === 'failed' && /\u5168\u9662|\u697c\u680b|\u8303\u56f4/.test(missingScopeFailure.reason), 'missing guide scope should report a clear row error')

    const importedManagerList = await api('/admin/accounts?accountType=manager&pageSize=100', { headers: authHeaders(superAdmin.token) })
    expectStatus(importedManagerList, 200, 'read imported manager scopes')
    const importedGlobalGuide = importedManagerList.json.data.list.find(function(item) { return item.username === 'import_global_guide' })
    const importedBuildingGuide = importedManagerList.json.data.list.find(function(item) { return item.username === 'import_building_guide' })
    const importedBuildingIdGuide = importedManagerList.json.data.list.find(function(item) { return item.username === 'import_building_id' })
    const importedCounselor = importedManagerList.json.data.list.find(function(item) { return item.username === 'import_counselor' })
    assert(importedGlobalGuide && importedGlobalGuide.scopeType === 'global' && !importedGlobalGuide.buildingId, 'imported global guide scope must persist')
    assert(importedBuildingGuide && importedBuildingGuide.scopeType === 'building' && importedBuildingGuide.buildingName === 'C\u5ea7', 'imported building guide should resolve and persist the building name')
    assert(importedBuildingIdGuide && importedBuildingIdGuide.scopeType === 'building' && importedBuildingIdGuide.buildingName === 'D\u5ea7', 'Chinese import columns should resolve and persist a valid building id')
    assert(importedCounselor && importedCounselor.scopeType === 'global' && !importedCounselor.buildingId, 'imported counselor must be forced to full-college scope')

    const importedStudentList = await api('/admin/accounts?accountType=student&pageSize=100', { headers: authHeaders(superAdmin.token) })
    expectStatus(importedStudentList, 200, 'read imported student building')
    const importedStudent = importedStudentList.json.data.list.find(function(item) { return item.username === '2024999011' })
    assert(importedStudent && importedStudent.buildingName === 'B\u5ea7', 'student import should keep its own building and ignore manager scope fields')

    expectStatus(await api('/admin/accounts/admin-' + superAdmin.userInfo.id, {
      method: 'PUT',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ role: 'admin' })
    }), 409, 'current super administrator cannot downgrade own role')
    const currentRoleList = await api('/admin/accounts?accountType=manager&pageSize=100', { headers: authHeaders(superAdmin.token) })
    expectStatus(currentRoleList, 200, 'read current super administrator after rejected downgrade')
    const currentSuperAdmin = currentRoleList.json.data.list.find(function(item) { return Number(item.rawId) === Number(superAdmin.userInfo.id) })
    assert(currentSuperAdmin && currentSuperAdmin.role === 'super_admin', 'rejected self downgrade must preserve super administrator role')
    expectStatus(await api('/admin/accounts/admin-' + superAdmin.userInfo.id, {
      method: 'PUT',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ realName: '\u8d85\u7ea7\u7ba1\u7406\u5458' })
    }), 200, 'current super administrator can update non-permission profile fields')

    expectStatus(await api('/admin/accounts/' + createdManagerAccount.json.data.id, {
      method: 'PUT',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ role: 'counselor', realName: '\u697c\u680b\u8f85\u5bfc\u5458' })
    }), 200, 'super administrator can change another manager role')
    const changedRoleList = await api('/admin/accounts?accountType=manager&role=counselor&pageSize=100', { headers: authHeaders(superAdmin.token) })
    expectStatus(changedRoleList, 200, 'read changed manager role')
    assert(changedRoleList.json.data.list.some(function(item) { return item.id === createdManagerAccount.json.data.id && item.role === 'counselor' }), 'other manager role change should persist')

    expectStatus(await api('/admin/accounts/admin-' + superAdmin.userInfo.id, {
      method: 'PUT',
      headers: jsonAuthHeaders(superAdmin.token),
      body: JSON.stringify({ status: 'disabled' })
    }), 409, 'current super administrator cannot disable self')
    expectStatus(await api('/admin/accounts/admin-' + superAdmin.userInfo.id, {
      method: 'DELETE',
      headers: authHeaders(superAdmin.token)
    }), 409, 'current super administrator cannot delete self')
    expectStatus(await api('/admin/managers/' + superAdmin.userInfo.id, {
      method: 'DELETE',
      headers: authHeaders(superAdmin.token)
    }), 409, 'legacy manager endpoint cannot bypass self protection')

    for (let i = 0; i < 12; i++) {
      const repeatedStudentLogin = await api('/auth/login/student', {
        method: 'POST',
        body: JSON.stringify(i % 2 === 0
          ? { studentNo: '2024001001', cardNo: '200001' }
          : { studentNo: '2024001002', cardNo: '200002' })
      })
      expectStatus(repeatedStudentLogin, 200, 'repeated valid student login should not be rate limited')
    }
    student = await loginStudent('2024001001', '200001')
    student2 = await loginStudent('2024001002', '200002')

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
    expectStatus(await api('/reservation/7/approve', { method: 'PUT', headers: authHeaders(counselor.token) }), 200, 'counselor inherits ordinary approval')

    expectStatus(await api('/reservation/10/approve', { method: 'PUT', headers: authHeaders(admin.token) }), 200, 'admin approves pending in own building')
    expectStatus(await api('/reservation/10/approve', { method: 'PUT', headers: authHeaders(admin.token) }), 409, 'duplicate approval conflict')
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
