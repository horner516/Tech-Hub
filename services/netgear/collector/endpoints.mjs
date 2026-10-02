// Endpoint IPs and names for ports that only show a learned MAC. Layer-2 switches know MACs, not IPs, and
// rarely have PTR records behind them, so two local sources fill the gap:
//  • this computer's own ARP table (MAC → IP), read locally with no network traffic
//  • Bonjour/mDNS (IP → device name), as announced by most AV gear (Blackmagic, Dante, NDI, Shure, …)
// mDNS uses RFC 6762 "legacy unicast" queries from an ephemeral port: responders answer straight back to that
// port, so nothing has to share UDP 5353 with the operating system's own responder. Both only cover networks this
// computer is attached to.
import dgram from 'node:dgram';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

// ---- this computer's ARP table -------------------------------------------------------------------------------
const normalizeMac=raw=>{const parts=String(raw).toLowerCase().split(/[:-]/);return parts.length===6&&parts.every(p=>/^[0-9a-f]{1,2}$/.test(p))?parts.map(p=>p.padStart(2,'0')).join(':'):null};
const usableIp=ip=>/^\d+\.\d+\.\d+\.\d+$/.test(ip)&&!/^(?:0|127|169\.254|22[4-9]|23\d|255)\./.test(ip)&&!ip.endsWith('.255');

