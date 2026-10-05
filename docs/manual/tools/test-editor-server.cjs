const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./serve-editor.cjs');

(async () => {
  const original = path.resolve(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-editor-test-'));
  const server = createServer(original, path.join(scratch, 'annotation-layouts.js'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const boxes = [{x:20,y:140,w:400,h:110},{x:402,y:150,w:60,h:39}];
    let res = await fetch(base+'/api/annotation-layouts', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({page:'student/room-list',boxes})});
    assert.equal(res.status, 200);
    assert.match(fs.readFileSync(path.join(scratch,'annotation-layouts.js'),'utf8'), /student\/room-list/);
    res = await fetch(base+'/api/annotation-layouts');
    assert.deepEqual((await res.json())['student/room-list'], boxes);
    res = await fetch(base+'/annotation-layouts.js');
    assert.match(await res.text(),/student\/room-list/);
    res = await fetch(base+'/api/annotation-layouts', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({page:'student/room-list',boxes:[{x:-1,y:0,w:20,h:20}]})});
    assert.equal(res.status, 400);
    res = await fetch(base+'/../../secret.txt');
    assert.equal(res.status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(scratch,{recursive:true,force:true}); }
  console.log('PASS: 标注保存、读取、错误数据拒绝与路径限制');
})().catch(error => {console.error(error);process.exitCode=1});
