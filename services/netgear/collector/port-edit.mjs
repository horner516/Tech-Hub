// Guarded VLAN changes for one access port at a time. All switch I/O is injected, so the guard rules and
// the order of operations (check → live re-read → assign → verify → save → re-read the switch → log) are
// testable without hardware.

/** More learned MACs than this on one port usually means an unmanaged switch or another uplink behind it. */
export const MAX_ENDPOINT_MACS=4;

const normalizeName=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const sameDevice=(device,other)=>{const left=normalizeName(device),right=normalizeName(other.name);return Boolean(left&&right&&(left.includes(right)||right.includes(left)))};

/**
 * Why this port can't be changed from the dashboard, or null when it can.
 * `context.switches` = every discovered switch (to spot uplinks), `context.localMacs` = this computer's MACs.
 */
export function portLock(sw,port,{switches=[],localMacs=new Set()}={}){
 // The AV UI addresses ports by number; how stack members are numbered in that call hasn't been verified.
 if(sw.ports.some(item=>Number(/^(\d+)\/\d+\/\d+$/.exec(item.interface??'')?.[1]??1)>1))return 'Stacked switch. VLAN changes on stacks aren\'t supported yet.';
 if(!port.ifIndex||!port.bridgePort)return 'The switch did not report this port\'s interface mapping, so its VLAN can\'t be checked live.';
 if(port.vlan==null)return 'The switch did not report this port\'s VLAN.';
 if(port.tagged?.length)return 'Trunk port (carries tagged VLANs). Trunks stay read-only.';
 if(port.lag)return 'Member of a link aggregation group. LAG members stay read-only.';
 const peer=switches.find(other=>other.ip!==sw.ip&&(other.ip===port.ip||sameDevice(port.device,other)));
 if(peer)return `Uplink to ${peer.name}. Switch-to-switch links stay read-only.`;
 const macs=port.learnedMacs??[];
 if(macs.some(mac=>localMacs.has(mac)))return 'This port carries the Tech Hub computer\'s own connection.';
 if(macs.length>MAX_ENDPOINT_MACS)return `${macs.length} devices are learned on this port, so it probably leads to another switch.`;
 return null;
}

const fail=(status,message)=>Object.assign(new Error(message),{status});

/**
 * @param deps.getSwitch(ip) → current switch data (ports, vlanIds) or undefined
 * @param deps.context() → {switches, localMacs} for portLock
 * @param deps.readPort(sw,port,vlanIds) → live {pvid, untagged:Set<vlan>, egress:Set<vlan>} from the switch
 * @param deps.assign({sw,port,fromVlan,toVlan}) applies the AV profile for toVlan to the port
 * @param deps.save({sw}) persists running config to startup config
 * @param deps.refresh(sw) re-reads the whole switch and publishes it
 * @param deps.audit(entry) appends to the change log
 */
export function createPortEditor({getSwitch,context,readPort,assign,save,refresh,audit=()=>{},onStep=()=>{},cooldownMs=3000,verifyAttempts=6,verifyDelayMs=700,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}){
 let busy=false,lastFinished=0;
 return {
  get busy(){return busy},
  async change({switchIp,ifIndex,fromVlan,toVlan,actor='unknown'}){
   if(busy)throw fail(409,'Another VLAN change is in progress. Try again in a moment.');
   const wait=lastFinished+cooldownMs-now();
   if(wait>0)throw fail(429,'Changes are spaced a few seconds apart. Try again in a moment.');
   if(![ifIndex,fromVlan,toVlan].every(Number.isInteger))throw fail(400,'Choose a port and a VLAN.');
   const sw=getSwitch(switchIp);
   if(!sw)throw fail(404,'That switch is not currently discovered.');
   const port=sw.ports.find(item=>item.ifIndex===ifIndex);
   if(!port)throw fail(404,'That port is not on this switch.');
   const lock=portLock(sw,port,context());
   if(lock)throw fail(409,lock);
   if(port.vlan!==fromVlan)throw fail(409,`Port ${port.number} is now on VLAN ${port.vlan}. Reopen it and try again.`);
   if(toVlan===fromVlan)throw fail(400,`Port ${port.number} is already on VLAN ${toVlan}.`);
   if(!sw.vlanIds?.includes(toVlan))throw fail(400,`VLAN ${toVlan} does not exist on ${sw.name}.`);
   busy=true;
   const entry={at:new Date(now()).toISOString(),actor,switchIp:sw.ip,switchName:sw.name,model:sw.model,port:port.number,interface:port.interface,ifIndex,fromVlan,toVlan,device:port.device};
   try{
    onStep('checking');
    const before=await readPort(sw,port,[fromVlan,toVlan]);
    if(before.pvid!==fromVlan||!before.untagged.has(fromVlan))throw fail(409,`Port ${port.number} changed on the switch since this page loaded (it now reports VLAN ${before.pvid}). Nothing was changed.`);
    onStep('applying');
    await assign({sw,port,fromVlan,toVlan});
    onStep('verifying');
    let after=null,verified=false;
    for(let attempt=0;attempt<verifyAttempts&&!verified;attempt++){
     if(attempt)await sleep(verifyDelayMs);
     after=await readPort(sw,port,[fromVlan,toVlan]).catch(()=>after);
     verified=after?.pvid===toVlan&&after.untagged.has(toVlan);
    }
    const warnings=[];
    if(verified&&after.egress.has(fromVlan))warnings.push(`The port is still a member of VLAN ${fromVlan}.`);
    let saved=false,saveError;
    if(verified){onStep('saving');try{await save({sw});saved=true}catch(error){saveError=error.message}}
    onStep('refreshing');
    await Promise.resolve(refresh(sw)).catch(()=>{});
    const result={ok:verified&&saved,verified,saved,saveError,warnings,fromVlan,toVlan,reportedVlan:after?.pvid??null};
    audit({...entry,result:verified?(saved?'applied':'applied-unsaved'):'unverified',reportedVlan:result.reportedVlan,saveError,warnings});
    if(!verified)throw Object.assign(fail(502,`The switch accepted the change, but it still reports VLAN ${after?.pvid??'unknown'} on port ${port.number}. Check the port before trying again.`),{result});
    return result;
   }catch(error){
    if(!error.result)audit({...entry,result:'failed',error:error.message});
    throw error;
   }finally{busy=false;lastFinished=now()}
  },
 };
}
