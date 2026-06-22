const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000/api/v1'

async function request(path, options) {
  const res = await fetch(BASE_URL + path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, options || {}))
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(path + ' 返回的不是 JSON：' + text.slice(0, 80))
  }
  if (json.code !== 200) {
    throw new Error(path + ' 返回失败：' + JSON.stringify(json))
  }
  return json.data
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function loginStudent(studentNo, cardNo) {
  return request('/auth/login/student', {
    method: 'POST',
    body: JSON.stringify({ studentNo, cardNo })
  })
}

async function main() {
  const login = await loginStudent('2024001001', '200001')
  assert(login.token, '张三登录后没有返回令牌')
  assert(Number(login.userInfo.credit_score) === 80, '张三登录信用分应为 80')

  const headers = { Authorization: 'Bearer ' + login.token }

  const reservations = await request('/reservation?page=1&pageSize=50', { headers })
  assert(Array.isArray(reservations.list), '我的预约没有返回列表')
  assert(reservations.list.some((item) => item.room_name === 'B102共享空间' && item.status === 'pending'), '张三缺少 B102共享空间待审核预约')
  assert(reservations.list.some((item) => item.room_name === 'C133学业辅导中心' && item.status === 'approved'), '张三缺少 C133已通过预约')
  assert(reservations.list.some((item) => item.room_name === 'B228自习室' && item.status === 'noshow'), '张三缺少 B228自习室爽约记录')

  const stats = await request('/user/stats', { headers })
  assert(stats.totalReservations >= 3, '张三使用统计不应为 0')
  assert(stats.noshowCount >= 1, '张三使用统计缺少爽约次数')

  const notifications = await request('/notification?page=1&pageSize=50', { headers })
  assert(Array.isArray(notifications.list), '消息通知没有返回列表')
  assert(notifications.list.length > 0, '张三消息通知不应为空')

  const credit = await request('/user/credit', { headers })
  assert(Number(credit.creditScore) === 80, '张三信用分明细应为 80')
  assert(Array.isArray(credit.records) && credit.records.length > 0, '张三信用分明细缺少变动记录')
  assert(credit.records.every((item) => item.reason), '信用分变动记录缺少原因')

  const form = new FormData()
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/atR9poAAAAASUVORK5CYII=', 'base64')
  form.append('avatar', new Blob([tinyPng], { type: 'image/png' }), 'avatar.png')
  const uploadRes = await fetch(BASE_URL + '/user/avatar', {
    method: 'POST',
    headers,
    body: form
  })
  const uploadText = await uploadRes.text()
  let uploadJson
  try {
    uploadJson = JSON.parse(uploadText)
  } catch (err) {
    throw new Error('/user/avatar 返回的不是 JSON：' + uploadText.slice(0, 80))
  }
  assert(uploadJson.code === 200, '头像上传接口返回失败')
  assert(uploadJson.data && /\.png($|\?)/.test(uploadJson.data.avatar || ''), '头像上传应返回图片地址')

  console.log('student-closed-loop-check passed')
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
