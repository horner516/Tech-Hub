'use strict';
const fs=require('node:fs'),path=require('node:path');
const files={'/__hub/chrome.css':['service-chrome.css','text/css'],'/__hub/chrome.js':['service-chrome.js','text/javascript'],'/__hub/theme.css':['service-theme.css','text/css']};
function asset(req,res){const entry=files[req.url];if(req.method!=='GET'||!entry)return false;res.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(path.join(__dirname,entry[0])));return true;}
const script='<script src="/__hub/chrome.js" defer></script>';
function inject(req,res,response,headers,id){
 if(req.method!=='GET'||!String(headers['content-type']).includes('text/html')||headers['content-encoding'])return false;
 const chunks=[];let size=0,pass=false;
 response.on('data',chunk=>{size+=chunk.length;if(pass){res.write(chunk);return;}chunks.push(chunk);if(size>8*1024*1024){pass=true;res.writeHead(response.statusCode,headers);for(const c of chunks)res.write(c);chunks.length=0;}});
 response.on('error',()=>res.destroy());
 response.on('end',()=>{if(pass){res.end();return;}let html=Buffer.concat(chunks).toString('utf8');const addition=script+(['record','ultrix'].includes(id)?'<link rel="stylesheet" href="/__hub/theme.css">':'');html=html.replace(/<\/head\s*>/i,addition+'</head>');delete headers['content-length'];delete headers.etag;delete headers['last-modified'];headers['cache-control']='no-store';res.writeHead(response.statusCode,headers);res.end(html);});return true;
}
function disabled(name,message='Choose another app above. Enable this service from Tech Hub’s master page.',state='off'){return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${script}<title>${name} is ${state}</title><link rel="stylesheet" href="/__hub/theme.css"></head><body data-techhub-recovery="true"><main><h1>${name} is ${state}</h1><p>${message}</p></main></body></html>`;}
module.exports={asset,inject,disabled};
