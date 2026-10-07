const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.MOCK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-mutation-check-'));
const mock = require('../server/src/config/mock-db');
const dbPath = require.resolve('../server/src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { isMock: () => true, query: mock.query } };
const service = require('../server/src/services/reservationMutationService');
const db = require('../server/src/config/database');
const t = mock.__tables;
function seed(type='other',participants=1,group=false){
  t.rooms=[{id:1,type,status:'open',capacity:5},{id:2,type:'other',status:'open',capacity:5}];
  t.users=[{id:1},{id:2},{id:3}];t.seats=[];
  t.reservations=[{id:100,user_id:1,room_id:1,date:'2026-10-07',start_time:'08:00',end_time:'09:00',purpose:'原用途',participants,status:'approved'}];
  t.reservation_groups=group?[{id:200,reservation_id:100,created_by:1,start_time:'08:00',end_time:'09:00',purpose:'原用途',status:'approved'}]:[];
  t.reservation_group_members=group?[{group_id:200,user_id:1,status:'confirmed'},{group_id:200,user_id:2,status:'confirmed'}]:[];
  t.reservation_slots=[{id:1,reservation_id:100,room_id:1,seat_scope:0,date:'2026-10-07',slot_minute:480}];
}
function other(id,userId,roomId,start,end,participants=1){t.reservations.push({id,user_id:userId,room_id:roomId,date:'2026-10-07',start_time:start,end_time:end,participants,status:'approved',purpose:'测试'});t.reservation_slots.push({id:99+id,reservation_id:id,room_id:roomId,seat_scope:0,date:'2026-10-07',slot_minute:600})}
function update(extra={}){return service.updateReservation({reservationId:100,actor:{id:1,role:'student'},startTime:'10:00',endTime:'11:00',...extra})}
function mysqlDriver(){
 const calls=[];
 db.isMock=()=>false;db.assertTransactional=()=>{};
 db.getConnection=async()=>({beginTransaction:async()=>calls.push(['begin']),commit:async()=>calls.push(['commit']),rollback:async()=>calls.push(['rollback']),release:()=>calls.push(['release']),execute:async(sql,params=[])=>{
  calls.push([sql,params]);
  if(sql.startsWith('SELECT DISTINCT'))return [t.reservations.filter(row=>row.user_id===params[1]).map(row=>({...row,room_type:t.rooms.find(room=>room.id===row.room_id).type}))];
  if(sql.startsWith('SELECT')&&sql.includes('FROM reservations')&&sql.includes('WHERE room_id'))return [t.reservations];
  if(sql.startsWith('SELECT')&&sql.includes('FROM reservations'))return [[{...t.reservations[0]}]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM reservation_groups'))return [t.reservation_groups];
  if(sql.startsWith('SELECT')&&sql.includes('FROM reservation_group_members'))return [t.reservation_group_members];
  if(sql.startsWith('SELECT')&&sql.includes('FROM rooms'))return [[t.rooms[0]]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM users'))return [[{id:params[0],credit_score:100,status:'active'}]];
  return [{affectedRows:1}];
 }});return calls;
}
let failures=0;async function test(name,fn){try{await fn();console.log('PASS '+name)}catch(e){failures++;console.error('FAIL '+name+': '+e.message)}}
(async()=>{
 await test('个人修改不能与另一房间预约重叠',async()=>{seed();other(101,1,2,'10:00','11:00');await assert.rejects(update(),e=>e.code==='PERSONAL_SLOT_CONFLICT');assert.equal(t.reservations[0].start_time,'08:00')});
 await test('个人修改不能与其参与组团重叠',async()=>{seed();other(101,3,2,'10:00','11:00');t.reservation_groups.push({id:201,reservation_id:101});t.reservation_group_members.push({group_id:201,user_id:1,status:'confirmed'});await assert.rejects(update(),e=>e.code==='PERSONAL_SLOT_CONFLICT')});
 await test('共享房间未满可与其他预约同时间修改',async()=>{seed('competition_room',2);other(101,3,1,'10:00','11:00',2);await update();assert.equal(t.reservations[0].participants,2);assert.equal(t.reservation_slots.find(s=>s.reservation_id===100).seat_scope,-100)});
 await test('共享房间超容量修改被拒绝',async()=>{seed('competition_room',4);other(101,3,1,'10:00','11:00',2);await assert.rejects(update(),e=>e.code==='CAPACITY_EXCEEDED');assert.equal(t.reservations[0].start_time,'08:00')});
 await test('团队改时间检查每位成员其他预约',async()=>{seed('seminar_room',2,true);other(101,2,2,'10:00','11:00');await assert.rejects(update(),e=>e.code==='PERSONAL_SLOT_CONFLICT');assert.equal(t.reservation_groups[0].start_time,'08:00')});
 await test('团队成功修改同步时间用途',async()=>{seed('seminar_room',2,true);await update({purpose:'新用途'});assert.equal(t.reservation_groups[0].start_time,'10:00');assert.equal(t.reservation_groups[0].end_time,'11:00');assert.equal(t.reservation_groups[0].purpose,'新用途')});
 await test('前端伪装组团不能绕过仅限组团要求',async()=>{seed('seminar_room',2);await assert.rejects(update({groupBooking:true}),e=>e.code==='GROUP_REQUIRED')});
 await test('已有3次预约修改自身仍可成功',async()=>{seed();other(101,1,2,'12:00','13:00');other(102,1,2,'14:00','15:00');await update();assert.equal(t.reservations[0].start_time,'10:00')});
 await test('历史超额预约修改不增加次数时仍可成功',async()=>{seed();other(101,1,2,'12:00','13:00');other(102,1,2,'14:00','15:00');other(103,1,2,'16:00','17:00');await update();assert.equal(t.reservations[0].start_time,'10:00')});
 await test('其他人不能修改团主预约',async()=>{seed('seminar_room',2,true);await assert.rejects(update({actor:{id:2,role:'student'}}),e=>e.httpStatus===403)});
 await test('MySQL修改检查个人其他房间冲突并回滚',async()=>{seed();other(101,1,2,'10:00','11:00');const calls=mysqlDriver();await assert.rejects(update(),e=>e.code==='PERSONAL_SLOT_CONFLICT');assert.equal(calls.some(c=>c[0]==='rollback'),true)});
 await test('MySQL共享修改保留独立槽并锁用户再锁房间',async()=>{seed('competition_room',2);const calls=mysqlDriver();await update();assert.equal(calls.find(c=>String(c[0]).startsWith('INSERT INTO reservation_slots'))[1][2],-100);const user=calls.findIndex(c=>String(c[0]).includes('FROM users'));const room=calls.findIndex(c=>String(c[0]).includes('FROM rooms'));assert.equal(user>=0&&user<room,true)});
 await test('MySQL团队修改锁每位成员并同步组团',async()=>{seed('seminar_room',2,true);const calls=mysqlDriver();await update({purpose:'新用途'});assert.deepEqual(calls.filter(c=>String(c[0]).includes('FROM users')&&String(c[0]).includes('FOR UPDATE')).map(c=>c[1][0]),[1,2]);assert.equal(calls.some(c=>String(c[0]).startsWith('UPDATE reservation_groups')),true)});
 process.exitCode=failures?1:0;
})();
