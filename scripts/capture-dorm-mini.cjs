// Capture actual DevTools UI and test real navigation, without mocked requests.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const automator = require(process.env.MINIPROGRAM_AUTOMATOR_PATH || 'miniprogram-automator');
const { PNG } = require(process.env.PNGJS_PATH || 'pngjs');
const { stitchVertical } = require('../docs/manual/tools/capture-stitch.cjs');
const out = path.resolve(__dirname, '../docs/screenshots/dorm-manager');
async function capture(mini, page, name) {
  console.log('CAPTURE', name);
  await page.callMethod('onHide');
  await mini.pageScrollTo(0);
  await page.waitFor(1000);
  await mini.screenshot({ path: path.join(out, name + '.png') });
  const system = await mini.systemInfo(), frames = [];
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitFor(350);
    const top = Number(await page.scrollTop()) || 0;
    const max = Math.max(0, Number((await page.size()).height) - system.windowHeight);
    console.log('FRAME', name, i, top, max);
    assert.ok(top !== last || top >= max - 2, '页面未滚动到底部');
    let image;
    if (i === 0) image = PNG.sync.read(fs.readFileSync(path.join(out, name + '.png')));
    else {
      const framePath = path.join(out, name + '-frame-' + i + '.png');
      await mini.screenshot({ path: framePath });
      image = PNG.sync.read(fs.readFileSync(framePath));
    }
    frames.push({ image, offset: Math.round(top * image.width / system.screenWidth) });
    if (top >= max - 2) break;
    last = top;
    await mini.pageScrollTo(Math.min(max, top + Math.floor(system.windowHeight * .68)));
    assert.ok(i < 39, '未到达底部');
  }
  const first = frames[0].image, ratio = first.width / system.screenWidth;
  const full = frames.length === 1 ? first : stitchVertical(frames, { total: frames.at(-1).offset + first.height, fixedStart: Math.round((system.screenHeight - system.windowHeight) * ratio), fixedEnd: Math.round(34 * ratio) });
  fs.writeFileSync(path.join(out, name + '-full.png'), PNG.sync.write(full));
  await mini.pageScrollTo(0);
  await page.callMethod('onShow');
  return { name, frames: frames.length, height: full.height };
}
async function login(mini, username, base = 'http://127.0.0.1:3295') {
  const response = await fetch(base + '/api/v1/auth/login/admin-miniapp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: process.env.DORM_TEST_PASSWORD || 'admin123' }) });
  const { data } = await response.json();
  assert.ok(data?.token, '宿管登录失败');
  await mini.evaluate(auth => {
    wx.setStorageSync('token', auth.token); wx.setStorageSync('refreshToken', auth.refreshToken); wx.setStorageSync('userInfo', auth.userInfo);
    Object.assign(getApp().globalData, auth);
  }, data);
}
async function main() {
  fs.mkdirSync(out, { recursive: true });
  process.env.PORT = '3295'; process.env.NODE_ENV = 'test'; process.env.ENABLE_SCHEDULER = 'false'; process.env.MYSQL_PORT = '1'; process.env.REDIS_PORT = '1';
  process.env.MOCK_DATA_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jingyi-dorm-ui-'));
  const db = require('../server/src/config/database'), backend = require('../server/src/app'), helpers = require('../server/src/utils/helpers');
  await db.ready();
  const redis = require('../server/src/config/redis');
  for (let i = 0; i < 100 && !redis.isMock(); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(redis.isMock(), true, '隔离测试缓存未就绪');
  const t = require('../server/src/config/mock-db').__tables;
  const booking = t.reservations.find(r => r.id === 1), now = new Date();
  Object.assign(booking, { date: helpers.formatDate(now), start_time: helpers.formatTime(now), end_time: helpers.minutesToTime(Math.min(1439, helpers.timeToMinutes(helpers.formatTime(now)) + 60)), status: 'approved', purpose: '宿管签到联测 · 自习', participants: 1 });
  let mini;
  let savedNetwork;
  async function setNetwork(url) {
    const page = await mini.reLaunch('/pages/network-settings/network-settings');
    await page.setData({ customBaseUrl: url });
    await page.callMethod('onSaveCustom');
    assert.equal((await page.data()).baseUrl, url);
  }
  async function restoreNetwork() {
    if (!mini || !savedNetwork) return;
    await setNetwork(savedNetwork.baseUrl);
    await mini.evaluate(saved => {
      if (saved.customBaseUrl) wx.setStorageSync('customBaseUrl', saved.customBaseUrl);
      else wx.removeStorageSync('customBaseUrl');
    }, savedNetwork);
  }
  async function waitForPage(expected) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const page = await mini.currentPage();
      if (page && page.path === expected) return page;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('页面跳转未完成：' + expected);
  }
  try {
    console.log('CONNECT_DEVTOOLS');
    let connectionError;
    for (let attempt = 0; attempt < 20 && !mini; attempt++) {
      try { mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }); }
      catch (error) { connectionError = error; await new Promise(resolve => setTimeout(resolve, 1500)); }
    }
    if (!mini) throw connectionError;
    await mini.restoreWxMethod('request');
    const settings = await mini.reLaunch('/pages/network-settings/network-settings');
    const network = await settings.data();
    savedNetwork = { baseUrl: network.baseUrl, customBaseUrl: network.customBaseUrl };
    if (savedNetwork.baseUrl === 'http://127.0.0.1:3295/api/v1') savedNetwork = { baseUrl: 'http://127.0.0.1:3000/api/v1', customBaseUrl: '' };
    await setNetwork('http://127.0.0.1:3295/api/v1');
    await login(mini, 'dorm_b');
    if (process.env.DORM_SIGNIN_ONLY === '1') {
      const page = await mini.reLaunch('/pages/dorm-scan/dorm-scan');
      await page.waitFor(async () => (await page.data()).me?.buildingName === 'B座');
      const qr = (await require('../server/src/services/checkinCredentialService').issue(booking)).credential;
      await mini.mockWxMethod('scanCode', { result: qr, scanType: 'QR_CODE', errMsg: 'scanCode:ok' });
      await mini.mockWxMethod('getLocation', function (options) { if (options.fail) options.fail({ errMsg: 'getLocation:fail simulator location unavailable' }); if (options.complete) options.complete(); });
      await page.callMethod('scan');
      await page.waitFor(async () => (await page.data()).result?.outcome === 'ready');
      await page.callMethod('identity', { detail: { value: ['yes'] } });
      await page.callMethod('pass');
      await page.waitFor(300);
      // Simulator mocks can omit getLocation's complete callback. Continue the
      // same pending request via the real retry handler, never injecting a result.
      if ((await page.data()).busy) {
        await page.setData({ busy: false });
        await page.callMethod('retry');
      }
      await page.waitFor(async () => (await page.data()).result?.outcome === 'passed');
      assert.equal(booking.status, 'checked_in');
      assert.equal(t.checkins.filter(row => row.reservation_id === booking.id).length, 1);
      const result = (await page.data()).result;
      assert.equal(result.reservation.buildingName, 'B座');
      assert.ok(result.reservation.location && result.reservation.name && result.reservation.startTime && result.reservation.participants);
      fs.writeFileSync(path.join(out, 'signin-result.json'), JSON.stringify({ checkedIn: result.checkedIn, outcome: result.outcome, reservation: result.reservation, checkinRows: t.checkins.filter(row => row.reservation_id === booking.id).length, note: '隔离数据、真实后端响应；模拟器相机输入与定位回调使用测试控制' }, null, 2));
      const screenshot = await capture(mini, page, 'miniapp-signin-success');
      const monitor = await mini.reLaunch('/pages/dorm-spaces/dorm-spaces');
      await monitor.waitFor(async () => (await monitor.data()).spaces?.length > 0);
      assert.equal((await monitor.data()).spaces.find(room => room.id === booking.room_id).state, 'in_use');
      const report = { passed: ['真实后端签到成功', '仅新增一条签到记录', '开门核对信息完整', '空间监控同步为使用中'], note: '微信开发者工具模拟器；隔离测试数据；调用实际页面操作方法；相机扫码与定位失败为自动化输入，接口响应未经伪造', screenshot };
      fs.writeFileSync(path.join(out, 'signin-report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
      return;
    }
    let page = await mini.reLaunch('/pages/verification/verification');
    await page.waitFor(async () => (await page.data()).me?.buildingName === 'B座');
    await page.waitFor(async () => (await page.data()).summary?.total > 0);
    const screenshots = [await capture(mini, page, 'miniapp-home')];
    for (const [section, target] of [['scan','dorm-scan'], ['reservations','dorm-reservations'], ['spaces','dorm-spaces'], ['records','dorm-records']]) {
      const entry = await page.$('#nav-' + section);
      assert.ok(entry, '工作台缺少入口：' + section);
      await entry.tap();
      page = await waitForPage('pages/' + target + '/' + target);
      assert.equal(page.path, 'pages/' + target + '/' + target);
      await page.waitFor(async () => (await page.data()).me?.buildingName === 'B座');
      if (section === 'reservations') {
        await page.waitFor(async () => (await page.data()).reservations?.length > 0);
        const state = await page.data();
        assert.ok(state.reservations.every(item => item.buildingId === 1 && item.buildingName === 'B座'));
        await page.setData({ reservationSearch: '不存在的测试预约' });
        await page.callMethod('searchReservations');
        await page.waitFor(async () => (await page.data()).reservationTotal === 0);
        await page.setData({ reservationSearch: '' }); await page.callMethod('searchReservations');
        await page.waitFor(async () => (await page.data()).reservations.length > 0);
      }
      if (section === 'scan') {
        const qr = (await require('../server/src/services/checkinCredentialService').issue(booking)).credential;
        assert.ok(await page.$('#scan-panel'));
        await page.setData({ credential: 'invalid-local-test-credential' });
        await page.callMethod('preview');
        await page.waitFor(async () => (await page.data()).result?.outcome === 'rejected' || !!(await page.data()).error);
        assert.notEqual((await page.data()).result?.checkedIn, true);
        await mini.mockWxMethod('scanCode', { result: qr, scanType: 'QR_CODE', errMsg: 'scanCode:ok' });
        await mini.mockWxMethod('getLocation', function (options) { if (options.fail) options.fail({ errMsg: 'getLocation:fail simulator location unavailable' }); if (options.complete) options.complete(); });
        await (await page.$('#scan-trigger')).tap();
        await page.waitFor(async () => (await page.data()).result?.outcome === 'ready');
        await page.callMethod('identity', { detail: { value: ['yes'] } });
        await page.waitFor(350);
        await (await page.$('#confirm-signin')).tap();
        await page.waitFor(async () => (await page.data()).result?.outcome === 'passed');
        assert.equal(booking.status, 'checked_in');
        assert.equal(t.checkins.filter(row => row.reservation_id === booking.id).length, 1);
        assert.equal((await page.data()).result.reservation.buildingName, 'B座');
        screenshots.push(await capture(mini, page, 'miniapp-signin-success'));
        await mini.restoreWxMethod('scanCode'); await mini.restoreWxMethod('getLocation');
      }
      if (section === 'spaces') {
        await page.waitFor(async () => (await page.data()).spaces?.length > 0);
        assert.equal((await page.data()).spaces.find(room => room.id === booking.room_id).state, 'in_use');
      }
      screenshots.push(await capture(mini, page, 'miniapp-' + section));
      await mini.navigateBack(); page = await mini.currentPage();
      assert.equal(page.path, 'pages/verification/verification');
    }
    await login(mini, 'dorm_c');
    page = await mini.reLaunch('/pages/dorm-reservations/dorm-reservations');
    await page.waitFor(async () => (await page.data()).me?.buildingName === 'C座');
    await page.waitFor(1000);
    assert.ok((await page.data()).reservations.every(item => item.buildingId === 2));
    await restoreNetwork();
    await login(mini, 'dorm_b', 'http://127.0.0.1:3000'); await mini.reLaunch('/pages/verification/verification');
    const report = { passed: ['五页实际导航与返回', 'B/C楼栋名称与隔离', '实际预约展示与搜索', '无效签到凭证不签到', '真实后端签到成功与空间状态同步'], note: '开发者工具模拟器；隔离测试数据；相机扫码和定位失败由自动化提供输入，签到与查询均为真实后端响应', screenshots };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { if (mini) { for (const method of ['scanCode', 'getLocation']) await mini.restoreWxMethod(method).catch(() => {}); await restoreNetwork().catch(() => {}); await login(mini, 'dorm_b', 'http://127.0.0.1:3000').catch(() => {}); await mini.reLaunch('/pages/verification/verification').catch(() => {}); await mini.disconnect(); } await backend.shutdown('dorm-ui-capture'); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
