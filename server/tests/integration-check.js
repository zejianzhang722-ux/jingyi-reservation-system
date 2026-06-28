const { spawn } = require('child_process');

const PORT = Number(process.env.TEST_PORT || 3100);
const BASE_URL = 'http://127.0.0.1:' + PORT + '/api/v1';

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function startServer() {
  const child = spawn(process.execPath, ['src/app.js'], {
    cwd: __dirname + '/..',
    env: Object.assign({}, process.env, {
      NODE_ENV: 'test',
      ALLOW_MOCK_DB: 'true',
      ENABLE_SCHEDULER: 'false',
      PORT: String(PORT),
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: '1',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', function(chunk) { output += chunk.toString(); });
  child.stderr.on('data', function(chunk) { output += chunk.toString(); });

  child.output = function() { return output; };
  return child;
}

async function stopServer(child) {
  if (!child || child.killed) return;
  child.kill();
  await wait(500);
}

async function waitForHealth(child) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('服务提前退出：\n' + child.output());
    }
    try {
      const res = await fetch(BASE_URL + '/health');
      const json = await res.json();
      if (json.code === 200) return;
    } catch (e) {}
    await wait(300);
  }
  throw new Error('服务未能按时启动：\n' + child.output());
}

async function api(path, options) {
  const res = await fetch(BASE_URL + path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, options || {}));
  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(path + ' 返回失败：' + JSON.stringify(json));
  }
  return json.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

async function main() {
  let server = startServer();
  try {
    await waitForHealth(server);

    const rooms = await api('/room');
    assert(Array.isArray(rooms) && rooms.length > 0, 'S02 首页功能房列表为空');

    const timeline = await api('/room/1/timeline?date=2026-06-03');
    assert(timeline && Array.isArray(timeline.timeline), 'S03 功能房时间线没有返回时间段');
    const seats = await api('/room/1/seats');
    assert(Array.isArray(seats) && seats.length > 0, 'S03 功能房座位没有返回数据');
    const integrationSeatId = seats[0].id;
    assert(integrationSeatId, 'S03 功能房座位没有返回座位编号');

    const studentLogin = await api('/auth/login/student', {
      method: 'POST',
      body: JSON.stringify({ studentNo: '2024001001', cardNo: '200001' })
    });
    const studentToken = studentLogin.token;
    assert(studentToken, 'S01 学生登录后没有拿到令牌');

    const studentHeaders = { Authorization: 'Bearer ' + studentToken };
    const profile = await api('/user/profile', { headers: studentHeaders });
    assert(profile && profile.name !== '未登录', 'S07 个人中心没有显示真实姓名');

    await api('/user/profile', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, studentHeaders),
      body: JSON.stringify({ name: '张三', phone: '13900000001' })
    });

    const reserveDate = formatDate(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
    const createdReservation = await api('/reservation', {
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Idempotency-Key': 'integration-seat-booking-' + Date.now()
      }, studentHeaders),
      body: JSON.stringify({
        roomId: 1,
        seatId: integrationSeatId,
        date: reserveDate,
        startTime: '13:00',
        endTime: '14:00',
        purpose: '验收测试预约',
        participants: 1
      })
    });
    assert(createdReservation && createdReservation.id, 'S04 创建预约没有返回预约编号');
    assert(Number(createdReservation.seatId) === Number(integrationSeatId), 'S04 自习室预约没有保留所选座位');

    const myReservations = await api('/reservation?page=1&pageSize=20', { headers: studentHeaders });
    assert(Array.isArray(myReservations.list), 'S05 我的预约列表没有返回列表');

    await api('/reservation/' + createdReservation.id, {
      method: 'DELETE',
      headers: studentHeaders
    });

    const notifications = await api('/notification', { headers: studentHeaders });
    assert(Array.isArray(notifications.list), 'S09 消息通知没有返回列表');

    const marker = '重启保留验收-' + Date.now();
    const feedback = await api('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + studentToken },
      body: JSON.stringify({ type: 'bug', content: marker, contact: 'test' })
    });
    assert(feedback && feedback.id, 'S10 反馈提交后没有返回编号');

    const adminLogin = await api('/auth/login/admin-miniapp', {
      method: 'POST',
      body: JSON.stringify({ username: 'superadmin', password: 'super123' })
    });
    assert(adminLogin.userInfo.role === 'super_admin', 'A01 超级管理员身份应统一为 super_admin，实际为 ' + adminLogin.userInfo.role);
    const adminToken = adminLogin.token;
    const adminHeaders = { Authorization: 'Bearer ' + adminToken };

    const pending = await api('/reservation/pending', { headers: adminHeaders });
    assert(Array.isArray(pending), 'A03 审批首页待审列表没有返回数组');

    await api('/reservation/7/approve', {
      method: 'PUT',
      headers: adminHeaders
    });

    await api('/reservation/5/reject', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, adminHeaders),
      body: JSON.stringify({ reason: '验收拒绝测试' })
    });

    const allReservations = await api('/reservation?page=1&pageSize=20', { headers: adminHeaders });
    assert(Array.isArray(allReservations.list) && allReservations.list.length >= myReservations.list.length, 'A06 管理员预约管理没有返回全量列表');

    const users = await api('/user/list?page=1&pageSize=20', { headers: adminHeaders });
    assert(Array.isArray(users.list) && users.list.length > 0, 'A10 宿生管理没有返回用户列表');

    const dashboard = await api('/stats/dashboard', { headers: adminHeaders });
    assert(dashboard && typeof dashboard === 'object', 'A07 管理中心统计没有返回数据');

    const buildings = await api('/admin/buildings', {
      headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert(Array.isArray(buildings.list) && buildings.list.length > 0, 'A09/W02 超级管理员无法访问楼栋管理');

    const adminRooms = await api('/admin/rooms?page=1&pageSize=20', { headers: adminHeaders });
    assert(Array.isArray(adminRooms.list) && adminRooms.list.length > 0, 'A09 功能房管理没有返回房间');

    const announcements = await api('/admin/announcements?page=1&pageSize=20', { headers: adminHeaders });
    assert(Array.isArray(announcements.list), 'A12 公告管理没有返回列表');

    const feedbackListBeforeResolve = await api('/feedback?status=pending&page=1&pageSize=50', { headers: adminHeaders });
    assert(feedbackListBeforeResolve.list.some(function(item) { return item.id === feedback.id; }), 'A11/W03 管理端没有看到学生刚提交的反馈');

    await api('/feedback/' + feedback.id + '/resolve', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, adminHeaders),
      body: JSON.stringify({ reply: '已收到，验收处理完成' })
    });

    await stopServer(server);
    server = startServer();
    await waitForHealth(server);

    const persistedAdminLogin = await api('/auth/login/admin-miniapp', {
      method: 'POST',
      body: JSON.stringify({ username: 'superadmin', password: 'super123' })
    });
    const persistedAdminToken = persistedAdminLogin.token;
    const feedbackList = await api('/feedback?page=1&pageSize=50', {
      headers: { Authorization: 'Bearer ' + persistedAdminToken }
    });
    assert(
      feedbackList.list.some(function(item) { return item.content === marker; }),
      '服务重启后没有查到刚提交的反馈'
    );

    console.log('integration-check passed');
  } finally {
    await stopServer(server);
  }
}

main().catch(function(err) {
  console.error(err.message);
  process.exit(1);
});
