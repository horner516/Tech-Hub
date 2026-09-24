'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {supervise} = require('./supervisor.cjs');
const serviceConfig = require('./service-config.cjs');
const backups=require('./backups.cjs');
const revision=value=>'"'+crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')+'"';
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const definitions = [
  {id:'dsan', name:'D’san Ready', detail:'Limitimer & PerfectCue', port:8701, backendPort:18701},
  {id:'lux', name:'Lux Link', detail:'Lighting network', port:8702, backendPort:18702},
  {id:'power', name:'Power Monitor', detail:'Power distribution', port:8703, backendPort:18703},
  {id:'netgear', name:'NETGEAR AV Switchboard', detail:'Switch discovery & monitoring', port:8704, backendPort:18704},
  {id:'record', name:'Record Monitor', detail:'HyperDeck & AJA Ki Pro', port:8705, backendPort:18705},
  {id:'ultrix', name:'Router Panel', detail:'Ross Ultrix & Blackmagic Videohub control', port:8706, backendPort:18706},
];
const root = path.resolve(__dirname, '..');
function save(file, data) {
  const temp = file+'.tmp'; fs.writeFileSync(temp, JSON.stringify(data,null,2)+'\n',{mode:0o600}); fs.renameSync(temp,file);
}
function defaultDataDir(platform=process.platform,env=process.env,home=os.homedir()) { return platform==='win32'?path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Streamline','Tech Hub'):path.join(home,'Library','Application Support','Tech Hub'); }
function loadConfig(dir) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file = path.join(dir,'config.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {adminPort:8700,host:'0.0.0.0',services:Object.fromEntries(definitions.map(d=>[d.id,{port:d.port,backendPort:d.backendPort,password:null}]))};
  // Add new services without changing any existing port or password.
  const occupied=new Set([config.adminPort,...Object.values(config.services||{}).flatMap(s=>[s.port,s.backendPort])]);
  config.services ||= {};
  const available=preferred=>{let port=preferred;while(occupied.has(port)&&port<65535)port++;if(occupied.has(port))throw Error('No available port for new service');occupied.add(port);return port;};
  for(const d of definitions)if(!config.services[d.id])config.services[d.id]={port:available(d.port),backendPort:available(d.backendPort),password:null};
  for(const d of definitions){const s=config.services[d.id];if(s.enabled===undefined)s.enabled=true;if(typeof s.enabled!=='boolean')throw Error('Service enabled must be true or false.');}
  const used = new Set();
  for (const port of [config.adminPort,...definitions.flatMap(d=>[config.services?.[d.id]?.port,config.services?.[d.id]?.backendPort])]) {
    if (!Number.isInteger(port)||port<1024||port>65535||used.has(port)) throw Error('Every admin, service, and internal port must be unique and between 1024 and 65535.');
    used.add(port);
  }
  if (!['0.0.0.0','127.0.0.1'].includes(config.host)) throw Error('host must be 0.0.0.0 or 127.0.0.1');
  save(file,config);
  return config;
}
async function hashPassword(value) { const salt=crypto.randomBytes(16).toString('hex'); return {salt,hash:(await scrypt(value,salt,32)).toString('hex')}; }
async function verifyPassword(value, stored) {
  if (!stored || typeof stored.salt!=='string' || !/^[a-f0-9]{64}$/.test(stored.hash)) return false;
  const actual=await scrypt(value,stored.salt,32); return crypto.timingSafeEqual(actual,Buffer.from(stored.hash,'hex'));
}
function send(res,status,body,type='application/json') { res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}); res.end(type==='application/json'?JSON.stringify(body):body); }
async function readBody(req,limit=65536) { let body=''; for await (const chunk of req) { body+=chunk; if(Buffer.byteLength(body)>limit) throw Error('Request too large'); } return body; }
function sameOrigin(req) { return req.headers['sec-fetch-site']!=='cross-site' && (!req.headers.origin || req.headers.origin===`http://${req.headers.host}`); }
function listen(server,port,host) { return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});}); }
function close(server) { server.closeAllConnections(); return new Promise(resolve=>server.close(resolve)); }
function ips(host) { return host==='127.0.0.1'?[]:[...new Set(Object.values(os.networkInterfaces()).flat().filter(n=>n&&!n.internal&&n.family==='IPv4').map(n=>n.address))]; }
function loginPage(name,error='') { return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${name} · Tech Hub</title><script src="/__hub/chrome.js" defer></script><link rel="icon" type="image/svg+xml" href="/__hub/favicon.svg"><style>:root{color-scheme:dark}body{background:#071015;color:#f2f7f5;font:16px system-ui;min-height:95vh;margin:0}main{width:min(360px,85vw);margin:8vh auto}main>p:first-child{color:#ff8a1f;font-weight:700;letter-spacing:.15em}input,button{box-sizing:border-box;width:100%;padding:14px;margin:10px 0;border-radius:8px;border:1px solid #31505a;font:inherit}input{background:#0c181e;color:#f2f7f5}button{background:#ff8a1f;color:#1b0d02;border-color:#ff8a1f;font-weight:650;cursor:pointer}button:hover{background:#ffa24f}input:focus-visible,button:focus-visible{outline:2px solid #ff8a1f;outline-offset:3px}p{color:#8ca3aa}p[role=alert]{color:#ff7a7a}</style><main><p>TECH HUB</p><h1>${name}</h1><p>Enter this service’s access password.</p><form method="post" action="/__hub/login"><label for="password">Service password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><button>Open dashboard</button></form><p role="alert">${error}</p></main>`; }
async function startHub({dir=process.env.TECH_HUB_DATA_DIR||defaultDataDir(), launch=true,checkUpdates=launch}={}) {
  const updates=require('./updates.cjs').createUpdateChecker(require('../package.json').version);
  const config=loadConfig(dir), sessions=new Map(), attempts=new Map(), states=new Map(), servers=[],supervisors=new Map();
  const activeResponses=new Map(definitions.map(d=>[d.id,new Set()]));
  const changing=new Set();let mutations=0;
  function track(req,res){if(['GET','HEAD'].includes(req.method)||req.url==='/api/backup/restore')return;mutations++;let done=false;const finish=()=>{if(!done){done=true;mutations--;}};res.once('finish',finish);res.once('close',finish);}
  const local=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&['localhost','127.0.0.1','[::1]'].includes(new URL('http://'+req.headers.host).hostname);
  const chrome=require('./service-chrome.cjs');
  const navigation=(req,id)=>({current:id,adminPort:config.adminPort,local:local(req),settings:local(req)&&['record','ultrix'].includes(id),services:services.filter(s=>config.services[s.id].enabled).map(s=>({id:s.id,name:s.name,port:s.port,protected:!!config.services[s.id].password,state:states.get(s.id)?.state}))});
  async function configure(req,res,id){
    if(!local(req)||!sameOrigin(req))return send(res,403,{error:'Settings are available only on the Tech Hub computer.'});
    if(req.method==='GET'){const value=serviceConfig.read(dir,id);res.setHeader('ETag',revision(value));return send(res,200,value);}
    if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
    if(changing.has(id)||['starting','recovering','stopping'].includes(states.get(id)?.state))return send(res,409,{error:'Wait for this service to finish changing state.'});
    changing.add(id);
    try{
      if(!/^application\/json/.test(req.headers['content-type']||''))throw Error('JSON required');
      const incoming=JSON.parse(await readBody(req));const previous=serviceConfig.read(dir,id);
      if(req.headers['if-match']&&req.headers['if-match']!==revision(previous))return send(res,409,{error:'Settings changed in another window. Close and reopen settings before saving.'});
      serviceConfig.write(dir,id,incoming);
      if(config.services[id].enabled&&supervisors.has(id)){
        if(['record','ultrix'].includes(id)){
          const reload=async()=>{const d=services.find(s=>s.id===id);const response=await fetch(`http://127.0.0.1:${d.backendPort}/api/reload-config`,{method:'POST',headers:{'Content-Type':'application/json','x-techhub-local-client':'1'},body:'{}',signal:AbortSignal.timeout(5000)});const result=await response.json();if(!response.ok)throw Error(result.error||'The service could not apply settings.');};
          try{await reload();}catch(error){serviceConfig.write(dir,id,previous);try{await reload();}catch{}throw error;}
        }else await supervisors.get(id).restart();
      }
      return send(res,200,{ok:true});
    }finally{changing.delete(id);}
  }
  let stopping=false,restorePending=false;
  const startedAt=Date.now();
  const services=definitions.map(d=>({...d,...config.services[d.id]}));
  // Keep every saved assignment reserved so one fallback cannot displace another service.
  const assigned=new Set([config.adminPort,...services.flatMap(d=>[d.port,d.backendPort])]);
  async function assign(server,preferred,host,record,key) {
    for(let offset=0;offset<64512;offset++) {
      const candidate=1024+(preferred-1024+offset)%64512;
      if(candidate!==preferred&&assigned.has(candidate))continue;
      try {await listen(server,candidate,host);} catch(error) {
        if(error.code==='EADDRINUSE')continue;
        throw error;
      }
      if(candidate!==preferred) {
        record[key]=candidate;
        try {save(path.join(dir,'config.json'),config);} catch(error) {record[key]=preferred;await close(server);throw error;}
        assigned.delete(preferred);assigned.add(candidate);
        console.log(`Port ${preferred} occupied; saved replacement ${candidate}.`);
      }
      return candidate;
    }
    throw Error(`No available TCP port for ${preferred}.`);
  }
  const logdir=path.join(dir,'logs'); fs.mkdirSync(logdir,{recursive:true,mode:0o700});
  const invalidate=id=>{for(const [key,s] of sessions) if(s.id===id)sessions.delete(key);for(const response of activeResponses.get(id))response.destroy();};
  function status() {return {name:'Tech Hub',version:require('../package.json').version,adminPort:config.adminPort,startedAt,services:services.map(d=>({id:d.id,name:d.name,detail:d.detail,port:d.port,enabled:config.services[d.id].enabled,protected:!!config.services[d.id].password,localURL:`http://127.0.0.1:${d.port}`,urls:ips(config.host).map(ip=>`http://${ip}:${d.port}`),...states.get(d.id)}))};}
  const diagnostics=require('./diagnostics.cjs').createDiagnostics(()=>services.map(d=>({...d,...states.get(d.id)})));
  for (const d of services) states.set(d.id,{state:'starting',error:null});
  const admin=http.createServer(async(req,res)=>{
    track(req,res);
    if (![`127.0.0.1:${config.adminPort}`,`localhost:${config.adminPort}`].includes(req.headers.host) || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(res,403,{error:'Admin is available only on this computer.'});
    try {
      if(restorePending&&req.method!=='GET')return send(res,409,{error:'Backup restored. Quit and reopen Tech Hub before making changes.'});
      if(chrome.asset(req,res))return;
      if(req.method==='GET'&&req.url==='/__hub/navigation')return send(res,200,navigation(req,'master'));
      if(req.method==='POST'&&req.url==='/api/enabled'){
        if(!sameOrigin(req)||!/^application\/json/.test(req.headers['content-type']||''))return send(res,403,{error:'Use the local admin page.'});
        backups.snapshot(dir);
        const {id,enabled}=JSON.parse(await readBody(req));
        if(!definitions.some(s=>s.id===id)||typeof enabled!=='boolean')return send(res,400,{error:'Choose a valid service and enabled state.'});
        if(changing.has(id))return send(res,409,{error:'Service state is changing. Try again shortly.'});
        changing.add(id);
        try{
          if(config.services[id].enabled===enabled)return send(res,200,{ok:true});
          if(enabled&&launch){const d=services.find(s=>s.id===id),reservation=http.createServer();try{d.backendPort=await assign(reservation,d.backendPort,'127.0.0.1',config.services[id],'backendPort');}finally{if(reservation.listening)await close(reservation);}}
          const next=structuredClone(config);next.services[id].enabled=enabled;save(path.join(dir,'config.json'),next);config.services[id].enabled=enabled;
          if(!enabled){states.set(id,{state:'stopping',error:null});invalidate(id);await supervisors.get(id)?.stop();states.set(id,{state:'disabled',error:null});}
          else if(supervisors.has(id))supervisors.get(id).start();else states.set(id,{state:launch?'error':'running',error:launch?'Unable to start service. Restart Tech Hub.':null});
          return send(res,200,{ok:true});
        }finally{changing.delete(id);}
      }
      if(req.method==='GET'&&['/favicon.ico','/__hub/favicon.svg'].includes(req.url))return send(res,200,fs.readFileSync(path.join(__dirname,'icon-hub.svg')),'image/svg+xml');
      if(req.url==='/api/diagnostics'&&req.method==='GET')return send(res,200,await diagnostics.collect());
      if(req.url==='/api/backup/list'&&req.method==='GET')return send(res,200,{backups:backups.list(dir)});
      if(req.url==='/api/backup/export'&&req.method==='POST'){
        if(!sameOrigin(req)||!/^application\/json/.test(req.headers['content-type']||''))return send(res,403,{error:'Use the local admin page.'});
        const {passphrase}=JSON.parse(await readBody(req));return send(res,200,await backups.seal(backups.collect(dir),passphrase));
      }
      if(req.url==='/api/backup/restore'&&req.method==='POST'){
        if(!sameOrigin(req)||!/^application\/json/.test(req.headers['content-type']||''))return send(res,403,{error:'Use the local admin page.'});
        if(restorePending||changing.size||mutations)return send(res,409,{error:'Wait for current service changes to finish.'});
        const body=JSON.parse(await readBody(req,20*1024*1024));const restored=backups.validate(body.snapshot?backups.saved(dir,body.snapshot):await backups.open(body.backup,body.passphrase),serviceConfig.validate);
        const staging=fs.mkdtempSync(path.join(os.tmpdir(),'techhub-restore-'));try{fs.writeFileSync(path.join(staging,'config.json'),restored.files['config.json']);loadConfig(staging);}finally{fs.rmSync(staging,{recursive:true,force:true});}
        if(restorePending||changing.size||mutations)return send(res,409,{error:'Wait for current service changes to finish.'});
        backups.snapshot(dir);restorePending=true;
        await Promise.all([...supervisors.values()].map(s=>s.stop()));
        try{backups.restore(dir,restored);}catch(error){restorePending=false;for(const [id,s]of supervisors)if(config.services[id].enabled)s.start();throw error;}
        for(const d of services){invalidate(d.id);config.services[d.id].enabled=false;states.set(d.id,{state:'disabled',error:null});}
        return send(res,200,{ok:true,message:'Backup restored. Quit and reopen Tech Hub to use the restored settings.'});
      }
      if(req.method==='GET'&&req.url==='/api/status')return send(res,200,{...status(),restorePending});
      if(req.method==='GET'&&req.url==='/api/updates')return send(res,200,updates.snapshot());
      if(req.method==='POST'&&req.url==='/api/updates/check') {
        if(!sameOrigin(req))return send(res,403,{error:'Use the local admin page.'});
        void updates.check();return send(res,202,updates.snapshot());
      }
      if(req.url?.startsWith('/api/service-config')) {
        if(!sameOrigin(req))return send(res,403,{error:'Use the local admin page.'});
        const id=new URL(req.url,'http://localhost').searchParams.get('id');
        return await configure(req,res,id);
      }
      if(req.method==='GET'&&['/','/app.js','/style.css'].includes(req.url)) {
        const file=req.url==='/'?'index.html':req.url.slice(1); return send(res,200,fs.readFileSync(path.join(__dirname,file)),file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
      }
      if(req.method==='POST'&&req.url==='/api/restart') {
        if(!sameOrigin(req) || !/^application\/json/.test(req.headers['content-type']||''))return send(res,403,{error:'Use the local admin page.'});
        const body=JSON.parse(await readBody(req)), supervisor=supervisors.get(body.id);
        if(!supervisor||!config.services[body.id]?.enabled||changing.has(body.id))return send(res,400,{error:'Enable the service before restarting, and wait for any pending change.'});
        if(states.get(body.id).state==='starting'||states.get(body.id).state==='recovering')return send(res,409,{error:'Service recovery is already in progress.'});
        states.set(body.id,{state:'recovering',error:null});
        changing.add(body.id);try{await supervisor.restart();return send(res,200,{ok:true});}finally{changing.delete(body.id);}
      }
      if(req.method==='POST'&&req.url==='/api/access') {
        if(!sameOrigin(req) || !/^application\/json/.test(req.headers['content-type']||'')) return send(res,403,{error:'Use the local admin page.'});
        const body=JSON.parse(await readBody(req));
        if(!definitions.some(d=>d.id===body.id)||typeof body.password!=='string'||body.password.length>256||(body.password.length>0&&body.password.length<8))return send(res,400,{error:'Use at least 8 characters, or leave blank to remove the password.'});
        backups.snapshot(dir);
        const password=body.password?await hashPassword(body.password):null;
        const next=structuredClone(config);next.services[body.id].password=password;save(path.join(dir,'config.json'),next);config.services[body.id].password=password;invalidate(body.id);
        return send(res,200,{ok:true});
      }
      send(res,404,{error:'Not found'});
    } catch(error) {send(res,400,{error:error.message});}
  });
  try {await assign(admin,config.adminPort,'127.0.0.1',config,'adminPort');servers.push(admin);} catch(error) {throw Error(`Master page port ${config.adminPort}: ${error.message}`);}
  for(const d of services) {
    const gateway=http.createServer(async(req,res)=>{
      track(req,res);
      try {
        if (!req.url.startsWith('/')||req.url.startsWith('//')) return send(res,400,{error:'Invalid URL'});
        if(!sameOrigin(req))return send(res,403,{error:'Cross-origin requests are not allowed.'});
        if(chrome.asset(req,res))return;
        if(restorePending&&req.method!=='GET')return send(res,409,{error:'Quit and reopen Tech Hub after restoring the backup.'});
        if(req.url.split('?')[0]==='/api/reload-config')return send(res,403,{error:'Internal endpoint'});
        const stored=config.services[d.id].password;
        // Icons identify the service even before login; they contain no private data.
        if(req.method==='GET'&&['/favicon.ico','/__hub/favicon.svg'].includes(req.url))return send(res,200,fs.readFileSync(path.join(__dirname,`icon-${d.id}.svg`)),'image/svg+xml');
        const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));
        const session=sessions.get(cookies['techhub_'+d.id]);
        const authed=!stored||(session&&session.id===d.id&&session.expires>Date.now());
        if(req.url==='/__hub/login'&&req.method==='POST') {
          const key=d.id+':'+req.socket.remoteAddress;
          const recent=attempts.get(key)||{count:0,until:Date.now()+60000};
          if(recent.until<Date.now()){recent.count=0;recent.until=Date.now()+60000;}
          if(recent.count>=10)return send(res,429,loginPage(d.name,'Too many attempts. Try again in one minute.'),'text/html');
          recent.count++;attempts.set(key,recent);
          const password=new URLSearchParams(await readBody(req)).get('password')||'';
          if(stored&&!await verifyPassword(password,stored))return send(res,401,loginPage(d.name,'Incorrect password.'),'text/html');
          const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{id:d.id,expires:Date.now()+12*3600000});attempts.delete(key);
          res.writeHead(303,{'Location':'/','Set-Cookie':`techhub_${d.id}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,'Cache-Control':'no-store'});res.end();return;
        }
        if(req.method==='GET'&&req.url==='/__hub/navigation')return send(res,200,{...navigation(req,d.id),settings:!!authed&&local(req)&&['record','ultrix'].includes(d.id),authRequired:!authed,message:!authed?'Session expired or password required. Sign in again.':!config.services[d.id].enabled?'Service off. Choose another app.':states.get(d.id).state!=='running'?'Reconnecting — '+states.get(d.id).state:null});
        if(!authed) return send(res,401,req.url.startsWith('/api/')?{error:'Service password required'}:loginPage(d.name),req.url.startsWith('/api/')?'application/json':'text/html');
        if(req.method==='GET'&&req.url==='/__hub/navigation')return send(res,200,navigation(req,d.id));
        if(req.url==='/__hub/settings'&&['record','ultrix'].includes(d.id))return await configure(req,res,d.id);
        if(!config.services[d.id].enabled)return send(res,503,chrome.disabled(d.name),'text/html');
        if(states.get(d.id).state!=='running')return send(res,503,req.url.startsWith('/api/')?{error:'Service reconnecting'}:chrome.disabled(d.name,'Reconnecting. You can choose another app above.','reconnecting'),req.url.startsWith('/api/')?'application/json':'text/html');
        if(req.url.startsWith('/api/update')&&d.id==='power')return send(res,200,{current_version:require('../package.json').version,available:false,error:'Power Monitor is bundled with Tech Hub. Update the complete app from the Tech Hub release page.'});
        if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&['/api/config','/api/devices','/api/devices/layout','/api/devices/ports','/api/color-scheme'].includes(req.url.split('?')[0]))backups.snapshot(dir);
        const headers={...req.headers,host:`127.0.0.1:${d.backendPort}`}; delete headers.cookie;delete headers.authorization;
        headers['x-techhub-local-client']=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)?'1':'0';
        headers['accept-encoding']='identity';
        // Preserve only Router Panel's profile session, never another service's cookies.
        if(d.id==='ultrix'&&/^[a-f0-9]+$/.test(cookies.techhub_ultrix_profile||''))headers.cookie=`sid=${cookies.techhub_ultrix_profile}`;
        if(headers.origin)headers.origin=`http://127.0.0.1:${d.backendPort}`;
        activeResponses.get(d.id).add(res);
        const sessionTimer=stored&&session?setTimeout(()=>res.destroy(),Math.max(1,session.expires-Date.now())):null;
        sessionTimer?.unref();
        res.once('close',()=>{clearTimeout(sessionTimer);activeResponses.get(d.id).delete(res);});
        const upstream=http.request({hostname:'127.0.0.1',port:d.backendPort,path:req.url,method:req.method,headers},response=>{
          const outgoing={...response.headers};delete outgoing['set-cookie'];
          if(d.id==='ultrix'&&response.headers['set-cookie'])outgoing['set-cookie']=response.headers['set-cookie'].filter(c=>c.startsWith('sid=')).map(c=>c.replace(/^sid=/,'techhub_ultrix_profile='));
          if(chrome.inject(req,res,response,outgoing,d.id))return;
          res.writeHead(response.statusCode,outgoing);response.pipe(res);
        });
        upstream.setTimeout(120000,()=>upstream.destroy(Error('Service timeout')));
        upstream.on('error',()=>{if(!res.headersSent)send(res,502,{error:'Service connection lost. Check Tech Hub.'});else res.destroy();});
        req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
      } catch(error){if(!res.headersSent)send(res,400,{error:error.message});else res.destroy();}
    });
    gateway.requestTimeout=15000;
    try {d.port=await assign(gateway,d.port,config.host,config.services[d.id],'port');servers.push(gateway);} catch(error){states.set(d.id,{state:'error',error:`Unable to assign web port ${d.port}: ${error.message}`});continue;}
    if(!launch){states.set(d.id,{state:config.services[d.id].enabled?'running':'disabled',error:null});continue;}
    const reservation=http.createServer();
    try {d.backendPort=await assign(reservation,d.backendPort,'127.0.0.1',config.services[d.id],'backendPort');await close(reservation);} catch(error){states.set(d.id,{state:'error',error:`Unable to assign internal port ${d.backendPort}: ${error.message}`});continue;}
    const dataDir=path.join(dir,d.id);fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
    const resources=process.env.TECH_HUB_RESOURCES||path.join(root,'build','resources');
    let command,args;
    if(d.id==='dsan'){command=path.join(resources,'dsan',process.platform==='win32'?'dsan-server.exe':'dsan-server');args=[];}
    if(d.id==='power'){command=path.join(resources,process.platform==='win32'?'power-server.exe':'power-server');args=['--host','127.0.0.1','--port',String(d.backendPort),'--config',path.join(dataDir,'settings.json'),'--no-browser'];}
    if(d.id==='lux'){command=process.execPath;args=[path.join(__dirname,'lux-server.cjs'),path.join(resources,'lux')];}
    if(d.id==='netgear'){command=process.execPath;args=[path.join(resources,'netgear','collector','server.mjs')];}
    if(['record','ultrix'].includes(d.id)){
      serviceConfig.read(dir,d.id);
      command=process.execPath;args=[path.join(resources,d.id,d.id==='record'?'server.js':'src/main.js'),'--config',serviceConfig.file(dir,d.id)];
    }
    const logPath=path.join(logdir,d.id+'.log');
    if(fs.existsSync(logPath)&&fs.statSync(logPath).size>5*1024*1024)fs.renameSync(logPath,logPath+'.previous');
    supervisors.set(d.id,supervise({
      autoStart:config.services[d.id].enabled,
      start:()=>{
        const log=fs.openSync(logPath,'a',0o600);
        const child=spawn(command,args,{windowsHide:true,env:{...process.env,TECH_HUB_MANAGED:'1',TECH_HUB_VERSION:require('../package.json').version,TECH_HUB_PUBLIC_PORT:String(d.port),TECH_HUB_PUBLIC_HOST:config.host,TECH_HUB_BACKEND_PORT:String(d.backendPort),TECH_HUB_BACKEND_HOST:'127.0.0.1',TECH_HUB_DATA_DIR:dataDir,LNA_APP_SUPPORT:dataDir,LNA_MA_READER:process.platform==='darwin'?path.join(resources,'MA Web Remote Reader.app','Contents','MacOS','MA Web Remote Reader'):''},stdio:['ignore',log,log]});fs.closeSync(log);return child;
      },
      check:async()=>{const response=await fetch(`http://127.0.0.1:${d.backendPort}/`,{signal:AbortSignal.timeout(1500)});await response.body?.cancel();return response.ok;},
      report:state=>{diagnostics.event(d.id,state);states.set(d.id,state);}
    }));
    if(!config.services[d.id].enabled)states.set(d.id,{state:'disabled',error:null});
  }
  try {save(path.join(dir,'runtime.json'),{pid:process.pid,adminPort:config.adminPort});} catch(error) {await Promise.all([...supervisors.values()].map(s=>s.stop()));await Promise.all(servers.map(close));throw error;}
  const cleanup=setInterval(()=>{for(const[k,s]of sessions)if(s.expires<Date.now())sessions.delete(k);for(const[k,a]of attempts)if(a.until<Date.now())attempts.delete(k);},60000);cleanup.unref();
  if(checkUpdates)void updates.check();
  async function stop(){if(stopping)return;stopping=true;updates.stop();clearInterval(cleanup);await Promise.all([...supervisors.values()].map(s=>s.stop()));await Promise.all(servers.map(close));}
  return {status,stop,config};
}
if(require.main===module)startHub().then(hub=>{console.log(`TECH_HUB_READY http://127.0.0.1:${hub.config.adminPort}`);if(process.env.TECH_HUB_STDIN_CONTROL==='1'){const lines=require('node:readline').createInterface({input:process.stdin});lines.on('line',line=>{if(line==='shutdown')hub.stop().then(()=>process.exit(0));});lines.on('close',()=>hub.stop().then(()=>process.exit(0)));}for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>hub.stop().then(()=>process.exit(0)));if(process.env.TECH_HUB_PARENT_PID){const parent=Number(process.env.TECH_HUB_PARENT_PID);setInterval(()=>{try{process.kill(parent,0);}catch{hub.stop().then(()=>process.exit(0));}},2000).unref();}}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={defaultDataDir,startHub,loadConfig,hashPassword,verifyPassword,definitions};
