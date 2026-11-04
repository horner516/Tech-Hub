'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {extractPackage,inspectPackage,validateManifest,compare,version}=require('./app-package.cjs');
const repo='https://github.com/horner516/Tech-Hub/releases/download/';
function validateCatalog(value){if(value?.schemaVersion!==1||!Array.isArray(value.apps)||value.apps.length>100)throw Error('Invalid app catalog');const ids=new Set();for(const a of value.apps){if(!/^[a-z][a-z0-9-]{1,39}$/.test(a.id)||ids.has(a.id)||typeof a.name!=='string'||a.name.length>80||typeof a.description!=='string'||a.description.length>240||!version(a.version)||!version(a.minHostVersion)||!a.packages||!Array.isArray(a.permissions))throw Error('Invalid catalog app');if(a.developer!==undefined&&(typeof a.developer!=='string'||a.developer.length>100))throw Error('Invalid catalog developer');if(a.sourceUrl!==undefined&&(typeof a.sourceUrl!=='string'||a.sourceUrl.length>500||!/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\/[^\s]*)?$/.test(a.sourceUrl)))throw Error('Invalid catalog source URL');ids.add(a.id);for(const [p,v]of Object.entries(a.packages)){if(!['darwin-arm64','win32-x64','linux-arm64','linux-x64','universal'].includes(p)||!v.url?.startsWith(repo)||!/^https:\/\/github\.com\/horner516\/Tech-Hub\/releases\/download\/[^/]+\/[^/?#]+$/.test(v.url)||! /^[a-f0-9]{64}$/.test(v.sha256)||!Number.isInteger(v.size)||v.size<=0||v.size>256*1024*1024)throw Error('Invalid catalog package');}}return value;}
function createLibrary({dir,hostVersion,platform=process.platform+'-'+process.arch,request=fetch,beforeChange=async()=>{},afterChange=async()=>{},catalogPath} ){
 const folder=path.join(dir,'apps');fs.mkdirSync(folder,{recursive:true,mode:0o700});const indexFile=path.join(folder,'installed.json'),catalogFile=path.join(folder,'catalog.json');
 const abort=new AbortController();let stopped=false,pending=null,pendingTimer=null;const pendingDir=path.join(folder,'.pending');fs.rmSync(pendingDir,{recursive:true,force:true});
 let index=fs.existsSync(indexFile)?JSON.parse(fs.readFileSync(indexFile,'utf8')):{},catalog=null,busy=false,refreshing=false,error=null,checkedAt=null;const jobs=new Map();
 const save=()=>{fs.writeFileSync(indexFile+'.tmp',JSON.stringify(index),{mode:0o600});fs.renameSync(indexFile+'.tmp',indexFile);};
 function prune(id){const keep=new Set([index[id]?.current,index[id]?.previous]),parent=path.join(folder,id);for(const name of fs.readdirSync(parent))if(/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(name)&&!keep.has(name))fs.rmSync(path.join(parent,name),{recursive:true,force:true});}
 function read(id){const entry=index[id];if(!entry)return null;const name=entry.current;if(!/^[a-zA-Z0-9.-]+$/.test(name)||! /^[a-z][a-z0-9-]{1,39}$/.test(id))throw Error('Invalid installed package path');const root=path.join(folder,id,name);const manifest=validateManifest(JSON.parse(fs.readFileSync(path.join(root,'techhub-app.json'),'utf8')));if(manifest.id!==id)throw Error('App identity mismatch');return {root,manifest,previous:!!entry.previous,unofficial:!!entry.unofficial};}

 try{if(fs.existsSync(catalogFile))catalog=validateCatalog(JSON.parse(fs.readFileSync(catalogFile,'utf8')));else if(catalogPath&&fs.existsSync(catalogPath))catalog=validateCatalog(JSON.parse(fs.readFileSync(catalogPath,'utf8')));}catch{error='Cached catalog unavailable. Refresh the catalog.';}
 try{if(catalogPath&&fs.existsSync(catalogPath)){const bundled=validateCatalog(JSON.parse(fs.readFileSync(catalogPath,'utf8')));if(!catalog||bundled.apps.some(a=>!catalog.apps.some(b=>b.id===a.id&&compare(b.version,a.version)>=0)))catalog=bundled;}}catch{error='Bundled catalog unavailable. Refresh the catalog.';}
 async function download(url,max,onProgress=()=>{}){const r=await request(url,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(120000)]),headers:{'User-Agent':'Tech-Hub-App-Library'}});if(!r.ok)throw Error('Download failed ('+r.status+')');const parts=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>max)throw Error('Download exceeds size limit');parts.push(chunk);onProgress(size);}return Buffer.concat(parts);}
 async function refresh(){if(refreshing||busy||stopped)return;refreshing=true;try{const response=await request('https://api.github.com/repos/horner516/Tech-Hub/releases?per_page=100',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)]),headers:{'User-Agent':'Tech-Hub-App-Library'}});if(!response.ok)throw Error('Unable to read the official catalog');const releases=await response.json();const available=releases.filter(r=>!r.draft&&!r.prerelease&&r.assets?.some(a=>a.name==='tech-hub-catalog.json')).sort((a,b)=>new Date(b.published_at)-new Date(a.published_at));const asset=available[0]?.assets.find(a=>a.name==='tech-hub-catalog.json');if(!asset||!asset.browser_download_url.startsWith(repo))throw Error('No published app catalog is available yet');const next=validateCatalog(JSON.parse((await download(asset.browser_download_url,1024*1024)).toString('utf8')));catalog=next;fs.writeFileSync(catalogFile+'.tmp',JSON.stringify(next),{mode:0o600});fs.renameSync(catalogFile+'.tmp',catalogFile);error=null;checkedAt=new Date().toISOString();}catch(e){error=e.message;}finally{refreshing=false;}}
 const packageFor=a=>a?.packages?.[platform]||(['darwin-arm64','win32-x64','linux-arm64','linux-x64'].includes(platform)?a?.packages?.universal:null);
 function catalogApps(){const all=[...(catalog?.apps||[])];for(const id of Object.keys(index))if(!all.some(a=>a.id===id)){const a=read(id);all.push({...a.manifest,packages:{},unlisted:true});}return all;}
 function snapshot(){
  const apps=catalogApps().map(a=>{
   let installed;try{installed=read(a.id);}catch{}
   const compatible=!!packageFor(a)&&compare(a.minHostVersion,hostVersion)<=0;
   const updateAvailable=!!installed&&!installed.unofficial&&!a.unlisted&&compare(a.version,installed.manifest.version)>0;
   return {...a,packages:undefined,compatible,unofficial:!!installed?.unofficial,installedVersion:installed?.manifest.version||null,rollback:installed?.previous||false,updateAvailable,canUpdate:updateAvailable&&compatible,job:jobs.get(a.id)||null};
  });
  return {busy,refreshing,error,checkedAt,platform,apps,installed:Object.keys(index),updateCount:apps.filter(a=>a.updateAvailable).length,readyUpdateCount:apps.filter(a=>a.canUpdate).length};
 }

 async function install(id,offlineBytes){const a=catalog?.apps.find(a=>a.id===id),pkg=packageFor(a);if(!pkg||compare(a.minHostVersion,hostVersion)>0)throw Error('Module is not compatible with this computer');const existing=read(id);if(existing?.unofficial)throw Error('Uninstall the unofficial module before installing the catalog module with this ID');if(existing&&compare(existing.manifest.version,a.version)>=0){jobs.set(id,{state:'installed',progress:100});return;}
  jobs.set(id,{state:'downloading',progress:0});const bytes=offlineBytes||await download(pkg.url,pkg.size,n=>jobs.set(id,{state:'downloading',progress:Math.min(99,Math.floor(n/pkg.size*100))}));if(bytes.length!==pkg.size||crypto.createHash('sha256').update(bytes).digest('hex')!==pkg.sha256)throw Error('Package checksum does not match the official catalog');
  const name=a.version+'-'+crypto.randomBytes(6).toString('hex'),stage=path.join(folder,id,name);fs.mkdirSync(stage,{recursive:true});let changed=false,old=index[id];
  try{jobs.set(id,{state:'validating',progress:100});extractPackage(bytes,stage,{id,version:a.version,hostVersion,platform});if(stopped)throw Error('Tech Hub is shutting down');await beforeChange(id);index[id]={current:name,...(old?{previous:old.current}:{})};save();changed=true;await afterChange(id);prune(id);jobs.set(id,{state:'installed',progress:100});}
  catch(e){if(changed){await beforeChange(id);if(old)index[id]=old;else delete index[id];save();if(!stopped)try{await afterChange(id);}catch{}}fs.rmSync(stage,{recursive:true,force:true});throw e;}
 }
 async function run(ids,action='install',offline={}){if(stopped)throw Error('Tech Hub is shutting down');if(busy)throw Error('An app operation is already running');if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>! /^[a-z][a-z0-9-]{1,39}$/.test(id)))throw Error('Select valid apps');if(!['install','uninstall','rollback'].includes(action))throw Error('Unknown app action');busy=true;try{for(const id of [...new Set(ids)]){try{
   if(stopped)break;if(action==='install')await install(id,offline[id]);
   else if(action==='uninstall'){await beforeChange(id);const old=index[id];delete index[id];try{save();await afterChange(id);}catch(e){if(old)index[id]=old;save();if(!stopped)await afterChange(id);throw e;}fs.rmSync(path.join(folder,id),{recursive:true,force:true});jobs.set(id,{state:'removed',progress:100});}
   else{const old=index[id];if(!old?.previous)throw Error('No previous app version is available');await beforeChange(id);index[id]={...old,current:old.previous,previous:old.current};save();try{await afterChange(id);}catch(e){await beforeChange(id);index[id]=old;save();await afterChange(id);throw e;}jobs.set(id,{state:'installed',progress:100});}
  }catch(e){jobs.set(id,{state:'error',error:e.message});}}}finally{busy=false;}}
 async function seed(seedDir){
  if(stopped)return;const marker=path.join(folder,'offline-seeded');if(fs.existsSync(marker)||!fs.existsSync(path.join(seedDir,'catalog.json')))return;
  catalog=validateCatalog(JSON.parse(fs.readFileSync(path.join(seedDir,'catalog.json'),'utf8')));fs.writeFileSync(catalogFile,JSON.stringify(catalog),{mode:0o600});busy=true;
  try{for(const a of catalog.apps){if(stopped)break;if(read(a.id))continue;const pkg=packageFor(a);if(!pkg)continue;try{await install(a.id,fs.readFileSync(path.join(seedDir,path.basename(new URL(pkg.url).pathname))));}catch(e){jobs.set(a.id,{state:'error',error:e.message});}}if(!stopped&&![...jobs.values()].some(j=>j.state==='error'))fs.writeFileSync(marker,'1');}finally{busy=false;}
 }
 async function importBundle(bytes){const Zip=require('adm-zip'),zip=new Zip(bytes),offline={},ids=[];if(zip.getEntries().length>102)throw Error('Invalid offline bundle');for(const app of catalog?.apps||[]){const pkg=packageFor(app);if(!pkg)continue;const entry=zip.getEntry(path.basename(new URL(pkg.url).pathname));if(!entry)continue;if(entry.isDirectory||entry.header.size!==pkg.size)throw Error('Offline package size does not match the official catalog');offline[app.id]=entry.getData();ids.push(app.id);}if(!ids.length)throw Error('No packages match this host’s official catalog. Refresh the catalog or use the matching full installer.');await run(ids,'install',offline);}
 function discardPending(){clearTimeout(pendingTimer);if(pending)fs.rmSync(pending.stage,{recursive:true,force:true});pending=null;}
 function inspectLocal(bytes){
  if(stopped||busy)throw Error('Wait for the current module operation');if(bytes.length>256*1024*1024)throw Error('Module package exceeds 256 MB');
  const manifest=inspectPackage(bytes,{hostVersion,platform}),id=manifest.id;
  if(['dsan','lux','power','netgear','record','ultrix','rtoo','pixel-peeker','otter-edid-editor'].includes(id)||catalog?.apps.some(a=>a.id===id)||read(id)&&!read(id).unofficial)throw Error('Choose a unique test app ID. Local packages cannot replace official apps.');
  discardPending();const token=crypto.randomBytes(24).toString('hex'),stage=path.join(pendingDir,token);fs.mkdirSync(stage,{recursive:true});
  try{extractPackage(bytes,stage,{id,version:manifest.version,hostVersion,platform});}catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e;}
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),expires=Date.now()+10*60*1000;pending={token,stage,manifest,sha256,expires};pendingTimer=setTimeout(discardPending,10*60*1000);pendingTimer.unref();
  return {token,manifest,sha256,expires,replacing:!!read(id)};
 }
 async function installLocal(token){
  if(stopped||busy)throw Error('Wait for the current module operation');
  if(!pending||pending.token!==token||pending.expires<Date.now())throw Error('Package review expired. Choose the ZIP again.');
  const p=pending;pending=null;clearTimeout(pendingTimer);const {id,version}=p.manifest;
  if(catalog?.apps.some(a=>a.id===id)){fs.rmSync(p.stage,{recursive:true,force:true});throw Error('This ID is now reserved by a catalog app. Use a different ID.');}
  busy=true;let old=index[id],changed=false;const name=version+'-'+crypto.randomBytes(6).toString('hex'),stage=path.join(folder,id,name);
  try{fs.mkdirSync(path.dirname(stage),{recursive:true});fs.renameSync(p.stage,stage);await beforeChange(id);index[id]={current:name,unofficial:true,sha256:p.sha256,...(old?{previous:old.current}:{})};save();changed=true;await afterChange(id);prune(id);jobs.set(id,{state:'installed',progress:100});return {id,version};}
  catch(e){if(changed){await beforeChange(id);if(old)index[id]=old;else delete index[id];save();if(!stopped)try{await afterChange(id);}catch{}}fs.rmSync(stage,{recursive:true,force:true});jobs.set(id,{state:'error',error:e.message});throw e;}finally{busy=false;}
 }
 async function stop(){stopped=true;discardPending();abort.abort();while(busy)await new Promise(r=>setTimeout(r,25));}
 return {read,refresh,snapshot,run,seed,stop,importBundle,inspectLocal,installLocal,cancelLocal:token=>{if(pending?.token===token)discardPending();},get busy(){return busy;},installed:()=>Object.keys(index).map(read).filter(Boolean)};
}
module.exports={createLibrary,validateCatalog};
