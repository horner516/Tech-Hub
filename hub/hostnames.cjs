'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
function installationId(dir){
 const file=path.join(dir,'hostname-id');
 if(fs.existsSync(file)){const id=fs.readFileSync(file,'utf8').trim();if(/^[a-f0-9]{12}$/.test(id))return id;}
 const id=crypto.randomBytes(6).toString('hex');fs.writeFileSync(file,id+'\n',{mode:0o600});return id;
}
function bonjour(onError){
 const instance=new (require('bonjour-service').Bonjour)({},onError);
 // The library callback covers responses; socket bind errors use the mDNS emitter.
 instance.server.mdns.on('error',onError);
 instance.server.mdns.on('warning',onError);
 return instance;
}
const aliases={master:'tech',dsan:'dsan',lux:'lux',power:'pd',netgear:'netgear',record:'record',ultrix:'router',rtoo:'rtoo','pixel-peeker':'pixel','otter-edid-editor':'edid'};
function validateNaming(value={suffix:'',portless:true},serviceIds=[]){
 const allowed={...aliases};for(const id of serviceIds)if(!Object.hasOwn(allowed,id)&&/^[a-z][a-z0-9-]{1,39}$/.test(id))allowed[id]=('app-'+id).slice(0,30).replace(/-$/,'');
 if(!value||typeof value.suffix!=='string'||typeof value.portless!=='boolean')throw Error('Choose a machine identifier and port-free setting.');
 const suffix=value.suffix.trim().toLowerCase();
 if(suffix&&!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(suffix))throw Error('Use up to 32 letters, numbers or hyphens; start and end with a letter or number.');
 if(value.names!==undefined&&(!value.names||typeof value.names!=='object'||Array.isArray(value.names)))throw Error('Service names must be an object.');
 if(Object.keys(value.names||{}).some(id=>!Object.hasOwn(allowed,id)))throw Error('Unknown service name.');
 const names={},used=new Set();
 for(const [id,fallback] of Object.entries(allowed)){
  const input=value.names?.[id]??fallback;
  if(typeof input!=='string')throw Error('Enter a hostname for each service.');
  const name=input.trim().toLowerCase().replace(/\.local$/,'');
  if(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name))throw Error('Service names must contain letters, numbers or internal hyphens, optionally ending in .local.');
  const full=name+(suffix?'-'+suffix:'');
  if(full.length>63)throw Error('Each service name plus machine identifier must be at most 63 characters.');
  if(used.has(full))throw Error('Each service must have a different hostname, including the Tech Hub directory.');
  used.add(full);names[id]=name;
 }
 return {suffix,portless:value.portless,names};
}
function serviceHostname(service,suffix='',names={}){return `${names[service]||aliases[service]||service}${suffix?'-'+suffix:''}.local`;}
function createHostnames({dir,getServices,getSuffix=()=>'',getNames=()=>({}),enabled=true,interfaces=os.networkInterfaces,factory=bonjour,intervalMs=5000,probeMs=900}){
 const id=installationId(dir),entries=new Map();let instance,signature='',stopped=false,pending=Promise.resolve(),failed=false;
 const hostname=service=>serviceHostname(service,getSuffix(),getNames());
 const info=service=>{const entry=entries.get(service);return {hostname:hostname(service),hostnameStatus:!enabled?'off':failed?'unavailable':entry?.status||'off',hostnameURL:entry?.status==='advertised'&&!failed?`http://${hostname(service)}${entry.port===80?'':':'+entry.port}`:null};};
 async function clear(){
  entries.clear();if(!instance)return;const old=instance;instance=null;
  await new Promise(resolve=>{const timer=setTimeout(resolve,500);try{old.unpublishAll(()=>{clearTimeout(timer);resolve();});}catch{clearTimeout(timer);resolve();}});
  old.destroy();
 }
 async function reconcile(){
  if(stopped)return;
  const addresses=Object.values(interfaces()).flat().filter(a=>a&&!a.internal&&a.family==='IPv4'&&a.mac!=='00:00:00:00:00:00').map(a=>a.address).sort();
  const services=enabled&&addresses.length?getServices().filter(s=>s.enabled):[];
  const next=JSON.stringify([addresses,getSuffix(),services.map(s=>[s.id,s.port,hostname(s.id)])]);
  if(next===signature&&!failed)return;signature=next;
  await clear();if(stopped||!services.length)return;failed=false;
  try{
   instance=factory(()=>{failed=true;});
   const mdns=instance.server?.mdns;
   // Check A records as well as DNS-SD service names: another device may use
   // dsan.local without advertising a Tech Hub service. Keep watching after startup.
   const names=new Map(services.map(s=>[hostname(s.id),s.id]));
   for(const s of services)entries.set(s.id,{port:s.port,status:'announcing'});
   if(mdns){
    mdns.on('response',packet=>{
     for(const rr of [...(packet.answers||[]),...(packet.additionals||[])]){
      const entry=entries.get(names.get(rr.name.toLowerCase().replace(/\.$/,'')));
      if(entry&&rr.ttl!==0&&((rr.type==='A'&&!addresses.includes(rr.data))||rr.type==='AAAA')){
       entry.status='conflict';entry.service?.stop();
      }
     }
    });
    for(let n=0;n<3;n++){mdns.query({questions:[...names.keys()].map(name=>({name,type:'ANY'}))});await new Promise(r=>setTimeout(r,probeMs/3));}
   }
   if(stopped)return;
   for(const s of services){
    const entry=entries.get(s.id);if(entry.status==='conflict')continue;
    const service=instance.publish({name:`Tech Hub ${id} ${s.name}`,host:hostname(s.id),type:'http',protocol:'tcp',port:s.port,disableIPv6:true,txt:{path:'/'}});
    entry.service=service;
    service.on('up',()=>{if(entries.get(s.id)===entry&&entry.status!=='conflict')entry.status='advertised';});
    service.on('error',()=>{entry.status='unavailable';});
   }
  }catch{failed=true;await clear();}
 }
 function sync(){pending=pending.then(reconcile).catch(()=>{failed=true;});return pending;}
 const timer=setInterval(sync,intervalMs);timer.unref();void sync();
 return {info,sync,async stop(){stopped=true;clearInterval(timer);await pending;await clear();}};
}
module.exports={installationId,createHostnames,serviceHostname,validateNaming};
