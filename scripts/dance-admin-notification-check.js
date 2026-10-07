const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.MOCK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-dance-notices-'));
const mock = require('../server/src/config/mock-db');
const dbPath = require.resolve('../server/src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { isMock: () => true, query: mock.query, getConnection: async () => ({ release() {} }) } };
const tables = mock.__tables;
tables.notifications = [{ id: 1, user_id: 1, type: 'system', is_read: 0, data: '{}', created_at: '2026-10-06 00:00:00' }];
tables.admin_notifications = [{ id: 1, admin_id: 1, type: 'dance_group_reserved', is_read: 0, data: '{}', created_at: '2026-10-06 00:00:00' }];
const controller = require('../server/src/controllers/notificationController');
const call = async (handler, role, id = 1, extra = {}) => {
  const res = { status(s) { this.code = s; return this; }, json(body) { this.body = body; return this; } };
  await handler({ user: { role, id }, query: {}, params: { id: 1 }, ...extra }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body)); return res.body.data;
};
(async () => {
  const adminList = await call(controller.list, 'admin');
  assert.equal(adminList.list[0].type, 'dance_group_reserved', 'admin id 1 never reads student id 1 notices');
  await call(controller.markRead, 'admin');
  assert.equal(Number(tables.admin_notifications[0].is_read), 1);
  assert.equal(Number(tables.notifications[0].is_read), 0);
  tables.admin_notifications = [];
  tables.admins = [
    { id: 1, role: 'admin', status: 'active', scope_type: 'building', building_id: 3 },
    { id: 2, role: 'dorm_manager', status: 'active', scope_type: 'building', building_id: 3 },
    { id: 3, role: 'admin', status: 'active', scope_type: 'building', building_id: 1 },
    { id: 4, role: 'super_admin', status: 'active', scope_type: 'global', building_id: null },
    { id: 5, role: 'counselor', status: 'active', scope_type: 'global', building_id: null },
    { id: 6, role: 'dorm_manager', status: 'active', scope_type: 'global', building_id: null },
    { id: 7, role: 'admin', status: 'disabled', scope_type: 'building', building_id: 3 }
  ];
  tables.reservations = [{ id: 90001, user_id: 1, room_id: 14, date: '2026-10-07', start_time: '17:00', end_time: '18:00', status: 'approved' }];
  tables.reservation_groups = [{ id: 90002, reservation_id: 90001, room_id: 14, status: 'approved', name: '舞蹈排练' }];
  const service = require('../server/src/services/danceGroupNotificationService');
  const realtime = require('../server/src/services/realtimeEventService');
  const emissions = [];
  realtime.setIO({ to(room) { return { emit(event, payload) { emissions.push({ room, event, payload }); } }; } });
  await Promise.all(Array.from({ length: 20 }, () => service.notifyApproved(90001)));
  assert.deepEqual(tables.admin_notifications.map(n => Number(n.admin_id)).sort(), [1, 2, 4, 5]);
  assert.equal(tables.notifications.length, 1, 'student inbox unchanged');
  assert.ok(tables.admin_notifications.every(n => n.content.includes('个人不可进入') && n.content.includes('开门') && n.content.includes('巡房')));
  assert.deepEqual(emissions.map(e => e.room).sort(), ['admin:1', 'admin:2', 'admin:4', 'admin:5']);
  assert.ok(fs.existsSync(path.join(process.env.MOCK_DATA_DIR, 'mock-admin-notifications.json')));
  tables.reservations[0].status = 'cancelled';
  await Promise.all(Array.from({ length: 5 }, () => service.notifyReleased(90001)));
  assert.equal(tables.admin_notifications.filter(n => n.type === 'dance_group_released').length, 4);
  assert.equal((await call(controller.unreadCount, 'dorm_manager', 2)).count, 2);
  await call(controller.markAllRead, 'dorm_manager', 2);
  assert.equal((await call(controller.unreadCount, 'dorm_manager', 2)).count, 0);
  const redisPath = require.resolve('../server/src/config/redis');
  require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: { get: async () => null } };
  const jwt = require('../server/node_modules/jsonwebtoken');
  const token = jwt.sign({ id: 2, role: 'dorm_manager', tokenType: 'access' }, require('../server/src/config').jwt.secret);
  const authenticate = require('../server/src/middleware/auth').auth;
  for (const [url, allowed] of [['/api/v1/notification/unread-count', true], ['/api/v1/user/profile', false]]) {
    let passed = false;
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await authenticate({ originalUrl: url, headers: { authorization: 'Bearer ' + token } }, res, () => { passed = true; });
    assert.equal(passed, allowed, 'dorm route ' + url);
    if (!allowed) assert.equal(res.code, 403);
  }
  tables.reservations[0].status = 'pending';
  tables.admin_notifications = [];
  await service.notifyApproved(90001);
  assert.equal(tables.admin_notifications.length, 0, 'pending team does not notify');
  tables.reservations[0].status = 'approved';
  await service.reconcile(new Date('2026-10-06T12:00:00'));
  assert.equal(tables.admin_notifications.length, 4, 'missed post-approval notices are recovered');
  await service.reconcile(new Date('2026-10-06T12:01:00'));
  assert.equal(tables.admin_notifications.length, 4, 'recovery stays idempotent');
  const groupService = require('../server/src/services/reservationGroupService');
  tables.reservations = []; tables.reservation_groups = []; tables.reservation_group_members = []; tables.reservation_slots = []; tables.admin_notifications = [];
  const room = tables.rooms.find(r => r.id === 14);
  room.need_audit = 0; room.need_counselor_audit = 0;
  const group = await groupService.createGroup(1, { title: '独立创建舞蹈团队', roomId: 14, date: '2026-10-07', startTime: '17:00', endTime: '18:00', maxMembers: 5 });
  assert.equal(tables.admin_notifications.length, 4, 'approval-free group creation immediately notifies');
  await groupService.dissolveGroup(group.id, 1);
  assert.equal(tables.admin_notifications.filter(n => n.type === 'dance_group_released').length, 4, 'dissolve triggers release notices');
  tables.admin_notifications = [];
  room.need_audit = 1;
  const pending = await groupService.createGroup(2, { title: '待审核舞蹈团队', roomId: 14, date: '2026-10-07', startTime: '18:00', endTime: '19:00', maxMembers: 5 });
  assert.equal(tables.admin_notifications.length, 0);
  await groupService.approveGroup(pending.id, 1, 'admin');
  assert.equal(tables.admin_notifications.length, 4, 'group approval triggers notices');
  await assert.rejects(groupService.approveGroup(pending.id, 1, 'admin'), /已被处理/);
  assert.equal(tables.admin_notifications.length, 4);
  const single = await groupService.createGroup(2, { title: '单项审批舞蹈团队', roomId: 14, date: '2026-10-07', startTime: '19:00', endTime: '20:00', maxMembers: 5 });
  await call(require('../server/src/controllers/reservationApprovalController').approve, 'admin', 1, { params: { id: single.reservationId }, body: {}, method: 'PUT' });
  assert.equal(tables.admin_notifications.filter(n => JSON.parse(n.data).reservationId === single.reservationId).length, 4);
  const batch = await groupService.createGroup(2, { title: '批量审批舞蹈团队', roomId: 14, date: '2026-10-07', startTime: '20:00', endTime: '21:00', maxMembers: 5 });
  await call(require('../server/src/controllers/auditController').batchAudit, 'admin', 1, { body: { ids: [batch.reservationId], action: 'approve' }, method: 'POST' });
  assert.equal(tables.admin_notifications.filter(n => JSON.parse(n.data).reservationId === batch.reservationId).length, 4);
  const reloaded = require('child_process').execFileSync(process.execPath, ['-e', 'const db=require(' + JSON.stringify(require.resolve('../server/src/config/mock-db')) + '); process.stdout.write(JSON.stringify(db.__tables.admin_notifications));'], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } });
  assert.equal(JSON.parse(reloaded).length, tables.admin_notifications.length, 'admin notices survive a fresh process');
  console.log('PASS: admin/student id isolation, building scope, admin-only socket, 20-way dedupe, durable mock store, cancellation, read counters');
  console.log('PASS: actual group create/approve/dissolve hooks and missed-notice recovery');
})().catch(err => { console.error(err); process.exitCode = 1; });