/** Parses `arp -an` (macOS/BSD), `arp -a` (Windows) or /proc/net/arp (Linux) into Map<mac, ip>. */
export function parseArp(text){
 const table=new Map();
 for(const line of String(text).split(/\r?\n/)){
  const bsd=/\(([\d.]+)\) at ([0-9a-f:]+) /i.exec(line),win=/^\s*([\d.]+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+dynamic/i.exec(line),linux=/^([\d.]+)\s+0x\w+\s+0x[2-9a-f]\w*\s+([0-9a-f:]{17})\s/i.exec(line);
  const match=bsd||win||linux;if(!match)continue;
  const mac=normalizeMac(match[2]);
  if(mac&&mac!=='ff:ff:ff:ff:ff:ff'&&mac!=='00:00:00:00:00:00'&&!mac.startsWith('01:00:5e')&&usableIp(match[1]))table.set(mac,match[1]);
 }
 return table;
}

let warnedEmpty=false;
/** Rejects with the reason when the table can't be read, so the caller can report it. */
export function readHostArp({platform=process.platform}={}){
 if(platform==='linux')return fs.promises.readFile('/proc/net/arp','utf8').then(parseArp);
 // Absolute paths: a service started by the desktop app may not inherit a shell PATH.
 const command=platform==='win32'?`${process.env.SystemRoot||'C:\\Windows'}\\System32\\ARP.EXE`:'/usr/sbin/arp';
 return new Promise((resolve,reject)=>execFile(command,[platform==='win32'?'-a':'-an'],{timeout:5000,windowsHide:true,maxBuffer:4*1024*1024},(error,stdout,stderr)=>{if(error&&!stdout)return reject(error);const table=parseArp(stdout);if(!table.size&&!warnedEmpty){warnedEmpty=true;console.warn(`This computer's ARP table came back empty${platform==='darwin'?' (macOS can hide it from apps; endpoint IPs then come only from the switches and LLDP)':''}.`)}resolve(table)}));
}

// ---- minimal DNS wire format (PTR / SRV / A) -------------------------------------------------------------------
const TYPE={A:1,PTR:12,SRV:33};
// Names travel as text with dots inside a label escaped as "\." (Bonjour instance names often contain dots).
function encodeName(name){const parts=name.replace(/\.$/,'').split(/(?<!\\)\./),buffers=parts.map(part=>{const label=Buffer.from(part.replace(/\\(.)/g,'$1'),'utf8');return Buffer.concat([Buffer.from([Math.min(63,label.length)]),label.subarray(0,63)])});return Buffer.concat([...buffers,Buffer.from([0])])}
export function encodeQuery(id,questions){
 const header=Buffer.alloc(12);header.writeUInt16BE(id,0);header.writeUInt16BE(questions.length,4);
 return Buffer.concat([header,...questions.map(({name,type})=>{const tail=Buffer.alloc(4);tail.writeUInt16BE(type,0);tail.writeUInt16BE(1,2);return Buffer.concat([encodeName(name),tail])})]);
}
function readName(buf,offset,depth=0){
 const labels=[];let pos=offset,end=null;
 for(let guard=0;guard<128;guard++){
  const len=buf[pos];if(len===undefined)throw new Error('truncated name');
  if(len===0){pos++;break}
  if((len&0xc0)===0xc0){if(depth>8)throw new Error('pointer loop');const pointer=((len&0x3f)<<8)|buf[pos+1];if(end===null)end=pos+2;labels.push(readName(buf,pointer,depth+1).name);pos=end;return {name:labels.filter(Boolean).join('.'),next:end}}
  labels.push(buf.toString('utf8',pos+1,pos+1+len).replace(/\\/g,'\\\\').replace(/\./g,'\\.'));pos+=1+len;
 }
 return {name:labels.join('.'),next:end??pos};
}
/** Records from the answer and additional sections: [{name, type, ptr|srv|a}]. Malformed packets yield []. */
export function decodeResponse(buf){
 try{
  if(buf.length<12||!(buf.readUInt16BE(2)&0x8000))return [];
  const qd=buf.readUInt16BE(4),total=buf.readUInt16BE(6)+buf.readUInt16BE(8)+buf.readUInt16BE(10);let pos=12;const records=[];
  for(let i=0;i<qd;i++)pos=readName(buf,pos).next+4;
  for(let i=0;i<total&&pos<buf.length;i++){
   const {name,next}=readName(buf,pos),type=buf.readUInt16BE(next),length=buf.readUInt16BE(next+8),data=next+10;pos=data+length;
   if(type===TYPE.PTR)records.push({name,type,ptr:readName(buf,data).name});
   else if(type===TYPE.SRV)records.push({name,type,srv:{port:buf.readUInt16BE(data+4),target:readName(buf,data+6).name}});
   else if(type===TYPE.A&&length===4)records.push({name,type,a:[...buf.subarray(data,data+4)].join('.')});
  }
  return records;
 }catch{return []}
}

// ---- mDNS browse -----------------------------------------------------------------------------------------------
const lower=name=>name.toLowerCase().replace(/\.$/,'');
// Per-channel and Apple-internal service types carry no device names worth showing and multiply queries.
const SKIP_TYPE=/_netaudio-(?:chan|cmc|dbc)|_sleep-proxy|_companion-link|_asquic|_raop|_airplay|_device-info|_services\._dns-sd/i;
// Earlier types give the most descriptive instance names.
const NAME_PRIORITY=['_videohub','_hyperdeck_ctrl','_switcher_ctrl','_blackmagic','_netaudio-arc','_ndi','_shure','_http'];
const privateIpv4=address=>/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/**
 * Asks every attached private IPv4 network which Bonjour services and hosts are present.
 * Returns Map<ip, {name, host}>. `target` (tests only) replaces the multicast group with one unicast address.
 */
export async function browseMdns({windowMs=1200,maxTypes=40,maxInstances=400,target=null,interfaces=os.networkInterfaces(),stats={}}={}){
 const addresses=target?[{address:'127.0.0.1',netmask:'255.0.0.0'}]:Object.values(interfaces).flat().filter(item=>item&&(item.family==='IPv4'||item.family===4)&&!item.internal&&privateIpv4(item.address));
 if(!addresses.length)return new Map();
 const ptr=new Map(),srv=new Map(),hostIp=new Map();let id=Math.floor(Math.random()*0xffff);
 Object.assign(stats,{interfaces:addresses.map(item=>item.address),replies:0,errors:[]});
 const onMessage=message=>{stats.replies++;for(const record of decodeResponse(message)){const key=lower(record.name);if(record.ptr)(ptr.get(key)??ptr.set(key,new Set()).get(key)).add(record.ptr.replace(/\.$/,''));else if(record.srv)srv.set(key,record.srv.target.replace(/\.$/,''));else if(record.a&&usableIp(record.a))hostIp.set(key,record.a)}};
 const sockets=[];
 const toInt=ip=>ip.split('.').reduce((n,part)=>(n*256+Number(part))>>>0,0),sameNet=(a,b,mask)=>((toInt(a)&toInt(mask))>>>0)===((toInt(b)&toInt(mask))>>>0);
 for(const {address,netmask} of addresses){
  const socket=dgram.createSocket({type:'udp4'});socket.local={address,netmask:netmask||'255.255.255.0'};socket.on('error',error=>stats.errors.push(`${address}: ${error.code||error.message}`));socket.on('message',onMessage);
  try{await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,address,resolve)});if(!target){socket.setMulticastInterface(address);socket.setMulticastTTL(255)}sockets.push(socket)}catch(error){stats.errors.push(`${address}: ${error.code||error.message}`);try{socket.close()}catch{}}
 }
 const ask=questions=>{for(let i=0;i<questions.length;i+=8){const packet=encodeQuery((id=(id+1)&0xffff),questions.slice(i,i+8));for(const socket of sockets)socket.send(packet,target?.port??5353,target?.address??'224.0.0.251',error=>{if(error&&stats.errors.length<5)stats.errors.push(`send ${socket.local.address}: ${error.code||error.message}`)})}};
 try{
  ask([{name:'_services._dns-sd._udp.local',type:TYPE.PTR}]);await wait(windowMs);
  const types=[...(ptr.get('_services._dns-sd._udp.local')??[])].filter(type=>!SKIP_TYPE.test(type)).slice(0,maxTypes);
  if(!types.length)return new Map();
  ask(types.map(name=>({name,type:TYPE.PTR})));await wait(windowMs);
  const instances=types.flatMap(type=>[...(ptr.get(lower(type))??[])].map(instance=>({type,instance}))).slice(0,maxInstances);
  const needSrv=instances.filter(({instance})=>!srv.has(lower(instance)));
  if(needSrv.length){ask(needSrv.map(({instance})=>({name:instance,type:TYPE.SRV})));await wait(windowMs)}
  const needA=[...new Set(instances.map(({instance})=>srv.get(lower(instance))).filter(host=>host&&!hostIp.has(lower(host))))];
  if(needA.length){ask(needA.map(name=>({name,type:TYPE.A})));await wait(windowMs)}
  const byIp=new Map();
  for(const {type,instance} of instances){
   const host=srv.get(lower(instance)),ip=host&&hostIp.get(lower(host));if(!ip)continue;
   const rank=NAME_PRIORITY.findIndex(prefix=>type.toLowerCase().startsWith(prefix)),score=rank<0?NAME_PRIORITY.length:rank,label=instance.slice(0,instance.length-type.length-1).replace(/\\(.)/g,'$1');
   const current=byIp.get(ip);if(!current||score<current.score)byIp.set(ip,{name:label||host.replace(/\.local$/i,''),host:host.replace(/\.local$/i,''),score});
  }
  // A unicast mDNS question to each named host (RFC 6762 §5.5) makes this computer ARP for it, so the next
  // ARP read can tie that name to the MAC the switch learned.
  if(!target)for(const [ip,{host}] of byIp){const socket=sockets.find(item=>sameNet(item.local.address,ip,item.local.netmask));if(socket)socket.send(encodeQuery((id=(id+1)&0xffff),[{name:`${host}.local`,type:TYPE.A}]),5353,ip,()=>{})}
  await wait(200);
  return new Map([...byIp].map(([ip,{name,host}])=>[ip,{name,host}]));
 }finally{for(const socket of sockets)try{socket.close()}catch{}}
}

