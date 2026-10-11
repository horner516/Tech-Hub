import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduler,LIMITS} from '../collector/scheduler.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Simulated site: 40 switches, 3 offline, 2 slow. Real time is compressed: poll 400ms ≈ 30s, status 40ms ≈ 3s.
function site({count=40,offline=new Set(['10.0.0.5','10.0.0.17','10.0.0.33']),slow=new Set(['10.0.0.8','10.0.0.9'])}={}){
 const ips=Array.from({length:count},(_,i)=>`10.0.0.${i+1}`),stats={sweeps:0,refresh:new Map(),status:new Map(),peakRefresh:0,peakStatus:0,overlap:0},busy=new Map(),active={refresh:0,status:0};
 const enter=(lane,ip)=>{const key=`${ip}`;if(busy.get(key))stats.overlap++;busy.set(key,true);active[lane]++;stats[lane==='refresh'?'peakRefresh':'peakStatus']=Math.max(stats[lane==='refresh'?'peakRefresh':'peakStatus'],active[lane]);stats[lane].set(ip,(stats[lane].get(ip)??0)+1)};
 const leave=(lane,ip)=>{busy.set(ip,false);active[lane]--};
 const io={
  sweep:async()=>{stats.sweeps++;await wait(30);return ips.filter(ip=>!offline.has(ip)).map(ip=>({ip}))},
  refresh:async ip=>{enter('refresh',ip);try{await wait(slow.has(ip)?120:15);if(offline.has(ip))throw new Error('timeout')}finally{leave('refresh',ip)}},
  status:async ip=>{enter('status',ip);try{await wait(2);if(offline.has(ip))throw new Error('timeout')}finally{leave('status',ip)}},
 };
 return {ips,offline,stats,io};
}

test('40 switches: lanes stay within their caps, never overlap on one switch, and every reachable switch keeps refreshing', async () => {
 const {ips,offline,stats,io}=site();
 const scheduler=createScheduler({io,timing:()=>({pollMs:400,discoveryMs:5000,statusMs:40})});
 // Two offline switches are known from the previous run's cache; one is never seen.
 scheduler.seed(['10.0.0.5','10.0.0.17']);
 const timer=setInterval(()=>scheduler.tick(),10);
 await wait(2400);
 clearInterval(timer);scheduler.stop();
 await wait(150);

 assert.ok(stats.peakRefresh<=LIMITS.refreshConcurrency,`refresh concurrency ${stats.peakRefresh}`);
 assert.ok(stats.peakStatus<=LIMITS.statusConcurrency,`status concurrency ${stats.peakStatus}`);
 assert.equal(stats.overlap,0,'a switch never has two requests from the collector in flight');
 assert.equal(stats.sweeps,1,'one discovery sweep at startup, then only on the discovery interval');
 const online=ips.filter(ip=>!offline.has(ip));
 for(const ip of online){
  const count=stats.refresh.get(ip)??0;
  assert.ok(count>=4&&count<=7,`${ip} refreshed ${count} times in ~6 poll periods`);
 }
 for(const ip of ['10.0.0.5','10.0.0.17'])assert.ok((stats.refresh.get(ip)??0)<=3,`offline ${ip} backs off (${stats.refresh.get(ip)} tries)`);
 assert.equal(stats.status.get('10.0.0.5')??0,0,'offline switches never get link-status checks');
 const statusChecks=online.map(ip=>stats.status.get(ip)??0);
 assert.ok(Math.min(...statusChecks)>=20,`every online switch gets frequent link checks (min ${Math.min(...statusChecks)})`);
 // Per switch, per "30 seconds": 1 full read + ~10 link checks, regardless of site size.
 const perPoll=Math.max(...statusChecks)/6;
 assert.ok(perPoll<=11,`link checks per switch per poll period: ${perPoll.toFixed(1)}`);
});

test('a forced re-read after a change waits for an in-flight read instead of returning stale data', async () => {
 const order=[];let reads=0;
 const scheduler=createScheduler({io:{sweep:async()=>[],refresh:async()=>{const n=++reads;order.push(`start ${n}`);await wait(40);order.push(`end ${n}`)},status:async()=>{}},timing:()=>({pollMs:10_000,discoveryMs:60_000,statusMs:0})});
 scheduler.seed(['10.0.0.2']);
 scheduler.tick();// starts read 1
 await wait(5);
 await scheduler.refreshNow('10.0.0.2',{force:true});
 assert.deepEqual(order,['start 1','end 1','start 2','end 2']);
 scheduler.stop();
});

test('manual scans and refreshes are rate limited so many dashboards cannot stack load', async () => {
 let sweeps=0,reads=0;
 const scheduler=createScheduler({io:{sweep:async()=>{sweeps++;return []},refresh:async()=>{reads++},status:async()=>{}},timing:()=>({pollMs:10_000,discoveryMs:60_000,statusMs:0})});
 assert.equal(scheduler.requestSweep(),true);
 await wait(5);
 assert.equal(scheduler.requestSweep(),false);
 assert.equal(sweeps,1);
 scheduler.seed(['10.0.0.2']);
 assert.ok(scheduler.refreshNow('10.0.0.2'));
 await wait(5);
 assert.equal(scheduler.refreshNow('10.0.0.2'),null);
 assert.equal(reads,1);
 scheduler.stop();
});
