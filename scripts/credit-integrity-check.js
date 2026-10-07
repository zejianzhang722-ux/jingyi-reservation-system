const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const config = require('../server/src/config');
let user, logs, notices;
const db = { query: async (sql, params = []) => {
  if (/SELECT.*FROM users/.test(sql)) return [[user]];
  if (/SELECT.*FROM credits_log/.test(sql)) return [logs.slice().sort((a,b) => b.id-a.id).slice(0,20)];
  if (/UPDATE users SET status = \?/.test(sql)) { user.status=params[0];user.restricted_until=params[1]; }
  if (/UPDATE users SET credit_score/.test(sql)) user.credit_score = params[0];
  if (/UPDATE users SET status = 'banned'/.test(sql)) { user.status = 'banned'; user.restricted_until = params[0]; }
  if (/UPDATE users SET status = 'restricted'/.test(sql) && user.status !== 'banned') { user.status = 'restricted'; user.restricted_until = params[0]; }
  if (/INSERT INTO credits_log/.test(sql)) { logs.push({ id: logs.length+1, score_change:params[1], score_after:params[2] }); return [{insertId: logs.length}]; }
  return [{affectedRows:1}];
}};
function load(relative, extras = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  vm.runInNewContext(source, { module, exports: module.exports, require: (name) => {
    if (name === '../config/database') return db;
    if (name === '../config/logger') return {info(){},error(){},warn(){}};
    if (name === '../config') return config;
    if (name === '../services/creditService') return credit;
    if (name === './creditBookingPolicy' || name === '../services/creditBookingPolicy') return require('../server/src/services/creditBookingPolicy');
    if (name === './notificationService') return {createNotification:async (...args) => notices.push(args)};
    if (name === '../utils/response') return require('../server/src/utils/response');
    if (extras[name]) return extras[name];
    if (name === 'crypto') return require('node:crypto');
    return {};
  }, Date, Number, console });
  return module.exports;
}
const credit = load('server/src/services/creditService.js');
const controller = load('server/src/controllers/userController.js', {'../services/creditService':credit});
const auth = load('server/src/controllers/authController.js', {'jsonwebtoken':{sign:()=> 'token'},'../config/redis':{set:async()=>{}}});
async function call(handler, req) { let body; await handler(req,{status(){return this},json(value){body=value;return this}}); return body; }
let failures = 0;
async function test(name, fn) { try { await fn(); console.log('PASS '+name); } catch(e) { failures++; console.error('FAIL '+name+': '+e.message); } }
(async()=>{
  user={id:1,credit_score:119,status:'active'}; logs=[]; notices=[];
  await test('119加5只记实际加1',async()=>{await credit.addCredit(1,5,'good','good');assert.equal(logs[0].score_change,1);assert.equal(user.credit_score,120)});
  user={id:1,credit_score:2,status:'active'}; logs=[];
  await test('2扣20只记实际扣2',async()=>{await credit.addCredit(1,-20,'noshow','miss');assert.equal(logs[0].score_change,-2);assert.equal(user.credit_score,0)});
  user={id:1,credit_score:0,status:'active'};logs=[{id:1,score_change:50,score_after:120}];
  await test('明细使用实际分数和日志快照',async()=>{const r=await call(controller.getCredit,{user:{id:1}});assert.equal(r.data.creditScore,0);assert.equal(r.data.records[0].score_after,120)});
  await test('登录保留零分',async()=>{const r=await call(auth.studentLogin,{body:{studentNo:'2024001001',cardNo:'200001'}});assert.equal(r.data.userInfo.credit_score,0)});
  for (const [score, level] of [[80,'good'],[79,'warning'],[60,'warning'],[59,'restricted'],[30,'restricted'],[29,'banned']]) await test('阈值 '+score,async()=>assert.equal(credit.getCreditLevel(score),level));
  user={id:1,credit_score:50,status:'restricted',restricted_until:new Date(Date.now()+86400000)};notices=[];
  await test('恢复加分不延长现有限制',async()=>{const before=user.restricted_until;await credit.addCredit(1,3,'reward','reward');assert.equal(user.restricted_until,before);assert.equal(notices.length,0)});
  for (const [before,change,status,notice] of [[80,-1,'active','credit_restricted'],[60,-1,'active','credit_restricted'],[30,-1,'active','credit_restricted']]) await test('实际扣分仅更新预约权限 '+status,async()=>{user={id:1,credit_score:before,status:'active'};logs=[];notices=[];await credit.addCredit(1,change,'penalty','test');assert.equal(user.status,status);assert.equal(notices[0][1],notice)});
  await test('一般加分在事务内更新并提交',async()=>{
    user={id:1,credit_score:100,status:'active'};logs=[];const events=[];
    db.getConnection=async()=>({query:db.query,beginTransaction:async()=>events.push('begin'),commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),release:()=>events.push('release')});
    await credit.addCredit(1,5,'reward','test');assert.deepEqual(events,['begin','commit','release']);delete db.getConnection;
  });
  await test('信用接口提供与执行一致的规则',async()=>{const r=await call(controller.getCredit,{user:{id:1}});assert.equal(r.data.rules.maxScore,120);assert.equal(r.data.rules.banThreshold,30)});
  let page, modal;
  const pageSource=fs.readFileSync(path.join(root,'miniapp/pages/credit-detail/credit-detail.js'),'utf8');
  vm.runInNewContext(pageSource,{Page: value=>page=value,require:name=>name.endsWith('/dialog')?{show:(_,value)=>{modal={content:value.sections.map(s=>s.title+'\n'+s.items.join('\n')).join('\n')}}}:name.endsWith('/credit-rules-presenter')?require('../miniapp/utils/credit-rules-presenter'):({}),wx:{showModal:value=>modal=value,showToast(){}},Number,Object,isNaN});
  await test('规则入口可弹出当前实际阈值',async()=>{const instance=Object.assign({},page,{data:{creditRules:credit.getCreditRules()}});instance.showCreditRules();assert.match(modal.content,/0–29分/);assert.match(modal.content,/09:00–17:00/);assert.match(modal.content,/不限制登录/);assert.match(modal.content,/最高120分/)});
  process.exitCode=failures?1:0;
})();
