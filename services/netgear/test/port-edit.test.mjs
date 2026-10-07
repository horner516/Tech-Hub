import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortEditor,portLock,MAX_ENDPOINT_MACS} from '../collector/port-edit.mjs';

const access=(number,extra={})=>({number,ifIndex:number,bridgePort:number,interface:`1/0/${number}`,status:'up',vlan:10,learnedMacs:['aa:bb:cc:00:00:01'],device:'Camera',...extra});
const makeSwitch=()=>({ip:'10.0.0.2',name:'Stage Left',model:'M4250-10G2XF-PoE+',vlanIds:[1,10,50],ports:[access(1),access(2,{tagged:[50]}),access(3,{device:'Core Switch'}),access(4,{lag:1000}),access(5,{learnedMacs:['de:ad:be:ef:00:01']}),access(6,{learnedMacs:Array.from({length:MAX_ENDPOINT_MACS+1},(_,i)=>`aa:00:00:00:00:0${i}`)}),access(7,{vlan:null}),access(8,{bridgePort:undefined})]});
const core={ip:'10.0.0.1',name:'Core Switch',ports:[]};

test('trunks, LAGs, uplinks, this computer\'s port and multi-device ports are locked', () => {
 const sw=makeSwitch(),context={switches:[sw,core],localMacs:new Set(['de:ad:be:ef:00:01'])},lock=n=>portLock(sw,sw.ports.find(p=>p.number===n),context);
 assert.equal(lock(1),null);
 assert.match(lock(2),/Trunk/);
 assert.match(lock(3),/Uplink to Core Switch/);
 assert.match(lock(4),/link aggregation/);
 assert.match(lock(5),/Tech Hub computer/);
 assert.match(lock(6),/devices are learned/);
 assert.match(lock(7),/VLAN/);
 assert.match(lock(8),/interface mapping/);
});

function harness(overrides={}){
 const sw=makeSwitch(),calls=[],live={pvid:10,untagged:new Set([10]),egress:new Set([10])},log=[];
 const deps={
  getSwitch:ip=>ip===sw.ip?sw:undefined,
  context:()=>({switches:[sw,core],localMacs:new Set()}),
  readPort:async()=>{calls.push('read');return {pvid:live.pvid,untagged:new Set(live.untagged),egress:new Set(live.egress)}},
  assign:async({toVlan})=>{calls.push(`assign ${toVlan}`);Object.assign(live,{pvid:toVlan,untagged:new Set([toVlan]),egress:new Set([toVlan])})},
  save:async()=>{calls.push('save')},
  refresh:async()=>{calls.push('refresh')},
  audit:entry=>log.push(entry),
  sleep:async()=>{},
  cooldownMs:0,
  ...overrides,
 };
 return {sw,calls,live,log,editor:createPortEditor(deps)};
}
const request={switchIp:'10.0.0.2',ifIndex:1,fromVlan:10,toVlan:50,actor:'test'};

test('a change re-reads live, assigns, verifies, saves, re-reads the switch and logs, in that order', async () => {
 const {editor,calls,log}=harness();
 const result=await editor.change(request);
 assert.deepEqual(calls,['read','assign 50','read','save','refresh']);
 assert.deepEqual({ok:result.ok,verified:result.verified,saved:result.saved},{ok:true,verified:true,saved:true});
 assert.equal(log.length,1);
 assert.equal(log[0].result,'applied');
 assert.equal(log[0].actor,'test');
});

test('nothing is written when the request or the live switch disagree with what the page showed', async () => {
 const {editor,calls,live}=harness();
 await assert.rejects(editor.change({...request,fromVlan:1}),e=>e.status===409&&/now on VLAN 10/.test(e.message));
 await assert.rejects(editor.change({...request,toVlan:99}),e=>e.status===400&&/does not exist/.test(e.message));
 await assert.rejects(editor.change({...request,toVlan:10}),e=>e.status===400);
 await assert.rejects(editor.change({...request,ifIndex:2}),e=>e.status===409&&/Trunk/.test(e.message));
 await assert.rejects(editor.change({...request,switchIp:'10.9.9.9'}),e=>e.status===404);
 await assert.rejects(editor.change({...request,ifIndex:'1'}),e=>e.status===400);
 live.pvid=1;live.untagged=new Set([1]);
 await assert.rejects(editor.change(request),e=>e.status===409&&/changed on the switch/.test(e.message));
 assert.ok(!calls.some(call=>call.startsWith('assign')),'assign never ran');
});

test('a change the switch does not reflect is reported, not saved, and logged as unverified', async () => {
 const {editor,calls,log}=harness({assign:async()=>{}});
 await assert.rejects(editor.change(request),e=>e.status===502&&e.result?.verified===false&&/still reports VLAN 10/.test(e.message));
 assert.ok(!calls.includes('save'));
 assert.ok(calls.includes('refresh'),'the switch is still re-read so the dashboard shows the truth');
 assert.equal(log.at(-1).result,'unverified');
});

test('a failed save keeps the verified change but says it is not persistent', async () => {
 const {editor,log}=harness({save:async()=>{throw new Error('flash busy')}});
 const result=await editor.change(request);
 assert.deepEqual({ok:result.ok,verified:result.verified,saved:result.saved,saveError:result.saveError},{ok:false,verified:true,saved:false,saveError:'flash busy'});
 assert.equal(log.at(-1).result,'applied-unsaved');
});

test('one change at a time, spaced apart', async () => {
 let release;
 const gate=new Promise(resolve=>{release=resolve}),now={t:10_000};
 const {editor}=harness({assign:async()=>gate,cooldownMs:3000,now:()=>now.t,readPort:async()=>({pvid:10,untagged:new Set([10]),egress:new Set()})});
 const first=editor.change(request).catch(()=>{});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(editor.busy,true);
 await assert.rejects(editor.change(request),e=>e.status===409&&/in progress/.test(e.message));
 release();await first;
 await assert.rejects(editor.change(request),e=>e.status===429);
 now.t+=3001;
 await assert.rejects(editor.change(request),e=>e.status!==429,'cooldown over');
});

test('stacked switches are locked until stack port numbering is verified', () => {
 const sw=makeSwitch();sw.ports.push(access(13,{interface:'2/0/1'}));
 assert.match(portLock(sw,sw.ports[0],{switches:[sw]}),/Stacked switch/);
});
