const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.MOCK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-noshow-rollback-'));
const mock = require('../server/src/config/mock-db');
const dbPath = require.resolve('../server/src/config/database');
const db = { isMock: () => true, query: mock.query };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
const lifecycle = require('../server/src/services/reservationLifecycleService');
const realtime = require('../server/src/services/realtimeEventService');
const notifications = require('../server/src/services/notificationService');
const t = mock.__tables;
const originalPublish = realtime.publishReservationRoomsSafely;
const originalNotice = notifications.createNotification;
function seed(score=100) {
  db.query = mock.query; realtime.publishReservationRoomsSafely = async () => {}; notifications.createNotification = async () => {};
  t.users = [{id:1,credit_score:score,status:'active'},{id:2,credit_score:100,status:'active'}];
  t.reservations = [{id:9901,user_id:1,room_id:1,date:'2020-01-01',start_time:'10:00:00',end_time:'11:00:00',status:'approved',version:1}];
  t.reservation_groups=[];t.reservation_waitlist=[];t.reservation_slots=[{id:1,reservation_id:9901}];t.checkins=[];t.credits_log=[];t.notifications=[];
}
const release = () => lifecycle.releaseAndPromote({reservationId:9901,nextStatus:'noshow',allowedCurrentStatuses:['approved']});
let failures=0;async function test(name,fn){try{await fn();console.log('PASS '+name)}catch(e){failures++;console.error('FAIL '+name+': '+e.message)}}
(async()=>{
  await test('日志写入失败恢复预约和用户信用',async()=>{
    seed();db.query=async(sql,params)=>{if(sql.startsWith('INSERT INTO credits_log'))throw new Error('credit log unavailable');return mock.query(sql,params)};
    await assert.rejects(release(),/credit log unavailable/);assert.equal(t.reservations[0].status,'approved');assert.equal(Number(t.users[0].credit_score),100);assert.equal(t.credits_log.length,0);assert.equal(t.reservation_slots.length,1);
  });
  await test('扣分日志写入失败只移除本次日志并保留其他用户更新',async()=>{
    seed(60);db.query=async(sql,params)=>{if(sql.startsWith('INSERT INTO credits_log')){await mock.query(sql,params);t.users[1].credit_score=90;t.credits_log.push({id:9999,user_id:2,type:'violation',related_id:500,score_change:-10,score_after:90});throw new Error('credit log update unavailable')}return mock.query(sql,params)};
    await assert.rejects(release(),/credit log update unavailable/);assert.equal(t.reservations[0].status,'approved');assert.equal(Number(t.users[0].credit_score),60);assert.equal(t.users[0].status,'active');assert.equal(Number(t.users[1].credit_score),90);assert.deepEqual(t.credits_log.map(l=>Number(l.user_id)),[2]);
  });
  await test('回滚保留同一用户无关奖励记录',async()=>{
    seed();db.query=async(sql,params)=>{if(sql.startsWith('INSERT INTO credits_log')){t.users[0].credit_score=Number(t.users[0].credit_score)+5;t.credits_log.push({id:9999,user_id:1,type:'good_behavior',score_change:5,score_after:85});throw new Error('credit log unavailable')}return mock.query(sql,params)};
    await assert.rejects(release(),/credit log unavailable/);assert.equal(Number(t.users[0].credit_score),105);assert.equal(t.credits_log.length,1);assert.equal(t.credits_log[0].type,'good_behavior');
  });
  await test('提交后发布异常不能撤销已扣分预约',async()=>{
    seed();realtime.publishReservationRoomsSafely=async()=>{throw new Error('realtime unavailable')};await assert.rejects(release(),/realtime unavailable/);assert.equal(t.reservations[0].status,'noshow');assert.equal(Number(t.users[0].credit_score),80);assert.equal(t.credits_log.length,1);
    realtime.publishReservationRoomsSafely=async()=>{};await lifecycle.detectNoshow(new Date('2026-10-07T12:00:00'));assert.equal(Number(t.users[0].credit_score),80);assert.equal(t.credits_log.length,1);
  });
  realtime.publishReservationRoomsSafely=originalPublish;notifications.createNotification=originalNotice;db.query=mock.query;
  process.exitCode=failures?1:0;
})();
