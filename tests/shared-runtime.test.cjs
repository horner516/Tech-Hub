'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Zip=require('adm-zip');
const {inspectPackage,validateManifest}=require('../hub/app-package.cjs');
const {launchSpec}=require('../hub/app-runtime.cjs');
const {createLibrary}=require('../hub/app-library.cjs');
function temp(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'th-shared-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
function fixture(id='example-meter',runtime='node'){
 const manifest={schemaVersion:1,id,name:id,description:'Fixture',version:'1.0.1',minHostVersion:'1.0.1',runtime,entry:'server.cjs',accent:'#ffffff',permissions:[],platforms:['universal'],...(runtime==='shared'?{engine:id}:{})};
 const z=new Zip();z.addFile('techhub-app.json',Buffer.from(JSON.stringify(manifest)));z.addFile('server.cjs',Buffer.from('// Fixture'));return {manifest,z,bytes:z.toBuffer()};
}
test('one universal ZIP validates and installs unchanged on Mac, Windows and Linux',async t=>{
 const {bytes}=fixture(),sha=crypto.createHash('sha256').update(bytes).digest('hex');
 for(const platform of ['darwin-arm64','win32-x64','linux-arm64','linux-x64']){
  assert.equal(inspectPackage(bytes,{hostVersion:'1.0.1',platform}).id,'example-meter');
  const dir=temp(t),seed=path.join(dir,'seed');fs.mkdirSync(seed);fs.writeFileSync(path.join(seed,'app.zip'),bytes);
  fs.writeFileSync(path.join(seed,'catalog.json'),JSON.stringify({schemaVersion:1,apps:[{...fixture().manifest,packages:{universal:{url:'https://github.com/horner516/Tech-Hub/releases/download/v1.0.1/app.zip',size:bytes.length,sha256:sha}}}]}));
  const library=createLibrary({dir,hostVersion:'1.0.1',platform});await library.seed(seed);assert.equal(library.read('example-meter').manifest.version,'1.0.1');assert.equal(library.snapshot().apps[0].compatible,true);await library.stop();
 }
 assert.throws(()=>inspectPackage(bytes,{hostVersion:'1.0.0',platform:'darwin-arm64'}),/incompatible/);
 assert.throws(()=>inspectPackage(bytes,{hostVersion:'1.0.1',platform:'linux-arm'}),/incompatible/);
});
test('shared engines use host binaries and reject arbitrary engine names',t=>{
 const resources=temp(t),root=temp(t),dataDir=temp(t);
 for(const platform of ['darwin','win32','linux'])for(const engine of ['dsan','power']){
  const command=path.join(resources,'drivers',engine,engine+'-server'+(platform==='win32'?'.exe':''));fs.mkdirSync(path.dirname(command),{recursive:true});fs.writeFileSync(command,'fixture');
  const spec=launchSpec({root,manifest:fixture(engine,'shared').manifest},{resources,dataDir,port:32123,platform});assert.equal(spec.command,command);assert(!spec.command.startsWith(root+path.sep));if(engine==='power')assert(spec.args.includes(path.join(dataDir,'settings.json')));
 }
 assert.throws(()=>validateManifest({...fixture('dsan','shared').manifest,engine:'../../arbitrary'}),/engine/);
 assert.throws(()=>validateManifest({...fixture().manifest,runtime:'native'}),/Universal/);
 const {z}=fixture();z.addFile('addon.node',Buffer.from('native'));assert.throws(()=>inspectPackage(z.toBuffer(),{hostVersion:'1.0.1',platform:'win32-x64'}),/native binaries/);
});
test('upgrading restores installed Lux without deleting its package or settings',async t=>{
 const dir=temp(t),root=path.join(dir,'apps/lux/1.0.0-old');fs.mkdirSync(root,{recursive:true});const manifest={...fixture('lux').manifest,platforms:['darwin-arm64'],minHostVersion:'1.0.0'};fs.writeFileSync(path.join(root,'techhub-app.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(dir,'apps/installed.json'),JSON.stringify({lux:{current:'1.0.0-old'}}));fs.mkdirSync(path.join(dir,'lux'));fs.writeFileSync(path.join(dir,'lux/devices.json'),'retained');
 const {loadConfig,startHub}=require('../hub/server.cjs'),c=loadConfig(dir);c.host='127.0.0.1';c.adminPort=32400;Object.values(c.services).forEach((s,i)=>Object.assign(s,{enabled:false,port:32401+i,backendPort:32411+i}));c.services.lux={port:32430,backendPort:32431,enabled:true,password:null};fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(c));
 const hub=await startHub({dir,launch:false,modular:true,advertise:false,checkUpdates:false,seedDir:path.join(dir,'none'),libraryOptions:{platform:'darwin-arm64',request:async()=>{throw Error('offline');}}});try{assert(hub.status().services.some(s=>s.id==='lux'));const apps=await fetch('http://127.0.0.1:'+hub.config.adminPort+'/api/apps').then(r=>r.json());assert(apps.apps.some(a=>a.id==='lux'));assert.equal(fs.readFileSync(path.join(dir,'lux/devices.json'),'utf8'),'retained');assert(fs.existsSync(path.join(root,'techhub-app.json')));}finally{await hub.stop();}
});
test('runtime helpers preserve settings and require host-supplied administrator status',t=>{
 const api=require('../hub/runtime-api.cjs'),dir=temp(t),old={...process.env};process.env.TECH_HUB_BACKEND_PORT='32123';process.env.TECH_HUB_DATA_DIR=dir;
 try{assert.deepEqual(api.readSettings({label:'default'}),{label:'default'});api.saveSettings({label:'saved'});assert.deepEqual(api.readSettings({}),{label:'saved'});assert.throws(()=>api.saveSettings({},'../escape.json'),/filename/);assert.equal(api.context().host,'127.0.0.1');assert(!api.isAdministrator({socket:{remoteAddress:'192.0.2.1'},headers:{'x-techhub-local-client':'1'}}));assert(api.isAdministrator({socket:{remoteAddress:'127.0.0.1'},headers:{'x-techhub-local-client':'1'}}));}finally{for(const k of ['TECH_HUB_BACKEND_PORT','TECH_HUB_DATA_DIR'])if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
});
test('SDK starter runs on the supplied runtime and persists settings through the gateway',async t=>{
 const dir=temp(t),appRoot=path.join(dir,'apps/example-meter/1.0.0-fixture');fs.mkdirSync(path.dirname(appRoot),{recursive:true});fs.cpSync(path.join(__dirname,'../sdk/template'),appRoot,{recursive:true});fs.writeFileSync(path.join(dir,'apps/installed.json'),JSON.stringify({'example-meter':{current:'1.0.0-fixture',unofficial:true}}));
 const {loadConfig,startHub}=require('../hub/server.cjs'),config=loadConfig(dir);config.adminPort=32500;config.host='127.0.0.1';Object.values(config.services).forEach((s,i)=>Object.assign(s,{enabled:false,port:32501+i,backendPort:32511+i}));config.services['example-meter']={port:32530,backendPort:32531,enabled:true,password:null};fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(config));
 const hub=await startHub({dir,launch:false,modular:true,advertise:false,checkUpdates:false,seedDir:path.join(dir,'none'),libraryOptions:{request:async()=>{throw Error('offline');}}});
 try{for(let i=0;i<100&&hub.status().services.find(s=>s.id==='example-meter').state!=='running';i++)await new Promise(r=>setTimeout(r,30));assert.equal(hub.status().services.find(s=>s.id==='example-meter').state,'running');const base='http://127.0.0.1:'+hub.config.services['example-meter'].port;assert.equal((await fetch(base+'/api/status').then(r=>r.json())).admin,true);const response=await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'Persisted fixture'})});assert.equal(response.status,200);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'example-meter/settings.json'))).label,'Persisted fixture');const backend='http://127.0.0.1:'+hub.config.services['example-meter'].backendPort;assert.equal((await fetch(backend+'/api/settings',{method:'POST',headers:{'x-techhub-local-client':'0'},body:'{}'})).status,403);}finally{await hub.stop();}
});
