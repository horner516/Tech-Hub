const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {startHub,loadConfig}=require('../hub/server.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tech-hub-smoke-'));
 const c=loadConfig(dir);c.host='127.0.0.1';fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(c));
 process.env.TECH_HUB_RESOURCES=path.resolve('dist/Tech Hub.app/Contents/Resources');
 const hub=await startHub({dir});
 try {
  for(let i=0;i<100&&!hub.status().services.every(s=>s.state==='running');i++)await new Promise(resolve=>setTimeout(resolve,300));
  console.log(JSON.stringify(hub.status(),null,2));
  assert(hub.status().services.every(s=>s.state==='running'),'All bundled services must start');
  for(const s of hub.status().services){const r=await fetch(s.localURL);assert.equal(r.status,200);assert.match(await r.text(),/<html|<!doctype/i);}
  assert.equal((await fetch('http://127.0.0.1:8701/full')).status,200);
  const timer=await fetch('http://127.0.0.1:8701/api/state').then(r=>r.json());assert.equal(timer.network.server.port,8701);assert.equal(timer.config.limitimer.enabled,false);
  const lighting=await fetch('http://127.0.0.1:8702/api/server-info').then(r=>r.json());assert.equal(lighting.port,8702);
  const power=await fetch('http://127.0.0.1:8703/api/status').then(r=>r.json());assert.deepEqual(power.devices,[]);
  console.log('PASS: all packaged dashboards, D’san full-screen, public port metadata, and empty defaults.');
  if(process.argv.includes('--preview')) { console.log('PREVIEW_READY http://127.0.0.1:8700');await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);}); }
 }finally{await hub.stop();for(const port of [8700,8701,8702,8703,18701,18702,18703]){await assert.rejects(fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(500)}));}console.log('PASS: all seven listeners stopped.');fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
