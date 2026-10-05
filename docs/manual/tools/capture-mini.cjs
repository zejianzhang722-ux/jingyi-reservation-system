/* 在微信开发者工具模拟器中采集真实运行画面；不保存账号口令。 */
const fs = require('node:fs');
const path = require('node:path');
const automator = require('D:/工青协/volunteer-platform/.local/automation/node_modules/miniprogram-automator');
const { PNG } = require('D:/工青协/volunteer-platform/.local/automation/node_modules/pngjs');
const { stitchVertical, stitchHorizontal } = require('./capture-stitch.cjs');

const output = path.resolve(__dirname, '../assets/miniapp');
const endpoint = process.env.WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const tomorrow = new Date(Date.now() + 86400000);
const date = [tomorrow.getFullYear(), String(tomorrow.getMonth() + 1).padStart(2, '0'), String(tomorrow.getDate()).padStart(2, '0')].join('-');
const tabbed = new Set(['student-home','student-reservations','student-notifications','student-profile','admin-home','admin-manage','admin-profile']);
const pages = [
  ['student', 'login', '/pages/login/login'],
  ['student', 'home', '/pages/index/index'],
  ['student', 'room-list', '/pages/room-list/room-list'],
  ['student', 'room-detail', '/pages/room-detail/room-detail?roomId=6'],
  ['student', 'study-room', '/pages/study-room/study-room?roomId=1'],
  ['student', 'room-timeline', '/pages/room-timeline/room-timeline?roomId=6'],
  ['student', 'reservation-confirm', '/pages/reservation-confirm/reservation-confirm?roomId=6&date=' + date + '&startHour=10&startMin=0&endHour=12&endMin=0'],
  ['student', 'reservation-detail', '/pages/reservation-detail/reservation-detail?id=1'],
  ['student', 'reservations', '/pages/my-reservations/my-reservations'],
  ['student', 'notifications', '/pages/notifications/notifications'],
  ['student', 'profile', '/pages/profile/profile'],
  ['student', 'group-reserve', '/pages/group-reserve/group-reserve?roomId=21'],
  ['student', 'group-list', '/pages/group-list/group-list'],
  ['student', 'room-compare', '/pages/room-compare/room-compare?roomId=6'],
  ['student', 'qrcode', '/pages/qrcode/qrcode?id=1'],
  ['student', 'reading-room', '/pages/reading-room/reading-room'],
  ['student', 'poster-apply', '/pages/poster-apply/poster-apply'],
  ['student', 'credit-detail', '/pages/credit-detail/credit-detail'],
  ['student', 'feedback', '/pages/feedback/feedback'],
  ['student', 'rules', '/pages/rules/rules'],
  ['student', 'profile-edit', '/pages/profile-edit/profile-edit'],
  ['student', 'network-settings', '/pages/network-settings/network-settings'],
  ['student', 'subscribe-settings', '/pages/subscribe-settings/subscribe-settings'],
  ['admin', 'home', '/pages/admin-home/admin-home'],
  ['admin', 'manage', '/pages/admin-manage/admin-manage'],
  ['admin', 'reservation', '/pages/admin-reservation/admin-reservation'],
  ['admin', 'reservation-detail', '/pages/admin-reservation-detail/admin-reservation-detail?id=10'],
  ['admin', 'poster', '/pages/admin-poster/admin-poster'],
  ['admin', 'feedback', '/pages/admin-feedback/admin-feedback'],
  ['admin', 'users', '/pages/admin-users/admin-users'],
  ['admin', 'credit', '/pages/admin-credit/admin-credit'],
  ['admin', 'stats', '/pages/admin-stats/admin-stats'],
  ['admin', 'rooms', '/pages/admin-rooms/admin-rooms'],
  ['admin', 'profile', '/pages/admin-profile/admin-profile']
];

