/* 采集网页后台实跑页面。账号口令通过环境变量传入，不写入手册。 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('D:/工青协/volunteer-platform/.tools/browser-qa/node_modules/playwright-core');

const output = path.resolve(__dirname, '../assets/web');
const base = process.env.MANUAL_WEB_BASE || 'http://127.0.0.1:5173';
const routes = [
  ['dashboard', '/dashboard'],
  ['reservation-pending', '/reservation/pending'],
  ['reservation-all', '/reservation/all'],
  ['reservation-counselor', '/reservation/counselor'],
  ['reservation-groups', '/reservation/groups'],
  ['checkin-manage', '/checkin/manage'],
  ['reading-room-logs', '/reading-room/logs'],
  ['room-monitor', '/room/monitor'],
  ['room-manage', '/room/manage'],
  ['building-manage', '/building/manage'],
  ['room-seats', '/room/seats'],
  ['room-rules', '/room/rules'],
  ['account', '/account'],
  ['credit-violations', '/credit/violations'],
  ['credit-blacklist', '/credit/blacklist'],
  ['credit-config', '/credit/config'],
  ['stats-overview', '/stats/overview'],
  ['stats-export', '/stats/export'],
  ['poster-pending', '/poster/pending'],
  ['poster-position', '/poster/position'],
  ['feedback', '/feedback'],
  ['system-announcements', '/system/announcements'],
  ['system-logs', '/system/logs'],
  ['system-backup', '/system/backup']
];

async function revealFullPage(page) {
  return page.evaluate(async () => {
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const sweep=async el=>{
      const step=Math.max(300,Math.round(el.clientHeight*.75));
      for(let y=0;y<el.scrollHeight-el.clientHeight;y+=step){el.scrollTop=y;await pause(55);}
      el.scrollTop=el.scrollHeight;
      await pause(90);
      el.scrollTop=0;
    };
    document.querySelectorAll('*').forEach(el=>{el.style.animation='none';el.style.transition='none';el.style.scrollSnapType='none';});
    await sweep(document.scrollingElement);
    const nested=[...document.querySelectorAll('*')].filter(el=>{
      const css=getComputedStyle(el);
      return !el.closest('aside,nav,.sidebar,.el-aside')&&el.scrollHeight>el.clientHeight+8&&/(auto|scroll|hidden)/.test(css.overflowY);
    });
    for(const el of nested)await sweep(el);
    const horizontal=[...document.querySelectorAll('*')].filter(el=>{
      const css=getComputedStyle(el);
      return !el.closest('aside,nav,.sidebar,.el-aside')&&el.scrollWidth>el.clientWidth+8&&/(auto|scroll|hidden)/.test(css.overflowX);
    });
    for(const el of horizontal){for(let x=0;x<el.scrollWidth-el.clientWidth;x+=Math.max(300,el.clientWidth*.75)){el.scrollLeft=x;await pause(55);}el.scrollLeft=0;}
    for(const el of nested){el.style.setProperty('height',el.scrollHeight+'px','important');el.style.setProperty('max-height','none','important');el.style.setProperty('overflow-y','visible','important');}
    for(const el of horizontal){el.style.setProperty('width',el.scrollWidth+'px','important');el.style.setProperty('max-width','none','important');el.style.setProperty('overflow-x','visible','important');}
    for(const el of [...nested,...horizontal])for(let parent=el.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
      if(parent.closest('aside,nav,.sidebar,.el-aside'))break;
      parent.style.setProperty('max-height','none','important');
      parent.style.setProperty('overflow','visible','important');
      if(parent.scrollHeight>parent.clientHeight+8)parent.style.setProperty('height','auto','important');
    }
    await sweep(document.scrollingElement);
    await document.fonts.ready;
    await Promise.all([...document.images].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;})));
    window.scrollTo(0,0);
    return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,nested:nested.length,horizontal:horizontal.length};
  });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MANUAL_CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check']
  });
  const results = [];
  try {
    const publicPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await publicPage.goto(base + '/login', { waitUntil: 'domcontentloaded' });
    await publicPage.waitForFunction(() => (document.querySelector('#app')?.textContent || '').trim().length > 20, null, { timeout: 20000 });
    await publicPage.waitForTimeout(1500);
    await publicPage.screenshot({ path: path.join(output, 'login.png'), fullPage: true });
    results.push({ id: 'login', route: '/login', file: 'assets/web/login.png', ok: true });
    await publicPage.close();

    const username = process.env.MANUAL_ADMIN_USER;
    const password = process.env.MANUAL_ADMIN_PASSWORD;
    if (!username || !password) throw new Error('MANUAL_ADMIN_USER and MANUAL_ADMIN_PASSWORD are required');
    const response = await fetch('http://127.0.0.1:3000/api/v1/auth/login/admin', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password })
    });
    const auth = (await response.json()).data;
    if (!auth?.token) throw new Error('admin login failed');

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript(data => {
      localStorage.setItem('token', data.token);
      localStorage.setItem('userInfo', JSON.stringify(data.userInfo));
    }, auth);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [id, route] of routes.filter(row => !process.env.MANUAL_CAPTURE_ID || row[0] === process.env.MANUAL_CAPTURE_ID)) {
      try {
        errors.length = 0;
        await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => (document.querySelector('#app')?.textContent || '').trim().length > 20, null, { timeout: 20000 });
        await page.waitForTimeout(500);
        if (id === 'room-seats') {
          await page.getByText('请选择功能房', { exact: true }).click();
          await page.getByText('B228自习室', { exact: true }).last().click();
          await page.waitForTimeout(500);
        }
        if (new URL(page.url()).pathname !== route) throw new Error('redirected to ' + page.url());
        if (errors.length) throw new Error('page error: ' + errors.join(' | '));
        const file = path.join(output, id + '.png');
        const capture=await revealFullPage(page);
        await page.screenshot({ path: file, fullPage: true, animations: 'disabled', timeout: 60000 });
        const header=fs.readFileSync(file).subarray(0,24);
        capture.imageWidth=header.readUInt32BE(16);capture.imageHeight=header.readUInt32BE(20);
        results.push({ id, route, file: 'assets/web/' + id + '.png', ok: true, title: await page.title(), capture });
        console.log('CAPTURED', id);
      } catch (error) {
        results.push({ id, route, ok: false, error: error.message });
        console.log('FAILED', id, error.message);
      }
    }
    await context.close();
  } finally {
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(results, null, 2));
    await browser.close();
  }
  const failures = results.filter(row => !row.ok);
  console.log(JSON.stringify({ captured: results.length - failures.length, failed: failures.length }));
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
