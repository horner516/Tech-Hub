// Test double for one NETGEAR AV switch: a real SNMPv3 agent (net-snmp) with the IF-MIB, BRIDGE and Q-BRIDGE
// tables the collector reads, a UDP proxy in front of it that counts every request packet, and a minimal AV
// interface (login, profile list, profile-to-port assign and save, as captured from a real M4250's AV UI). Test use only; it never talks to real equipment.
import dgram from 'node:dgram';
import http from 'node:http';
import snmp from 'net-snmp';

const RO=snmp.MaxAccess['read-only'],HIDDEN=snmp.MaxAccess['not-accessible'];
const col=(number,name,type,maxAccess=RO)=>({number,name,type,maxAccess});
const table=(name,oid,columns,indexName)=>({name,type:snmp.MibProviderType.Table,oid,maxAccess:HIDDEN,tableColumns:columns,tableIndex:[{columnName:indexName}]});

/**
 * ports: [{number, pvid, up?, tagged?:[vlan]}] — ifIndex and bridge port both equal the port number.
 * fdb: [{mac, port, vlan}] learned MACs; arp: [{mac, ip}] served as a router's ipNetToMediaTable.
 */
export async function startMockSwitch({fdb=[],arp=[],avRoutes={},snmpPort,proxyPort,avPort,model='M4250-10G2XF-PoE+',name='Mock Stage',vlans={1:'default',10:'Video',50:'Dante'},ports}){
 const agent=snmp.createAgent({port:snmpPort,address:'127.0.0.1',transport:'udp4'},()=>{});
 agent.getAuthorizer().addUser({name:'dashboard',level:snmp.SecurityLevel.noAuthNoPriv});
 const mib=agent.getMib(),T=snmp.ObjectType;
 for(const [scalarName,oid,type,value] of [['sysDescr','1.3.6.1.2.1.1.1',T.OctetString,`NETGEAR ${model} AV Line Fully Managed Switch`],['sysUpTime','1.3.6.1.2.1.1.3',T.TimeTicks,8640000],['sysName','1.3.6.1.2.1.1.5',T.OctetString,name]]){
  mib.registerProvider({name:scalarName,type:snmp.MibProviderType.Scalar,oid,scalarType:type,maxAccess:RO});
  mib.setScalarValue(scalarName,value);
 }
 // Real switches have objects after every table the collector walks; this keeps the agent from running off the end of its MIB.
 mib.registerProvider({name:'endSentinel',type:snmp.MibProviderType.Scalar,oid:'1.3.6.1.6.3.1.1.6.1',scalarType:T.Integer,maxAccess:RO});
 mib.setScalarValue('endSentinel',1);
 mib.registerProvider(table('ifTable','1.3.6.1.2.1.2.2.1',[col(1,'ifIndex',T.Integer),col(2,'ifDescr',T.OctetString),col(3,'ifType',T.Integer),col(8,'ifOperStatus',T.Integer),col(13,'ifInDiscards',T.Counter),col(14,'ifInErrors',T.Counter),col(19,'ifOutDiscards',T.Counter),col(20,'ifOutErrors',T.Counter)],'ifIndex'));
 mib.registerProvider(table('ifXTable','1.3.6.1.2.1.31.1.1.1',[col(100,'ifXIndex',T.Integer,HIDDEN),col(1,'ifName',T.OctetString),col(15,'ifHighSpeed',T.Gauge),col(18,'ifAlias',T.OctetString)],'ifXIndex'));
 mib.registerProvider(table('basePortTable','1.3.6.1.2.1.17.1.4.1',[col(1,'dot1dBasePort',T.Integer),col(2,'dot1dBasePortIfIndex',T.Integer)],'dot1dBasePort'));
 mib.registerProvider(table('portVlanTable','1.3.6.1.2.1.17.7.1.4.5.1',[col(100,'pvidIndex',T.Integer,HIDDEN),col(1,'dot1qPvid',T.Gauge)],'pvidIndex'));
 mib.registerProvider(table('vlanStaticTable','1.3.6.1.2.1.17.7.1.4.3.1',[col(100,'vlanIndex',T.Integer,HIDDEN),col(1,'name',T.OctetString),col(2,'egress',T.OctetString),col(4,'untagged',T.OctetString)],'vlanIndex'));

 const macBytes=mac=>Buffer.from(mac.split(':').map(byte=>parseInt(byte,16)));
 mib.registerProvider({...table('fdbTable','1.3.6.1.2.1.17.7.1.2.2.1',[col(100,'fdbId',T.Integer,HIDDEN),col(101,'fdbAddress',T.OctetString,HIDDEN),col(2,'fdbPort',T.Integer)],'fdbId'),tableIndex:[{columnName:'fdbId'},{columnName:'fdbAddress'}]});
 for(const {mac,port,vlan=10} of fdb)mib.addTableRow('fdbTable',[vlan,macBytes(mac),port]);
 mib.registerProvider({...table('arpTable','1.3.6.1.2.1.4.22.1',[col(1,'arpIfIndex',T.Integer),col(2,'arpPhysAddress',T.OctetString),col(3,'arpNetAddress',T.IpAddress)],'arpIfIndex'),tableIndex:[{columnName:'arpIfIndex'},{columnName:'arpNetAddress'}]});
 for(const {mac,ip} of arp)mib.addTableRow('arpTable',[10,macBytes(mac),ip]);
 const state=new Map(ports.map(port=>[port.number,{up:true,tagged:[],...port}]));
 const bytes=Math.ceil(Math.max(...state.keys())/8);
 const bitmap=numbers=>{const buf=Buffer.alloc(bytes);for(const n of numbers)buf[Math.floor((n-1)/8)]|=0x80>>((n-1)%8);return buf};
 for(const port of state.values()){
  mib.addTableRow('ifTable',[port.number,`Unit: 1 Slot: 0 Port: ${port.number} Gigabit - Level`,6,port.up?1:2,0,0,0,0]);
  mib.addTableRow('ifXTable',[port.number,`1/0/${port.number}`,port.up?1000:0,'']);
  mib.addTableRow('basePortTable',[port.number,port.number]);
  mib.addTableRow('portVlanTable',[port.number,port.pvid]);
 }
 mib.addTableRow('ifTable',[1001,'VLAN 1 interface',135,1,0,0,0,0]);// filtered out as non-physical
 mib.addTableRow('ifXTable',[1001,'vlan 1',0,'']);
 const membership=()=>{const all=[...state.values()];return Object.fromEntries(Object.keys(vlans).map(Number).map(id=>[id,{egress:bitmap(all.filter(p=>p.pvid===id||p.tagged.includes(id)).map(p=>p.number)),untagged:bitmap(all.filter(p=>p.pvid===id).map(p=>p.number))}]))};
 const writeVlans=()=>{const m=membership();for(const [id,label] of Object.entries(vlans)){const row=Number(id);try{mib.deleteTableRow('vlanStaticTable',[row])}catch{}mib.addTableRow('vlanStaticTable',[row,label,m[row].egress,m[row].untagged])}};
 writeVlans();

 // Counting proxy: collector → proxyPort → agent. Replies are relayed back to the asking socket.
 const proxy=dgram.createSocket('udp4'),upstreams=new Map(),counts={requests:0};
 proxy.on('message',(msg,from)=>{counts.requests++;const key=`${from.address}:${from.port}`;let up=upstreams.get(key);if(!up){up=dgram.createSocket('udp4');up.on('message',reply=>proxy.send(reply,from.port,from.address));upstreams.set(key,up)}up.send(msg,snmpPort,'127.0.0.1')});
 await new Promise(resolve=>proxy.bind(proxyPort,'127.0.0.1',resolve));

 // AV interface: enough for login, profile list and logout.
 const avLog=[],avCalls=[],avFail={assign:false,save:false,ignoreAssign:false};
 const av=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{avLog.push(`${req.method} ${req.url}`);res.setHeader('Content-Type','application/json');
  if(req.url==='/api/v1/login'){const {user}=JSON.parse(body||'{}');if(user?.name==='admin'&&user?.password==='switch-pass')return res.end(JSON.stringify({resp:{respCode:0},user:{session:'mock-session'}}));res.statusCode=401;return res.end(JSON.stringify({resp:{respCode:1}}))}
  if(req.headers.session!=='mock-session'){res.statusCode=401;return res.end('{}')}
  const parsed=JSON.parse(body||'{}');if(req.method==='POST')avCalls.push({url:req.url,body:parsed});
  if(req.url==='/api/v1/profile/list')return res.end(JSON.stringify({resp:{respCode:0},profileList:Object.entries(vlans).map(([id,label])=>({name:label,profileType:Number(id)===1?'Default':'Data',color:'#1e9bff',vlans:[{vlanId:Number(id),vlanType:0,static:true}]}))}));
  if(req.url==='/api/v1/profile/port'&&req.method==='POST'){if(avFail.assign)return res.end(JSON.stringify({resp:{respCode:5,respMsg:'Port is a trunk member',status:'failure'}}));const {vlanId,Untaged=[]}=parsed.portToProfile??{};if(!avFail.ignoreAssign)setTimeout(()=>{for(const n of Untaged)if(state.has(n))api.setPvid(n,vlanId)},200);return res.end(JSON.stringify({resp:{respCode:0,respMsg:'Success',status:'success'}}))}
  if(req.url==='/api/v1/switch_config'&&req.method==='POST'){if(avFail.save)return res.end(JSON.stringify({resp:{respCode:3,respMsg:'Flash busy',status:'failure'}}));return res.end(JSON.stringify({resp:{respCode:0,respMsg:'Success',status:'success'}}))}
  if(req.url==='/api/v1/logout')return res.end(JSON.stringify({resp:{respCode:0}}));
  if(avRoutes[req.url])return res.end(JSON.stringify(avRoutes[req.url](parsed)));
  res.statusCode=404;res.end('{}')})});
 await new Promise(resolve=>av.listen(avPort,'127.0.0.1',resolve));

 const api={
  counts,avLog,avCalls,avFail,
  pvid:number=>state.get(number).pvid,
  setLink(number,up){const port=state.get(number);port.up=up;mib.setTableSingleCell('ifTable',8,[number],up?1:2);mib.setTableSingleCell('ifXTable',15,[number],up?1000:0)},
  setPvid(number,pvid){state.get(number).pvid=pvid;mib.setTableSingleCell('portVlanTable',1,[number],pvid);writeVlans()},
  async close(){agent.close();proxy.close();for(const up of upstreams.values())up.close();await new Promise(resolve=>{av.closeAllConnections();av.close(resolve)})},
 };
 return api;
}
