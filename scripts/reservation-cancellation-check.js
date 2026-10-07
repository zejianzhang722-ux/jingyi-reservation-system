const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.MOCK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-cancel-check-'));
const mock = require('../server/src/config/mock-db');
const dbPath = require.resolve('../server/src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { isMock: () => true, query: mock.query } };
const controller = require('../server/src/controllers/reservationLifecycleController');
const lifecycle = require('../server/src/services/reservationLifecycleService');
const groups = require('../server/src/services/reservationGroupService');
const t = mock.__tables;
function seed(status, group = false) {
  t.users = [{ id: 1, credit_score: 100, status: 'active' }, { id: 2, credit_score: 100, status: 'active' }];
  t.reservations = [{ id: 9901, user_id: 1, room_id: 1, date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00', status, version: 1 }];
  t.reservation_slots = [{ id: 1, reservation_id: 9901 }];
  t.reservation_waitlist = [];
  t.notifications = [];
  t.notification_outbox = [];
  t.credits_log = [];
  t.reservation_groups = group ? [{ id: 9902, reservation_id: 9901, created_by: 1, room_id: 1, date:'2020-01-01',start_hour:'10:00',end_hour:'11:00',start_time:'10:00',end_time:'11:00',max_members:4,status: 'approved', name: '测试组团' }] : [];
  t.reservation_group_members = group ? [{id:1,group_id:9902,user_id:1},{id:2,group_id:9902,user_id:2}] : [];
}
async function cancel(userId = 1) { let body; await controller.cancel({params:{id:9901},user:{id:userId,role:'student'}},{status(){return this},json(value){body=value}});return body; }
let failures=0;
async function test(name,fn){try{await fn();console.log('PASS '+name)}catch(e){failures++;console.error('FAIL '+name+': '+e.message)}}
(async()=>{
  for(const status of ['pending','counselor_pending','approved']) await test('本人 '+status+' 临近或开始后仍可取消',async()=>{seed(status);assert.equal((await cancel()).code,200);assert.equal(t.reservations[0].status,'cancelled');assert.equal(t.reservation_slots.length,0)});
  for(const status of ['checked_in','completed','noshow']) await test(status+'不可取消',async()=>{seed(status);assert.equal((await cancel()).code,409);assert.equal(t.reservations[0].status,status)});
  await test('20次重复并发取消只释放一次并通知一次',async()=>{seed('approved');const responses=await Promise.all(Array.from({length:20},()=>cancel()));assert.equal(responses.every(r=>r.code===200),true);assert.equal(t.reservations[0].version,2);assert.equal(t.notifications.filter(n=>n.type==='reservation_cancelled').length,1);assert.equal(t.credits_log.length,0)});
  await test('团主从普通预约入口取消同步组团',async()=>{seed('approved',true);assert.equal((await cancel()).code,200);assert.equal(t.reservation_groups[0].status,'cancelled')});
  await test('成员不能取消团主预约',async()=>{seed('approved',true);assert.equal((await cancel(2)).code,403);assert.equal(t.reservation_groups[0].status,'approved')});
  await test('成员不能解散他人组团',async()=>{seed('approved',true);await assert.rejects(groups.dissolveGroup(9902,2),e=>e.httpStatus===403)});
  await test('已签到组团不可解散',async()=>{seed('checked_in',true);await assert.rejects(groups.dissolveGroup(9902,1),e=>e.httpStatus===409);assert.equal(t.reservations[0].status,'checked_in')});
  await test('重复解散已取消组团成功且不重复释放',async()=>{seed('approved',true);await groups.dissolveGroup(9902,1);await groups.dissolveGroup(9902,1);assert.equal(t.reservations[0].version,2)});
  await test('生命周期取消同样拒绝签到状态',async()=>{seed('checked_in');await assert.rejects(lifecycle.releaseAndPromote({reservationId:9901,nextStatus:'cancelled',actorRole:'student',actorUserId:1}),e=>e.httpStatus===409)});
  process.exitCode=failures?1:0;
})();
