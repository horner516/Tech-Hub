import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {parseArp,encodeQuery,decodeResponse,browseMdns,parseArpVarbinds,parseRouterList,ARP_OIDS} from '../collector/endpoints.mjs';

test('ARP tables from macOS, Windows and Linux map MAC to IP, skipping incomplete, broadcast and multicast entries', () => {
 const mac=`? (10.15.10.26) at 7c:2e:d:1b:72:4a on en10 ifscope [ethernet]
? (10.15.11.66) at 0:1d:c1:8e:f8:c7 on en10 ifscope [ethernet]
? (10.15.10.99) at (incomplete) on en10 ifscope [ethernet]
? (10.15.11.255) at ff:ff:ff:ff:ff:ff on en10 ifscope [ethernet]
? (224.0.0.251) at 1:0:5e:0:0:fb on en10 ifscope permanent [ethernet]`;
 assert.deepEqual([...parseArp(mac)],[['7c:2e:0d:1b:72:4a','10.15.10.26'],['00:1d:c1:8e:f8:c7','10.15.11.66']]);
 const windows=`Interface: 10.15.11.71 --- 0x7
  Internet Address      Physical Address      Type
  10.15.10.24           7c-2e-0d-a7-c7-18     dynamic
  10.15.11.255          ff-ff-ff-ff-ff-ff     static`;
 assert.deepEqual([...parseArp(windows)],[['7c:2e:0d:a7:c7:18','10.15.10.24']]);
 const linux=`IP address       HW type     Flags       HW address            Mask     Device
10.15.10.10      0x1         0x2         7c:2e:0d:0f:dd:62     *        eth0
10.15.10.50      0x1         0x0         00:00:00:00:00:00     *        eth0`;
 assert.deepEqual([...parseArp(linux)],[['7c:2e:0d:0f:dd:62','10.15.10.10']]);
});

// Builds a response packet: answers = [{name, type:'PTR'|'SRV'|'A', value}].
function response(id,answers){
 const name=n=>Buffer.concat([...n.split(/(?<!\\)\./).map(part=>{const label=Buffer.from(part.replace(/\\(.)/g,'$1'));return Buffer.concat([Buffer.from([label.length]),label])}),Buffer.from([0])]);
 const header=Buffer.alloc(12);header.writeUInt16BE(id,0);header.writeUInt16BE(0x8400,2);header.writeUInt16BE(answers.length,6);
 return Buffer.concat([header,...answers.map(({name:n,type,value})=>{let rdata;if(type==='PTR')rdata=name(value);else if(type==='A')rdata=Buffer.from(value.split('.').map(Number));else{const head=Buffer.alloc(6);head.writeUInt16BE(value.port,4);rdata=Buffer.concat([head,name(value.target)])}const meta=Buffer.alloc(10);meta.writeUInt16BE({PTR:12,SRV:33,A:1}[type],0);meta.writeUInt16BE(0x8001,2);meta.writeUInt32BE(120,4);meta.writeUInt16BE(rdata.length,8);return Buffer.concat([name(n),meta,rdata])})]);
}
const questions=packet=>{const out=[];let pos=12;for(let i=0;i<packet.readUInt16BE(4);i++){const labels=[];while(packet[pos]){labels.push(packet.toString('utf8',pos+1,pos+1+packet[pos]).replace(/\./g,'\\.'));pos+=1+packet[pos]}pos++;out.push({name:labels.join('.'),type:packet.readUInt16BE(pos)});pos+=4}return out};

test('DNS names round-trip, including instance names that contain dots', () => {
 const packet=encodeQuery(9,[{name:'M4250-10G2XF-PoE+\\.10\\.15\\.1\\.136._http._tcp.local',type:33}]);
 assert.equal(packet[12],29,'one 29-byte label, not split at the dots');
 assert.deepEqual(questions(packet),[{name:'M4250-10G2XF-PoE+\\.10\\.15\\.1\\.136._http._tcp.local',type:33}]);
 const records=decodeResponse(response(9,[{name:'_http._tcp.local',type:'PTR',value:'Core\\.Switch._http._tcp.local'},{name:'Core.local',type:'A',value:'10.15.1.2'}]));
 assert.deepEqual(records.map(r=>r.ptr??r.a),['Core\\.Switch._http._tcp.local','10.15.1.2']);
 assert.deepEqual(decodeResponse(Buffer.from([1,2,3])),[],'garbage is ignored');
});

