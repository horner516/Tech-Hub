// Polling plan that scales to large sites. Three independent lanes, each with a hard concurrency cap, so a
// slow or offline switch never delays the others and nothing piles up:
//  • discovery — sweep the subnet for new switches (rarely; a /23 is 510 probes)
//  • refresh   — full SNMP read of each known switch on its own staggered schedule, a few switches at a time
//  • status    — one small GET per switch for link state/speed, so port changes show within seconds
// The I/O functions are injected so the plan can be load-tested against simulated switches.

export const LIMITS={refreshTimeoutMs:120_000,refreshConcurrency:4,statusConcurrency:8,maxBackoffMs:5*60_000,forgetAfterMs:60*60_000,manualSweepGapMs:20_000,manualRefreshGapMs:5_000,statusFailuresBeforePause:2,statusPauseMs:30_000};

export async function pool(items,limit,work){
 const results=[];let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const result=await work(items[next++]);if(result)results.push(result)}}));
 return results;
}

/**
 * @param io.sweep() → [{ip,...}] switches that answered discovery
 * @param io.refresh(ip) → resolves when the switch has been re-read and published (rejects on failure)
 * @param io.status(ip) → resolves after a link-status check (rejects on failure)
 * @param timing() → {pollMs, discoveryMs, statusMs}; read on every tick so settings apply without restart
 */
export function createScheduler({io,timing,limits=LIMITS,now=Date.now,log=()=>{}}){
 const known=new Map();// ip -> {nextRefresh, failures, lastOk, statusFailures, statusPausedUntil, lastManual}
 const refreshing=new Map();// ip -> in-flight refresh promise
 const checking=new Map();// ip -> in-flight link-status promise (one request per switch at a time, across both lanes)
 let sweeping=false,lastSweep=0,lastManualSweep=0,statusRunning=false,lastStatus=0,stopped=false;
 const entry=ip=>{let item=known.get(ip);if(!item){item={nextRefresh:0,failures:0,lastOk:0,statusFailures:0,statusPausedUntil:0,lastManual:0,added:now()};known.set(ip,item)}return item};

 async function sweep(){
  if(sweeping)return;sweeping=true;
  try{for(const sw of await io.sweep())entry(sw.ip)}
  catch(error){log(`Discovery sweep failed: ${error.message}`)}
  finally{lastSweep=now();sweeping=false}
 }

 async function refresh(ip){
  const item=entry(ip);if(refreshing.has(ip))return refreshing.get(ip);
  const run=(async()=>{try{await checking.get(ip)?.catch(()=>{});let timer;await Promise.race([io.refresh(ip),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('read timed out')),limits.refreshTimeoutMs)})]).finally(()=>clearTimeout(timer));item.failures=0;item.lastOk=now();item.nextRefresh=now()+timing().pollMs}
  catch(error){item.failures++;item.nextRefresh=now()+Math.min(limits.maxBackoffMs,timing().pollMs*2**Math.min(item.failures,4));log(`Could not read ${ip}: ${error.message}; retrying later`);throw error}
  finally{refreshing.delete(ip)}})();
  refreshing.set(ip,run);run.catch(()=>{});return run;
 }

 async function statusPass(){
  if(statusRunning)return;statusRunning=true;
  try{
   const t=now(),ips=[...known.entries()].filter(([ip,item])=>item.lastOk&&!refreshing.has(ip)&&item.statusPausedUntil<=t).map(([ip])=>ip);
   await pool(ips,limits.statusConcurrency,async ip=>{const item=known.get(ip);if(!item||refreshing.has(ip))return;const check=io.status(ip);checking.set(ip,check);try{await check;item.statusFailures=0}catch{if(++item.statusFailures>=limits.statusFailuresBeforePause){item.statusFailures=0;item.statusPausedUntil=now()+limits.statusPauseMs}}finally{checking.delete(ip)}});
  }finally{lastStatus=now();statusRunning=false}
 }

 function tick(){
  if(stopped)return;
  const t=now(),{pollMs,discoveryMs,statusMs}=timing();
  // Sweep often while nothing is known yet, then only on the discovery interval.
  if(!sweeping&&t-lastSweep>=(known.size?discoveryMs:pollMs))void sweep();
  for(const [ip,item] of known)if(!item.lastOk&&item.failures&&t-item.added>limits.forgetAfterMs||item.lastOk&&t-item.lastOk>limits.forgetAfterMs)known.delete(ip);
  const due=[...known.entries()].filter(([ip,item])=>!refreshing.has(ip)&&!checking.has(ip)&&item.nextRefresh<=t).sort((a,b)=>a[1].nextRefresh-b[1].nextRefresh);
  for(const [ip] of due.slice(0,Math.max(0,limits.refreshConcurrency-refreshing.size)))refresh(ip).catch(()=>{});
  if(statusMs>0&&!statusRunning&&t-lastStatus>=statusMs)void statusPass();
 }

 return {
  tick,
  seed(ips){for(const ip of ips)entry(ip)},
  known:()=>[...known.keys()],
  isRefreshing:ip=>refreshing.has(ip),
  get sweeping(){return sweeping},
  /** Manual "Scan network": rate limited so many dashboards pressing it can't stack sweeps. */
  requestSweep(){const t=now();if(sweeping||t-lastManualSweep<limits.manualSweepGapMs)return false;lastManualSweep=t;void sweep();for(const item of known.values())item.nextRefresh=Math.min(item.nextRefresh,t);return true},
  /**
   * Re-read one switch now. `force` (after a change) never skips: if a read is already running it may predate
   * the change, so wait for it and read again. Otherwise rate limited per switch; returns null when skipped.
   */
  refreshNow(ip,{force=false}={}){const item=entry(ip),t=now();if(force){const running=refreshing.get(ip);return running?running.catch(()=>{}).then(()=>refresh(ip)):refresh(ip)}if(t-item.lastManual<limits.manualRefreshGapMs||refreshing.has(ip))return null;item.lastManual=t;return refresh(ip)},
  reset(){known.clear();lastSweep=0},
  stop(){stopped=true},
 };
}
