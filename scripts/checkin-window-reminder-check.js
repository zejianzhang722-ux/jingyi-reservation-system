const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const policy = require('../server/src/services/verificationPolicy');
const reservation = { id: 90001, user_id: 1, room_id: 1, date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00', status: 'approved', user_status: 'active', room_status: 'open' };
for (const [time, expected] of [['09:44:59', false], ['09:45:00', true], ['10:15:00', true], ['10:15:01', false]]) {
  assert.equal(policy.eligibility(reservation, new Date('2026-10-06T' + time)).eligible, expected, time);
}
const queries = [], notifications = [];
const rows = [{ ...reservation }];
const penalties = [];
const execute = async (sql, params) => {
  queries.push({ sql, params });
  if (/SELECT.*checkins/i.test(sql)) return [[]];
  if (/SELECT.*reservation_waitlist/i.test(sql)) return [[]];
  if (/UPDATE reservations/i.test(sql)) { rows[0].status = 'noshow'; return [{ affectedRows: 1 }]; }
  if (/SELECT.*reservations/i.test(sql)) return [[{ ...rows[0] }]];
  return [{ affectedRows: 1 }];
};
const dbPath = require.resolve('../server/src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  isMock: () => false,
  query: execute,
  assertTransactional: () => {},
  getConnection: async () => ({ execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} })
} };
const creditPath = require.resolve('../server/src/services/creditService');
require.cache[creditPath] = { id: creditPath, filename: creditPath, loaded: true, exports: {
  addCredit: async (...args) => penalties.push(args),
  addCreditWithinTransaction: async (...args) => { penalties.push(args); return {}; },
  notifyCreditThreshold: async () => {}
} };
const notificationPath = require.resolve('../server/src/services/notificationService');
require.cache[notificationPath] = { id: notificationPath, filename: notificationPath, loaded: true, exports: {
  createNotification: async (...args) => { if (!notifications.some(n => n[0] === args[0] && n[1] === args[1] && n[4].reservationId === args[4].reservationId)) notifications.push(args); return {}; }
} };
const scheduler = require('../server/src/services/schedulerService');
(async () => {
  await scheduler.sendStartReminders(new Date('2026-10-06T09:50:00'));
  assert.ok(notifications[0][3].includes('10分钟'));
  assert.ok(queries[0].params.includes('10:00:00') || queries[0].params.includes('2026-10-06 10:00:00'));
  assert.equal(scheduler.TASK_DEFINITIONS.find(t => t.name === 'detect-noshow').cron, '* * * * *');
  assert.match(fs.readFileSync(path.join(root, 'scripts/run-backend-hidden.vbs'), 'utf8'), /ENABLE_SCHEDULER/);
  const lifecycle = require('../server/src/services/reservationLifecycleService');
  await lifecycle.detectNoshow(new Date('2026-10-06T10:15:00'));
  assert.equal(rows[0].status, 'approved', 'exact closing instant still accepts checkin');
  await lifecycle.detectNoshow(new Date('2026-10-06T10:15:01'));
  assert.equal(rows[0].status, 'noshow');
  await lifecycle.detectNoshow(new Date('2026-10-06T10:16:00'));
  assert.equal(penalties.length, 1, 'one penalty after repeated scans');
  assert.equal(notifications.filter(n => n[1] === 'noshow').length, 1);
  const jobs = [], locks = new Map();
  const lockService = {
    acquire: async (key) => {
      if (locks.has(key)) return { acquired: false };
      const lock = { acquired: true, key }; locks.set(key, lock); return lock;
    },
    renew: async lock => locks.get(lock.key) === lock,
    release: async lock => locks.delete(lock.key)
  };
  const schedulerState = await scheduler.initScheduler({
    scheduleLib: { scheduleJob: (cron, callback) => { const job = { cron, callback, cancel() {} }; jobs.push(job); return job; } },
    redisClient: { ready: async () => ({ mode: 'mock' }), isMock: () => true }, lockService
  });
  assert.equal(schedulerState.jobs, 7);
  const reminderJob = jobs[1];
  const outcomes = await Promise.all(Array.from({ length: 20 }, () => reminderJob.callback(new Date('2026-10-06T09:50:00'))));
  assert.equal(outcomes.filter(r => r.status === 'success').length, 1);
  assert.equal(outcomes.filter(r => r.status === 'skipped').length, 19);
  await scheduler.stopScheduler();
  console.log('PASS: precise 15-minute boundaries, 10-minute reminders, minute noshow scan, manual runner scheduler');
})().catch(err => { console.error(err); process.exitCode = 1; });
