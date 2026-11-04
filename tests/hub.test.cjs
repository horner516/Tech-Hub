const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {startHub,loadConfig,definitions}=require('../hub/server.cjs');
const listen=(server,port)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
function setup(base){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tech-hub-test-'));const c=loadConfig(dir);c.host='127.0.0.1';c.adminPort=base;definitions.forEach((d,i)=>{c.services[d.id].port=base+1+i;c.services[d.id].backendPort=base+11+i;});fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(c));return{dir,c};}
test('validates all listener ports before starting and preserves invalid configuration',()=>{const{dir,c}=setup(28700);c.services.power.port=c.services.dsan.port;const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify(c));assert.throws(()=>loadConfig(dir),/unique/);assert.deepEqual(JSON.parse(fs.readFileSync(file)),c);fs.rmSync(dir,{recursive:true});});
test('isolates services, protects admin and APIs, persists passwords, invalidates sessions, shuts down listeners',async()=>{
 const{dir,c}=setup(28800);const backends=[];let hub;
 try{
 for(const d of definitions){const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({service:d.id,path:req.url,origin:req.headers.origin,host:req.headers.host}));});await listen(server,c.services[d.id].backendPort);backends.push(server);}
 hub=await startHub({dir,launch:false});const admin=`http://127.0.0.1:${c.adminPort}`,dsan=`http://127.0.0.1:${c.services.dsan.port}`,power=`http://127.0.0.1:${c.services.power.port}`;
 assert.equal((await fetch(admin)).status,200);assert.equal(await new Promise(resolve=>http.get(admin+'/api/status',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);})),403);
 assert.equal((await fetch(admin+'/api/updates').then(r=>r.json())).status,'idle');
 assert.equal((await fetch(admin+'/api/updates/check',{method:'POST',headers:{Origin:'http://evil.example'}})).status,403);
 assert.equal((await fetch(dsan+'/api/status')).status,200);assert.equal((await fetch(dsan+'/api/status').then(r=>r.json())).service,'dsan');
 const set=async(id,password,headers={})=>fetch(admin+'/api/access',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({id,password})});
 assert.equal((await set('dsan','test-pass',{Origin:'http://evil.example'})).status,403);
 assert.equal((await set('dsan','short')).status,400);assert.equal((await set('dsan','test-pass')).status,200);assert.equal((await set('power','other-pass')).status,200);
 assert.equal((await fetch(dsan+'/api/state')).status,401);assert.match(await fetch(dsan).then(r=>r.text()),/Service password/);
 const login=await fetch(dsan+'/__hub/login',{method:'POST',body:new URLSearchParams({password:'test-pass'}),redirect:'manual'});assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(dsan+'/api/state',{headers:{Cookie:cookie}})).status,200);
 assert.equal((await fetch(power+'/api/devices',{headers:{Cookie:cookie}})).status,401);
 assert.equal((await fetch(dsan+'/api/config',{method:'POST',headers:{Cookie:cookie,Origin:'http://evil.example'}})).status,403);
 const forwarded=await fetch(dsan+'/api/config',{method:'POST',headers:{Cookie:cookie,Origin:dsan},body:'{}'}).then(r=>r.json());assert.equal(forwarded.origin,`http://127.0.0.1:${c.services.dsan.backendPort}`);
 assert.equal((await set('dsan','changed-pass')).status,200);assert.equal((await fetch(dsan,{headers:{Cookie:cookie}})).status,401);
 const saved=fs.readFileSync(path.join(dir,'config.json'),'utf8');assert(!saved.includes('changed-pass'));assert(loadConfig(dir).services.dsan.password.hash);
 const stat=await fetch(admin+'/api/status').then(r=>r.json());assert(!JSON.stringify(stat).includes('hash'));assert.equal(stat.services[0].protected,true);
 await hub.stop();hub=null;const reclaimed=http.createServer();await listen(reclaimed,c.adminPort);await close(reclaimed);
 }finally{await hub?.stop();await Promise.all(backends.map(close));fs.rmSync(dir,{recursive:true,force:true});}
});
test('occupied master and public ports move, preserve other assignments and persist across restart',async()=>{
 const{dir,c}=setup(28900);const blockers=[http.createServer(),http.createServer()];let hub;
 try{
 await listen(blockers[0],c.adminPort);await listen(blockers[1],c.services.power.port);
 hub=await startHub({dir,launch:false});const selected=structuredClone(hub.config);
 assert.notEqual(selected.adminPort,c.adminPort);assert.notEqual(selected.services.power.port,c.services.power.port);
 assert.equal(selected.services.dsan.port,c.services.dsan.port);assert.equal(selected.services.record.port,c.services.record.port);
 assert.equal(new Set([selected.adminPort,...Object.values(selected.services).flatMap(s=>[s.port,s.backendPort])]).size,19);
 assert.equal((await fetch(`http://127.0.0.1:${selected.adminPort}/api/status`).then(r=>r.json())).adminPort,selected.adminPort);
 assert.equal(hub.status().services[1].localURL,`http://127.0.0.1:${selected.services.power.port}`);
 assert.equal(hub.status().services[1].state,'running');assert.deepEqual(loadConfig(dir),selected);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'runtime.json'))),{pid:process.pid,adminPort:selected.adminPort});
 await hub.stop();hub=null;await Promise.all(blockers.map(close));
 hub=await startHub({dir,launch:false});assert.deepEqual(hub.config,selected);
 }finally{await hub?.stop();await Promise.all(blockers.filter(b=>b.listening).map(close));fs.rmSync(dir,{recursive:true,force:true});}
});
test('occupied internal port is replaced without treating unrelated listener as the backend',async()=>{
 const{dir,c}=setup(29000);const blocker=http.createServer((req,res)=>res.end('unrelated'));let hub;
 try{await listen(blocker,c.services.power.backendPort);hub=await startHub({dir});
 assert.notEqual(hub.config.services.power.backendPort,c.services.power.backendPort);
 assert.equal(hub.config.services.record.backendPort,c.services.record.backendPort);
 assert.notEqual(hub.status().services[1].state,'running');
 assert.equal(loadConfig(dir).services.power.backendPort,hub.config.services.power.backendPort);
 }finally{await hub?.stop();await close(blocker);fs.rmSync(dir,{recursive:true,force:true});}
});

test('Windows default data is per-user LocalAppData',()=>{const {defaultDataDir}=require('../hub/server.cjs');assert.equal(defaultDataDir('win32',{LOCALAPPDATA:'/users/test/local'},'/users/test'),path.join('/users/test/local','Streamline','Tech Hub'));});
