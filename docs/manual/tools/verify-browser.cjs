const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('D:/工青协/volunteer-platform/.tools/browser-qa/node_modules/playwright-core');

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--disable-gpu', '--no-first-run'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const file = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  await page.goto(file, { waitUntil: 'load' });
  const all = await page.evaluate(() => window.MANUAL.pages.map(p => ({ role:p.role, id:p.id, title:p.title })));
  for (const item of all) {
    await page.goto(file + `#/${item.role}/${item.id}`, { waitUntil: 'load' });
    await page.locator('.screen-image').waitFor();
    const actual = await page.evaluate(() => ({
      title:document.querySelector('article h1')?.textContent,
      imageOk:document.querySelector('.screen-image')?.naturalWidth > 0,
      sections:document.querySelectorAll('.manual-section').length,
      boxes:[...document.querySelectorAll('.annotation')].every(el => el.style.left && el.style.top && el.style.width && el.style.height),
      flow:document.querySelectorAll('.flow-node').length,
      links:document.querySelectorAll('.related-link[href^="#/"]').length,
      alignment:(()=>{const img=document.querySelector('.screen-image'),stage=img.parentElement,ir=img.getBoundingClientRect(),sr=stage.getBoundingClientRect();return {heightGap:Math.abs(ir.height-sr.height),boxGap:Math.max(...[...stage.querySelectorAll('.annotation')].map(box=>Math.abs(box.getBoundingClientRect().top-ir.top-Number(box.dataset.y)/img.naturalHeight*ir.height)))};})()
    }));
    assert.equal(actual.title, item.title, `${item.role}/${item.id} 标题错误`);
    assert(actual.imageOk && actual.sections >= 5 && actual.boxes && actual.flow >= 4 && actual.links >= 1, `${item.role}/${item.id} 内容不完整 ${JSON.stringify(actual)}`);
    assert(actual.alignment.heightGap<1&&actual.alignment.boxGap<1.5,`${item.role}/${item.id} 截图与标注坐标未对齐 ${JSON.stringify(actual.alignment)}`);
    if(item.role==='student'&&['study-room','room-timeline'].includes(item.id)){
      const panorama=page.locator('.panorama img');
      await panorama.scrollIntoViewIfNeeded();
      await panorama.evaluate(img=>img.decode());
      assert(await panorama.evaluate(img=>img.naturalWidth>488),'横向全览未加载完整');
    }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.goto(file + (process.env.MANUAL_PREVIEW_HASH || '#/student/room-detail'));
  if (process.env.MANUAL_PREVIEW) await page.screenshot({ path: process.env.MANUAL_PREVIEW, fullPage: true });
  await page.goto(file + '#/student/room-detail');
  await page.locator('.related-link[href="#/student/group-reserve"]').click();
  assert.equal(new URL(page.url()).hash, '#/student/group-reserve', '预约到组团的关联跳转失败');
  await page.goto(file + '#/student/find-room');
  assert.equal(await page.locator('article h1').textContent(), '功能房列表', '旧版资料库链接未正确转到新版页面');
  await page.goto(file + '#/student/qrcode');
  await page.locator('.qr-mask').waitFor({state:'visible'});
  await page.goto(file + '#/student/room-list');
  await page.locator('.annotation-key').first().hover();
  assert(await page.locator('.annotation-key').first().evaluate(el => el.classList.contains('selected')), '指向说明卡时没有突出说明卡');
  assert(await page.locator('.annotation').first().evaluate(el => el.classList.contains('selected')), '指向说明卡时没有同步突出标注框');
  await page.locator('.annotation').last().focus();
  assert(await page.locator('.annotation-key').last().evaluate(el => el.classList.contains('selected')), '键盘选中标注框时没有同步突出说明卡');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  assert(await page.locator('#roleSwitch').evaluate(el => { const r=el.getBoundingClientRect(); return r.top >= 70 && r.bottom < innerHeight; }), '滚动长文后无法直接切换使用端');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(file + '#/mobile-admin/home');
  await page.locator('#menuToggle').click();
  assert(await page.locator('#sidebar').evaluate(el => el.classList.contains('open')), '手机目录未打开');
  await browser.close();
  console.log(`PASS: 浏览器逐页打开 ${all.length} 页，截图/标注/流程/关联跳转与手机目录正常`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
