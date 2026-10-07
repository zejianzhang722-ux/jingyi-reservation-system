const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..','docs','manual'),ctx={window:{}};vm.createContext(ctx);
for(const name of ['data.js','pages.js','annotation-layouts.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx);
const manual=ctx.window.MANUAL,ids=['rooms','users','credit','poster','room-detail','room-base-status','room-timed-status','credit-setting'];let count=0;
for(const page of manual.pages)assert(page.annotations.length>0,page.role+'/'+page.id+'缺少截图定位');
for(const id of ids){const page=manual.pages.find(p=>p.role==='mobile-admin'&&p.id===id);assert(page);const png=fs.readFileSync(path.join(root,page.screenshot)),width=png.readUInt32BE(16),height=png.readUInt32BE(20),saved=manual.annotationLayouts['mobile-admin/'+id];assert.equal(saved.length,page.annotations.length);assert.equal(page.layout.length,page.annotations.length);for(const [i,box]of page.annotations.entries()){assert(box.label&&box.detail&&box.guide,'每个标注必须有名称、说明和对应操作');assert(box.x>=0&&box.y>=0&&box.w>0&&box.h>0&&box.x+box.w<=width&&box.y+box.h<=height,id+'标注超出图片');assert.deepEqual(JSON.parse(JSON.stringify(saved[i])),{x:box.x,y:box.y,w:box.w,h:box.h});count++}}
assert(fs.readFileSync(path.join(root,'app-visual.js'),'utf8').includes('b.guide||page.steps['));
console.log('PASS 63页均有标注；更新8页共'+count+'个定位，独立操作说明、截图边界与校准数据一致');
