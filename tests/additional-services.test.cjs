const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {loadConfig,startHub,definitions}=require('../hub/server.cjs');
const serviceConfig=require('../hub/service-config.cjs');
test('three-service upgrades preserve existing passwords and occupied assignments',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-migrate-'));
 try{
  const config=loadConfig(dir);for(const id of ['netgear','record','ultrix'])delete config.services[id];
  config.services.dsan.port=8704;config.services.dsan.password={salt:'saved',hash:'saved'};
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(config));
  const migrated=loadConfig(dir);assert.deepEqual(migrated.services.dsan,config.services.dsan);
  assert.equal(Object.keys(migrated.services).length,6);assert.notEqual(migrated.services.netgear.port,8704);
  assert.equal(new Set([migrated.adminPort,...Object.values(migrated.services).flatMap(s=>[s.port,s.backendPort])]).size,13);
  assert.deepEqual(loadConfig(dir),migrated);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('new service settings start disconnected and persist without shipping hardware addresses',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-settings-'));
 try{
  const record=serviceConfig.read(dir,'record'),ultrix=serviceConfig.read(dir,'ultrix');
  assert.deepEqual(record.devices,[]);assert.equal(record.allowFormat,false);assert.equal(ultrix.title,'Router Panel');assert.equal(ultrix.routers[0].router.host,'');assert.equal(ultrix.routers[0].router.type,'swp08');
  ultrix.routers[0].router.port=2001;serviceConfig.write(dir,'ultrix',ultrix);assert.equal(serviceConfig.read(dir,'ultrix').routers[0].router.port,2001);
  assert.throws(()=>serviceConfig.write(dir,'record',{devices:[{host:'',type:'hyperdeck'}]}));
  assert.throws(()=>serviceConfig.write(dir,'ultrix',{...ultrix,mock:{enabled:true}}));
  // A second saved router (a Videohub) and switching which one is active.
  const hub={...structuredClone(ultrix.routers[0]),id:'studio-b',name:'Studio B',router:{type:'videohub',host:'',port:9990,allowRouting:true}};
  serviceConfig.write(dir,'ultrix',{...ultrix,activeRouter:'studio-b',routers:[...ultrix.routers,hub]});
  assert.deepEqual(serviceConfig.read(dir,'ultrix').routers.map(r=>r.id),['router-1','studio-b']);
  assert.throws(()=>serviceConfig.write(dir,'ultrix',{...ultrix,routers:[...ultrix.routers,{...hub,levels:[{name:'Video'},{name:'Audio'}]}]}),/one level/);
  assert.throws(()=>serviceConfig.write(dir,'ultrix',{...ultrix,activeRouter:'missing'}),/active/);
  assert.throws(()=>serviceConfig.write(dir,'ultrix',{...ultrix,routers:[ultrix.routers[0],ultrix.routers[0]]}),/used by two/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Router Panel upgrades a saved single-router Ultrix Panel config without losing its setup',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-settings-'));
 try{
  const old={title:'Ultrix Panel',router:{host:'',port:2000,matrix:1,allowRouting:true},levels:[{name:'Video'},{name:'Audio 1'}],sources:{categories:[{name:'Cameras',match:'^CAM'}]},destinations:{protected:'5'},defaultProfile:'operator',profiles:{operator:{title:'Operator',levels:[1,2]}}};
  fs.mkdirSync(path.join(dir,'ultrix'));fs.writeFileSync(serviceConfig.file(dir,'ultrix'),JSON.stringify(old));
  const upgraded=serviceConfig.read(dir,'ultrix');
  assert.equal(upgraded.title,'Router Panel');assert.equal(upgraded.activeRouter,'router-1');assert.equal(upgraded.routers.length,1);
  const [r]=upgraded.routers;
  assert.deepEqual(r.router,{type:'swp08',...old.router});assert.deepEqual(r.levels,old.levels);assert.deepEqual(r.sources,old.sources);assert.deepEqual(r.destinations,old.destinations);assert.deepEqual(r.profiles,old.profiles);
  serviceConfig.write(dir,'ultrix',old);assert.deepEqual(JSON.parse(fs.readFileSync(serviceConfig.file(dir,'ultrix'),'utf8')),upgraded,'an old-shape save is stored upgraded');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Ultrix profile cookies and event streams survive the gateway; access changes close streams',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-stream-'));let hub;const backends=[];
 try{
  const config=loadConfig(dir);config.host='127.0.0.1';config.adminPort=29200;
  for(const [i,d] of definitions.entries()){
   config.services[d.id].port=29201+i;config.services[d.id].backendPort=29211+i;
   const server=http.createServer((req,res)=>{
    if(req.url==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: ready\n\n');return;}
    res.setHeader('Set-Cookie',['sid=abc123; HttpOnly; SameSite=Strict; Path=/','unrelated=discard']);
    res.end(JSON.stringify({cookie:req.headers.cookie,local:req.headers['x-techhub-local-client']}));
   });await new Promise(resolve=>server.listen(29211+i,'127.0.0.1',resolve));backends.push(server);
  }
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(config));hub=await startHub({dir,launch:false});
  const base='http://127.0.0.1:29206',response=await fetch(base,{headers:{Cookie:'techhub_ultrix_profile=abc123; techhub_dsan=secret','x-techhub-local-client':'0'}});
  assert.deepEqual(await response.json(),{cookie:'sid=abc123',local:'1'});
  assert.deepEqual(response.headers.getSetCookie(),['techhub_ultrix_profile=abc123; HttpOnly; SameSite=Strict; Path=/']);
  const stream=await fetch(base+'/events'),reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/ready/);
  const closed=reader.read().then(result=>assert(result.done),()=>{});
  const change=await fetch('http://127.0.0.1:29200/api/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'ultrix',password:'test-password'})});assert.equal(change.status,200);
  await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Stream stayed open')),1500);timer.unref();})]);
  assert.equal((await fetch(base+'/events')).status,401);
 }finally{await hub?.stop();await Promise.all(backends.map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));fs.rmSync(dir,{recursive:true,force:true});}
});
