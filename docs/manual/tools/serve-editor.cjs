/* 仅在本机开放资料库与标注保存接口。 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadManual(root) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root,'data.js'),'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages.js'),'utf8'), context);
  return context.window.MANUAL.pages;
}
function readLayouts(file) {
  if (!fs.existsSync(file)) return {};
  const context = { window: { MANUAL: {} } };
  vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
  return JSON.parse(JSON.stringify(context.window.MANUAL.annotationLayouts || {}));
}
function createServer(root=path.resolve(__dirname,'..'), layoutFile=path.join(root,'annotation-layouts.js')) {
  const pages = loadManual(root);
  const pageMap = new Map(pages.map(page=>[page.role+'/'+page.id,page]));
  const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8'};
  function reply(res,status,body,type='application/json; charset=utf-8') {res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(typeof body==='string'?body:JSON.stringify(body));}
  return http.createServer(async (req,res)=>{
    const url = new URL(req.url,'http://127.0.0.1');
    if (url.pathname==='/api/annotation-layouts') {
      if (req.method==='GET') return reply(res,200,readLayouts(layoutFile));
      if (req.method!=='POST') return reply(res,405,{error:'只支持读取和保存'});
      try {
        let raw='';
        for await (const chunk of req) {raw+=chunk;if(raw.length>100000) throw Error('数据过大');}
        const data=JSON.parse(raw), page=pageMap.get(data.page);
        if(!page) throw Error('页面不存在');
        if(!Array.isArray(data.boxes)||data.boxes.length!==page.annotations.length) throw Error('标注数量不符');
        const image=path.join(root,page.screenshot);
        const header=Buffer.alloc(24);const fd=fs.openSync(image,'r');try{fs.readSync(fd,header,0,24,0);}finally{fs.closeSync(fd);}
        const width=header.readUInt32BE(16),height=header.readUInt32BE(20);
        const boxes=data.boxes.map(box=>{
          const values=['x','y','w','h'].map(key=>Number(box[key]));
          const [x,y,w,h]=values;
          if(values.some(n=>!Number.isFinite(n))||x<0||y<0||w<4||h<4||x+w>width+1||y+h>height+1) throw Error('标注超出截图范围');
          return {x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h)};
        });
        const layouts=readLayouts(layoutFile);
        layouts[data.page]=boxes;
        const pending=layoutFile+'.tmp';
        fs.writeFileSync(pending,'/* 标注校准器自动保存，坐标为截图原始像素。 */\nwindow.MANUAL.annotationLayouts = '+JSON.stringify(layouts,null,2)+';\n');
        fs.renameSync(pending,layoutFile);
        return reply(res,200,{ok:true,page:data.page,boxes});
      } catch(error) {return reply(res,400,{error:error.message});}
    }
    if(req.method!=='GET'&&req.method!=='HEAD') return reply(res,405,{error:'不支持该请求'});
    const allowed=/^(?:index\.html|styles\.css|visual\.css|data\.js|pages\.js|app-visual\.js|annotation-layouts\.js|tools\/annotation-editor\.html|tools\/annotation-editor\.js|tools\/annotation-editor\.css|assets\/(?:miniapp|web)\/[a-z0-9-]+\.(?:png|jpg|json))$/;
    let name;
    try {name=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';}catch{return reply(res,400,{error:'路径无效'});}
    if(!allowed.test(name)) return reply(res,404,{error:'文件不存在'});
    const file=name==='annotation-layouts.js'?layoutFile:path.join(root,name);
    if(!fs.existsSync(file)) return reply(res,404,{error:'文件不存在'});
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});
    if(req.method==='HEAD')return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
if(require.main===module){const port=Number(process.env.MANUAL_EDITOR_PORT)||4179;createServer().listen(port,'127.0.0.1',()=>console.log(`资料库与标注校准器：http://127.0.0.1:${port}/tools/annotation-editor.html`));}
module.exports={createServer};
