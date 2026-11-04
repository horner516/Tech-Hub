const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {startHub,loadConfig,definitions}=require('../hub/server.cjs');
test('all service pages get navigation; disabling persists and removes apps; in-app settings retain local and password gates',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-nav-'));const backends=[];let hub;
 try{
 const c=loadConfig(dir);c.host='127.0.0.1';c.adminPort=29400;
 for(const [i,d] of definitions.entries()){
  Object.assign(c.services[d.id],{port:29401+i,backendPort:29411+i});
  const b=http.createServer((req,res)=>{if(req.url==='/api/data'){res.setHeader('content-type','application/json');res.end('{"ok":true}');return;}res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><title>Fixture</title></head><body>Service</body></html>');});
  await new Promise(r=>b.listen(29411+i,'127.0.0.1',r));backends.push(b);
 }
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(c));hub=await startHub({dir,launch:false});
 const admin='http://127.0.0.1:29400',base=id=>'http://127.0.0.1:'+c.services[id].port;
 for(const d of definitions){const html=await fetch(base(d.id)).then(r=>r.text());assert.match(html,/\/__hub\/chrome.js/);assert.equal(html.includes('/__hub/theme.css'),['record','ultrix'].includes(d.id));const nav=await fetch(base(d.id)+'/__hub/navigation').then(r=>r.json());assert.equal(nav.current,d.id);assert.equal(nav.services.length,9);assert(!JSON.stringify(nav).includes('backendPort'));assert.deepEqual(await fetch(base(d.id)+'/api/data').then(r=>r.json()),{ok:true});}
 const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post(admin+'/api/enabled',{id:'power',enabled:false},{Origin:'http://evil.invalid'})).status,403);
 assert.equal((await post(admin+'/api/enabled',{id:'power',enabled:false})).status,200);
 assert.equal((await fetch(base('power'))).status,503);assert.match(await fetch(base('power')).then(r=>r.text()),/is off/);
 assert(!(await fetch(base('dsan')+'/__hub/navigation').then(r=>r.json())).services.some(s=>s.id==='power'));
 assert.equal(loadConfig(dir).services.power.enabled,false);
 assert.equal((await post(admin+'/api/enabled',{id:'power',enabled:true})).status,200);assert.equal((await fetch(base('power'))).status,200);
 const settings=base('record')+'/__hub/settings',initial=await fetch(settings),tag=initial.headers.get('etag'),config=await initial.json();config.pollIntervalMs=3500;
 assert.equal((await post(settings,config,{'If-Match':tag})).status,200);assert.equal((await post(settings,config,{'If-Match':tag})).status,409);assert.equal((await fetch(settings).then(r=>r.json())).pollIntervalMs,3500);
 assert.equal((await post(settings,config,{Origin:'http://evil.invalid'})).status,403);
 const status=await new Promise(resolve=>http.get(settings,{headers:{Host:'show.example:29405','x-techhub-local-client':'1'}},r=>{r.resume();resolve(r.statusCode);}));assert.equal(status,403);
 assert.equal((await post(admin+'/api/access',{id:'record',password:'test-settings'})).status,200);assert.equal((await fetch(settings)).status,401);const locked=await fetch(base('record')+'/__hub/navigation').then(r=>r.json());assert.equal(locked.authRequired,true);assert.equal(locked.settings,false);
 }finally{await hub?.stop();await Promise.all(backends.map(b=>new Promise(r=>{b.closeAllConnections();b.close(r);})));fs.rmSync(dir,{recursive:true,force:true});}
});
