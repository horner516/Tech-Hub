'use strict';
const known=new Set(['running','starting','recovering','stopping','disabled','error','connected','connecting','disconnected','waiting','online','offline','warning','pending','ready','loading','unverified','unknown','stale','recording','stopped','playing','paused','standby','setup_required']);
const state=value=>known.has(String(value).toLowerCase())?String(value).toLowerCase():'unknown';
function date(value){let n=typeof value==='number'?(value<1e12?value*1000:value):Date.parse(value);return Number.isFinite(n)&&n>0&&n<=Date.now()+60000?new Date(n).toISOString():null;}
function devices(id,data){
 let rows=[];
 if(id==='dsan')rows=['limitimer','perfectcue'].map(k=>({status:data[k]?.stale?'stale':data[k]?.status,at:data[k]?.updated_at,error:!!data[k]?.error}));
 if(id==='record')rows=(data.devices||[]).map(d=>({status:d.online===false?'offline':d.status,at:typeof d.lastSeenAgoMs==='number'?Date.now()-d.lastSeenAgoMs:null,error:!!d.error}));
 if(id==='power')rows=(data.devices||[]).map(d=>({status:d.stale?'stale':d.status,at:d.last_seen,error:!!d.error}));
 if(id==='netgear')rows=(data.switches||[]).map(d=>({status:d.status||'unverified',at:d.lastSeen||Math.max(0,...(d.ports||[]).map(p=>p.sampledAt||0)),error:!!d.error}));
 if(id==='lux')rows=(data.devices||[]).map(d=>{const info=data.info?.[d.ip];return {status:info?info.responding?'online':'offline':d.state,at:info?.checkedAt,error:!!info?.error};});
 if(id==='ultrix')rows=[{status:data.status,at:data.lastRx,error:data.status!=='ready'}];
 if(id==='rtoo')rows=Object.values(data.amps||{}).map(d=>({status:d.stale?'stale':d.connected?'connected':'disconnected',at:d.lastSeen,error:!!d.error||['generalError','deviceError','ampError','smpsError'].some(k=>d.status?.[k]===true)}));
 return rows.slice(0,1000).map((d,i)=>({device:i+1,status:state(d.status),lastSuccessfulUpdate:date(d.at),problem:d.error?'Device reports a connection or reading problem':null}));
}
function summarize(row){
 if(row.kind==='browser-tool')return {kind:'browser-tool',total:0,healthy:0,attention:0,unknown:0};
 const good=new Set(['online','connected','ready','recording','playing','stopped','standby','running']);
 const bad=new Set(['offline','disconnected','error','stale','warning']);
 let healthy=0,attention=0,unknown=0;
 for(const d of row.devices){if(d.problem||bad.has(d.status))attention++;else if(good.has(d.status))healthy++;else unknown++;}
 return {kind:'devices',total:row.devices.length,healthy,attention,unknown};
}
function createDiagnostics(getServices,{request=fetch}={}){
 const events=[],last=new Map(),successful=new Map();let pending,cache=null,at=0;
 function event(id,value){const s=state(value.state),key=s+Boolean(value.error);if(last.get(id)===key)return;last.set(id,key);events.unshift({time:new Date().toISOString(),service:id,state:s,summary:value.error?'Service reported an error; inspect local logs for details':'Service state changed'});events.splice(100);}
 function collect(){if(pending)return pending;if(cache&&Date.now()-at<5000)return Promise.resolve(cache);pending=(async()=>{
 const paths={dsan:'/api/state',lux:'/api/devices',power:'/api/status?history=false',netgear:'/api/switches',record:'/api/status',ultrix:'/api/health',rtoo:'/state','pixel-peeker':'/api/health','otter-edid-editor':'/api/health'};
 const services=await Promise.all(getServices().map(async s=>{
  const row={id:s.id,name:s.name,state:state(s.state),webPort:s.port,lastSuccessfulCheck:successful.get(s.id)||null,devices:[],problem:s.error?'Service error; inspect local logs for details':null};
  if(['pixel-peeker','otter-edid-editor'].includes(s.id))row.kind='browser-tool';
  if(s.state!=='running'||!paths[s.id]){row.summary=summarize(row);return row;}
  try{const r=await request(`http://127.0.0.1:${s.backendPort}${paths[s.id]}`,{headers:{'x-techhub-local-client':'1'},signal:AbortSignal.timeout(1800)});if(!r.ok)throw Error();const data=await r.json();row.devices=devices(s.id,data);row.lastSuccessfulCheck=new Date().toISOString();successful.set(s.id,row.lastSuccessfulCheck);}
  catch{row.problem='Status endpoint unavailable';event(s.id,{state:'error',error:true});}
  row.summary=summarize(row);return row;
 }));cache={format:'tech-hub-diagnostics',version:require('../package.json').version,generatedAt:new Date().toISOString(),platform:process.platform,services,recentEvents:events.slice()};at=Date.now();return cache;
 })().finally(()=>pending=null);return pending;}
 return {collect,event};
}
module.exports={createDiagnostics,devices,summarize};
