const assert = require('node:assert/strict');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000/api/v1';
async function api(path, token, body, method) {
  return fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(res => res.json());
}
async function main() {
  assert(process.env.MOCK_DATA_DIR, '必须使用独立测试数据');
  const login = async name => (await api('/auth/login/admin-miniapp', null, { username: name, password: name === 'superadmin' ? 'super123' : 'admin123' })).data.token;
  const token = await login('superadmin'), admin = await login('admin');
  const now = new Date(), date = value => { const d = new Date(now.getTime() + value * 86400000); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };
  const active = { status: 'maintenance', startAt: date(-1) + ' 00:00', endAt: date(1) + ' 23:59' };
  const url = '/admin/rooms/28';
  assert.equal((await api(url, admin, { statusSchedules: [active] }, 'PUT')).code, 403);
  assert.equal((await api(url, token, { statusSchedules: [active] }, 'PUT')).code, 200);
  const detail = (await api(url, token)).data;
  assert.equal(detail.status, 'maintenance'); assert.equal(detail.baseStatus, 'open'); assert.deepEqual(detail.statusSchedules, [active]);
  const list = (await api('/admin/rooms?status=maintenance&pageSize=100', token)).data;
  assert(list.list.some(room => room.id === 28)); assert(list.list.every(room => room.status === 'maintenance')); assert.equal(list.total, list.list.length);
  assert.equal((await api('/room/28', token)).data.status, 'maintenance');
  const timeline = (await api('/room/28/timeline?date=' + date(0), token)).data;
  assert(timeline.timeline.length); assert(timeline.timeline.every(slot => slot.status === 'unavailable' && slot.availableCount === 0));
  assert.equal((await api(url, token, { statusSchedules: [active, active] }, 'PUT')).code, 400);
  assert.equal((await api(url, token, { status: 'closed' }, 'PUT')).code, 200);
  assert.equal((await api(url, token)).data.status, 'maintenance');
  assert.equal((await api(url, token, { statusSchedules: [] }, 'PUT')).code, 200);
  assert.equal((await api(url, token)).data.status, 'closed');
  assert.equal((await api(url, token, { status: 'open', statusSchedules: [{ status: 'closed', startAt: date(1) + ' 10:00', endAt: date(1) + ' 12:00' }] }, 'PUT')).code, 200);
  assert.equal((await api(url, token)).data.status, 'open');
  const future = (await api('/room/28/timeline?date=' + date(1), token)).data.timeline;
  assert(future.filter(slot => slot.time >= '10:00' && slot.time < '12:00').every(slot => slot.status === 'unavailable'));
  assert(future.some(slot => slot.time >= '12:00' && slot.status === 'available'));
  console.log('PASS 定时安排真实接口保存、多端显示、筛选数量、未来时段、取消恢复与管理员权限');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
