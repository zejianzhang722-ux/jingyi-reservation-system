const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.MOCK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-noshow-check-'));
const mock = require('../server/src/config/mock-db');
const dbPath = require.resolve('../server/src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { isMock: () => true, query: mock.query, getConnection: async () => ({ release() {} }) } };
const lifecycle = require('../server/src/services/reservationLifecycleService');
const scheduler = require('../server/src/services/schedulerService');
const tables = mock.__tables;
const base = { id: 99001, user_id: 1, room_id: 1, date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00', status: 'approved', version: 1 };
(async () => {
  tables.reservations = [{ ...base }];
  tables.users = [{ id: 1, status: 'active', credit_score: 100 }];
  tables.checkins = [];
  tables.credits_log = [];
  tables.notifications = [];
  tables.reservation_waitlist = [];
  tables.reservation_slots = [{ reservation_id: base.id }];
  await Promise.all(Array.from({ length: 20 }, () => scheduler.sendStartReminders(new Date('2026-10-06T09:50:00'))));
  assert.equal(tables.notifications.filter(n => n.type === 'reservation_reminder').length, 1);
  await lifecycle.detectNoshow(new Date('2026-10-06T10:15:00'));
  assert.equal(tables.reservations[0].status, 'approved');
  await Promise.all(Array.from({ length: 20 }, () => lifecycle.detectNoshow(new Date('2026-10-06T10:15:01'))));
  assert.equal(tables.reservations[0].status, 'noshow');
  assert.equal(Number(tables.users[0].credit_score), 80);
  assert.equal(tables.credits_log.length, 1);
  assert.equal(tables.notifications.filter(n => n.type === 'noshow').length, 1);
  assert.equal(tables.reservation_slots.length, 0);
  // An existing checkin wins over expiry, even if its status has not yet been repaired.
  tables.reservations = [{ ...base, id: 99002 }];
  tables.checkins = [{ id: 1, reservation_id: 99002 }];
  await lifecycle.detectNoshow(new Date('2026-10-07T10:00:00'));
  assert.equal(tables.reservations[0].status, 'approved');
  assert.equal(tables.credits_log.length, 1);
  tables.checkins = [];
  await lifecycle.detectNoshow(new Date('2026-10-07T10:00:00'));
  assert.equal(tables.reservations[0].status, 'noshow', 'overdue earlier-day reservations recovered on next startup');
  assert.equal(tables.credits_log.length, 2);
  const credentialPath = require.resolve('../server/src/services/checkinCredentialService');
  require.cache[credentialPath] = { id: credentialPath, filename: credentialPath, loaded: true, exports: { consume: async () => {} } };
  const controller = require('../server/src/controllers/checkinController');
  const OriginalDate = Date;
  for (const role of ['student', 'admin', 'dorm_manager']) {
    for (const [time, code] of [['09:44:59', 400], ['09:45:00', 200], ['10:15:00', 200], ['10:15:01', 400]]) {
      global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-06T' + time])); } static now() { return new OriginalDate('2026-10-06T' + time).getTime(); } };
      tables.reservations = [{ ...base }]; tables.checkins = [];
      const response = { status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
      await controller.checkin({ body: { reservationId: base.id, credential: 'isolated-test-credential' }, user: { id: 1, role } }, response);
      assert.equal(response.code, code, role + ' ' + time + ': ' + JSON.stringify(response.body));
      assert.equal(tables.checkins.length, code === 200 ? 1 : 0);
    }
  }
  global.Date = OriginalDate;
  const manualRunner = { transactional: false, query: mock.query };
  tables.reservations = [{ ...base }]; tables.checkins = [];
  await assert.rejects(controller.applyManualCheckinWithinTransaction(manualRunner, { reservationId: base.id, now: new Date('2026-10-06T09:44:59') }), /15分钟/);
  await controller.applyManualCheckinWithinTransaction(manualRunner, { reservationId: base.id, now: new Date('2026-10-06T09:45:00') });
  assert.equal(tables.checkins.length, 1);
  const verification = require('../server/src/services/verificationRepository');
  global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-06T09:45:00'])); } };
  tables.reservations = [{ ...base }]; tables.checkins = [];
  await assert.rejects(verification.atomic(async runner => {
    await verification.applyCheckin(runner, tables.reservations[0], {});
    throw new Error('isolated rollback');
  }), /isolated rollback/);
  assert.equal(tables.reservations[0].status, 'approved', 'failed verification does not retain a checkin claim');
  await verification.atomic(runner => verification.applyCheckin(runner, tables.reservations[0], {}));
  assert.equal(tables.reservations[0].status, 'checked_in');
  assert.equal(tables.checkins.length, 1);
  global.Date = OriginalDate;
  console.log('PASS: 20 concurrent reminder scans => 1 reminder; 20 noshow scans => 1 penalty/message; exact boundary and checkin protection; next-day catchup');
  console.log('PASS: student/admin/dorm-manager checkin controllers at all four boundaries; manual admin checkin window');
  console.log('Isolated mock directory: ' + process.env.MOCK_DATA_DIR);
})().catch(err => { console.error(err); process.exitCode = 1; });