test('Bonjour lookup follows services → instances → SRV → A and prefers the most descriptive service name', async () => {
 const services={'_services._dns-sd._udp.local':['_http._tcp.local','_hyperdeck_ctrl._tcp.local','_netaudio-chan._udp.local','_netaudio-arc._udp.local']};
 const instances={'_http._tcp.local':['CAM1 Web._http._tcp.local','Dotted\\.Name._http._tcp.local'],'_hyperdeck_ctrl._tcp.local':['CAM1._hyperdeck_ctrl._tcp.local'],'_netaudio-arc._udp.local':['Q8-8ef8c7._netaudio-arc._udp.local'],'_netaudio-chan._udp.local':['01@Q8._netaudio-chan._udp.local']};
 const srv={'cam1 web._http._tcp.local':'CAM1.local','cam1._hyperdeck_ctrl._tcp.local':'CAM1.local','dotted\\.name._http._tcp.local':'dotted.local'};
 const asked=[];
 const responder=dgram.createSocket('udp4');
 responder.on('message',(packet,from)=>{const id=packet.readUInt16BE(0),answers=[];for(const q of questions(packet)){asked.push(q.name);const key=q.name.toLowerCase();
  if(q.type===12)for(const value of (services[q.name]??instances[q.name]??[]))answers.push({name:q.name,type:'PTR',value});
  if(q.type===12&&q.name==='_netaudio-arc._udp.local')answers.push({name:'Q8-8ef8c7._netaudio-arc._udp.local',type:'SRV',value:{port:4440,target:'Q8-8ef8c7.local'}},{name:'Q8-8ef8c7.local',type:'A',value:'10.15.11.66'});// bundled additionals
  if(q.type===33&&srv[key])answers.push({name:q.name,type:'SRV',value:{port:80,target:srv[key]}});
  if(q.type===1&&key==='cam1.local')answers.push({name:q.name,type:'A',value:'10.15.10.11'});
  if(q.type===1&&key==='dotted.local')answers.push({name:q.name,type:'A',value:'10.15.10.40'});}
  if(answers.length)responder.send(response(id,answers),from.port,from.address)});
 await new Promise(resolve=>responder.bind(0,'127.0.0.1',resolve));
 try{
  const found=await browseMdns({target:{address:'127.0.0.1',port:responder.address().port},windowMs:150});
  assert.deepEqual(Object.fromEntries(found),{'10.15.10.11':{name:'CAM1',host:'CAM1'},'10.15.11.66':{name:'Q8-8ef8c7',host:'Q8-8ef8c7'},'10.15.10.40':{name:'Dotted.Name',host:'dotted'}});
  assert.ok(!asked.includes('_netaudio-chan._udp.local'),'per-channel Dante services are never queried');
  assert.ok(!asked.some(name=>/q8-8ef8c7/i.test(name)&&name!=='_netaudio-arc._udp.local'),'bundled SRV/A answers are not re-asked');
 }finally{responder.close()}
});

test('router ARP tables parse from both the current and the legacy MIB, skipping broadcast and multicast', () => {
 const mac=hex=>Buffer.from(hex.split(':').map(byte=>parseInt(byte,16)));
 const rows=[
  {base:ARP_OIDS.physical,oid:`${ARP_OIDS.physical}.12.1.4.10.15.10.26`,value:mac('7c:2e:0d:1b:72:4a')},
  {base:ARP_OIDS.physical,oid:`${ARP_OIDS.physical}.12.2.16.254.128.0.0.0.0.0.0.0.0.0.0.0.0.0.1`,value:mac('7c:2e:0d:1b:72:4b')},// IPv6: ignored
  {base:ARP_OIDS.legacy,oid:`${ARP_OIDS.legacy}.50.10.15.50.120`,value:mac('00:19:7c:15:87:00')},
  {base:ARP_OIDS.legacy,oid:`${ARP_OIDS.legacy}.50.10.15.51.255`,value:mac('ff:ff:ff:ff:ff:ff')},
  {base:ARP_OIDS.legacy,oid:`${ARP_OIDS.legacy}.50.224.0.0.251`,value:mac('01:00:5e:00:00:fb')},
  {base:ARP_OIDS.legacy,oid:`${ARP_OIDS.legacy}.50.10.15.50.9`,value:'not a mac'},
 ];
 assert.deepEqual([...parseArpVarbinds(rows)],[['7c:2e:0d:1b:72:4a','10.15.10.26'],['00:19:7c:15:87:00','10.15.50.120']]);
});

test('router lists accept commas or spaces, drop duplicates, and reject anything that is not IPv4', () => {
 assert.deepEqual(parseRouterList('10.15.10.1, 10.15.50.1 10.15.10.1'),['10.15.10.1','10.15.50.1']);
 assert.deepEqual(parseRouterList(''),[]);
 assert.throws(()=>parseRouterList('router.local'),/not an IPv4/);
 assert.throws(()=>parseRouterList('10.15.10.300'),/not an IPv4/);
});
