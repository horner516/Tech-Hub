'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const resources=path.resolve(process.argv[2]);process.env.TECH_HUB_RESOURCES=resources;
const {startHub,loadConfig,hashPassword}=require(path.join(resources,'hub/server.cjs'));
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'techhub-linux-smoke-'));let hub;
 try {
  const c=loadConfig(dir);c.host='127.0.0.1';c.adminPort=30700;
  Object.values(c.services).forEach((s,i)=>Object.assign(s,{enabled:true,port:30701+i,backendPort:30721+i}));
  c.services.power.password=await hashPassword('fixture-password');
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(c));
  const catalog=JSON.parse(fs.readFileSync(path.join(resources,'catalog.json')));
  hub=await startHub({dir,advertise:false,checkUpdates:false,libraryOptions:{request:async()=>{throw Error('Offline smoke test');}}});
  for(let i=0;i<300;i++){
   const state=hub.status();if(state.services.filter(s=>s.state==='running').length===catalog.apps.length)break;
   await new Promise(r=>setTimeout(r,200));
  }
  const services=hub.status().services;
  assert.equal(services.length,catalog.apps.length);
  assert(services.every(s=>s.state==='running'),JSON.stringify(services));
  for(const s of services){
   const response=await fetch(s.localURL);assert.equal(response.status,s.id==='power'?401:200,s.id);
   assert.match(await response.text(),/rel="icon"/,s.id);
   assert.equal((await fetch(s.localURL+'/__hub/favicon.svg')).status,200,s.id);
  }
  const power=services.find(s=>s.id==='power');
  const login=await fetch(power.localURL+'/__hub/login',{method:'POST',body:new URLSearchParams({password:'fixture-password'}),redirect:'manual'});
  assert.equal(login.status,303);
  assert.equal((await fetch(power.localURL,{headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}})).status,200);
  await hub.stop();hub=null;
  for(const s of services)await assert.rejects(fetch(s.localURL,{signal:AbortSignal.timeout(500)}));
  console.log(`PASS: ${services.length} modules start offline on ${process.platform}/${process.arch}, serve pages, enforce password access and stop listeners.`);
 } catch(error){console.error('Smoke data/logs: '+dir);throw error;}
 finally{await hub?.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