// ---- a router's ARP table over SNMP ----------------------------------------------------------------------------
export const ARP_OIDS={physical:'1.3.6.1.2.1.4.35.1.4',legacy:'1.3.6.1.2.1.4.22.1.2'};
/**
 * MAC → IP from ipNetToPhysicalPhysAddress (index ifIndex.addrType.len.a.b.c.d) and the older
 * ipNetToMediaPhysAddress (index ifIndex.a.b.c.d), which many routers still only implement.
 */
export function parseArpVarbinds(rows){
 const table=new Map();
 for(const {oid,value,base} of rows){
  if(!Buffer.isBuffer(value)||value.length!==6)continue;
  const suffix=String(oid).slice(base.length+1).split('.').map(Number);
  const ip=base===ARP_OIDS.physical?(suffix[1]===1&&suffix[2]===4?suffix.slice(3,7).join('.'):null):suffix.slice(1,5).join('.');
  const mac=[...value].map(byte=>byte.toString(16).padStart(2,'0')).join(':');
  if(ip&&usableIp(ip)&&mac!=='ff:ff:ff:ff:ff:ff'&&mac!=='00:00:00:00:00:00'&&!mac.startsWith('01:00:5e'))table.set(mac,ip);
 }
 return table;
}
export function parseRouterList(text){
 const items=String(text||'').split(/[\s,;]+/).filter(Boolean);
 if(items.length>10)throw new Error('List at most 10 routers');
 for(const item of items)if(!/^\d+\.\d+\.\d+\.\d+$/.test(item)||item.split('.').some(n=>Number(n)>255))throw new Error(`"${item}" is not an IPv4 address`);
 return [...new Set(items)];
}