async function login(kind) {
  const base = process.env.MANUAL_API_BASE || 'http://127.0.0.1:3000/api/v1';
  const body = kind === 'student'
    ? { studentNo: process.env.MANUAL_STUDENT_NO, cardNo: process.env.MANUAL_CARD_NO }
    : { username: process.env.MANUAL_ADMIN_USER, password: process.env.MANUAL_ADMIN_PASSWORD };
  if (Object.values(body).some(value => !value)) throw new Error(kind + ' capture credentials are missing');
  const res = await fetch(base + (kind === 'student' ? '/auth/login/student' : '/auth/login/admin-miniapp'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok || !json.data?.token) throw new Error(kind + ' login failed: ' + (json.message || res.status));
  return json.data;
}

async function captureFullPage(mini, page, kind, id, file) {
  const system = await mini.systemInfo();
  const frames = [];
  const scrollHeight = () => page.size().then(size => Number(size.height));
  const windowHeight = Number(system.windowHeight);
  if (!Number.isFinite(windowHeight) || windowHeight < 1) throw Error('无法读取模拟器可滚动高度');
  await mini.pageScrollTo(0);
  await page.waitFor(180);
  let height = await scrollHeight();
  if (process.env.MANUAL_CAPTURE_DEBUG) console.log('METRICS',kind,id,'window',windowHeight,'content',height);
  let lastTop = -1;
  for (let i = 0; i < 80; i++) {
    const top = Number(await page.scrollTop()) || 0;
    if (process.env.MANUAL_CAPTURE_DEBUG) console.log('FRAME',kind,id,i,'top',top,'height',height);
    if (top === lastTop && top < Math.max(0, height - windowHeight - 2)) throw Error('页面尚未到底部，但滚动位置未变化');
    const png = PNG.sync.read(Buffer.from(await mini.screenshot(), 'base64'));
    const pxPerCss = png.width / Number(system.screenWidth);
    frames.push({ image: png, offset: Math.round(top * pxPerCss) });
    lastTop = top;
    height = await scrollHeight();
    const maxTop = Math.max(0, height - windowHeight);
    if (top >= maxTop - 2) break;
    const target = Math.min(maxTop, top + Math.floor(windowHeight * 0.68));
    if (process.env.MANUAL_CAPTURE_DEBUG) console.log('SCROLL',kind,id,target);
    await mini.pageScrollTo(target);
    await page.waitFor(220);
    if (i === 79) throw Error('滚动超过80次，无法确认页面底部');
  }
  const first = frames[0].image;
  const ratio = first.width / Number(system.screenWidth);
  const full = frames.length === 1 ? first : stitchVertical(frames, {
    total: frames[frames.length-1].offset + first.height,
    fixedStart: Math.round((Number(system.screenHeight)-windowHeight)*ratio),
    fixedEnd: tabbed.has(kind+'-'+id) ? Math.round(104*ratio) : Math.round(34*ratio)
  });
  if (file) fs.writeFileSync(file, PNG.sync.write(full));
  await mini.pageScrollTo(0);
  return { image:full, width:full.width, height:full.height, viewportHeight:first.height, frames:frames.length, scrollHeight:height, fullPage:true };
}

function cropImage(source,x,y,width,height) {
  const out=new PNG({width,height});
  for(let row=0;row<height;row++)source.data.copy(out.data,row*width*4,((y+row)*source.width+x)*4,((y+row)*source.width+x+width)*4);
  return out;
}

async function captureTimelinePanorama(mini,page,kind,id,firstImage) {
  const component=await page.$('timeline');
  const scroller=component&&await component.$('.timeline-scroll-x');
  if(!scroller)return null;
  const system=await mini.systemInfo(),size=await scroller.size(),offset=await scroller.offset();
  const viewport=Number(size.width),scrollWidth=Number(await scroller.scrollWidth());
  if(scrollWidth<=viewport+2)return null;
  const ratio=firstImage.width/Number(system.screenWidth);
  const left=Math.round(Number(offset.left)*ratio),top=Math.round((Number(offset.top)+Number(system.screenHeight)-Number(system.windowHeight))*ratio);
  const width=Math.min(Math.round(viewport*ratio),firstImage.width-left),height=Math.min(Math.round(Number(size.height)*ratio),firstImage.height-top);
  if(width<20||height<20||left<0||top<0)throw Error('时间轴区域的截图坐标无效');
  const frames=[{image:cropImage(firstImage,left,top,width,height),offset:0}];
  let last=0;
  for(let i=0;i<40;i++){
    const target=Math.min(scrollWidth-viewport,last+Math.max(30,Math.floor(viewport*.68)));
    if(target<=last+1)break;
    await scroller.scrollTo(target,0);
    await page.waitFor(250);
    const actual=Number(await scroller.property('scrollLeft'));
    if(!Number.isFinite(actual)||actual<=last+1)throw Error('时间轴右滑后位置未变化');
    const captured=await captureFullPage(mini,page,kind,id,null);
    frames.push({image:cropImage(captured.image,left,top,width,height),offset:Math.round(actual*ratio)});
    last=actual;
    if(actual>=scrollWidth-viewport-2)break;
    if(i===39)throw Error('时间轴横向滚动超过40次');
  }
  const result=stitchHorizontal(frames,{total:frames[frames.length-1].offset+width});
  const file=path.join(output,kind+'-'+id+'-timeline-panorama.png');
  fs.writeFileSync(file,PNG.sync.write(result));
  await scroller.scrollTo(0,0);
  return {file:path.relative(path.resolve(__dirname,'..'),file).replace(/\\/g,'/'),width:result.width,height:result.height,frames:frames.length,scrollWidth};
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const mini = await automator.connect({ wsEndpoint: endpoint });
  const results = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const current = await mini.currentPage().catch(() => null);
      if (current?.path) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw Error('开发者工具未加载出小程序首页');
    for (const kind of ['student', 'admin']) {
      const auth = await login(kind);
      await mini.evaluate(data => {
        wx.setStorageSync('token', data.token);
        wx.setStorageSync('refreshToken', data.refreshToken);
        wx.setStorageSync('userInfo', data.userInfo);
        const app = getApp();
        app.globalData.token = data.token;
        app.globalData.refreshToken = data.refreshToken;
        app.globalData.userInfo = data.userInfo;
      }, auth);
      const selectedIds = process.env.MANUAL_CAPTURE_ID?.split(',').map(id => id.trim());
      const selected = pages.filter(row => row[0] === kind && (!selectedIds || selectedIds.includes(row[1])));
      for (const [pageKind, id, route] of selected) {
        try {
          const page = await mini.reLaunch(route);
          await page.waitFor(650);
          if (pageKind === 'student' && (id === 'study-room' || id === 'room-timeline')) {
            await page.waitFor(5300);
            await page.callMethod('onRulesScrollToLower');
            await page.callMethod('onRulesAgreeChange');
            await page.callMethod('onRulesConfirm');
            await page.waitFor(350);
          }
          const current = (await mini.currentPage()).path;
          if (current !== route.split('?')[0].replace(/^\//, '')) throw new Error('redirected to ' + current);
          const file = path.join(output, pageKind + '-' + id + '.png');
          const {image,...capture}=await captureFullPage(mini, page, pageKind, id, file);
          if(pageKind==='student'&&(id==='study-room'||id==='room-timeline'))capture.horizontal=await captureTimelinePanorama(mini,page,pageKind,id,image);
          results.push({ kind, id, route, file: path.relative(path.resolve(__dirname, '..'), file).replace(/\\/g, '/'), ok: true, capture });
          console.log('CAPTURED', kind, id);
        } catch (error) {
          results.push({ kind, id, route, ok: false, error: error.message });
          console.log('FAILED', kind, id, error.message);
        }
      }
    }
  } finally {
    const manifest = path.join(output, 'manifest.json');
    const previous = process.env.MANUAL_CAPTURE_ID && fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : [];
    const merged = previous.filter(row => !results.some(next => next.kind === row.kind && next.id === row.id)).concat(results);
    fs.writeFileSync(manifest, JSON.stringify(merged, null, 2));
    await mini.close().catch(() => {});
  }
  const failed = results.filter(row => !row.ok);
  console.log(JSON.stringify({ captured: results.length - failed.length, failed: failed.length }));
  if (failed.length) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
