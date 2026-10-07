// End-to-end: the real collector process against one mock switch (real SNMPv3 packets) and a mock AV interface.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startMockSwitch} from './mock-switch.mjs';
import {hashPin} from '../collector/edit-access.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port))})});
async function until(check,timeoutMs,label){const end=Date.now()+timeoutMs;let last;while(Date.now()<end){try{last=await check();if(last)return last}catch{}await wait(150)}throw new Error(`Timed out waiting for ${label}`)}

test('collector: discovery, live link updates over SSE, port locks, PIN-gated AV profile changes and switch load', {timeout:120_000}, async () => {
 const [snmpPort,proxyPort,avPort,collectorPort]=await Promise.all(Array.from({length:4},freePort));
 const mock=await startMockSwitch({fdb:[{mac:'7c:2e:0d:1b:72:4a',port:5}],arp:[{mac:'7c:2e:0d:1b:72:4a',ip:'10.15.10.26'}],snmpPort,proxyPort,avPort,ports:[...Array.from({length:10},(_,i)=>({number:i+1,pvid:i<8?10:50})),{number:11,pvid:1,up:false},{number:12,pvid:1,tagged:[10,50]}]});
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'netgear-collector-'));
 const child=spawn(process.execPath,[path.join(here,'../collector/server.mjs')],{env:{...process.env,TECH_HUB_DATA_DIR:dataDir,TECH_HUB_MANAGED:'',SNMP_SUBNET:'127.0.0.0/30',SNMP_USERNAME:'dashboard',SNMP_SECURITY_LEVEL:'noAuthNoPriv',SNMP_PORT:String(proxyPort),COLLECTOR_PORT:String(collectorPort),SERVER_BIND_ADDRESS:'127.0.0.1',POLL_SECONDS:'10',STATUS_SECONDS:'2',DISCOVERY_SECONDS:'300',VLAN_EDITING:'1',ENDPOINT_MDNS:'0',ARP_ROUTERS:'127.0.0.1',ARP_SNMP:'v3',EDIT_PIN_HASH:await hashPin('2468'),NETGEAR_WEB_USERNAME:'admin',NETGEAR_WEB_PASSWORD:'switch-pass',NETGEAR_AV_ENDPOINTS:`http:${avPort}`},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 const base=`http://127.0.0.1:${collectorPort}`,json=(p,options)=>fetch(base+p,options).then(async r=>({status:r.status,headers:r.headers,body:await r.json().catch(()=>null)}));
 const post=(p,body,headers={})=>json(p,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 let events;
 try{
  const first=await until(async()=>{const r=await json('/api/switches');return r.body?.switches?.length===1&&r.body},20_000,'discovery');
  const sw=first.switches[0],port=n=>sw.ports.find(p=>p.number===n);
  assert.equal(sw.ip,'127.0.0.1');
  assert.equal(sw.model,'M4250-10G2XF-PoE+');
  assert.equal(sw.ports.length,12,'the VLAN interface is not shown as a port');
  assert.deepEqual(sw.vlanIds,[1,10,50]);
  assert.deepEqual({ifIndex:port(1).ifIndex,vlan:port(1).vlan,status:port(1).status,lock:port(1).lock},{ifIndex:1,vlan:10,status:'up',lock:undefined});
  assert.deepEqual(port(12).tagged,[10,50]);
  assert.match(port(12).lock,/Trunk/);
  assert.equal(port(11).status,'down');
  assert.deepEqual({available:first.edit.available,unlocked:first.edit.unlocked},{available:true,unlocked:false});

  // A MAC learned on port 5 gets its IP from the router's ARP table (here the mock also plays the router).
  const withIp=await until(async()=>{const p5=(await json('/api/switches')).body.switches[0].ports.find(p=>p.number===5);return p5.ip&&p5},15_000,'router ARP IP');
  assert.deepEqual({ip:withIp.ip,mac:withIp.mac,device:withIp.device},{ip:'10.15.10.26',mac:'7c:2e:0d:1b:72:4a',device:'MAC 7c:2e:0d:1b:72:4a'});
  assert.match(JSON.stringify((await json('/api/config')).body.arpStatus),/"127\.0\.0\.1":\{"entries":1/);

  // Live link change reaches a browser over SSE within a status interval.
  const received=[];
  events=http.get(`${base}/api/events`,res=>{res.setEncoding('utf8');let buffer='';res.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,i);buffer=buffer.slice(i+2);const event=/^event: (.+)$/m.exec(block)?.[1],data=/^data: (.+)$/m.exec(block)?.[1];if(event)received.push({event,data:JSON.parse(data),at:Date.now()})}})});
  await wait(500);
  const flippedAt=Date.now();mock.setLink(3,false);
  const patch=await until(()=>received.find(e=>e.event==='ports'&&e.data.ports.some(p=>p.ifIndex===3&&p.status==='down')),8_000,'link-down event');
  console.log(`link change reached the browser in ${patch.at-flippedAt} ms`);
  assert.ok(patch.at-flippedAt<4_500);
  assert.equal((await json('/api/switches')).body.switches[0].ports.find(p=>p.number===3).status,'down','the snapshot agrees with the event');

  // Load on the switch in steady state (status every 2s, full read every 10s).
  await wait(1000);
  const start=mock.counts.requests,windowMs=20_000;await wait(windowMs);
  const perSecond=(mock.counts.requests-start)/(windowMs/1000);
  console.log(`steady-state SNMP requests to the switch: ${perSecond.toFixed(1)}/s (status 2 s, full read 10 s)`);
  assert.ok(perSecond<20,`${perSecond}/s`);
  assert.ok(received.some(e=>e.event==='switch'&&e.data.switch.ip==='127.0.0.1'),'full re-reads are pushed per switch');

  // PIN gating.
  assert.equal((await post('/api/login',{pin:'2468'},{Origin:'http://evil.example'})).status,403,'cross-origin login refused');
  assert.equal((await post('/api/login',{pin:'0000'})).status,403);
  const login=await post('/api/login',{pin:'2468'});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie');
  assert.match(cookie,/^sid=[a-f0-9]{48}; HttpOnly; SameSite=Strict/);
  const sid=cookie.split(';')[0];
  assert.equal((await json('/api/edit-access',{headers:{cookie:sid}})).body.unlocked,true);
  assert.equal((await json('/api/edit-access')).body.unlocked,false);
  const change1={switchIp:'127.0.0.1',ifIndex:1,fromVlan:10,toVlan:50};
  assert.equal((await post('/api/ports/profile',change1)).status,401,'no unlock, no change');
  assert.equal((await post('/api/ports/profile',{...change1,ifIndex:12,fromVlan:1,toVlan:10},{cookie:sid})).status,409,'trunk refused');
  assert.equal((await post('/api/ports/profile',{...change1,fromVlan:1},{cookie:sid})).status,409,'stale page refused');
  assert.equal((await post('/api/ports/profile',{...change1,toVlan:99},{cookie:sid})).status,400,'VLAN must exist on the switch');
  assert.ok(!mock.avCalls.length,'none of the refused requests reached the AV interface');

  // The real change: exactly the AV UI's own assign and save calls, verified over SNMP.
  const startedAt=Date.now(),applied=await post('/api/ports/profile',change1,{cookie:sid});
  console.log(`VLAN change applied, verified and saved in ${Date.now()-startedAt} ms`);
  assert.equal(applied.status,200,JSON.stringify(applied.body));
  assert.deepEqual({ok:applied.body.ok,verified:applied.body.verified,saved:applied.body.saved,reportedVlan:applied.body.reportedVlan},{ok:true,verified:true,saved:true,reportedVlan:50});
  assert.equal(mock.pvid(1),50);
  assert.deepEqual(mock.avCalls.map(call=>call.url),['/api/v1/profile/port','/api/v1/switch_config']);
  assert.deepEqual(mock.avCalls[0].body,{portToProfile:{vlanId:50,profileType:'Data',Untaged:[1]}});
  assert.deepEqual(mock.avCalls[1].body,{switchConfig:{save:true}});
  await wait(300);
  const count=entry=>mock.avLog.filter(line=>line===entry).length;
  assert.equal(count('POST /api/v1/login'),2);
  assert.equal(count('GET /api/v1/logout'),2,'every AV session is logged out');
  assert.equal((await json('/api/switches')).body.switches[0].ports.find(p=>p.number===1).vlan,50,'the switch was re-read right after the change');
  assert.ok(received.some(e=>e.event==='switch'&&e.data.switch.ports.find(p=>p.number===1)?.vlan===50),'dashboards got the re-read over SSE');

  // Revert to VLAN 1 uses the Default profile; then failure modes.
  await wait(3100);
  const reverted=await post('/api/ports/profile',{...change1,fromVlan:50,toVlan:1},{cookie:sid});
  assert.equal(reverted.status,200,JSON.stringify(reverted.body));
  assert.deepEqual(mock.avCalls.filter(call=>call.url==='/api/v1/profile/port')[1].body,{portToProfile:{vlanId:1,profileType:'Default',Untaged:[1]}});
  await wait(3100);
  mock.avFail.save=true;
  const unsaved=await post('/api/ports/profile',{...change1,ifIndex:2},{cookie:sid});
  assert.deepEqual({status:unsaved.status,verified:unsaved.body.verified,saved:unsaved.body.saved},{status:200,verified:true,saved:false});
  assert.match(unsaved.body.saveError,/Flash busy/);
  mock.avFail.save=false;
  await wait(3100);
  mock.avFail.assign=true;
  const rejected=await post('/api/ports/profile',{...change1,ifIndex:3},{cookie:sid});
  assert.equal(rejected.status,502);assert.match(rejected.body.error,/Port is a trunk member/);
  assert.equal(mock.pvid(3),10);
  mock.avFail.assign=false;
  await wait(3100);
  mock.avFail.ignoreAssign=true;const savesBefore=mock.avCalls.filter(call=>call.url==='/api/v1/switch_config').length;
  const ignored=await post('/api/ports/profile',{...change1,ifIndex:4},{cookie:sid});
  assert.equal(ignored.status,502);assert.match(ignored.body.error,/still reports VLAN 10/);
  assert.equal(mock.avCalls.filter(call=>call.url==='/api/v1/switch_config').length,savesBefore,'an unverified change is never saved');
  mock.avFail.ignoreAssign=false;
  const audit=fs.readFileSync(path.join(dataDir,'vlan-changes.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(audit.map(entry=>`${entry.port}:${entry.fromVlan}->${entry.toVlan}:${entry.result}`),['1:10->50:applied','1:50->1:applied','2:10->50:applied-unsaved','3:10->50:failed','4:10->50:unverified']);
  assert.equal((await fetch(base+'/api/ports/vlan',{method:'POST'})).status,404,'no raw PVID write path');

  // One-switch refresh is rate limited.
  assert.equal((await post('/api/scan',{ip:'127.0.0.1'})).body.status,'refreshing');
  assert.equal((await post('/api/scan',{ip:'127.0.0.1'})).body.status,'recently refreshed');

  // Secrets never leave the collector.
  const everything=JSON.stringify([(await json('/api/switches')).body,(await json('/api/config')).body,(await json('/api/edit-access')).body]);
  for(const secret of ['scrypt:','switch-pass','2468'])assert.ok(!everything.includes(secret),`${secret} leaked`);
  const config=(await json('/api/config')).body;
  assert.deepEqual({hasEditPin:config.hasEditPin,editingEnabled:config.editingEnabled,statusSeconds:config.statusSeconds},{hasEditPin:true,editingEnabled:true,statusSeconds:2});

  // Lockout after repeated wrong PINs.
  for(let i=0;i<5;i++)await post('/api/login',{pin:'0000'});
  assert.equal((await post('/api/login',{pin:'2468'})).status,429);
 }catch(error){console.log(output);throw error}
 finally{events?.destroy();child.kill();await mock.close();fs.rmSync(dataDir,{recursive:true,force:true})}
});
