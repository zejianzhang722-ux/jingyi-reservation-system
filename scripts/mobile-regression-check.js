const jwt = require('../server/node_modules/jsonwebtoken')
const config = require('../server/src/config')
const fs = require('fs')
const path = require('path')

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000/api/v1'

const storage = {}
global.wx = {
  getStorageSync: function(key) { return storage[key] },
  setStorageSync: function(key, value) { storage[key] = value },
  removeStorageSync: function(key) { delete storage[key] },
  getSystemInfoSync: function() { return { platform: 'devtools' } },
  redirectTo: function() {},
  reLaunch: function() {},
  showToast: function() {},
  showModal: function() {}
}
global.getApp = function() {
  return { globalData: {} }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertDashboardContract(payload, label) {
  assert(Number.isInteger(payload.ordinaryPendingCount), label + ' 缺少普通待审数')
  assert(Number.isInteger(payload.counselorPendingCount), label + ' 缺少重点待审数')
  assert(Number.isInteger(payload.actionablePendingCount), label + ' 缺少可处理待审总数')
  assert(Number.isInteger(payload.activeRoomCount), label + ' 缺少开放房间数')
  assert(payload.pendingCount === payload.actionablePendingCount, label + ' 旧待审总数应与可处理总数一致')
}

function assertUsageContract(rows, label) {
  assert(Array.isArray(rows), label + ' 使用排行应为数组')
  rows.forEach(function(row) {
    assert(row.room_id && row.room_name, label + ' 排行缺少房间标识或名称')
    assert(row.room_type, label + ' 排行缺少房间类型')
    assert(Number.isInteger(row.reservation_count), label + ' 预约次数必须为整数')
    assert(Number.isInteger(row.used_days), label + ' 使用天数必须为整数')
  })
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]
    const current = rows[index]
    assert(previous.reservation_count >= current.reservation_count, label + ' 使用排行未按预约次数降序')
    if (previous.reservation_count === current.reservation_count) {
      assert(String(previous.room_name).localeCompare(String(current.room_name)) <= 0, label + ' 同次数房间名称排序不稳定')
    }
  }
}

function assertApprovalQueue(responseJson, expectedStatus, queueName, expectedPageSize) {
  const data = responseJson && responseJson.data
  assert(data && !Array.isArray(data) && Array.isArray(data.list), queueName + ' 应返回 data.list 分页列表')
  assert(Number.isInteger(data.total) && Number.isInteger(data.page) && Number.isInteger(data.pageSize), queueName + ' 应返回 total、page、pageSize 分页字段')
  assert(data.page === 1, queueName + ' 应返回第 1 页')
  assert(data.pageSize === expectedPageSize, queueName + ' pageSize 应与请求值一致')
  assert(data.total >= data.list.length, queueName + ' total 不得小于当前列表数量')
  assert(data.total > 0 && data.list.length > 0, queueName + ' 在已知测试数据下不应为空')
  assert(data.list.every(function(item) { return item && item.status === expectedStatus }), queueName + ' 只应包含 ' + expectedStatus + ' 状态的预约')
}

function assertActionableQueue(responseJson, allowedStatuses, queueName, expectedPageSize) {
  const data = responseJson && responseJson.data
  assert(data && !Array.isArray(data) && Array.isArray(data.list), queueName + ' 应返回 data.list 分页列表')
  assert(Number.isInteger(data.total) && Number.isInteger(data.page) && Number.isInteger(data.pageSize), queueName + ' 应返回 total、page、pageSize 分页字段')
  assert(data.page === 1, queueName + ' 应返回第 1 页')
  assert(data.pageSize === expectedPageSize, queueName + ' pageSize 应与请求值一致')
  assert(data.total >= data.list.length, queueName + ' total 不得小于当前列表数量')
  assert(data.total > 0 && data.list.length > 0, queueName + ' 在已知测试数据下不应为空')
  assert(data.list.every(function(item) {
    return item && allowedStatuses.includes(item.status)
  }), queueName + ' 只应包含当前角色可处理的待审状态')
  return data
}

function assertFails(check, message) {
  var failed = false
  try {
    check()
  } catch (err) {
    failed = true
  }
  assert(failed, message)
}

async function api(path, options) {
  const res = await fetch(BASE_URL + path, options || {})
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(path + ' 返回的不是 JSON：' + text.slice(0, 80))
  }
  return { status: res.status, json: json }
}

