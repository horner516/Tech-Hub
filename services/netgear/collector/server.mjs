import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import dns from 'node:dns/promises';import {fileURLToPath} from 'node:url';import snmp from 'net-snmp';import {createEditSessions,hashPin,validPin,PIN_RULE,isPinRecord,cookieSid} from './edit-access.mjs';import {createPortEditor,portLock} from './port-edit.mjs';import {createScheduler,pool} from './scheduler.mjs';import {withAvSession,listProfiles,assignableProfile,profileAssignment} from './av-ui.mjs';import {readHostArp,browseMdns,ARP_OIDS,parseArpVarbinds,parseRouterList} from './endpoints.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),dataRoot=(process.env.TECH_HUB_DATA_DIR||process.env.NETGEAR_DISCOVERY_DATA_DIR)?path.resolve(process.env.TECH_HUB_DATA_DIR||process.env.NETGEAR_DISCOVERY_DATA_DIR):root;fs.mkdirSync(dataRoot,{recursive:true});
const envPath=path.join(dataRoot,'.env'),cachePath=path.join(dataRoot,'discovery-cache.json'),schemePath=path.join(dataRoot,'color-scheme.json');
if(fs.existsSync(envPath))process.loadEnvFile(envPath);
const managed=process.env.TECH_HUB_MANAGED==='1';
const securityLevelNames=['noAuthNoPriv','authNoPriv','authPriv'];
const defaults={subnet:'10.1.0.0/24',sourceAddress:'',username:'dashboard',securityLevel:'authPriv',authProtocol:'sha512',authKey:'',privProtocol:'aes',privKey:'',webUsername:'admin',webPassword:'',port:8787,bindAddress:'0.0.0.0',pollSeconds:30,discoverySeconds:300,statusSeconds:3,editingEnabled:false,editPinHash:'',endpointMdns:true,arpRouters:[],arpSnmp:'v3',arpCommunity:''};
const statusChoices=[0,2,3,5,10,30],discoveryChoices=[60,300,900,3600],envNumber=(name,fallback,allowed)=>{const raw=process.env[name],number=raw===undefined||raw===''?fallback:Number(raw);return allowed.includes(number)?number:fallback};
const defaultProfiles=[
 [1,'Default','#111827'],[2,'PDMonitor','#1687ff'],[10,'ShowInternet','#ffe2ae'],[11,'11_DantePrimary','#ff2b2b'],[12,'12_Dante Secondary','#ffd900'],[13,'13_AudioControl','#ff00cc'],[14,'AUD_14','#eaff00'],[15,'Waves','#7700e8'],[16,'Riedel','#ff271e'],[17,'17_Riedel2','#ff2a28'],[18,'VOIPRemotes','#f4b4df'],[19,'19_AudKVM','#e83ee8'],[21,'Video_21','#1e9bff'],[22,'22_D3Net - Data','#b9fff5'],[26,'26_LX Main','#ff9518'],[27,'27_LX_2nd','#f6d4ff'],[28,'28_Banners','#ff2424'],[29,'29_Showcase 2','#f000d8'],[31,'31_Dante Guest P','#ff2525'],[32,'32_Dante Guest Sec','#caff00'],[33,'Guest 3','#ef8bdc'],[35,'Guest5','#ef51d6'],[41,'Shure Profile','#e6ff00'],[42,'Shure Profile Audio Dante','#0879ee'],[43,'43_Dante Sec','#ffd8cc'],[99,'Remote Internet','#fff3a5'],[101,'Shop Internet','#7f8cff'],[102,'Shop - Cameras','#8886ee'],[103,'Shop-Guest','#fff5a3'],[3001,'3001 - LX','#111827'],[3002,'3002 - LX','#7000ff'],[3005,'3005 LX','#f000dd'],[3007,'3007 - LX','#eb63d7'],[3024,'3024','#b600df']
].map(([id,name,color])=>({id:Number(id),name:String(name),color:String(color)}));
const defaultColorScheme=()=>({sourceIp:'default',sourceName:'Current NETGEAR AV setup',updatedAt:'2026-09-01T15:00:00.000Z',profiles:defaultProfiles});
let config={...defaults,subnet:process.env.SNMP_SUBNET||defaults.subnet,sourceAddress:process.env.SNMP_SOURCE_ADDRESS||'',username:process.env.SNMP_USERNAME||defaults.username,securityLevel:securityLevelNames.includes(process.env.SNMP_SECURITY_LEVEL)?process.env.SNMP_SECURITY_LEVEL:defaults.securityLevel,authProtocol:(process.env.SNMP_AUTH_PROTOCOL||defaults.authProtocol).toLowerCase(),authKey:process.env.SNMP_AUTH_KEY||'',privProtocol:(process.env.SNMP_PRIV_PROTOCOL||defaults.privProtocol).toLowerCase(),privKey:process.env.SNMP_PRIV_KEY||'',webUsername:process.env.NETGEAR_WEB_USERNAME||defaults.webUsername,webPassword:process.env.NETGEAR_WEB_PASSWORD||'',port:Number(process.env.COLLECTOR_PORT||defaults.port),bindAddress:process.env.SERVER_BIND_ADDRESS||defaults.bindAddress,pollSeconds:Number(process.env.POLL_SECONDS||defaults.pollSeconds),discoverySeconds:envNumber('DISCOVERY_SECONDS',defaults.discoverySeconds,discoveryChoices),statusSeconds:envNumber('STATUS_SECONDS',defaults.statusSeconds,statusChoices),endpointMdns:process.env.ENDPOINT_MDNS!=='0',arpRouters:(()=>{try{return parseRouterList(process.env.ARP_ROUTERS)}catch{return []}})(),arpSnmp:process.env.ARP_SNMP==='v2c'?'v2c':'v3',arpCommunity:process.env.ARP_COMMUNITY||'',editingEnabled:process.env.VLAN_EDITING==='1',editPinHash:isPinRecord(process.env.EDIT_PIN_HASH)?process.env.EDIT_PIN_HASH:''};
if(managed){config.port=Number(process.env.TECH_HUB_BACKEND_PORT);config.bindAddress='127.0.0.1';}
const configured=()=>(config.securityLevel==='noAuthNoPriv'||config.authKey.length>=8)&&(config.securityLevel!=='authPriv'||config.privKey.length>=8);
const authProtocols={sha:snmp.AuthProtocols.sha,sha224:snmp.AuthProtocols.sha224,sha256:snmp.AuthProtocols.sha256,sha384:snmp.AuthProtocols.sha384,sha512:snmp.AuthProtocols.sha512};
const privProtocols={aes:snmp.PrivProtocols.aes,aes128:snmp.PrivProtocols.aes};
const securityLevels={noAuthNoPriv:snmp.SecurityLevel.noAuthNoPriv,authNoPriv:snmp.SecurityLevel.authNoPriv,authPriv:snmp.SecurityLevel.authPriv};
const snmpUser=()=>{const level=securityLevels[config.securityLevel]??snmp.SecurityLevel.authPriv,user={name:config.username,level};if(level!==snmp.SecurityLevel.noAuthNoPriv){user.authProtocol=authProtocols[config.authProtocol]??snmp.AuthProtocols.sha512;user.authKey=config.authKey}if(level===snmp.SecurityLevel.authPriv){user.privProtocol=privProtocols[config.privProtocol]??snmp.PrivProtocols.aes;user.privKey=config.privKey}return user};
const O={sysDescr:'1.3.6.1.2.1.1.1.0',sysUpTime:'1.3.6.1.2.1.1.3.0',sysName:'1.3.6.1.2.1.1.5.0',ifDescr:'1.3.6.1.2.1.2.2.1.2',ifType:'1.3.6.1.2.1.2.2.1.3',ifOper:'1.3.6.1.2.1.2.2.1.8',inDiscards:'1.3.6.1.2.1.2.2.1.13',inErrors:'1.3.6.1.2.1.2.2.1.14',outDiscards:'1.3.6.1.2.1.2.2.1.19',outErrors:'1.3.6.1.2.1.2.2.1.20',ifName:'1.3.6.1.2.1.31.1.1.1.1',ifHCInOctets:'1.3.6.1.2.1.31.1.1.1.6',ifHCOutOctets:'1.3.6.1.2.1.31.1.1.1.10',ifHighSpeed:'1.3.6.1.2.1.31.1.1.1.15',ifAlias:'1.3.6.1.2.1.31.1.1.1.18',bridgeMap:'1.3.6.1.2.1.17.1.4.1.2',pvid:'1.3.6.1.2.1.17.7.1.4.5.1.1',vlanName:'1.3.6.1.2.1.17.7.1.4.3.1.1',fdbPort:'1.3.6.1.2.1.17.7.1.2.2.1.2',neighborMac:'1.3.6.1.2.1.4.35.1.4',lldpName:'1.0.8802.1.1.2.1.4.1.1.9',lldpPortDesc:'1.0.8802.1.1.2.1.4.1.1.8',lldpMgmt:'1.0.8802.1.1.2.1.4.2.1.3',poeDetection:'1.3.6.1.2.1.105.1.1.1.6',opticalRxLegacy:'1.3.6.1.4.1.4526.10.43.1.16.1.6',opticalRx:'1.3.6.1.4.1.4526.10.43.1.18.1.6',vlanEgress:'1.3.6.1.2.1.17.7.1.4.3.1.2',vlanUntagged:'1.3.6.1.2.1.17.7.1.4.3.1.4',lagAttached:'1.2.840.10006.300.43.1.2.1.1.13'};
let savedState=null;try{savedState=JSON.parse(fs.readFileSync(cachePath,'utf8'))}catch{}
let state=savedState?.subnet===config.subnet&&Array.isArray(savedState.switches)?{...savedState,status:'online',error:null}:{status:configured()?'starting':'setup_required',subnet:config.subnet,lastUpdated:null,vlans:[],switches:[],error:null};
const switchCache=new Map((state.switches||[]).map(item=>[item.ip,{switchData:item,vlans:(state.vlans||[]).map(({id,name})=>({id,name})),lastSeen:Date.now()}])),cacheTtlMs=5*60*1000;
let colorScheme=defaultColorScheme();try{const saved=JSON.parse(fs.readFileSync(schemePath,'utf8')),complete=Array.isArray(saved.profiles)&&saved.profiles.some(profile=>profile.color)&&saved.profiles.some(profile=>profile.name&&!/^VLAN \d+$/i.test(profile.name));if(complete)colorScheme=saved;else fs.writeFileSync(schemePath,JSON.stringify(colorScheme,null,2),{mode:0o600})}catch{fs.writeFileSync(schemePath,JSON.stringify(colorScheme,null,2),{mode:0o600})}
const value=v=>Buffer.isBuffer(v)?v.toString('utf8').replace(/\0/g,'').trim():v,indexOf=(oid,base)=>Number(oid.slice(base.length+1).split('.').pop());
function session(ip){return snmp.createV3Session(ip,snmpUser(),{port:Number(process.env.SNMP_PORT||161),retries:1,timeout:1800,transport:'udp4',sourceAddress:config.sourceAddress||undefined,backwardsGetNexts:true,idBitsSize:32})}
function get(ip,oids){return new Promise((resolve,reject)=>{const s=session(ip);let settled=false;const done=(e,v)=>{if(settled)return;settled=true;try{s.close()}catch{}e?reject(e):resolve(v)};s.on('error',e=>done(e));s.get(oids,(e,v)=>done(e,v))})}
// A walk always settles: a hard deadline plus a guarded feed callback, so a malformed reply can't leave a switch's
// refresh pending forever (which would silently stop that switch from ever being read again).
// `shared` reuses one SNMPv3 session for a whole switch read, so engine discovery happens once rather than per walk.
function walk(ip,base,shared){return new Promise((resolve,reject)=>{const s=shared||session(ip),rows=[];let settled=false;const timer=setTimeout(()=>done(new Error(`SNMP walk of ${base} timed out`)),20000),onError=e=>done(e),done=e=>{if(settled)return;settled=true;clearTimeout(timer);s.removeListener('error',onError);if(!shared)try{s.close()}catch{}e?reject(e):resolve(rows)};s.on('error',onError);s.subtree(base,20,vbs=>{try{for(const vb of vbs)if(vb?.oid&&!snmp.isVarbindError(vb))rows.push(vb)}catch(e){done(e);return true}},e=>done(e))})}
const avProfiles=(ip,username,password)=>withAvSession(ip,username,password,listProfiles);
function hosts(cidr){const [raw,bitsText]=cidr.split('/'),bits=Number(bitsText);if(bits<16||bits>30)throw new Error('Subnet must be between /16 and /30');const parts=raw.split('.').map(Number);if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error('Enter a valid IPv4 subnet');const n=((parts[0]<<24)|(parts[1]<<16)|(parts[2]<<8)|parts[3])>>>0,mask=(0xffffffff<<(32-bits))>>>0,network=n&mask,size=2**(32-bits),out=[];for(let i=1;i<size-1;i++){const x=(network+i)>>>0;out.push(`${x>>>24}.${(x>>>16)&255}.${(x>>>8)&255}.${x&255}`)}return out}
async function discover(ip){try{const v=await get(ip,[O.sysDescr,O.sysName,O.sysUpTime]);const descr=String(value(v[0].value)||'');if(!/netgear|m4[0-9]{3}/i.test(descr))return null;return {ip,descr,name:String(value(v[1].value)||ip),ticks:Number(v[2].value||0)}}catch{return null}}
const table=rows=>Object.fromEntries(rows.map(r=>[indexOf(r.oid,r.base),value(r.value)]));
const rawTable=rows=>Object.fromEntries(rows.map(r=>[indexOf(r.oid,r.base),r.value]));
async function inspect(sw){
 const bases=[O.ifDescr,O.ifType,O.ifOper,O.inDiscards,O.inErrors,O.outDiscards,O.outErrors,O.ifName,O.ifHCInOctets,O.ifHCOutOctets,O.ifHighSpeed,O.ifAlias,O.bridgeMap,O.pvid,O.vlanName,O.fdbPort,O.neighborMac,O.lldpName,O.lldpPortDesc,O.lldpMgmt,O.poeDetection,O.opticalRxLegacy,O.opticalRx,O.vlanEgress,O.vlanUntagged,O.lagAttached];
 const result=[],shared=session(sw.ip);shared.on('error',()=>{});try{for(let i=0;i<bases.length;i+=4)result.push(...await Promise.all(bases.slice(i,i+4).map(async base=>(await walk(sw.ip,base,shared)).map(r=>({...r,base})))))}finally{try{shared.close()}catch{}}
 const tables=result.slice(0,15).map(table);tables[8]=rawTable(result[8]);tables[9]=rawTable(result[9]);
 const [descr,type,oper,inDrop,inErr,outDrop,outErr,names,inOctets,outOctets,speeds,aliases,bridge,pvids,vlanNames]=tables;
 const [fdbRows,neighborRows,lldpRows,lldpDescRows,lldpMgmtRows,poeRows,opticalLegacyRows,opticalRows,vlanEgressRows,vlanUntaggedRows,lagRows]=result.slice(15),lagByIf=table(lagRows),ifToPvid={},bridgeToIf={},ifToBridge={};
 for(const [bridgePort,ifIndex] of Object.entries(bridge)){bridgeToIf[Number(bridgePort)]=Number(ifIndex);ifToBridge[Number(ifIndex)]=Number(bridgePort);const pvid=pvids[Number(bridgePort)];ifToPvid[Number(ifIndex)]=pvid!==undefined?Number(pvid):undefined}
 const portBits=buf=>{const set=new Set();if(!Buffer.isBuffer(buf))return set;for(let i=0;i<buf.length;i++){const byte=buf[i];for(let bit=0;bit<8;bit++)if(byte&(0x80>>bit))set.add(i*8+bit+1)}return set};
 const vlanEgressByVlan=rawTable(vlanEgressRows),vlanUntaggedByVlan=rawTable(vlanUntaggedRows),taggedVlansByBridgePort={};
 for(const vlanId of Object.keys(vlanEgressByVlan)){const egress=portBits(vlanEgressByVlan[vlanId]),untagged=portBits(vlanUntaggedByVlan[vlanId]);for(const bridgePort of egress)if(!untagged.has(bridgePort))(taggedVlansByBridgePort[bridgePort]??=[]).push(Number(vlanId))}
 const normalizeMac=bytes=>bytes.map(n=>Number(n).toString(16).padStart(2,'0')).join(':');
 const macToIp={};
 for(const row of neighborRows){const suffix=row.oid.slice(O.neighborMac.length+1).split('.').map(Number),length=suffix[2],ip=suffix.slice(3,3+length).join('.'),mac=Buffer.isBuffer(row.value)?normalizeMac([...row.value]):'';if(length===4&&mac)macToIp[mac]=ip}
 const macsByIf={};
 for(const row of fdbRows){const suffix=row.oid.slice(O.fdbPort.length+1).split('.').map(Number),mac=normalizeMac(suffix.slice(-6)),ifIndex=bridgeToIf[Number(row.value)];if(ifIndex)(macsByIf[ifIndex]??=[]).push({mac,ip:macToIp[mac]})}
 const lldpByPort={},lldpRemotePortByPort={},lldpIpByPort={};
 for(const row of lldpRows){const suffix=row.oid.slice(O.lldpName.length+1).split('.').map(Number),localPort=suffix.at(-2),name=String(value(row.value)||'').trim();if(localPort&&name)lldpByPort[localPort]=name}
 for(const row of lldpDescRows){const suffix=row.oid.slice(O.lldpPortDesc.length+1).split('.').map(Number),localPort=suffix.at(-2),name=String(value(row.value)||'').trim();if(localPort&&name)lldpRemotePortByPort[localPort]=name}
 for(const row of lldpMgmtRows){const suffix=row.oid.slice(O.lldpMgmt.length+1).split('.').map(Number),localPort=suffix[1],length=suffix[4],ip=suffix.slice(5,5+length).join('.');if(localPort&&length===4)lldpIpByPort[localPort]=ip}
 const poeByPort={};
 for(const row of poeRows){const port=Number(row.oid.split('.').at(-1));poeByPort[port]=Number(row.value)}
 const opticalByPort={};
 for(const row of opticalLegacyRows){const port=Number(row.oid.split('.').at(-1)),raw=value(row.value),text=String(raw??'').trim();if(port&&text)opticalByPort[port]=/dbm/i.test(text)?text:Number.isFinite(Number(raw))?`${(Number(raw)/100).toFixed(2)} dBm`:text}
 for(const row of opticalRows){const port=Number(row.oid.split('.').at(-1)),raw=value(row.value),text=String(raw??'').trim();if(port&&text)opticalByPort[port]=/dbm/i.test(text)?text:Number.isFinite(Number(raw))?`${(Number(raw)/1000).toFixed(3)} dBm`:text}
 const physical=Object.keys(names).map(Number).filter(i=>{const name=String(names[i]||'').trim(),description=String(descr[i]||'').trim(),label=`${name} ${description}`;return [6,117].includes(Number(type[i]))&&!/vlan|loopback|lag|port-channel|cpu|stack/i.test(label)&&(/^\d+(?:\/\d+){0,2}$/.test(name)||/^(?:g|xg|ge|xe)\d+(?:\/\d+){0,2}$/i.test(name)||/(?:ethernet|gigabit|physical)\s*(?:port)?\s*\d+/i.test(description))}).sort((a,b)=>a-b);
 const sampledAt=Date.now(),previous=switchCache.get(sw.ip)?.switchData?.ports||[],counter=item=>{if(typeof item==='bigint')return Number(item);if(Buffer.isBuffer(item)){let total=0;for(const byte of item)total=total*256+byte;return total}return Number(item||0)};
 const switchData={id:sw.ip.replaceAll('.','-'),vlanIds:Object.keys(vlanNames).map(Number).filter(Number.isInteger).sort((a,b)=>a-b),name:sw.name,model:(sw.descr.match(/M4\d{3}[-\w+]*/i)||['NETGEAR AV'])[0],ip:sw.ip,location:'Discovered switch',uptime:formatUptime(sw.ticks),ports:physical.map((ifIndex,pos)=>{const label=String(names[ifIndex]||descr[ifIndex]),number=Number((label.match(/\d+(?!.*\d)/)||[pos+1])[0]),speed=Number(speeds[ifIndex]||0),learned=[...new Map((macsByIf[ifIndex]||[]).map(item=>[item.mac,item])).values()],endpoint=learned.length===1?learned[0]:null,description=String(aliases[ifIndex]||'').trim()||undefined,device=lldpByPort[ifIndex]||lldpByPort[number]||(learned.length===1?'Learned endpoint':learned.length>1?`${learned.length} learned devices`:undefined),bytesIn=counter(inOctets[ifIndex]),bytesOut=counter(outOctets[ifIndex]),prior=previous.find(port=>port.number===number),elapsed=prior?.sampledAt?(sampledAt-prior.sampledAt)/1000:0,hasPrior=prior?.bytesIn!=null&&prior?.bytesOut!=null,delta=hasPrior&&elapsed>0?Math.max(0,bytesIn-Number(prior.bytesIn))+Math.max(0,bytesOut-Number(prior.bytesOut)):0;const lag=Number(lagByIf[ifIndex]||0);return {number,ifIndex,bridgePort:ifToBridge[ifIndex],lag:lag>0&&lag!==ifIndex?lag:undefined,interface:label,description,status:Number(oper[ifIndex])===1?'up':'down',speed:formatSpeed(speed),vlan:ifToPvid[ifIndex]??null,tagged:taggedVlansByBridgePort[ifToBridge[ifIndex]]?.length?[...new Set(taggedVlansByBridgePort[ifToBridge[ifIndex]])].sort((a,b)=>a-b):undefined,device,neighborPort:lldpRemotePortByPort[ifIndex]||lldpRemotePortByPort[number],ip:endpoint?.ip||lldpIpByPort[ifIndex]||lldpIpByPort[number],mac:endpoint?.mac,learnedMacs:learned.map(item=>item.mac),drops:Number(inDrop[ifIndex]||0)+Number(outDrop[ifIndex]||0),errors:Number(inErr[ifIndex]||0)+Number(outErr[ifIndex]||0),poe:poeByPort[number]===3?'Delivering power':poeByPort[number]===2?'Not delivering':undefined,optical:opticalByPort[ifIndex]||opticalByPort[number],media:/49|50|51|52$|sfp|fiber|10g/i.test(label)||number>48?'sfp':'copper',bytesIn,bytesOut,sampledAt,usageMbps:hasPrior&&elapsed>0?delta*8/elapsed/1e6:undefined}})};
 return {switchData,macToIp,vlans:Object.entries(vlanNames).map(([id,name])=>({id:Number(id),name:String(name)||`VLAN ${id}`})).sort((a,b)=>a.id-b.id)}
}
const genericVlanName=(name,id)=>!String(name||'').trim()||String(name).trim().toLowerCase()===`vlan ${id}`.toLowerCase();
const nestedEntries=value=>value&&typeof value==='object'?Object.entries(value).flatMap(([key,item])=>[[key,item],...(item&&typeof item==='object'?nestedEntries(item):[])]):[];
const fieldValue=(profile,exact,pattern)=>{for(const key of exact)if(profile?.[key]!==undefined&&profile[key]!==null&&profile[key]!=='')return profile[key];const match=nestedEntries(profile).find(([key,value])=>pattern.test(key)&&value!==undefined&&value!==null&&value!==''&&typeof value!=='object');return match?.[1]};
const cssColor=value=>{if(value===undefined||value===null||value==='')return undefined;if(typeof value==='object'){const nested=value.hex??value.value??value.rgb??value.color??value.colour;if(nested!==undefined)return cssColor(nested);const {r,g,b}=value;if([r,g,b].every(channel=>Number.isFinite(Number(channel))))return `rgb(${Number(r)} ${Number(g)} ${Number(b)})`;return undefined}if(typeof value==='number'){if(value<256)return undefined;return `#${Math.min(value,0xffffff).toString(16).padStart(6,'0')}`}const color=String(value).trim();if(/^#?[0-9a-f]{6,8}$/i.test(color))return color.startsWith('#')?color:`#${color}`;if(/^(?:rgb|hsl)a?\(|^[a-z]+$/i.test(color))return color;return undefined};
function normalizeAvProfile(profile){
 const id=Number(fieldValue(profile,['vlanId','vlan_id','vid','vlan','id'],/(?:^|_)(?:vlan_?)?id$/i));
 const rawName=fieldValue(profile,['profileName','profile_name','vlanName','vlan_name','networkName','network_name','displayName','display_name','name','label'],/(?:profile|vlan|network|display).*name|(?:^|_)label$/i);
 const rawColor=fieldValue(profile,['profileColor','profile_color','vlanColor','vlan_color','networkColor','network_color','color','colour','hexColor','hex_color','colorCode','color_code'],/(?:color|colour)/i);
 return {id,name:String(rawName||`VLAN ${id}`),color:cssColor(rawColor)};
}
const applyColorScheme=vlans=>{const byId=new Map(colorScheme.profiles.map(profile=>[Number(profile.id),profile]));return vlans.map(vlan=>{const profile=byId.get(Number(vlan.id)),name=profile&&!genericVlanName(profile.name,profile.id)?String(profile.name):vlan.name,color=cssColor(profile?.color);return {...vlan,name:String(name||`VLAN ${vlan.id}`),color}})};
function combinedVlans(){const byId=new Map;for(const item of switchCache.values())for(const vlan of item.vlans)if(!byId.has(vlan.id))byId.set(vlan.id,{id:Number(vlan.id),name:String(vlan.name)});return applyColorScheme([...byId.values()].sort((a,b)=>a.id-b.id))}
const formatSpeed=speed=>speed?`${speed>=1000?speed/1000:speed}${speed>=1000?'G':'M'}`:undefined;
function formatUptime(ticks){const sec=Math.floor(ticks/100),d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600);return `${d}d ${String(h).padStart(2,'0')}h`}
// ---- Polling: discovery sweep, staggered per-switch reads, fast link status (see scheduler.mjs) ----
const dnsCache=new Map(),dnsTtlMs=10*60*1000;
async function resolveNames(ips){const fresh=Date.now()-dnsTtlMs,todo=[...new Set(ips)].filter(ip=>!(dnsCache.get(ip)?.at>fresh));await pool(todo,12,async ip=>{let name=null;try{const names=await Promise.race([dns.reverse(ip),new Promise((_,reject)=>setTimeout(()=>reject(new Error('DNS timeout')),700))]);name=names?.[0]?.replace(/\.$/,'')||null}catch{}dnsCache.set(ip,{name,at:Date.now()})})}
const eventClients=new Set();
function broadcast(event,data){const payload=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;for(const res of eventClients)res.write(payload)}
const localMacs=()=>new Set(Object.values(os.networkInterfaces()).flat().map(item=>String(item?.mac||'').toLowerCase()).filter(mac=>mac&&mac!=='00:00:00:00:00:00'));
const editContext=()=>({switches:state.switches,localMacs:localMacs()});
const decorate=(sw,context=editContext())=>({...sw,ports:sw.ports.map(port=>({...port,lock:portLock(sw,port,context)??undefined}))});
// Endpoint IPs from this computer's ARP table and names from Bonjour (see endpoints.mjs); both local-network only.
let hostArp=new Map(),hostArpAt=0,mdnsNames=new Map(),mdnsAt=0,mdnsRunning=false;
let hostArpProblem=null,hostArpLogged=false;
async function refreshHostArp(force=false){if(!force&&Date.now()-hostArpAt<15000)return;hostArpAt=Date.now();try{hostArp=await readHostArp();if(hostArpProblem||!hostArpLogged){hostArpLogged=true;console.log(`This computer's ARP table: ${hostArp.size} entries`)}hostArpProblem=null}catch(e){if(hostArpProblem!==e.message)console.warn(`Could not read this computer's ARP table: ${e.message}`);hostArpProblem=e.message}}
const macToIpAll=()=>Object.assign(Object.fromEntries(hostArp),Object.fromEntries(routerArp),...[...switchCache.values()].map(item=>item.macToIp||{}));
const broadcastAllSwitches=()=>{const context=editContext();for(const item of switchCache.values())broadcast('switch',{switch:decorate(item.switchData,context),vlans:state.vlans,lastUpdated:state.lastUpdated,status:state.status})};
// Routers' ARP tables over SNMP: the reliable MAC → IP source for every routed VLAN (macOS hides its own ARP table
// from apps, and the switches only know hosts on their management VLAN).
let routerArp=new Map(),routerArpAt=0,routerArpRunning=false;const routerStatus=new Map();
const routerSession=ip=>config.arpSnmp==='v2c'?snmp.createSession(ip,config.arpCommunity,{version:snmp.Version2c,port:Number(process.env.SNMP_PORT||161),retries:1,timeout:1800,transport:'udp4',sourceAddress:config.sourceAddress||undefined,backwardsGetNexts:true,idBitsSize:32}):session(ip);
async function refreshRouterArp(){
 if(routerArpRunning||!config.arpRouters.length)return;routerArpRunning=true;routerArpAt=Date.now();
 try{
  const merged=new Map();
  for(const ip of config.arpRouters){
   const s=routerSession(ip),previous=routerStatus.get(ip);s.on('error',()=>{});
   try{let rows=(await walk(ip,ARP_OIDS.physical,s)).map(r=>({...r,base:ARP_OIDS.physical}));if(!rows.length)rows=(await walk(ip,ARP_OIDS.legacy,s)).map(r=>({...r,base:ARP_OIDS.legacy}));const table=parseArpVarbinds(rows);for(const [mac,address] of table)merged.set(mac,address);routerStatus.set(ip,{entries:table.size,at:new Date().toISOString(),error:null});if(!previous||previous.error)console.log(`Router ARP ${ip}: ${table.size} entries`)}
   catch(e){routerStatus.set(ip,{entries:0,at:new Date().toISOString(),error:e.message});if(previous?.error!==e.message)console.warn(`Router ARP ${ip}: ${e.message}`)}
   finally{try{s.close()}catch{}}
  }
  const changed=merged.size!==routerArp.size||[...merged].some(([mac,address])=>routerArp.get(mac)!==address);routerArp=merged;
  if(changed&&switchCache.size){buildState();broadcastAllSwitches()}
 }finally{routerArpRunning=false}
}
async function refreshMdns(){
 if(mdnsRunning||!config.endpointMdns)return;mdnsRunning=true;mdnsAt=Date.now();
 const stats={};
 try{mdnsNames=await browseMdns({stats});await new Promise(resolve=>setTimeout(resolve,1500));await refreshHostArp(true);if(switchCache.size){buildState();broadcastAllSwitches()}console.log(`Bonjour: ${mdnsNames.size} named device(s) via ${stats.interfaces?.join(', ')||'no private IPv4 interface'}; ${stats.replies??0} replies${stats.errors?.length?`; errors: ${stats.errors.join('; ')}`:''}`)}
 catch(e){console.warn(`Bonjour lookup failed: ${e.message}`)}
 finally{mdnsRunning=false}
}
let persistTimer=null,sweptOnce=false;
function persist(){if(persistTimer)return;persistTimer=setTimeout(()=>{persistTimer=null;try{fs.writeFileSync(cachePath,JSON.stringify(state),{mode:0o600})}catch(e){console.warn(`Could not save the discovery cache: ${e.message}`)}},10000);persistTimer.unref?.()}
function buildState(){
 const now=Date.now();for(const [ip,cached] of switchCache)if(now-cached.lastSeen>cacheTtlMs){switchCache.delete(ip);broadcast('removed',{ip})}
 const cached=[...switchCache.values()],globalMacToIp=macToIpAll();
 for(const item of cached)for(const port of item.switchData.ports){if(!port.ip&&port.learnedMacs?.length===1)port.ip=globalMacToIp[port.learnedMacs[0]];const name=port.ip&&(mdnsNames.get(port.ip)?.name||dnsCache.get(port.ip)?.name);if(name&&(!port.device||/^(?:Learned endpoint|Known IP endpoint|MAC [0-9a-f:]+)$/.test(port.device)))port.device=name;else if(port.learnedMacs?.length===1&&(!port.device||port.device==='Learned endpoint'))port.device=`MAC ${port.learnedMacs[0]}`}
 const switches=cached.map(item=>item.switchData).sort((a,b)=>a.ip.localeCompare(b.ip,undefined,{numeric:true}));
 state={status:switches.length||sweptOnce?'online':'scanning',subnet:config.subnet,lastUpdated:new Date().toISOString(),vlans:combinedVlans(),switches,error:null};
 persist();
}
async function sweepSubnet(){
 try{const found=await pool(hosts(config.subnet),24,discover);sweptOnce=true;console.log(`Discovery sweep: ${found.length} NETGEAR switch(es) answered on ${config.subnet}`);if(!found.length){buildState();broadcast('status',{status:state.status,subnet:state.subnet})}return found}
 catch(e){state={...state,status:'error',error:e.message,lastUpdated:new Date().toISOString()};broadcast('status',{status:state.status,error:state.error});throw e}
}
async function refreshSwitch(ip){
 const sw=await discover(ip);if(!sw)throw new Error('no SNMP response');
 const inspected=await inspect(sw);switchCache.set(ip,{...inspected,lastSeen:Date.now()});
 await refreshHostArp();const globalMacToIp=macToIpAll();
 await resolveNames(inspected.switchData.ports.map(port=>port.ip||(port.learnedMacs?.length===1?globalMacToIp[port.learnedMacs[0]]:undefined)).filter(Boolean));
 buildState();
 const current=switchCache.get(ip)?.switchData;if(current)broadcast('switch',{switch:decorate(current),vlans:state.vlans,lastUpdated:state.lastUpdated,status:state.status});
}
// Link state + speed for every physical port in one or two GETs per switch, on a session kept open between
// checks so SNMPv3 engine discovery isn't repeated every few seconds.
const statusSessions=new Map();
function closeStatusSession(ip){const s=statusSessions.get(ip);statusSessions.delete(ip);try{s?.close()}catch{}}
function statusGet(ip,oids){return new Promise((resolve,reject)=>{let s=statusSessions.get(ip);if(!s){s=session(ip);s.on('error',()=>closeStatusSession(ip));statusSessions.set(ip,s)}s.get(oids,(e,v)=>{if(e){closeStatusSession(ip);reject(e)}else resolve(v)})})}
async function statusCheck(ip){
 const item=switchCache.get(ip);if(!item)return;
 const ports=item.switchData.ports.filter(port=>port.ifIndex),changes=[];
 for(let i=0;i<ports.length;i+=24){const chunk=ports.slice(i,i+24),vbs=await statusGet(ip,chunk.flatMap(port=>[`${O.ifOper}.${port.ifIndex}`,`${O.ifHighSpeed}.${port.ifIndex}`]));chunk.forEach((port,j)=>{const oper=vbs[j*2],rate=vbs[j*2+1];if(!oper||snmp.isVarbindError(oper))return;const status=Number(oper.value)===1?'up':'down',speed=!rate||snmp.isVarbindError(rate)?port.speed:formatSpeed(Number(rate.value||0));if(status!==port.status||speed!==port.speed){port.status=status;port.speed=speed;changes.push({ifIndex:port.ifIndex,number:port.number,status,speed})}})}
 if(changes.length){broadcast('ports',{ip,ports:changes,at:new Date().toISOString()});persist()}
}
const scheduler=createScheduler({io:{sweep:sweepSubnet,refresh:refreshSwitch,status:statusCheck},timing:()=>({pollMs:Math.max(10,config.pollSeconds)*1000,discoveryMs:Math.max(60,config.discoverySeconds)*1000,statusMs:config.statusSeconds>0?Math.max(2,config.statusSeconds)*1000:0}),log:message=>console.warn(message)});
scheduler.seed([...switchCache.keys()]);
// ---- VLAN changes: AV profile assignment through the switch's AV interface, PIN-gated ----
const editSessions=createEditSessions(),auditPath=path.join(dataRoot,'vlan-changes.jsonl');
const portBit=(buf,bridgePort)=>Buffer.isBuffer(buf)&&((buf[Math.floor((bridgePort-1)/8)]??0)&(0x80>>((bridgePort-1)%8)))!==0;
/** Live PVID and membership of one port, straight from the switch (used before and after a change). */
async function readPortVlan(sw,port,vlanIds){const ids=[...new Set(vlanIds)],vbs=await get(sw.ip,[`${O.pvid}.${port.bridgePort}`,...ids.flatMap(id=>[`${O.vlanEgress}.${id}`,`${O.vlanUntagged}.${id}`])]),egress=new Set(),untagged=new Set();ids.forEach((id,i)=>{const e=vbs[1+i*2],u=vbs[2+i*2];if(e&&!snmp.isVarbindError(e)&&portBit(e.value,port.bridgePort))egress.add(id);if(u&&!snmp.isVarbindError(u)&&portBit(u.value,port.bridgePort))untagged.add(id)});return {pvid:snmp.isVarbindError(vbs[0])?null:Number(vbs[0].value),egress,untagged}}
const assignProfile=({sw,port,toVlan})=>withAvSession(sw.ip,config.webUsername,config.webPassword,async av=>{const {groups}=await listProfiles(av),profile=assignableProfile(groups,toVlan);if(!profile)throw Object.assign(new Error(`${sw.name} has no single-VLAN AV network profile for VLAN ${toVlan}, so the AV interface can't assign it to a port. Nothing was changed.`),{status:409});return profileAssignment.assign(av,{port,profile,switch:sw})});
const saveSwitch=({sw})=>withAvSession(sw.ip,config.webUsername,config.webPassword,av=>profileAssignment.save(av,{switch:sw}));
const editor=createPortEditor({getSwitch:ip=>switchCache.get(ip)?.switchData,context:editContext,readPort:readPortVlan,assign:assignProfile,save:saveSwitch,refresh:sw=>scheduler.refreshNow(sw.ip,{force:true}),audit:entry=>{console.log(`VLAN change ${entry.result}: ${entry.switchName} (${entry.switchIp}) port ${entry.port} VLAN ${entry.fromVlan} → ${entry.toVlan}${entry.error?` — ${entry.error}`:''}`);try{fs.appendFileSync(auditPath,JSON.stringify(entry)+'\n',{mode:0o600})}catch(e){console.warn(`Could not write the VLAN change log: ${e.message}`)}}});
function editStatus(req){const reason=[!config.editingEnabled&&'VLAN changes are turned off in Server settings.',!config.editPinHash&&'Set an edit PIN in Server settings.',!(config.webUsername&&config.webPassword)&&'Add the switch admin login in Server settings.',!profileAssignment.ready&&profileAssignment.reason].find(Boolean)||null;return {available:!reason,reason,unlocked:editSessions.unlocked(cookieSid(req)),busy:editor.busy}}
const local=req=>{if(managed)return req.headers['x-techhub-local-client']==='1';const address=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');return ['127.0.0.1','::1',...interfaces().map(item=>item.address)].includes(address)};
const send=(res,status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});res.end(type==='application/json'?JSON.stringify(data):data)};
const readBody=req=>new Promise((resolve,reject)=>{let body='';req.on('data',c=>{body+=c;if(body.length>65536)reject(new Error('Request too large'))});req.on('end',()=>{try{resolve(JSON.parse(body))}catch{reject(new Error('Invalid settings'))}})});
// Edit endpoints: JSON only, same origin only, and no wildcard CORS, so another site can't drive them.
const sendPrivate=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data))};
const sameOrigin=req=>{const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host}catch{return false}};
async function readJson(req){if(!/^application\/json\b/i.test(req.headers['content-type']||''))throw Object.assign(new Error('Send JSON'),{status:415});const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw Object.assign(new Error('Request too large'),{status:413});chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('Invalid JSON'),{status:400})}}
const actorFor=req=>`${local(req)?'Tech Hub computer':'dashboard client'} · ${String(req.headers['user-agent']||'unknown browser').slice(0,90)}`;
function publicConfig(){return {managed,subnet:config.subnet,sourceAddress:config.sourceAddress,username:config.username,securityLevel:config.securityLevel,webUsername:config.webUsername,authProtocol:config.authProtocol,privProtocol:config.privProtocol,port:config.port,bindAddress:config.bindAddress,pollSeconds:config.pollSeconds,hasAuthKey:!!config.authKey,hasPrivKey:!!config.privKey,hasWebPassword:!!config.webPassword,discoverySeconds:config.discoverySeconds,statusSeconds:config.statusSeconds,editingEnabled:config.editingEnabled,hasEditPin:!!config.editPinHash,endpointMdns:config.endpointMdns,arpRouters:config.arpRouters.join(', '),arpSnmp:config.arpSnmp,hasArpCommunity:!!config.arpCommunity,arpStatus:Object.fromEntries(routerStatus),pinRule:PIN_RULE,profileAssignmentReady:profileAssignment.ready,profileAssignmentReason:profileAssignment.ready?null:profileAssignment.reason}}
function interfaces(){return Object.entries(os.networkInterfaces()).flatMap(([name,addresses])=>(addresses||[]).filter(a=>(a.family==='IPv4'||a.family===4)&&!a.internal).map(a=>({name,address:a.address,netmask:a.netmask,cidr:a.cidr||`${a.address}/24`,mac:a.mac}))).sort((a,b)=>a.name.localeCompare(b.name)||a.address.localeCompare(b.address,undefined,{numeric:true}))}
function dashboardAddress(){if(!['0.0.0.0','127.0.0.1','::','::1'].includes(config.bindAddress))return config.bindAddress;const available=interfaces(),managementPrefix=config.subnet.split('/')[0].split('.').slice(0,3).join('.');return available.find(item=>!item.address.startsWith(`${managementPrefix}.`))?.address||available[0]?.address||'localhost'}
async function saveConfig(next){hosts(next.subnet);const arpRouters=parseRouterList(next.arpRouters),arpSnmp=next.arpSnmp==='v2c'?'v2c':'v3',arpCommunity=String(next.arpCommunity||'').trim()||config.arpCommunity;if(arpRouters.length&&arpSnmp==='v2c'&&!arpCommunity)throw new Error('Enter the SNMP community for the routers');const editPin=typeof next.editPin==='string'?next.editPin:'';if(editPin&&!validPin(editPin))throw new Error(`Edit PIN: ${PIN_RULE}`);const editPinHash=next.clearEditPin===true||next.clearEditPin==='on'?'':editPin?await hashPin(editPin):config.editPinHash,pinChanged=editPinHash!==config.editPinHash,oldSubnet=config.subnet;if(!next.username?.trim())throw new Error('SNMPv3 username is required');const securityLevel=securityLevelNames.includes(next.securityLevel)?next.securityLevel:config.securityLevel,authKey=next.authKey?.trim()||config.authKey,privKey=next.privKey?.trim()||config.privKey,webPassword=next.webPassword||config.webPassword;if(securityLevel!=='noAuthNoPriv'&&authKey.length<8)throw new Error('An authentication key of at least 8 characters is required for this security level');if(securityLevel==='authPriv'&&privKey.length<8)throw new Error('An encryption key of at least 8 characters is required for authentication + encryption');const oldBind=config.bindAddress;config={...config,subnet:next.subnet.trim(),sourceAddress:(next.sourceAddress||'').trim(),username:next.username.trim(),securityLevel,authProtocol:'sha512',authKey,privProtocol:'aes',privKey,webUsername:(next.webUsername||'admin').trim(),webPassword,bindAddress:managed?'127.0.0.1':(next.bindAddress||'0.0.0.0').trim(),pollSeconds:Math.max(10,Number(next.pollSeconds)||30),discoverySeconds:discoveryChoices.includes(Number(next.discoverySeconds))?Number(next.discoverySeconds):config.discoverySeconds,statusSeconds:statusChoices.includes(Number(next.statusSeconds))?Number(next.statusSeconds):config.statusSeconds,editingEnabled:next.editingEnabled===true||next.editingEnabled==='on',endpointMdns:next.endpointMdns===true||next.endpointMdns==='on',arpRouters,arpSnmp,arpCommunity,editPinHash};routerStatus.clear();routerArpAt=0;const lines=[`SNMP_SUBNET=${config.subnet}`,`SNMP_SOURCE_ADDRESS=${config.sourceAddress}`,`SNMP_USERNAME=${config.username}`,`SNMP_SECURITY_LEVEL=${config.securityLevel}`,`SNMP_AUTH_PROTOCOL=${config.authProtocol}`,`SNMP_AUTH_KEY=${config.authKey}`,`SNMP_PRIV_PROTOCOL=${config.privProtocol}`,`SNMP_PRIV_KEY=${config.privKey}`,`NETGEAR_WEB_USERNAME=${config.webUsername}`,`NETGEAR_WEB_PASSWORD=${config.webPassword}`,`COLLECTOR_PORT=${config.port}`,`SERVER_BIND_ADDRESS=${config.bindAddress}`,`POLL_SECONDS=${config.pollSeconds}`,`DISCOVERY_SECONDS=${config.discoverySeconds}`,`STATUS_SECONDS=${config.statusSeconds}`,`VLAN_EDITING=${config.editingEnabled?1:0}`,`ENDPOINT_MDNS=${config.endpointMdns?1:0}`,`ARP_ROUTERS=${config.arpRouters.join(',')}`,`ARP_SNMP=${config.arpSnmp}`,`ARP_COMMUNITY=${config.arpCommunity}`,`EDIT_PIN_HASH=${config.editPinHash}`];fs.writeFileSync(envPath,lines.join('\n')+'\n',{mode:0o600});if(pinChanged||!config.editingEnabled)editSessions.revokeAll();for(const ip of statusSessions.keys())closeStatusSession(ip);if(oldSubnet!==config.subnet){scheduler.reset();switchCache.clear();sweptOnce=false;state={status:'starting',subnet:config.subnet,lastUpdated:null,vlans:[],switches:[],error:null}}else{state={...state,error:null};scheduler.requestSweep()}scheduler.tick();return oldBind!==config.bindAddress}
const handleRequest=async(req,res)=>{
 if(req.method==='OPTIONS')return send(res,204,{});
 const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
 if(url.pathname==='/api/switches'){const context=editContext();return send(res,200,{...state,switches:state.switches.map(sw=>decorate(sw,context)),edit:editStatus(req),dashboardAddress:dashboardAddress(),dashboardPort:Number(process.env.TECH_HUB_PUBLIC_PORT||3000)})}
 if(url.pathname==='/api/scan'&&req.method==='POST'){let body={};try{body=await readBody(req)}catch{}if(!configured())return send(res,202,{status:'setup_required'});if(body.ip){if(!switchCache.has(String(body.ip)))return send(res,404,{error:'That switch is not currently discovered.'});const started=scheduler.refreshNow(String(body.ip));return send(res,202,{status:started?'refreshing':'recently refreshed'})}const started=scheduler.requestSweep();if(started)mdnsAt=0;return send(res,202,{status:started?'scanning':'scan already running'})}
 if(url.pathname==='/api/events'&&req.method==='GET'){if(eventClients.size>=200)return send(res,503,{error:'Too many live connections'});res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.write('retry: 3000\n\n');eventClients.add(res);req.on('close',()=>eventClients.delete(res));return}
 if(url.pathname==='/api/edit-access')return sendPrivate(res,200,editStatus(req));
 if(url.pathname==='/api/login'&&req.method==='POST'){
  if(!sameOrigin(req))return sendPrivate(res,403,{error:'Cross-origin requests are not allowed.'});
  if(!config.editPinHash)return sendPrivate(res,503,{error:'No edit PIN is set. Set one in Server settings.'});
  try{const body=await readJson(req),result=await editSessions.login(String(body.pin??''),config.editPinHash);if(!result.ok)return sendPrivate(res,result.status,{error:result.error,retryAfterMs:result.retryAfterMs});return sendPrivate(res,200,{ok:true},{'Set-Cookie':`sid=${result.sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(editSessions.ttlMs/1000)}`})}
  catch(e){return sendPrivate(res,e.status||400,{error:e.message})}
 }
 if(url.pathname==='/api/logout'&&req.method==='POST'){if(!sameOrigin(req))return sendPrivate(res,403,{error:'Cross-origin requests are not allowed.'});editSessions.logout(cookieSid(req));return sendPrivate(res,200,{ok:true},{'Set-Cookie':'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})}
 if(url.pathname==='/api/ports/profile'&&req.method==='POST'){
  if(!sameOrigin(req))return sendPrivate(res,403,{error:'Cross-origin requests are not allowed.'});
  const access=editStatus(req);if(!access.available)return sendPrivate(res,503,{error:access.reason});if(!access.unlocked)return sendPrivate(res,401,{error:'PIN required'});
  try{const body=await readJson(req),result=await editor.change({switchIp:String(body.switchIp||''),ifIndex:Number(body.ifIndex),fromVlan:Number(body.fromVlan),toVlan:Number(body.toVlan),actor:actorFor(req)});return sendPrivate(res,200,result)}
  catch(e){return sendPrivate(res,e.status||500,{error:e.message,result:e.result})}
 }
 if(url.pathname==='/api/health')return send(res,200,{ok:true,status:state.status,subnet:config.subnet});
 if(url.pathname==='/api/interfaces'){if(!local(req))return send(res,403,{error:'Interface discovery is available only on the Tech Hub computer.'});return send(res,200,{interfaces:interfaces()})}
 if(url.pathname==='/api/color-scheme'){
  if(req.method==='GET')return send(res,200,colorScheme);
  if(!local(req))return send(res,403,{error:'Color schemes can be changed only on the Tech Hub computer.'});
  if(req.method==='POST'){
   try{const body=await readBody(req),profiles=(body.profiles||[]).map(profile=>({id:Number(profile.id),name:String(profile.name||`VLAN ${profile.id}`),color:profile.color?String(profile.color):undefined})).filter(profile=>Number.isInteger(profile.id)&&profile.id>0&&profile.id<4095);if(!profiles.length)throw new Error('The pulled scheme does not contain any VLAN profiles');colorScheme={sourceIp:String(body.sourceIp||''),sourceName:String(body.sourceName||body.sourceIp||''),updatedAt:new Date().toISOString(),profiles};fs.writeFileSync(schemePath,JSON.stringify(colorScheme,null,2),{mode:0o600});state={...state,vlans:combinedVlans()};fs.writeFileSync(cachePath,JSON.stringify(state),{mode:0o600});return send(res,200,colorScheme)}catch(e){return send(res,400,{error:e.message})}
  }
 }
 if(url.pathname==='/api/color-scheme/pull'&&req.method==='POST'){
  if(!local(req))return send(res,403,{error:'AV interface login is available only on the Tech Hub computer.'});
  try{const body=await readBody(req),target=state.switches.find(item=>item.ip===body.switchIp);if(!target)throw new Error('Select a currently discovered switch');const pulled=await avProfiles(target.ip,String(body.username||'admin'),String(body.password||'')),profiles=[...new Map(pulled.profiles.map(normalizeAvProfile).filter(profile=>Number.isInteger(profile.id)&&profile.id>0&&profile.id<4095).map(profile=>[profile.id,profile])).values()];if(!profiles.length)throw new Error('No AV VLAN profiles were returned by this switch');return send(res,200,{sourceIp:target.ip,sourceName:target.name,endpoint:pulled.endpoint,profiles})}catch(e){return send(res,400,{error:e.message})}
 }
 if(url.pathname==='/setup'||url.pathname==='/setup.css'||url.pathname==='/setup.js'){
  if(!local(req))return send(res,403,'Settings are available only on the Tech Hub computer.','text/plain');
  const file=url.pathname==='/setup'?'setup.html':url.pathname.slice(1);
  return send(res,200,fs.readFileSync(path.join(root,file)),file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');
 }
 if(url.pathname==='/api/config'){
  if(!local(req))return send(res,403,{error:'Settings are available only on the Tech Hub computer.'});
  if(req.method==='GET')return send(res,200,publicConfig());
  if(req.method==='POST'){
   try{const restartRequired=await saveConfig(await readBody(req));return send(res,200,{ok:true,restartRequired,status:'Scanning network…'})}
   catch(e){return send(res,400,{error:e.message})}
  }
 }
 if(req.method==='GET'&&!url.pathname.startsWith('/api/')){
  try {
   const publicRoot=path.resolve(root,'../out'),file=path.resolve(publicRoot,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(publicRoot+path.sep))return send(res,403,{error:'Forbidden'});
   const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain'};
   return send(res,200,fs.readFileSync(file),types[path.extname(file)]||'application/octet-stream');
  }catch{}
 }
 return send(res,404,{error:'Not found'});
};
const listen=address=>http.createServer(handleRequest).listen(config.port,address,()=>console.log(`NETGEAR AV collector listening on ${address}:${config.port}`));
const availableAddresses=new Set(interfaces().map(item=>item.address));
if(!['0.0.0.0','127.0.0.1','::','::1'].includes(config.bindAddress)&&!availableAddresses.has(config.bindAddress)){
 console.warn(`Configured bind address ${config.bindAddress} is unavailable; listening on all interfaces instead`);
 config.bindAddress='0.0.0.0';
}
if(config.sourceAddress&&!availableAddresses.has(config.sourceAddress)){
 console.warn(`Configured SNMP source address ${config.sourceAddress} is unavailable; using automatic routing instead`);
 config.sourceAddress='';
}
listen(config.bindAddress);
if(!['0.0.0.0','127.0.0.1'].includes(config.bindAddress))listen('127.0.0.1');
if(!managed&&!['::','::1'].includes(config.bindAddress))listen('::1');
if(configured())scheduler.tick();else console.log(`Complete setup at http://localhost:${config.port}/setup`);
setInterval(()=>{if(!configured())return;scheduler.tick();if(config.endpointMdns&&switchCache.size&&Date.now()-mdnsAt>=Math.max(60,config.discoverySeconds)*1000)void refreshMdns();if(config.arpRouters.length&&Date.now()-routerArpAt>=Math.max(60,config.pollSeconds)*1000)void refreshRouterArp();if([...switchCache.values()].some(item=>Date.now()-item.lastSeen>cacheTtlMs)){buildState();broadcast('status',{status:state.status})}},1000);
setInterval(()=>{for(const res of eventClients)res.write(': ping\n\n')},20000);
