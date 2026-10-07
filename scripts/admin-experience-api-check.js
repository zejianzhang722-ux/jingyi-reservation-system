const assert = require('node:assert/strict');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000/api/v1';
async function api(path, token, body, method) {
  return fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(res => res.json());
}
async function main() {
  assert(process.env.MOCK_DATA_DIR, '此检查只允许在独立数据环境执行');
  const login = (username, password) => api('/auth/login/admin-miniapp', null, { username, password }).then(res => { assert.equal(res.code, 200); return res.data.token; });
  const manager = await login('superadmin', 'super123');
  const counselor = await login('counselor', 'counselor123');
  const admin = await login('admin', 'admin123');
  const student = await api('/auth/login/student', null, { studentNo: '2024001001', cardNo: '200001' });
  const detail = await api('/credit/students/2024001001', manager); assert.equal(detail.code, 200); assert.equal(Number(detail.data.student.credit_score), 80); assert(Array.isArray(detail.data.logs));
  for (const token of [admin, student.data.token]) {
    assert.equal((await api('/credit/students/1', token)).code, 403);
    assert.equal((await api('/credit/students/1', token, { score: 20, reason: '无权调整' }, 'PUT')).code, 403);
  }
  assert.equal((await api('/credit/students/1', manager, { score: 20, reason: '' }, 'PUT')).code, 400);
  assert.equal((await api('/credit/students/1', manager, { score: 200, reason: '超出范围' }, 'PUT')).code, 400);
  const set = await api('/credit/students/1', counselor, { score: 20, reason: '核实后调整预约权限' }, 'PUT'); assert.equal(set.code, 200); assert.equal(set.data.change, -60); assert.equal(set.data.bookingPermission.advanceDays, 0);
  const after = await api('/credit/students/1', manager); assert.equal(Number(after.data.student.credit_score), 20); assert.equal(after.data.student.status, 'active'); assert(after.data.logs.some(log => Number(log.score_after) === 20 && Number(log.score_change) === -60));
  assert.equal((await api('/auth/login/student', null, { studentNo: '2024001001', cardNo: '200001' })).code, 200);
  const zero = await api('/credit/students/1', manager, { score: 0, reason: '零分边界检查' }, 'PUT'); assert.equal(zero.code, 200); assert.equal(zero.data.score, 0);
  const missing = await api('/credit/students/9999999999', manager); assert.equal(missing.code, 404);
  const counselorRooms=await api('/admin/rooms?status=counselor_only&pageSize=100',manager);assert.equal(counselorRooms.code,200);assert(counselorRooms.data.list.some(room=>room.name.includes('D128')));assert(counselorRooms.data.list.every(room=>room.status==='counselor_only'));
  const room = await api('/admin/rooms/22', manager); assert.equal(room.code, 200); assert.equal(room.data.status, 'counselor_only');
  assert.equal((await api('/admin/rooms/13', admin, { capacity: 20 }, 'PUT')).code, 403);
  assert.equal((await api('/admin/rooms/13', manager, { capacity: 20 }, 'PUT')).code, 200);
  assert.equal((await api('/admin/rooms/13', manager, { openStartTime:'22:00',openEndTime:'08:00' }, 'PUT')).code, 400);
  assert.equal((await api('/admin/rooms/13', manager, { status:'counselor_only',openStartTime:'09:30',openEndTime:'21:15' }, 'PUT')).code, 200);
  const editedRoom=await api('/admin/rooms/13',manager);assert.equal(editedRoom.data.status,'counselor_only');assert.equal(editedRoom.data.open_start_time,'09:30');
  assert.equal((await api('/admin/rooms/13',manager,{status:'restricted'},'PUT')).code,400);
  assert.equal((await api('/admin/rooms/22',manager,{status:'closed'},'PUT')).code,200);assert.equal((await api('/admin/rooms/22',manager)).data.status,'closed');assert(!(await api('/admin/rooms?status=counselor_only&pageSize=100',manager)).data.list.some(room=>room.id===22));
  assert.equal((await api('/admin/rooms/22',manager,{status:'open'},'PUT')).code,200);assert.equal((await api('/admin/rooms/22',manager)).data.status,'counselor_only');
  const created=await api('/admin/rooms',manager,{name:'管理检查空间',type:'data_room',buildingId:1,capacity:8,openStartTime:'09:00',openEndTime:'20:30',status:'counselor_only',facilities:['wifi','power']});assert.equal(created.code,200);const createdDetail=await api('/admin/rooms/'+created.data.id,manager);assert.equal(createdDetail.data.status,'counselor_only');assert.equal(createdDetail.data.facilities,'wifi,power');
  const search = await api('/credit/violations?keyword=2024001001&type=noshow&page=1&pageSize=20', manager); assert.equal(search.code, 200); assert(search.data.list.length > 0); assert(search.data.list.every(row => row.student_id === '2024001001' && row.type === 'noshow')); assert.equal(search.data.total, search.data.list.length);
  const noMatch = await api('/credit/violations?keyword=不存在的姓名&page=1&pageSize=20', manager); assert.equal(noMatch.code, 200); assert.equal(noMatch.data.total, 0);
  console.log('PASS: managed student lookup, credit setting snapshots and zero/login, role isolation, room management, D128 channel and violation keyword/type totals');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
