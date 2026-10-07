import assert from 'node:assert/strict';

const baseUrl = process.env.ADMIN_API_BASE_URL || 'http://127.0.0.1:3000/api/v1';

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${body.message || ''}`);
  }
  return body;
}

const login = await request('/auth/login/admin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'superadmin', password: 'super123' })
});

const token = login.data.token;
const headers = { Authorization: `Bearer ${token}` };

const allPending = await request('/reservation?status=pending&page=1&pageSize=20', { headers });
const auditPending = await request('/audit/pending?type=admin&page=1&pageSize=20', { headers });
const counselorPending = await request('/audit/counselor/pending?page=1&pageSize=20', { headers });

const mock = await import('../server/src/config/mock-db.js');
const pendingRows = mock.default.__tables.reservations.filter(row => row.status === 'pending');
assert.equal(allPending.data.total, pendingRows.length, '全部预约应返回全部普通待审记录');
assert.equal(allPending.data.list.length, pendingRows.length, '普通待审分页应完整');
assert.ok(pendingRows.length > 0, '测试种子须包含普通待审预约');
assert.equal(auditPending.data.total, pendingRows.length, '普通审核队列不应混入辅导员待审');
assert.equal(auditPending.data.list.length, pendingRows.length, '普通审核列表应完整');
assert.ok(auditPending.data.list.every(row => row.status === 'pending'), '普通审核队列只含 pending');
const counselorRows = mock.default.__tables.reservations.filter(row => row.status === 'counselor_pending');
assert.equal(counselorPending.data.total, counselorRows.length, '辅导员审核应返回全部辅导员待审记录');
assert.ok(counselorRows.length > 0 && counselorPending.data.list.every(row => row.status === 'counselor_pending'), '辅导员审核状态应准确');

for (const row of [...allPending.data.list, ...auditPending.data.list, ...counselorPending.data.list]) {
  assert.ok(row.userName, '预约人不能为空');
  assert.ok(row.studentId, '学号不能为空');
  assert.ok(row.roomName, '功能房不能为空');
  assert.ok(row.timeSlot, '时间段不能为空');
  assert.ok(row.createdAt, '创建时间不能为空');
}

console.log('admin reservation endpoint checks passed');
