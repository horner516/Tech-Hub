'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {defaultDataDir}=require('../hub/server.cjs');
test('Linux uses persistent XDG data and ignores relative XDG locations',()=>{
 assert.equal(defaultDataDir('linux',{},'/home/operator'),'/home/operator/.local/share/tech-hub');
 assert.equal(defaultDataDir('linux',{XDG_DATA_HOME:'/srv/operator-data'},'/home/operator'),'/srv/operator-data/tech-hub');
 assert.equal(defaultDataDir('linux',{XDG_DATA_HOME:'relative'},'/home/operator'),'/home/operator/.local/share/tech-hub');
});
test('Lux ping uses Linux seconds and Mac milliseconds without a shell',async()=>{
 const {createReachabilityProbe}=require('../services/lux/electron/reachability.cjs');
 for(const [platform,value] of [['linux','1'],['darwin','1000']]){
  let seen;const ping=createReachabilityProbe({platform,run:(cmd,args,options,cb)=>{seen={cmd,args,options};cb(null);}});
  assert.equal(await ping('10.1.1.1'),true);assert.equal(seen.cmd,'ping');assert.equal(seen.args[seen.args.indexOf('-W')+1],value);assert.equal(seen.options.shell,undefined);
 }
});
