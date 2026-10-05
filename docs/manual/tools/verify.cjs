const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const context = { window: {} };
for (const file of ['data.js', 'pages.js', 'annotation-layouts.js']) vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
const pages = context.window.MANUAL.pages;
assert(Array.isArray(pages), '需要逐页内容清单');
const mini = JSON.parse(fs.readFileSync(path.join(root, 'assets/miniapp/manifest.json')));
const web = JSON.parse(fs.readFileSync(path.join(root, 'assets/web/manifest.json')));
const expected = [...mini.map(row => `${row.kind === 'admin' ? 'mobile-admin' : row.kind}/${row.id}`), ...web.map(row => `web-admin/${row.id}`)];
const longMiniPages = new Set(['student/poster-apply', 'student/room-list', 'student/rules', 'mobile-admin/reservation-detail', 'mobile-admin/manage']);
const keys = new Set(pages.map(page => `${page.role}/${page.id}`));
const saved=context.window.MANUAL.annotationLayouts||{};
assert.equal(keys.size, pages.length, '页面标识不可重复');
for (const key of expected) assert(keys.has(key), `缺少实机页面 ${key}`);
for (const page of pages) {
  const key = `${page.role}/${page.id}`;
  for (const prop of ['title', 'category', 'summary', 'route', 'note', 'screenshot']) assert(page[prop], `${key} 缺少 ${prop}`);
  assert(fs.existsSync(path.join(root, page.screenshot)), `${key} 截图不存在`);
  assert(page.steps.length >= 2, `${key} 缺少分步说明`);
  assert(page.layout.length >= 2, `${key} 缺少版式区域`);
  assert(page.annotations.length >= 2, `${key} 缺少截图标注`);
  assert(page.flow.nodes.length >= 3, `${key} 缺少流程节点`);
  assert(page.flow.edges.length >= 2, `${key} 缺少流程连线`);
  const png = fs.readFileSync(path.join(root, page.screenshot));
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a', `${key} 截图无效`);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const manifest=(page.role==='web-admin'?web:mini).find(row=>row.id===page.id&&(page.role==='web-admin'||row.kind===(page.role==='student'?'student':'admin')));
  assert(manifest?.ok,`${key} 截图采集未成功`);
  if(page.role!=='web-admin')assert(manifest.capture?.fullPage,`${key} 缺少整页采集记录`);
  if (longMiniPages.has(key)) assert(height > 1052, `${key} 仍是 1052 像素的首屏截图`);
  const boxes=saved[key]||page.annotations;
  assert.equal(boxes.length,page.annotations.length,`${key} 保存的标注数量不符`);
  for (const box of boxes) {
    if(!saved[key])assert(box.label && box.detail, `${key} 标注无说明`);
    assert(box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= width && box.y + box.h <= height, `${key} 标注超出截图 ${JSON.stringify(box)}`);
  }
  for (const link of page.links) assert(keys.has(link), `${key} 无效跳转 ${link}`);
}
for(const id of ['study-room','room-timeline']){
  const entry=mini.find(row=>row.kind==='student'&&row.id===id);
  assert(entry.capture.horizontal?.frames>1,`student/${id} 缺少横向滑动采集`);
  const image=fs.readFileSync(path.join(root,entry.capture.horizontal.file));
  assert(image.readUInt32BE(16)>488,`student/${id} 时间轴仍只有首屏宽度`);
}
console.log(`PASS: ${pages.length} 页、${expected.length} 张实机截图、逐页标注/版式/步骤/流程/跳转齐全`);
