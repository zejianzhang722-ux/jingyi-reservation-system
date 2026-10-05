const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const navCalls = [];
const postCalls = [];
const storage = {
  token: 'student-token',
  customBaseUrl: 'http://127.0.0.1:3000/api/v1',
  userInfo: { id: 1, role: 'student', student_no: '2024001001', card_no: '200001', phone: '13900000001' }
};

global.wx = {
  getStorageSync: function(key) { return storage[key]; },
  setStorageSync: function(key, value) { storage[key] = value; },
  removeStorageSync: function(key) { delete storage[key]; },
  navigateTo: function(options) { navCalls.push({ type: 'navigateTo', url: options.url }); },
  switchTab: function(options) { navCalls.push({ type: 'switchTab', url: options.url }); },
  redirectTo: function(options) { navCalls.push({ type: 'redirectTo', url: options.url }); },
  showToast: function() {},
  showModal: function() {},
  setNavigationBarTitle: function() {},
  stopPullDownRefresh: function() {}
};
global.getApp = function() { return { globalData: {} }; };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPage(relativePath) {
  let pageConfig = null;
  global.Page = function(config) { pageConfig = config; };
  const fullPath = path.join(root, relativePath);
  delete require.cache[require.resolve(fullPath)];
  require(fullPath);
  assert(pageConfig, relativePath + ' 未注册 Page');
  pageConfig.data = JSON.parse(JSON.stringify(pageConfig.data || {}));
  pageConfig.setData = function(next) {
    Object.keys(next).forEach(function(key) {
      const parts = key.split('.');
      let target = pageConfig.data;
      for (let index = 0; index < parts.length - 1; index += 1) {
        target[parts[index]] = target[parts[index]] || {};
        target = target[parts[index]];
      }
      target[parts[parts.length - 1]] = next[key];
    });
  };
  return pageConfig;
}

async function flushPromises() {
  await new Promise(function(resolve) { setImmediate(resolve); });
}

async function main() {
  const request = require('../miniapp/utils/request');
  const subscribeMessage = require('../miniapp/services/subscribeMessage');

  wx.request = function(options) {
    options.success({
      statusCode: 201,
      data: { code: 201, message: '创建成功', data: { id: 31 } }
    });
  };
  const createdGroup = await request.request({ url: '/groups', method: 'POST', data: {} });
  assert(createdGroup && createdGroup.id === 31, '请求层应将 HTTP 201 的组团创建响应视为成功');

  request.get = function(url) {
    if (url.indexOf('/room/') === 0) {
      return Promise.resolve({ id: 6, name: 'B102共享空间', type: 'seminar_room', capacity: 12, status: 'open' });
    }
    return Promise.resolve({});
  };
  request.post = function(url, data) {
    postCalls.push({ url: url, data: data });
    return Promise.resolve({ id: 31, reservationId: 18 });
  };
  subscribeMessage.requestReservationSubscribe = function() {};

  const groupList = loadPage('miniapp/pages/group-list/group-list.js');
  groupList.onGoRoomList.call(groupList);
  assert(navCalls[0] && navCalls[0].type === 'navigateTo', '“去发起组团”应打开普通功能房列表页');
  assert(navCalls[0].url === '/pages/room-list/room-list?groupMode=1', '“去发起组团”应带组团模式进入功能房列表');

  navCalls.length = 0;
  const roomDetail = loadPage('miniapp/pages/room-detail/room-detail.js');
  const groupRoom = roomDetail.normalizeRoom({ id: 6, name: 'B102共享空间', type: 'seminar_room', status: 'open' });
  const studyRoom = roomDetail.normalizeRoom({ id: 1, name: 'B228自习室', type: 'study_room', status: 'open' });
  assert(groupRoom.canGroupReserve === true, '共享空间应标记为支持组团预约');
  assert(studyRoom.canGroupReserve === false, '按座位预约的自习室不应支持组团预约');
  assert(typeof roomDetail.onGroupReserveTap === 'function', '功能房详情页应提供组团预约入口');
  roomDetail.setData({ room: groupRoom });
  roomDetail.onGroupReserveTap.call(roomDetail);
  assert(navCalls[0] && navCalls[0].url === '/pages/room-timeline/room-timeline?roomId=6&reservationMode=group', '详情页组团入口应进入该功能房的时段选择');

  const confirmPage = loadPage('miniapp/pages/reservation-confirm/reservation-confirm.js');
  confirmPage.setData({
    roomId: 6,
    date: '2026-09-22',
    startHour: 14,
    startMin: 0,
    endHour: 16,
    endMin: 0,
    room: { id: 6, name: 'B102共享空间', type: 'seminar_room', capacity: 12 },
    canGroupReserve: true,
    reservationMode: 'group',
    phone: '13900000001',
    cardNo: '200001',
    agreedRules: true,
    discussionFields: { purposeCategory: '项目合作', participantCount: '4', hasMultimedia: false, hasOwnAppliance: false },
    groupFields: { title: '', maxMembers: '4', description: '' }
  });
  assert(confirmPage.validateForm.call(confirmPage) === '请填写组团标题', '组团预约必须校验组团标题');

  confirmPage.setData({ 'groupFields.title': '课程项目组', 'groupFields.maxMembers': '4', 'groupFields.description': '欢迎同学加入' });
  const groupPayload = confirmPage.buildGroupPayload.call(confirmPage);
  assert(groupPayload.roomId === 6, '组团请求应绑定当前功能房');
  assert(groupPayload.startTime === '14:00' && groupPayload.endTime === '16:00', '组团请求应沿用已选择时段');
  assert(groupPayload.title === '课程项目组' && groupPayload.maxMembers === 4, '组团请求应包含标题和人数上限');

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = function(callback) { callback(); return 0; };
  confirmPage.onSubmit.call(confirmPage);
  await flushPromises();
  global.setTimeout = originalSetTimeout;
  assert(postCalls[0] && postCalls[0].url === '/groups', '组团模式必须提交到组团预约接口');
  assert(navCalls.some(function(call) {
    return call.type === 'redirectTo' && call.url === '/pages/group-reserve/group-reserve?mode=detail&groupId=31';
  }), '创建成功后应进入组团详情页');

  const confirmWxml = fs.readFileSync(path.join(root, 'miniapp/pages/reservation-confirm/reservation-confirm.wxml'), 'utf8');
  assert(/个人预约/.test(confirmWxml) && /组团预约/.test(confirmWxml), '预约确认页应展示个人与组团两种方式');
  console.log('miniapp-group-reservation-flow-check passed');
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
