const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require(process.env.MINIPROGRAM_AUTOMATOR_PATH || 'miniprogram-automator');
const base = 'http://127.0.0.1:3000/api/v1';
const dir = path.resolve(__dirname, '../.artifacts/admin-mobile');
async function main() {
  fs.mkdirSync(dir, {recursive:true});
  const mini = await automator.connect({wsEndpoint:'ws://127.0.0.1:9420'}), exceptions = [], pages = [];
  mini.on('exception', error => exceptions.push(error));
  const backup = await mini.evaluate(() => ({token:wx.getStorageSync('token'),refreshToken:wx.getStorageSync('refreshToken'),userInfo:wx.getStorageSync('userInfo')}));
  async function login(username,password) {
    const res = await fetch(base+'/auth/login/admin-miniapp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}).then(r=>r.json());
    assert.equal(res.code,200);
    await mini.evaluate(data => {wx.setStorageSync('token',data.token);wx.setStorageSync('refreshToken',data.refreshToken);wx.setStorageSync('userInfo',data.userInfo);Object.assign(getApp().globalData,data)},res.data);
  }
  async function open(name,query='') {
    const page = await mini.reLaunch('/pages/'+name+'/'+name+query); await page.waitFor(1200);
    assert.equal((await mini.currentPage()).path,'pages/'+name+'/'+name);
    pages.push(name); return page;
  }
  async function shot(name) {await mini.screenshot({path:path.join(dir,name+'.png')});}
  async function dialogData() {return mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#app-dialog').data);}
  try {
    await login('superadmin','super123');
    let page = await open('admin-rooms');
    assert.ok((await page.data('visibleRooms')).length>10);
    assert.ok((await page.data('typeOptions')).length>=19);
    assert.ok(await page.$('picker'));
    await shot('01-rooms');
    await page.callMethod('onSearch',{detail:{value:'D128'}});
    await page.waitFor(400); assert.equal((await page.data('visibleRooms'))[0].status,'counselor_only');
    await (await page.$('.room-item')).tap(); await page.waitFor(1500);page=await mini.currentPage();
    assert.equal(page.path,'pages/admin-room-detail/admin-room-detail');await page.waitFor(700);
    assert.equal(await page.data('canConfigure'),true);await shot('02-room-detail');
    await page.callMethod('onEdit');await page.waitFor(300);
    assert.equal((await dialogData()).fields.filter(f=>f.type==='time').length,2);await shot('03-room-edit');
    await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#app-dialog').onCancel());
    await page.callMethod('onSchedule');await page.waitFor(700);assert.equal((await dialogData()).visible,true);await shot('04-schedule');
    page=await open('admin-users');assert.ok((await page.data('list')).every(row=>row.statusText!=='restricted'));await shot('05-users');
    page=await open('admin-credit','?tab=blacklist');assert.ok(await page.$('picker'));await shot('06-credit');
    const list=await page.data('blacklist');assert.ok(list.length);
    await page.callMethod('onViewCredit',{currentTarget:{dataset:{id:list[0].id}}});await page.waitFor(800);assert.equal((await dialogData()).title,'宿生信用详情');await shot('07-credit-detail');
    await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#app-dialog').onCancel());
    await page.callMethod('onSetCredit',{currentTarget:{dataset:{id:list[0].id}}});assert.equal((await dialogData()).fields.length,3);await shot('08-credit-setting');
    page=await open('admin-poster');const posters=await page.data('list');assert.ok(posters.length);assert.ok(await page.$('.poster-detail-button'));await shot('09-posters');
    await page.callMethod('onViewDetail',{currentTarget:{dataset:{id:posters[0].id}}});await page.waitFor(300);assert.equal((await dialogData()).sections.length,2);await shot('10-poster-detail');
    await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#app-dialog').onCancel());
    await page.callMethod('onReject',{currentTarget:{dataset:{id:posters[0].id}}});assert.equal((await dialogData()).draft,'');await shot('11-reject');
    await login('admin','admin123');page=await open('admin-room-detail','?roomId=22');assert.equal(await page.data('canConfigure'),false);
    await page.callMethod('onEdit');assert.equal((await dialogData()).visible,false);
    const student=await fetch(base+'/auth/login/student',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentNo:'2024001001',cardNo:'200001'})}).then(r=>r.json());assert.equal(student.code,200);
    await mini.evaluate(data=>{wx.setStorageSync('token',data.token);wx.setStorageSync('userInfo',data.userInfo);Object.assign(getApp().globalData,data)},student.data);
    page=await open('credit-detail');await page.callMethod('showCreditRules');assert.equal((await dialogData()).sections.length,4);await shot('12-credit-rules');
    page=await open('study-room','?roomId=1');assert.ok((await page.data('rulesSections')).length>=5);await shot('13-room-rules');
    assert.equal(exceptions.length,0,JSON.stringify(exceptions));
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({ok:true,pages,exceptions,device:await mini.systemInfo()},null,2));
    console.log('PASS: real DevTools room/detail/time selectors, read-only schedule, resident labels, credit search/detail/settings, poster/detail/rejection and structured rules; no runtime exceptions');
  } finally {
    await mini.evaluate(data=>{['token','refreshToken','userInfo'].forEach(key=>{if(data[key])wx.setStorageSync(key,data[key]);else wx.removeStorageSync(key)});Object.assign(getApp().globalData,data)},backup).catch(()=>{});
    await mini.reLaunch('/pages/admin-manage/admin-manage').catch(()=>{});mini.disconnect();
  }
}
main().catch(err=>{console.error(err);process.exitCode=1});
