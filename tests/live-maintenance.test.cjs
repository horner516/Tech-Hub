const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {startHub,loadConfig,definitions}=require('../hub/server.cjs'),settings=require('../hub/service-config.cjs');
test('live settings, encrypted backup/restore and diagnostics work through the hub without hardware or service restarts',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-live-maint-')),resources=fs.mkdtempSync(path.join(os.tmpdir(),'hub-live-res-')),before=process.env.TECH_HUB_RESOURCES;let hub;
 try{
 const config=loadConfig(dir);config.host='127.0.0.1';config.adminPort=29700;
 for(const [i,d]of definitions.entries())Object.assign(config.services[d.id],{port:29701+i,backendPort:29711+i,enabled:['record','ultrix'].includes(d.id)});
 for(const id of ['record','ultrix']){settings.read(dir,id);fs.symlinkSync(path.resolve(__dirname,'../services',id),path.join(resources,id),'dir');}
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(config));process.env.TECH_HUB_RESOURCES=resources;hub=await startHub({dir,checkUpdates:false});
 for(let n=0;n<100&&!hub.status().services.filter(s=>s.enabled).every(s=>s.state==='running');n++)await new Promise(r=>setTimeout(r,100));assert(hub.status().services.filter(s=>s.enabled).every(s=>s.state==='running'));
 const admin='http://127.0.0.1:29700',post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const record=await fetch('http://127.0.0.1:29705/__hub/settings'),recordCfg=await record.json();recordCfg.pollIntervalMs=3750;
 assert.equal((await post('http://127.0.0.1:29705/__hub/settings',recordCfg,{'If-Match':record.headers.get('etag')})).status,200);
 assert.equal((await fetch('http://127.0.0.1:29705/api/status').then(r=>r.json())).pollIntervalMs,3750);
 const ultrix=await fetch('http://127.0.0.1:29706/__hub/settings'),ultrixCfg=await ultrix.json();ultrixCfg.routers[0].profiles.operator.title='Updated fixture panel';
 assert.equal((await post('http://127.0.0.1:29706/__hub/settings',ultrixCfg,{'If-Match':ultrix.headers.get('etag')})).status,200);
 assert.equal((await fetch('http://127.0.0.1:29706/api/config').then(r=>r.json())).title,'Updated fixture panel');
 assert(hub.status().services.filter(s=>s.enabled).every(s=>s.state==='running'));
 assert.equal((fs.readFileSync(path.join(dir,'logs/record.log'),'utf8').match(/running with/g)||[]).length,1);
 const diagnostics=await fetch(admin+'/api/diagnostics').then(r=>r.json());assert.equal(diagnostics.services.length,6);assert(!JSON.stringify(diagnostics).includes('Updated fixture panel'));
 const passphrase='fixture-backup-passphrase';const exported=await post(admin+'/api/backup/export',{passphrase}).then(r=>r.json());assert.equal(exported.format,'tech-hub-encrypted-backup');
 const deny=await post(admin+'/api/backup/restore',{backup:exported,passphrase},{Origin:'http://evil.invalid'});assert.equal(deny.status,403);
 const result=await post(admin+'/api/backup/restore',{backup:exported,passphrase});assert.equal(result.status,200,await result.text());assert(hub.status().services.every(s=>s.state==='disabled'));
 assert.equal((await post(admin+'/api/enabled',{id:'record',enabled:true})).status,409);assert.equal(settings.read(dir,'record').pollIntervalMs,3750);
 }finally{await hub?.stop();if(before===undefined)delete process.env.TECH_HUB_RESOURCES;else process.env.TECH_HUB_RESOURCES=before;fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(resources,{recursive:true,force:true});}
});
