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
  const adminViolations = await api('/credit/violations', {
    headers: { Authorization: 'Bearer ' + adminLogin.json.data.token }
  })
  assert(adminViolations.json.code === 200, '管理员信用违规记录接口应可用')
  const adminBlacklist = await api('/credit/blacklist', {
    headers: { Authorization: 'Bearer ' + adminLogin.json.data.token }
  })
  assert(adminBlacklist.json.code === 200, '管理员信用黑名单接口应可用')

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
