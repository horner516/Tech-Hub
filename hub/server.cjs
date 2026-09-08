'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const definitions = [
  {id:'dsan', name:'D’san Ready', detail:'Limitimer & PerfectCue', port:8701, backendPort:18701},
  {id:'lux', name:'Lux Link', detail:'Lighting network', port:8702, backendPort:18702},
  {id:'power', name:'Power Monitor', detail:'Power distribution', port:8703, backendPort:18703},
];
const root = path.resolve(__dirname, '..');
function save(file, data) {
  const temp = file+'.tmp'; fs.writeFileSync(temp, JSON.stringify(data,null,2)+'\n',{mode:0o600}); fs.renameSync(temp,file);
}
function loadConfig(dir) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file = path.join(dir,'config.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {adminPort:8700,host:'0.0.0.0',services:Object.fromEntries(definitions.map(d=>[d.id,{port:d.port,backendPort:d.backendPort,password:null}]))};
  const used = new Set();
  for (const port of [config.adminPort,...definitions.flatMap(d=>[config.services?.[d.id]?.port,config.services?.[d.id]?.backendPort])]) {
    if (!Number.isInteger(port)||port<1024||port>65535||used.has(port)) throw Error('Every admin, service, and internal port must be unique and between 1024 and 65535.');
    used.add(port);
  }
  if (!['0.0.0.0','127.0.0.1'].includes(config.host)) throw Error('host must be 0.0.0.0 or 127.0.0.1');
  if (!fs.existsSync(file)) save(file,config);
  return config;
}
async function hashPassword(value) { const salt=crypto.randomBytes(16).toString('hex'); return {salt,hash:(await scrypt(value,salt,32)).toString('hex')}; }
async function verifyPassword(value, stored) {
  if (!stored || typeof stored.salt!=='string' || !/^[a-f0-9]{64}$/.test(stored.hash)) return false;
  const actual=await scrypt(value,stored.salt,32); return crypto.timingSafeEqual(actual,Buffer.from(stored.hash,'hex'));
}
function send(res,status,body,type='application/json') { res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}); res.end(type==='application/json'?JSON.stringify(body):body); }
async function readBody(req) { let body=''; for await (const chunk of req) { body+=chunk; if(Buffer.byteLength(body)>8192) throw Error('Request too large'); } return body; }
function sameOrigin(req) { return req.headers['sec-fetch-site']!=='cross-site' && (!req.headers.origin || req.headers.origin===`http://${req.headers.host}`); }
function listen(server,port,host) { return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});}); }
function close(server) { server.closeAllConnections(); return new Promise(resolve=>server.close(resolve)); }
function ips(host) { return host==='127.0.0.1'?[]:[...new Set(Object.values(os.networkInterfaces()).flat().filter(n=>n&&!n.internal&&n.family==='IPv4').map(n=>n.address))]; }
function loginPage(name,error='') { return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${name} · Tech Hub</title><style>body{background:#10171b;color:#f1f5f4;font:16px system-ui;display:grid;place-items:center;min-height:95vh}main{width:min(360px,85vw)}input,button{box-sizing:border-box;width:100%;padding:14px;margin:10px 0;border-radius:8px;border:1px solid #526166;font:inherit}button{background:#baf16e;cursor:pointer}p{color:#a9b8b9}</style><main><p>TECH HUB</p><h1>${name}</h1><p>Enter this service’s access password.</p><form method="post" action="/__hub/login"><label for="password">Service password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><button>Open dashboard</button></form><p role="alert">${error}</p></main>`; }
async function startHub({dir=process.env.TECH_HUB_DATA_DIR||path.join(os.homedir(),'Library','Application Support','Tech Hub'), launch=true}={}) {
  const config=loadConfig(dir), sessions=new Map(), attempts=new Map(), states=new Map(), servers=[],children=[];
  let stopping=false;
  const startedAt=Date.now();
  const services=definitions.map(d=>({...d,...config.services[d.id]}));
  const logdir=path.join(dir,'logs'); fs.mkdirSync(logdir,{recursive:true,mode:0o700});
  const invalidate=id=>{for(const [key,s] of sessions) if(s.id===id)sessions.delete(key);};
  function status() {return {name:'Tech Hub',version:require('../package.json').version,adminPort:config.adminPort,startedAt,services:services.map(d=>({id:d.id,name:d.name,detail:d.detail,port:d.port,protected:!!config.services[d.id].password,localURL:`http://127.0.0.1:${d.port}`,urls:ips(config.host).map(ip=>`http://${ip}:${d.port}`),...states.get(d.id)}))};}
  for (const d of services) states.set(d.id,{state:'starting',error:null});
  const admin=http.createServer(async(req,res)=>{
    if (![`127.0.0.1:${config.adminPort}`,`localhost:${config.adminPort}`].includes(req.headers.host) || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(res,403,{error:'Admin is available only on this Mac.'});
    try {
      if(req.method==='GET'&&req.url==='/api/status')return send(res,200,status());
      if(req.method==='GET'&&['/','/app.js','/style.css'].includes(req.url)) {
        const file=req.url==='/'?'index.html':req.url.slice(1); return send(res,200,fs.readFileSync(path.join(__dirname,file)),file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
      }
      if(req.method==='POST'&&req.url==='/api/access') {
        if(!sameOrigin(req) || !/^application\/json/.test(req.headers['content-type']||'')) return send(res,403,{error:'Use the local admin page.'});
        const body=JSON.parse(await readBody(req));
        if(!definitions.some(d=>d.id===body.id)||typeof body.password!=='string'||body.password.length>256||(body.password.length>0&&body.password.length<8))return send(res,400,{error:'Use at least 8 characters, or leave blank to remove the password.'});
        const password=body.password?await hashPassword(body.password):null;
        const next=structuredClone(config);next.services[body.id].password=password;save(path.join(dir,'config.json'),next);config.services[body.id].password=password;invalidate(body.id);
        return send(res,200,{ok:true});
      }
      send(res,404,{error:'Not found'});
    } catch(error) {send(res,400,{error:error.message});}
  });
  try {await listen(admin,config.adminPort,'127.0.0.1');servers.push(admin);} catch(error) {throw Error(`Master page port ${config.adminPort}: ${error.message}`);}
  for(const d of services) {
    const gateway=http.createServer(async(req,res)=>{
      try {
        if (!req.url.startsWith('/')||req.url.startsWith('//')) return send(res,400,{error:'Invalid URL'});
        if(!sameOrigin(req))return send(res,403,{error:'Cross-origin requests are not allowed.'});
        const stored=config.services[d.id].password;
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
        if(!authed) return send(res,401,req.url.startsWith('/api/')?{error:'Service password required'}:loginPage(d.name),req.url.startsWith('/api/')?'application/json':'text/html');
        if(states.get(d.id).state!=='running')return send(res,503,{error:`${d.name} is unavailable. Check the Tech Hub master page.`,detail:states.get(d.id).error});
        if(req.url.startsWith('/api/update')&&d.id==='power')return send(res,200,{current_version:require('../package.json').version,available:false,error:'Power Monitor is bundled with Tech Hub. Update the complete app from the Tech Hub release page.'});
        const headers={...req.headers,host:`127.0.0.1:${d.backendPort}`}; delete headers.cookie;delete headers.authorization;
        if(headers.origin)headers.origin=`http://127.0.0.1:${d.backendPort}`;
        const upstream=http.request({hostname:'127.0.0.1',port:d.backendPort,path:req.url,method:req.method,headers},response=>{
          const outgoing={...response.headers};delete outgoing['set-cookie'];
          res.writeHead(response.statusCode,outgoing);response.pipe(res);
        });
        upstream.setTimeout(120000,()=>upstream.destroy(Error('Service timeout')));
        upstream.on('error',()=>{if(!res.headersSent)send(res,502,{error:'Service connection lost. Check Tech Hub.'});else res.destroy();});
        req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
      } catch(error){if(!res.headersSent)send(res,400,{error:error.message});else res.destroy();}
    });
    gateway.requestTimeout=15000;
    try {await listen(gateway,d.port,config.host);servers.push(gateway);} catch(error){states.set(d.id,{state:'error',error:`Port ${d.port} is occupied or unavailable. Quit the other app or edit config.json and restart Tech Hub.`});continue;}
    if(!launch){states.set(d.id,{state:'running',error:null});continue;}
    const reservation=http.createServer();
    try {await listen(reservation,d.backendPort,'127.0.0.1');await close(reservation);} catch(error){states.set(d.id,{state:'error',error:`Internal port ${d.backendPort} is occupied. Quit the other app or edit config.json and restart.`});continue;}
    const dataDir=path.join(dir,d.id);fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
    const resources=process.env.TECH_HUB_RESOURCES||path.join(root,'build','resources');
    let command,args;
    if(d.id==='dsan'){command=path.join(resources,'dsan','dsan-server');args=[];}
    if(d.id==='power'){command=path.join(resources,'power-server');args=['--host','127.0.0.1','--port',String(d.backendPort),'--config',path.join(dataDir,'settings.json'),'--no-browser'];}
    if(d.id==='lux'){command=process.execPath;args=[path.join(__dirname,'lux-server.cjs'),path.join(resources,'lux')];}
    const logPath=path.join(logdir,d.id+'.log');
    if(fs.existsSync(logPath)&&fs.statSync(logPath).size>5*1024*1024)fs.renameSync(logPath,logPath+'.previous');
    const log=fs.openSync(logPath,'a',0o600);
    const child=spawn(command,args,{env:{...process.env,TECH_HUB_MANAGED:'1',TECH_HUB_VERSION:require('../package.json').version,TECH_HUB_PUBLIC_PORT:String(d.port),TECH_HUB_PUBLIC_HOST:config.host,TECH_HUB_BACKEND_PORT:String(d.backendPort),TECH_HUB_BACKEND_HOST:'127.0.0.1',TECH_HUB_DATA_DIR:dataDir,LNA_APP_SUPPORT:dataDir,LNA_MA_READER:path.join(resources,'MA Web Remote Reader.app','Contents','MacOS','MA Web Remote Reader')},stdio:['ignore',log,log]});fs.closeSync(log);children.push(child);
    child.on('error',error=>states.set(d.id,{state:'error',error:error.message}));
    child.on('exit',(code,signal)=>{if(!stopping)states.set(d.id,{state:'error',error:`Service stopped (${signal||code}). See ${d.id}.log; quit and reopen Tech Hub to restart.`});});
    // Backend ports are preflighted; a child that fails its strict bind exits.
    const probe=async()=>{
      if(stopping||states.get(d.id).state==='error')return;
      try {const response=await fetch(`http://127.0.0.1:${d.backendPort}/`,{signal:AbortSignal.timeout(1500)});await response.body?.cancel(); if(response.ok&&child.exitCode===null){states.set(d.id,{state:'running',error:null});return;}}catch{}
      if(Date.now()-startedAt>30000){states.set(d.id,{state:'error',error:'Startup timed out. See service log, then quit and reopen Tech Hub.'});child.kill();return;}
      setTimeout(probe,300).unref();
    };setTimeout(probe,500).unref();
  }
  const cleanup=setInterval(()=>{for(const[k,s]of sessions)if(s.expires<Date.now())sessions.delete(k);for(const[k,a]of attempts)if(a.until<Date.now())attempts.delete(k);},60000);cleanup.unref();
  async function stop(){if(stopping)return;stopping=true;clearInterval(cleanup);for(const child of children)if(child.pid&&child.exitCode===null&&child.signalCode===null)child.kill('SIGINT');await Promise.all(servers.map(close));await Promise.all(children.map(child=>(!child.pid||child.exitCode!==null||child.signalCode!==null)?Promise.resolve():new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});})));}
  return {status,stop,config};
}
if(require.main===module)startHub().then(hub=>{console.log(`TECH_HUB_READY http://127.0.0.1:${hub.config.adminPort}`);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>hub.stop().then(()=>process.exit(0)));if(process.env.TECH_HUB_PARENT_PID){const parent=Number(process.env.TECH_HUB_PARENT_PID);setInterval(()=>{try{process.kill(parent,0);}catch{hub.stop().then(()=>process.exit(0));}},2000).unref();}}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={startHub,loadConfig,hashPassword,verifyPassword,definitions};
