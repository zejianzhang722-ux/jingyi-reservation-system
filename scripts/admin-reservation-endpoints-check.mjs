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
const auditPending = await request('/audit/pending?page=1&pageSize=20', { headers });
const counselorPending = await request('/audit/counselor/pending?page=1&pageSize=20', { headers });

assert.equal(allPending.data.total, 2, '全部预约的待审核总数应为 2');
assert.equal(allPending.data.list.length, 2, '全部预约应返回 2 条待审核记录');
assert.equal(auditPending.data.total, 3, '预约审核应包含普通待审与辅导员待审共 3 条');
assert.equal(auditPending.data.list.length, 3, '预约审核列表应返回 3 条记录');
assert.equal(counselorPending.data.total, 1, '辅导员审核应只返回 1 条辅导员待审记录');

for (const row of [...allPending.data.list, ...auditPending.data.list, ...counselorPending.data.list]) {
  assert.ok(row.userName, '预约人不能为空');
  assert.ok(row.studentId, '学号不能为空');
  assert.ok(row.roomName, '功能房不能为空');
  assert.ok(row.timeSlot, '时间段不能为空');
  assert.ok(row.createdAt, '创建时间不能为空');
}

console.log('admin reservation endpoint checks passed');
