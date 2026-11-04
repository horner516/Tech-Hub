'use strict';
const fs=require('node:fs'),path=require('node:path');
function frontendLicenses(source){
 const visited=new Set(),sections=[];
 function visit(name,from,optional=false){
  let manifest;
  try{manifest=require.resolve(name+'/package.json',{paths:[from]});}
  catch{
   try{let dir=path.dirname(require.resolve(name,{paths:[from]}));while(true){const file=path.join(dir,'package.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).name===name){manifest=file;break;}const parent=path.dirname(dir);if(parent===dir)throw Error('Missing manifest: '+name);dir=parent;}}
   catch(error){if(optional)return;throw error;}
  }
  const dir=path.dirname(manifest),data=JSON.parse(fs.readFileSync(manifest));
  const key=data.name+'@'+data.version;if(visited.has(key))return;visited.add(key);
  const notices=fs.readdirSync(dir).filter(name=>/^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name)&&fs.statSync(path.join(dir,name)).isFile());
  sections.push(key+'\nDeclared license: '+(data.license||'See package notices')+'\n'+notices.map(name=>name+'\n'+fs.readFileSync(path.join(dir,name),'utf8')).join('\n'));
  for(const child of Object.keys(data.dependencies||{}))visit(child,dir,!!data.optionalDependencies?.[child]);
  for(const child of Object.keys(data.optionalDependencies||{}))visit(child,dir,true);
 }
 const data=JSON.parse(fs.readFileSync(path.join(source,'package.json')));
 for(const name of Object.keys(data.dependencies||{}))visit(name,source);
 return 'Runtime dependency notices (includes installed optional dependencies)\n\n'+sections.sort().join('\n\n----------------------------------------\n\n')+'\n';
}
module.exports={frontendLicenses};
