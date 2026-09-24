const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const backup=require('../hub/backups.cjs'),service=require('../hub/service-config.cjs');
test('Router Panel validation rejects broken routers, profiles, ranges, labels, categories and levels before saving',()=>{
 for(const mutate of [c=>c.profiles.operator.levels='1,2',c=>c.sources={include:'8-2'},c=>c.sources={labels:{'-1':'bad'}},c=>c.sources={categories:[{name:'Bad',match:'['}]},c=>c.profiles.operator.levels=[2],c=>c.levels=[null],c=>c.profiles=null,c=>c.router.port=0,c=>c.destinations={count:Infinity},c=>c.router.type='other',c=>c.id='Not An ID',c=>c.name='']){const c=structuredClone(service.defaults.ultrix);mutate(c.routers[0]);assert.throws(()=>service.validate('ultrix',c));}
 assert(service.validate('ultrix',structuredClone(service.defaults.ultrix)));
});
test('encrypted backups authenticate passphrases, enforce the file allowlist, retain ten snapshots and restore settings',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'th-backup-test-'));try{
 fs.writeFileSync(path.join(dir,'config.json'),'{}');const cfg=service.read(dir,'record');const bundle=backup.collect(dir),encrypted=await backup.seal(bundle,'fixture-passphrase-only');assert(!JSON.stringify(encrypted).includes('pollIntervalMs'));
 assert.deepEqual(await backup.open(encrypted,'fixture-passphrase-only'),bundle);await assert.rejects(()=>backup.open(encrypted,'wrong-passphrase-only'));
 assert.throws(()=>backup.validate({...bundle,files:{...bundle.files,'../escape':'secret'}},service.validate));
 for(let i=0;i<12;i++){cfg.pollIntervalMs=2000+i;service.write(dir,'record',cfg);}assert.equal(backup.list(dir).length,10);
 backup.restore(dir,backup.validate(bundle,service.validate));assert.equal(service.read(dir,'record').pollIntervalMs,2000);assert.throws(()=>backup.saved(dir,'../config.json'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('diagnostics whitelist device state and timestamps and never copy credentials, names, addresses or raw errors',async()=>{
 const {createDiagnostics}=require('../hub/diagnostics.cjs');const data={devices:[{name:'SECRET',host:'SECRET',error:'SECRET',online:false,status:'offline',lastSeenAgoMs:1000,token:'SECRET'}]};
 const diag=createDiagnostics(()=>[{id:'record',name:'Record Monitor',port:8705,backendPort:18705,state:'running',error:'SECRET'}],{request:async()=>({ok:true,json:async()=>data})});diag.event('record',{state:'error',error:'SECRET'});const result=await diag.collect();assert.equal(result.services[0].devices[0].status,'offline');assert(result.services[0].devices[0].lastSuccessfulUpdate);assert(!JSON.stringify(result).includes('SECRET'));assert(!JSON.stringify(result).includes('backendPort'));
});
test('Record Monitor polling never overlaps and marks stale while a response is stuck',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../services/record/public/index.html'),'utf8'),source=html.slice(html.indexOf('  let lastOk ='),html.lastIndexOf('})();'));
 let time=10000,calls=0,resolve;const classes=new Set(),timers=[],elements={banner:{classList:{add(){classes.add('banner');},remove(){classes.delete('banner');}}},conn:{lastChild:{},className:''},clock:{}};
 const context={Date:{now:()=>time},$:id=>elements[id],document:{body:{classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)}}},fetch:()=>{calls++;return new Promise(r=>resolve=r);},AbortSignal:{timeout:ms=>{assert.equal(ms,3500);return {};}},render:()=>{},setInterval:(fn,ms)=>timers.push({fn,ms})};vm.createContext(context);vm.runInContext(source,context);await vm.runInContext('tick()',context);assert.equal(calls,1);time+=5000;timers.find(t=>t.ms===500).fn();assert(classes.has('stale'));resolve({ok:true,json:async()=>({})});await new Promise(r=>setImmediate(r));assert(!classes.has('stale'));
});
