const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.MOCK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-group-lock-'));
const mock = require('../server/src/config/mock-db');
const tables = mock.__tables;
const dbPath = require.resolve('../server/src/config/database');
let mockMode = true;
const database = { isMock: () => mockMode, query: mock.query, assertTransactional() {} };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
require('../server/src/services/realtimeEventService').setIO({ to() { return { emit() {} }; } });
const groups = require('../server/src/services/reservationGroupService');
tables.users.push({ ...tables.users[0], id: 6, credit_score: 100 }, { ...tables.users[0], id: 7, credit_score: 100 });
const date = require('../server/src/utils/helpers').formatDate(new Date(Date.now() + 86400000));
async function fresh(maxMembers = 2) {
  tables.reservations = []; tables.reservation_groups = []; tables.reservation_group_members = []; tables.reservation_slots = [];
  return groups.createGroup(1, { title: '并发与生命周期检查', roomId: 14, date, startTime: '17:00', endTime: '18:00', maxMembers });
}
(async () => {
  let group = await fresh();
  const joins = await Promise.allSettled([2, 6, 7].map(id => groups.joinGroup(group.id, id)));
  assert.equal(joins.filter(r => r.status === 'fulfilled').length, 1, 'only the one remaining registration place can be claimed');
  assert.equal(tables.reservation_group_members.length, 2);
  assert.equal(Number(tables.reservations[0].participants), 2, 'registration does not shrink the declared actual attendance');
  for (const status of ['noshow', 'completed', 'cancelled', 'rejected', 'checked_in']) {
    group = await fresh(); tables.reservations[0].status = status;
    await assert.rejects(groups.joinGroup(group.id, 2), /预约|组团/);
    assert.equal(tables.reservation_group_members.length, 1, status + ' cannot recruit');
  }
  group = await fresh();
  const reservation = tables.reservations[0];
  reservation.date = require('../server/src/utils/helpers').formatDate(new Date());
  reservation.start_time = '00:00'; reservation.end_time = '23:59';
  await assert.rejects(groups.joinGroup(group.id, 2), /开始|招募/);
  group = await fresh();
  await groups.joinGroup(group.id, 2);
  await Promise.allSettled([groups.leaveGroup(group.id, 2), groups.dissolveGroup(group.id, 1), groups.joinGroup(group.id, 6)]);
  assert.equal(tables.reservations[0].status, 'cancelled');
  await assert.rejects(groups.joinGroup(group.id, 7), /预约|组团/);
  // Exercise the real MySQL branch with an isolated transaction runner.
  mockMode = false;
  const statements = []; let rollbacks = 0;
  database.getConnection = async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { rollbacks++; }, release() {},
    execute: async (sql) => {
      statements.push(sql);
      if (/FROM users/.test(sql)) return [[{ id: 2, status: 'active', credit_score: 100 }]];
      if (/FROM reservation_groups/.test(sql)) return [[{ id: 888, reservation_id: 889, room_id: 14, room_type: 'dance_room', created_by: 1, date, start_time: '17:00', end_time: '18:00', max_members: 2, status: 'approved' }]];
      if (/FROM reservations/.test(sql)) return [[{ id: 889, date, start_time: '17:00', end_time: '18:00', status: 'noshow' }]];
      return [[], []];
    }
  });
  await assert.rejects(groups.joinGroup(888, 2), /预约|组团/);
  assert.ok(statements.some(sql => /FROM reservations.*FOR UPDATE/.test(sql)), 'MySQL checks the primary reservation under row lock');
  assert.equal(statements.filter(sql => /INSERT INTO reservation_group_members/.test(sql)).length, 0);
  assert.equal(rollbacks, 1);
  console.log('PASS: concurrent places, terminal states, recruitment closes at start, join/leave/dissolve serialization, unchanged headcount, MySQL primary row lock');
})().catch(err => { console.error(err); process.exitCode = 1; });
