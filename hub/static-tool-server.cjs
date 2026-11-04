'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.jpg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8'};
function createStaticServer(root){
 const base=fs.realpathSync(root);
 return http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(req.method==='HEAD'?undefined:JSON.stringify(value));};
  if(!['GET','HEAD'].includes(req.method))return json(405,{error:'This tool runs in your browser; uploads are not accepted.'});
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return json(400,{error:'Invalid URL'});}
  if(pathname==='/api/health')return json(200,{ok:true,kind:'browser-tool'});
  // Tech Hub supplies offline files and password gates. A PWA worker must not cache those gates.
  if(pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(req.method==='HEAD'?undefined:"self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.registration.unregister()));");}
  if(pathname.startsWith('/api/'))return json(404,{error:'Not found'});
  if(pathname.includes('\\')||pathname.includes('\0'))return json(403,{error:'Invalid path'});
  let file=path.resolve(base,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(base+path.sep))return json(403,{error:'Invalid path'});
  try{
   try{file=await fs.promises.realpath(file);}catch(error){
    if(error.code==='ENOENT'&&String(req.headers.accept).includes('text/html')&&!path.extname(pathname))file=path.join(base,'index.html');else throw error;
   }
   if(!file.startsWith(base+path.sep))return json(403,{error:'Invalid path'});
   const stat=await fs.promises.stat(file);if(!stat.isFile())return json(404,{error:'Not found'});
   res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':stat.size});
   if(req.method==='HEAD')return res.end();
   const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch{return json(404,{error:'Not found'});}
 });
}
if(require.main===module){
 const runtime=require(process.env.TECH_HUB_RUNTIME_API);
 const server=createStaticServer(path.join(__dirname,'public'));runtime.listen(server);
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.closeAllConnections();server.close();});
}
module.exports={createStaticServer};
