const assert = require('node:assert/strict');
const mock = require('../src/config/mock-db');

async function main() {
  const tables = mock.__tables;
  const required = [
    'buildings', 'rooms', 'seats', 'users', 'admins', 'reservations',
    'checkins', 'credits_log', 'violations', 'posters', 'poster_positions',
    'reading_room_logs', 'notifications', 'reservation_waitlist',
    'reservation_groups', 'reservation_group_members', 'operation_logs',
    'announcements', 'system_config'
  ];
  for (const name of required) assert.ok(tables[name]?.length > 0, name + ' should have demo rows');
  assert.ok(Array.isArray(tables.feedbacks), 'feedback storage must exist without inventing student feedback');
  for (const group of tables.reservation_groups) {
    const reservation = tables.reservations.find(row => row.id === group.reservation_id);
    assert.ok(reservation, 'group ' + group.id + ' must link to a reservation');
    assert.equal(reservation.room_id, group.room_id);
    assert.equal(reservation.date, group.date);
    assert.equal(reservation.status, group.status);
    assert.ok(tables.reservation_group_members.some(row => row.group_id === group.id && row.user_id === group.created_by));
  }
  const [blacklist] = await mock.query(
    "SELECT u.id, u.nickname, u.real_name, u.student_id, u.credit_score, u.status, u.restricted_until FROM users u WHERE u.status IN ('banned', 'restricted') OR u.credit_score < ? ORDER BY u.credit_score ASC",
    [60]
  );
  assert.ok(blacklist.some(row => row.id === 3), 'OR/IN blacklist query should include restricted user');
  console.log('mock-seed-coverage-check passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