async function main() {
  assertFails(function() {
    assertApprovalQueue({ data: { list: [{ status: 'pending' }] } }, 'pending', '缺少分页字段', 10)
  }, '审核队列缺少分页字段时检查必须失败')
  assertFails(function() {
    assertApprovalQueue({ data: { list: [], total: 0, page: 1, pageSize: 10 } }, 'pending', '空队列', 10)
  }, '已知测试服务审核队列为空时检查必须失败')
  assertFails(function() {
    assertApprovalQueue({ data: { list: [{ status: 'approved' }], total: 1, page: 1, pageSize: 10 } }, 'pending', '错误状态', 10)
  }, '审核队列包含错误状态时检查必须失败')

  const scopedQuerySource = fs.readFileSync(path.join(__dirname, '../server/src/controllers/scopedQueryController.js'), 'utf8')
  assert(scopedQuerySource.includes('rm.type AS room_type, rm.type AS roomType'), '统一待审查询应显式返回 room_type 和 roomType')

  const localData = require('../miniapp/utils/local-data')
  assert(localData.resolveRoomId('B228') === 1, 'B228 应解析为功能房 1')
  assert(localData.resolveRoomId('B228自习室') === 1, 'B228自习室 应解析为功能房 1')
  assert(localData.resolveRoomId('C110') === 3, 'C110 应解析为功能房 3')
  assert(localData.resolveRoomId('C110自习室') === 3, 'C110自习室 应解析为功能房 3')
  assert(localData.resolveRoomId('1') === 1, '字符串 1 应解析为数字功能房 1')

  const auth = require('../miniapp/utils/auth')
  assert(typeof auth.setUserInfo === 'function', 'auth 缺少 setUserInfo，页面无法统一刷新用户缓存')
  assert(typeof auth.setAuthData === 'function', 'auth 缺少 setAuthData，登录无法统一保存令牌和用户资料')

  const login = await api('/auth/login/student', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentNo: '2024001001', cardNo: '200001' })
  })
  assert(login.json.code === 200, '张三登录失败')
  assert(Number(login.json.data.userInfo.credit_score) === 80, '张三登录信用分应为 80')

  const adminLogin = await api('/auth/login/admin-miniapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })
  assert(adminLogin.json.code === 200, '管理员登录应成功')
  assert(adminLogin.json.data.userInfo.role !== 'student', '管理员角色不应被识别为学生')
  const buildingAdminLogin = await api('/auth/login/admin-miniapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'building_admin', password: 'admin123' })
  })
  assert(buildingAdminLogin.json.code === 200, '楼栋导生管理员登录应成功')
  const adminProfileLeak = await api('/user/profile', {
    headers: { Authorization: 'Bearer ' + adminLogin.json.data.token }
  })
  assert(adminProfileLeak.json.code !== 200, '管理员不应能通过学生个人资料接口读到张三/李四')
  const adminStudyRooms = await api('/room?type=study_room', {
    headers: { Authorization: 'Bearer ' + adminLogin.json.data.token }
  })
  assert(adminStudyRooms.json.code === 200, '管理员应能读取自习室分类数据')
  assert((adminStudyRooms.json.data || []).some(function(room) { return room.type === 'study_room' }), '自习室分类应返回 study_room 数据')
  const adminStats = await api('/stats/dashboard', {
    headers: { Authorization: 'Bearer ' + adminLogin.json.data.token }
  })
  assert(adminStats.json.code === 200 && adminStats.json.data, '管理员数据统计接口应可用')
  assertDashboardContract(adminStats.json.data, '全院导生管理员')
  assert(adminStats.json.data.pendingItems.every(function(item) { return item.tag !== '辅导员审核' }), '全院导生管理员待审明细不得包含重点待审')
  const adminViolations = await api('/credit/violations', {
    headers: { Authorization: 'Bearer ' + adminLogin.json.data.token }
  })
  assert(adminViolations.json.code === 200, '管理员信用违规记录接口应可用')
  const adminBlacklist = await api('/credit/blacklist', {
    headers: { Authorization: 'Bearer ' + adminLogin.json.data.token }
  })
  assert(adminBlacklist.json.code === 403, '导生管理员不应管理信用黑名单')
  const counselorLogin = await api('/auth/login/admin-miniapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'counselor', password: 'counselor123' })
  })
  assert(counselorLogin.json.code === 200, '辅导员登录应成功')
  const superAdminLogin = await api('/auth/login/admin-miniapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'superadmin', password: 'super123' })
  })
  assert(superAdminLogin.json.code === 200, '超级管理员登录应成功')

  const scopedStatsRoles = [
    { label: '楼栋导生管理员', token: buildingAdminLogin.json.data.token },
    { label: '辅导员', token: counselorLogin.json.data.token },
    { label: '超级管理员', token: superAdminLogin.json.data.token }
  ]
  const scopedStatsResults = []
  for (const role of scopedStatsRoles) {
    const roleDashboard = await api('/stats/dashboard', {
      headers: { Authorization: 'Bearer ' + role.token }
    })
    assert(roleDashboard.json.code === 200 && roleDashboard.json.data, role.label + ' 仪表盘接口应可用')
    assertDashboardContract(roleDashboard.json.data, role.label)
    const roleUsage = await api('/stats/usage-rate', {
      headers: { Authorization: 'Bearer ' + role.token }
    })
    assert(roleUsage.json.code === 200, role.label + ' 使用排行接口应可用')
    assertUsageContract(roleUsage.json.data, role.label)
    scopedStatsResults.push({ dashboard: roleDashboard.json.data, usage: roleUsage.json.data })
  }
  const buildingAdminRooms = await api('/room', {
    headers: { Authorization: 'Bearer ' + buildingAdminLogin.json.data.token }
  })
  assert(buildingAdminRooms.json.code === 200 && Array.isArray(buildingAdminRooms.json.data), '楼栋导生管理员房间列表应可用')
  const buildingAdminInfo = buildingAdminLogin.json.data.userInfo || {}
  const buildingAdminScope = buildingAdminInfo.scope || buildingAdminInfo.adminScope || {}
  const buildingAdminId = Number(
    buildingAdminInfo.buildingId !== undefined ? buildingAdminInfo.buildingId :
      (buildingAdminInfo.building_id !== undefined ? buildingAdminInfo.building_id :
        (buildingAdminScope.buildingId !== undefined ? buildingAdminScope.buildingId : buildingAdminScope.building_id))
  )
  assert(Number.isInteger(buildingAdminId) && buildingAdminId > 0, '楼栋导生管理员登录响应应包含有效楼栋范围')

  const actionableRoles = [
    {
      label: '全院导生管理员可处理预约',
      token: adminLogin.json.data.token,
      statuses: ['pending']
    },
    {
      label: '辅导员可处理预约',
      token: counselorLogin.json.data.token,
      statuses: ['pending', 'counselor_pending']
    },
    {
      label: '超级管理员可处理预约',
      token: superAdminLogin.json.data.token,
      statuses: ['pending', 'counselor_pending']
    },
    {
      label: '楼栋导生管理员可处理预约',
      token: buildingAdminLogin.json.data.token,
      statuses: ['pending'],
      buildingId: buildingAdminId
    }
  ]
  for (const role of actionableRoles) {
    const actionable = await api('/reservation?actionable=1&status=rejected&page=1&pageSize=100', {
      headers: { Authorization: 'Bearer ' + role.token }
    })
    assert(actionable.status === 200 && actionable.json.code === 200, role.label + ' 接口应可用')
    const actionableData = assertActionableQueue(actionable.json, role.statuses, role.label, 100)
    if (role.statuses.includes('counselor_pending')) {
      assert(actionableData.list.some(function(item) { return item.status === 'pending' }), role.label + ' 应包含普通待审')
      assert(actionableData.list.some(function(item) { return item.status === 'counselor_pending' }), role.label + ' 应包含重点待审')
    }
    if (role.buildingId) {
      assert(actionableData.list.every(function(item) {
        return Number(item.buildingId || item.building_id) === role.buildingId
      }), role.label + ' 不得越过楼栋范围')
    }

    const firstPage = await api('/reservation?actionable=1&page=1&pageSize=1', {
      headers: { Authorization: 'Bearer ' + role.token }
    })
    assert(firstPage.status === 200 && firstPage.json.code === 200, role.label + ' 小分页接口应可用')
    const firstPageData = assertActionableQueue(firstPage.json, role.statuses, role.label + ' 小分页', 1)
    assert(firstPageData.total === actionableData.total, role.label + ' 筛选总数必须在分页前计算')
  }

  const studentActionable = await api('/reservation?actionable=1&page=1&pageSize=100', {
    headers: { Authorization: 'Bearer ' + login.json.data.token }
  })
  assert(studentActionable.status === 403 && studentActionable.json.code === 403, '宿生不得读取管理员可处理预约列表')

  const buildingAdminRoomMap = new Map(buildingAdminRooms.json.data.map(function(room) { return [Number(room.id), room] }))
  scopedStatsResults[0].usage.forEach(function(row) {
    const room = buildingAdminRoomMap.get(Number(row.room_id))
    assert(room, '楼栋导生管理员使用排行房间必须能映射到房间元数据')
    const roomBuildingId = Number(room.building_id !== undefined ? room.building_id : room.buildingId)
    assert(roomBuildingId === buildingAdminId, '楼栋导生管理员使用排行不得包含范围外房间')
  })
  for (let index = 1; index < scopedStatsRoles.length; index += 1) {
    const scopedRooms = await api('/room', {
      headers: { Authorization: 'Bearer ' + scopedStatsRoles[index].token }
    })
    assert(scopedRooms.json.code === 200 && Array.isArray(scopedRooms.json.data), scopedStatsRoles[index].label + ' 房间范围应可读取')
    const scopedRoomIds = new Set(scopedRooms.json.data.map(function(room) { return Number(room.id) }))
    scopedStatsResults[index].usage.forEach(function(row) {
      assert(scopedRoomIds.has(Number(row.room_id)), scopedStatsRoles[index].label + ' 使用排行不得包含其房间范围外数据')
    })
  }
  assert(scopedStatsResults[0].dashboard.activeRoomCount < scopedStatsResults[2].dashboard.activeRoomCount, '楼栋导生管理员开放房间数应小于全院超级管理员')
  assert(scopedStatsResults[0].dashboard.counselorPendingCount === 0, '楼栋导生管理员不应看到重点待审数')
  assert(scopedStatsResults[0].dashboard.pendingItems.every(function(item) { return item.tag !== '辅导员审核' }), '楼栋导生管理员待审明细不得包含重点待审')
  for (const result of scopedStatsResults.slice(1)) {
    const pendingTags = new Set(result.dashboard.pendingItems.map(function(item) { return item.tag }))
    assert(pendingTags.has('待审核') && pendingTags.has('辅导员审核'), '辅导员与超级管理员待审明细应允许普通和重点两类')
  }

  const invalidUsageRoom = await api('/stats/usage-rate?roomId=abc', {
    headers: { Authorization: 'Bearer ' + buildingAdminLogin.json.data.token }
  })
  assert(invalidUsageRoom.status === 400 && invalidUsageRoom.json.code === 400, '非法房间编号应返回 400')

  const counselorBlacklist = await api('/credit/blacklist', {
    headers: { Authorization: 'Bearer ' + counselorLogin.json.data.token }
  })
  assert(counselorBlacklist.json.code === 200, '辅导员信用黑名单接口应可用')

  const guideOrdinaryAudit = await api('/audit/pending?type=admin&page=1&pageSize=10', {
    headers: { Authorization: 'Bearer ' + adminLogin.json.data.token }
  })
  assert(guideOrdinaryAudit.json.code === 200, '导生管理员应能读取普通预约审核队列')
  assertApprovalQueue(guideOrdinaryAudit.json, 'pending', '导生管理员普通审核队列', 10)
  assert(guideOrdinaryAudit.json.data.list.every(function(item) {
    const room = localData.getRoomById(item.room_id || item.roomId)
    return room && item.room_type === room.type
  }), '导生管理员普通审核队列应返回与房间一致的 room_type')
  const guideCounselorAudit = await api('/audit/pending?type=counselor&page=1&pageSize=10', {
    headers: { Authorization: 'Bearer ' + adminLogin.json.data.token }
  })
  assert(guideCounselorAudit.status === 403 && guideCounselorAudit.json.code === 403, '导生管理员不应读取辅导员重点审核队列')
  const counselorAudit = await api('/audit/pending?type=counselor&page=1&pageSize=10', {
    headers: { Authorization: 'Bearer ' + counselorLogin.json.data.token }
  })
  assert(counselorAudit.json.code === 200, '辅导员应能读取辅导员重点审核队列')

  assertApprovalQueue(counselorAudit.json, 'counselor_pending', '辅导员重点审核队列', 10)

  const scopedGuideOrdinaryAudit = await api('/audit/pending?type=admin&page=1&pageSize=100', {
    headers: { Authorization: 'Bearer ' + buildingAdminLogin.json.data.token }
  })
  assert(scopedGuideOrdinaryAudit.json.code === 200, '楼栋导生管理员应能读取范围内普通预约审核队列')
  assert(scopedGuideOrdinaryAudit.json.data.list.length > 0, '楼栋导生管理员范围内应有普通待审预约')
  const scopedGuideDetail = await api('/reservation/' + scopedGuideOrdinaryAudit.json.data.list[0].id, {
    headers: { Authorization: 'Bearer ' + buildingAdminLogin.json.data.token }
  })
  assert(scopedGuideDetail.json.code === 200, '楼栋导生管理员应能读取范围内普通预约详情')
  assert(scopedGuideDetail.json.data.credit_score !== undefined, '管理员预约详情应返回申请人信用分')
  assert(String(scopedGuideDetail.json.data.user_status || '').trim(), '管理员预约详情应返回申请人账号状态')
  assert(!Object.prototype.hasOwnProperty.call(scopedGuideDetail.json.data, 'phone'), '管理员预约详情不得返回申请人手机号')
  assert(!Object.prototype.hasOwnProperty.call(scopedGuideDetail.json.data, 'reservation_code'), '管理员预约详情不得返回学生签到凭证码')

  const boundaryReservations = await api('/reservation?page=1&pageSize=100', {
    headers: { Authorization: 'Bearer ' + superAdminLogin.json.data.token }
  })
  assert(boundaryReservations.json.code === 200, '超级管理员应能读取边界测试预约列表')
  const outsideBuildingReservation = boundaryReservations.json.data.list.find(function(item) {
    return Number(item.building_id || item.buildingId) !== buildingAdminId
  })
  assert(outsideBuildingReservation, '应存在楼栋导生管理员范围外的预约')
  const outsideBuildingDetail = await api('/reservation/' + outsideBuildingReservation.id, {
    headers: { Authorization: 'Bearer ' + buildingAdminLogin.json.data.token }
  })
  assert(outsideBuildingDetail.status === 403 && outsideBuildingDetail.json.code === 403, '楼栋导生管理员读取范围外预约详情应返回 403')
  const otherStudentReservation = boundaryReservations.json.data.list.find(function(item) {
    return Number(item.user_id || item.userId) !== Number(login.json.data.userInfo.id)
  })
  assert(otherStudentReservation, '应存在其他学生的预约用于本人边界测试')
  const otherStudentDetail = await api('/reservation/' + otherStudentReservation.id, {
    headers: { Authorization: 'Bearer ' + login.json.data.token }
  })
  assert(otherStudentDetail.status === 403 && otherStudentDetail.json.code === 403, '学生读取他人预约详情应返回 403')

  const counselorDetail = await api('/reservation/' + counselorAudit.json.data.list[0].id, {
    headers: { Authorization: 'Bearer ' + counselorLogin.json.data.token }
  })
  assert(counselorDetail.json.code === 200, '辅导员应能读取重点预约详情')
  assert(counselorDetail.json.data.credit_score !== undefined, '重点预约详情应返回申请人信用分')
  assert(String(counselorDetail.json.data.user_status || '').trim(), '重点预约详情应返回申请人账号状态')
  assert(!Object.prototype.hasOwnProperty.call(counselorDetail.json.data, 'phone'), '辅导员重点预约详情不得返回申请人手机号')
  assert(!Object.prototype.hasOwnProperty.call(counselorDetail.json.data, 'reservation_code'), '辅导员重点预约详情不得返回学生签到凭证码')
  const superAdminDetail = await api('/reservation/' + counselorAudit.json.data.list[0].id, {
    headers: { Authorization: 'Bearer ' + superAdminLogin.json.data.token }
  })
  assert(superAdminDetail.json.code === 200, '超级管理员应能读取重点预约详情')
  assert(superAdminDetail.json.data.credit_score !== undefined && String(superAdminDetail.json.data.user_status || '').trim(), '超级管理员重点预约详情应包含审批所需的信用状态')
  assert(!Object.prototype.hasOwnProperty.call(superAdminDetail.json.data, 'phone') && !Object.prototype.hasOwnProperty.call(superAdminDetail.json.data, 'reservation_code'), '超级管理员重点预约详情不得泄露手机号或签到凭证码')

  const expiredAccessToken = jwt.sign({
    id: login.json.data.userInfo.id,
    openid: login.json.data.userInfo.openid,
    role: 'student'
  }, config.jwt.secret, { expiresIn: -1 })

  const refresh = await api('/auth/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + expiredAccessToken
    },
    body: JSON.stringify({ refreshToken: login.json.data.refreshToken })
  })
  assert(refresh.json.code === 200 && refresh.json.data.token, '过期令牌应能通过刷新令牌恢复')

  const profile = await api('/user/profile', {
    headers: { Authorization: 'Bearer ' + refresh.json.data.token }
  })
  assert(profile.json.code === 200, '刷新后应能读取个人资料')
  assert(Number(profile.json.data.credit_score) === 80, '个人资料信用分应为 80')

  const detail = await api('/reservation/12', {
    headers: { Authorization: 'Bearer ' + refresh.json.data.token }
  })
  assert(detail.json.code === 200, '预约详情应可读取')
  assert(detail.json.data.room_name && detail.json.data.room_name.indexOf('C110') !== -1, '预约详情应返回 C110 功能房')
  assert(!detail.json.data.room_number, '预约详情不应把宿舍号 B301 当成功能房房号返回')
  assert(Object.prototype.hasOwnProperty.call(detail.json.data, 'phone'), '学生本人预约详情应保留联系信息契约')
  assert(Object.prototype.hasOwnProperty.call(detail.json.data, 'reservation_code'), '学生本人预约详情应保留签到凭证契约')

  const qr = await api('/reservation/12/qrcode', {
    headers: { Authorization: 'Bearer ' + refresh.json.data.token }
  })
  assert(qr.json.code === 200, '签到凭证接口应可读取')
  assert(qr.json.data.qrcode && qr.json.data.qrcode.indexOf('data:image/png;base64,') === 0, '签到凭证应返回二维码图片')
  assert(qr.json.data.code && /^JY/.test(qr.json.data.code), '签到凭证应返回完整凭证码')

  function localDatePlus(days) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }

  async function cleanupSharedRegressionReservations(token) {
    const list = await api('/reservation?page=1&pageSize=100&roomId=8', {
      headers: { Authorization: 'Bearer ' + token }
    })
    const activeStatuses = ['approved', 'pending', 'counselor_pending', 'checked_in']
    const reservations = (list.json.data && list.json.data.list) || list.json.data || []
    for (const reservation of reservations) {
      const purpose = String(reservation.purpose || '')
      const isRegressionData = purpose.indexOf('mobile-regression-shared-space') !== -1 || Number(reservation.participants) === 4
      if (Number(reservation.room_id) === 8 && activeStatuses.includes(reservation.status) && isRegressionData) {
        await api('/reservation/' + reservation.id, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token }
        })
      }
    }
  }

  async function findSharedRegressionSlot(token) {
    const slots = [
      ['08:00', '09:00'],
      ['09:00', '10:00'],
      ['10:00', '11:00'],
      ['14:00', '15:00'],
      ['15:00', '16:00'],
      ['16:00', '17:00'],
      ['19:00', '20:00']
    ]
    const maxDays = Math.max(3, Math.min(Number(config.reservation.advanceDays || 7), 7))
    for (let day = 1; day <= maxDays; day++) {
      const date = localDatePlus(day)
      for (const slot of slots) {
        const conflict = await api('/reservation/check-conflict', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
          },
          body: JSON.stringify({
            roomId: 8,
            date: date,
            startTime: slot[0],
            endTime: slot[1]
          })
        })
        if (conflict.json.code === 200 && conflict.json.data && !conflict.json.data.hasConflict) {
          return { date: date, startTime: slot[0], endTime: slot[1] }
        }
      }
    }
    throw new Error('未找到可用于共享空间回归测试的空闲时段')
  }

  const liLogin = await api('/auth/login/student', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentNo: '2024001002', cardNo: '200002' })
  })
  assert(liLogin.json.code === 200, '李四登录失败')
  const sharedToken = liLogin.json.data.token
  await cleanupSharedRegressionReservations(sharedToken)
  const sharedSlot = await findSharedRegressionSlot(sharedToken)
  const invalidShared = await api('/reservation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + sharedToken
    },
    body: JSON.stringify({
      roomId: 8,
      date: sharedSlot.date,
      startTime: sharedSlot.startTime,
      endTime: sharedSlot.endTime
    })
  })
  assert(invalidShared.json.code !== 200, '共享空间缺少用途和人数时不应预约成功')

  const validShared = await api('/reservation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + sharedToken
    },
    body: JSON.stringify({
      roomId: 8,
      date: sharedSlot.date,
      startTime: sharedSlot.startTime,
      endTime: sharedSlot.endTime,
      purposeCategory: '项目合作',
      participantCount: 4
    })
  })
  assert(validShared.json.code === 200, '共享空间填写用途和人数后应预约成功')
  assert(Number(validShared.json.data.participants) === 4, '共享空间预约应保存参与人数')
  assert(validShared.json.data.purpose === '项目合作', '共享空间预约应保存用途分类')

  await api('/reservation/' + validShared.json.data.id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + sharedToken }
  })

  const credit = await api('/user/credit', {
    headers: { Authorization: 'Bearer ' + refresh.json.data.token }
  })
  assert(credit.json.code === 200, '信用分明细应可读取')
  const records = credit.json.data.records || []
  const latestGood = records.find(function(item) { return Number(item.change) === 5 })
  const latestWarning = records.find(function(item) { return Number(item.change) === -5 })
  const noshow = records.find(function(item) { return Number(item.change) === -20 })
  assert(latestGood && Number(latestGood.scoreAfter) === 80, '最新 +5 后余额应为 80')
  assert(latestWarning && Number(latestWarning.scoreAfter) === 75, '-5 后余额应为 75')
  assert(noshow && Number(noshow.scoreAfter) === 80, '-20 后余额应为 80')

  const beforeAvatarProfile = await api('/user/profile', {
    headers: { Authorization: 'Bearer ' + refresh.json.data.token }
  })
  const beforeAvatar = beforeAvatarProfile.json.data && beforeAvatarProfile.json.data.avatar
  const avatarCandidatePaths = [
    process.env.AVATAR_TEST_IMAGE,
    'C:/Users/zzj/AppData/Local/Temp/codex-clipboard-abd3f517-a12d-4417-8e4c-7ad96301da0b.png',
    'C:/Users/zzj/AppData/Local/Temp/codex-clipboard-e1215da1-e8b7-4371-9452-8b24abb8c0c1.png',
    'C:/Users/zzj/AppData/Local/Temp/codex-clipboard-f82382ef-f72f-4acf-ae01-ac7bc1b6c7e0.png'
  ].filter(Boolean)
  const avatarFixturePath = avatarCandidatePaths.find(function (filePath) {
    return fs.existsSync(filePath)
  })
  assert(avatarFixturePath, '应能从本机文件夹找到一张头像测试图片')
  const ext = path.extname(avatarFixturePath).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  const form = new FormData()
  const avatarBuffer = fs.readFileSync(avatarFixturePath)
  form.append('avatar', new Blob([avatarBuffer], { type: mime }), 'avatar-test' + ext)
  const avatar = await fetch(BASE_URL + '/user/avatar', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + refresh.json.data.token },
    body: form
  })
  const avatarText = await avatar.text()
  let avatarJson
  try {
    avatarJson = JSON.parse(avatarText)
  } catch (err) {
    throw new Error('/user/avatar 返回的不是 JSON：' + avatarText.slice(0, 80))
  }
  assert(avatarJson.code === 200 && avatarJson.data && avatarJson.data.avatar, '头像接口应返回头像地址')
  assert(/\.(png|jpg|jpeg)($|\?)/.test(avatarJson.data.avatar), '头像接口应保存图片文件')
  assert(avatarJson.data.avatar !== beforeAvatar, '头像上传后应生成新的头像地址')
  const afterAvatarProfile = await api('/user/profile', {
    headers: { Authorization: 'Bearer ' + refresh.json.data.token }
  })
  assert(afterAvatarProfile.json.data.avatar === avatarJson.data.avatar, '头像上传后应在个人资料中同步更新')
  const avatarImage = await fetch(BASE_URL.replace(/\/api\/v1$/, '') + avatarJson.data.avatar)
  assert(avatarImage.ok, '头像图片地址应可直接访问')
  assert((avatarImage.headers.get('content-type') || '').indexOf('image/') === 0, '头像地址应返回图片内容')

  console.log('mobile-regression-check passed')
}

main().catch(function(err) {
  console.error(err.message)
  process.exitCode = 1
})
