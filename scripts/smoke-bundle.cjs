const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const resources=path.resolve(process.argv[2]);process.env.TECH_HUB_RESOURCES=resources;
const {startHub,loadConfig,hashPassword}=require(path.join(resources,'hub/server.cjs'));
(async()=>{const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'tech-hub-smoke-'));let hub;const blockers=[];
try {
 const c=loadConfig(dir);c.host='127.0.0.1';c.adminPort=30700;
 ['dsan','lux','power','netgear','record','ultrix'].forEach((id,i)=>Object.assign(c.services[id],{port:30701+i,backendPort:30711+i}));
 c.services.lux.password=await hashPassword('smoke-test-only');fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(c));
 for(const port of [30700,30702,30711]){const server=http.createServer((req,res)=>res.end('unrelated'));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});blockers.push(server);}
 hub=await startHub({dir});
 for(let i=0;i<100&&!hub.status().services.every(s=>s.state==='running');i++)await new Promise(r=>setTimeout(r,300));
 assert.equal(hub.status().services.length,6);
 assert(hub.status().services.every(s=>s.state==='running'),JSON.stringify(hub.status()));
 assert.notEqual(hub.config.adminPort,30700);assert.notEqual(hub.config.services.lux.port,30702);assert.notEqual(hub.config.services.dsan.backendPort,30711);
 const admin=`http://127.0.0.1:${hub.config.adminPort}`;
 assert.match(await fetch(admin+'/app.js').then(r=>r.text()),/Set password/);
 for(const s of hub.status().services){
   const r=await fetch(s.localURL);assert.equal(r.status,s.id==='lux'?401:200);
   assert.match(await r.text(),/rel="icon"/);
   const icon=await fetch(s.localURL+'/__hub/favicon.svg');assert.equal(icon.status,200);
   assert.match(icon.headers.get('content-type'),/image\/svg\+xml/);
   assert.equal(await icon.text(),fs.readFileSync(path.join(resources,'hub',`icon-${s.id}.svg`),'utf8'));
 }
 assert.equal(await fetch(admin+'/__hub/favicon.svg').then(r=>r.text()),fs.readFileSync(path.join(resources,'hub/icon-hub.svg'),'utf8'));
 const lux=hub.status().services.find(s=>s.id==='lux').localURL;
 const login=await fetch(lux+'/__hub/login',{method:'POST',body:new URLSearchParams({password:'smoke-test-only'}),redirect:'manual'});assert.equal(login.status,303);
 assert.equal((await fetch(lux,{headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}})).status,200);
 const service=id=>hub.status().services.find(s=>s.id===id).localURL;
 const netgear=service('netgear'),record=service('record'),ultrix=service('ultrix');
 assert.equal((await fetch(netgear+'/api/health')).status,200);
 assert.equal((await fetch(netgear+'/setup')).status,200);
 assert.equal((await fetch(netgear+'/api/ports/vlan',{method:'POST'})).status,404);
 const switches=await fetch(netgear+'/api/switches').then(r=>r.json());assert.deepEqual(switches.switches,[]);
 assert.equal((await fetch(`http://127.0.0.1:${hub.config.services.netgear.backendPort}/api/config`,{headers:{'x-techhub-local-client':'0'}})).status,403);
 const recordState=await fetch(record+'/api/status').then(r=>r.json());assert.deepEqual(recordState.devices,[]);assert.equal(recordState.control.allowFormat,false);
 const remoteRecord=await fetch(`http://127.0.0.1:${hub.config.services.record.backendPort}/api/status`,{headers:{'x-techhub-local-client':'0'}}).then(r=>r.json());assert.equal(remoteRecord.control.enabled,false);
 const configURL=admin+'/api/service-config?id=ultrix',ultrixConfig=await fetch(configURL).then(r=>r.json());
 assert.equal(ultrixConfig.routers[0].router.host,'');ultrixConfig.routers[0].profiles.viewer.pin='fixture-only';
 assert.equal((await fetch(configURL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(ultrixConfig)})).status,200);
 for(let i=0;i<100&&hub.status().services.find(s=>s.id==='ultrix').state!=='running';i++)await new Promise(r=>setTimeout(r,100));
 assert.equal((await fetch(ultrix+'/api/state?profile=viewer')).status,401);
 const profileLogin=await fetch(ultrix+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:'viewer',pin:'fixture-only'})});assert.equal(profileLogin.status,200);
 const profileCookie=profileLogin.headers.get('set-cookie').split(';')[0];assert(profileCookie.startsWith('techhub_ultrix_profile='));
 assert.equal((await fetch(ultrix+'/api/state?profile=viewer',{headers:{Cookie:profileCookie}})).status,200);
 const restart=async(headers={})=>fetch(admin+'/api/restart',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({id:'dsan'})});
 assert.equal((await restart({Origin:'http://example.invalid'})).status,403);
 assert.equal((await restart()).status,200);
 for(let i=0;i<100&&hub.status().services.find(s=>s.id==='dsan').state!=='running';i++)await new Promise(r=>setTimeout(r,100));
 assert(hub.status().services.every(s=>s.state==='running'),JSON.stringify(hub.status()));
 assert.equal((await fetch(lux)).status,401);
 console.log('PASS: bundled services running on reassigned ports; password gate and login verified; Set password label bundled; individual restart preserves other services and passwords.');
} catch(e){console.error('Smoke logs: '+dir);throw e;} finally {await hub?.stop();await Promise.all(blockers.map(s=>new Promise(r=>{s.closeAllConnections();s.close(r);})));}
})().catch(e=>{console.error(e);process.exitCode=1;});
