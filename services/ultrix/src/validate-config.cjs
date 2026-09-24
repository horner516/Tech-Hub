'use strict';
function validateUltrix(c){
 const obj=(v,n)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error(n+' must be an object');};
 const text=(v,n)=>{if(typeof v!=='string'||!v.trim()||v.length>256)throw Error(n+' needs a name of 1–256 characters');};
 const int=(v,min,max,n)=>{if(!Number.isInteger(v)||v<min||v>max)throw Error(`${n} must be between ${min} and ${max}`);};
 const bool=(v,n)=>{if(v!==undefined&&typeof v!=='boolean')throw Error(n+' must be true or false');};
 function range(v,n){if(typeof v!=='string')throw Error(n+' must be a range such as 1-16,20');for(const part of v.split(',').map(s=>s.trim()).filter(Boolean)){const m=/^(\d+)(?:\s*-\s*(\d+|\*))?$/.exec(part);if(!m||+m[1]<1||+m[1]>65535||(m[2]&&m[2]!=='*'&&(+m[2]<+m[1]||+m[2]>65535)))throw Error(n+' contains an invalid range');}}
 function section(s,n){if(s===undefined)return;obj(s,n);if(s.count!==undefined)int(s.count,0,65535,n+' count');bool(s.hideUnnamed,n+' hide unnamed');for(const k of ['include','hidden','protected'])if(s[k]!==undefined)range(s[k],n+' '+k);if(s.labels!==undefined){obj(s.labels,n+' labels');for(const [key,value]of Object.entries(s.labels)){int(Number(key),1,65535,n+' label number');text(value,n+' label');}}if(s.categories!==undefined){if(!Array.isArray(s.categories)||s.categories.length>128)throw Error(n+' categories must be a list of up to 128');for(const cat of s.categories){obj(cat,n+' category');text(cat.name,n+' category name');if(!cat.match&&!cat.range)throw Error(n+' category needs a match or range');if(cat.range!==undefined)range(cat.range,n+' category');if(cat.match!==undefined){if(typeof cat.match!=='string'||cat.match.length>256)throw Error('Invalid category match');try{new RegExp(cat.match,'i');}catch{throw Error('Invalid category regular expression');}}}}}
 function groups(g,n){if(g===undefined)return;if(!Array.isArray(g)||g.length>128)throw Error(n+' must be a list');for(const row of g){obj(row,n);text(row.name,n+' name');if(Array.isArray(row.levels)){if(!row.levels.length)throw Error(n+' needs levels');row.levels.forEach(l=>int(l,1,c.levels.length,n+' level'));}else range(row.levels,n+' levels');}}
 obj(c,'Configuration');obj(c.router,'Router');if(typeof c.router.host!=='string'||/[\s/]/.test(c.router.host)||c.router.host.length>253)throw Error('Invalid router host');int(c.router.port,1,65535,'Router port');if(c.router.matrix!==undefined)int(c.router.matrix,0,255,'Matrix');bool(c.router.allowRouting,'Routing');if(c.router.extended!==undefined&&![true,false,'auto'].includes(c.router.extended))throw Error('Extended mode must be auto, true or false');if(c.router.nameChars!==undefined&&!['auto',4,8,12,16,32].includes(c.router.nameChars))throw Error('Invalid router name length');for(const k of ['pollSeconds','ackTimeoutMs','ackAttempts','loadTimeoutMs','namesNoticeDelayMs'])if(c.router[k]!==undefined&&(!Number.isFinite(c.router[k])||c.router[k]<=0||c.router[k]>2147483647))throw Error('Invalid router '+k);
 if(!Array.isArray(c.levels)||c.levels.length<1||c.levels.length>128)throw Error('Define 1–128 levels');for(const l of c.levels){obj(l,'Level');text(l.name,'Level');if(l.short!==undefined)text(l.short,'Level abbreviation');}bool(c.readOnly,'Read only');if(c.title!==undefined)text(c.title,'Panel title');section(c.sources,'Sources');section(c.destinations,'Destinations');groups(c.levelGroups,'Level groups');
 obj(c.profiles,'Profiles');if(!Object.keys(c.profiles).length||Object.keys(c.profiles).length>128||!Object.hasOwn(c.profiles,c.defaultProfile))throw Error('Choose an existing default profile');for(const [name,p]of Object.entries(c.profiles)){text(name,'Profile ID');if(['__proto__','constructor','prototype'].includes(name))throw Error('Invalid profile ID');obj(p,'Profile '+name);for(const k of ['title','label'])if(p[k]!==undefined)text(p[k],'Profile '+k);if(p.pin!==undefined&&(typeof p.pin!=='string'||p.pin.length>256))throw Error('Profile PIN must be text');bool(p.readOnly,'Profile read only');if(p.levels!==undefined){if(!Array.isArray(p.levels)||!p.levels.length)throw Error('Profile levels must be a nonempty list');p.levels.forEach(l=>int(l,1,c.levels.length,'Profile level'));}section(p.sources,'Profile sources');section(p.destinations,'Profile destinations');groups(p.levelGroups,'Profile level groups');}
 return c;
}

// ---- Router Panel: several saved routers, one active ------------------------------------------------------
// Stored shape: {title, activeRouter, routers:[{id, name, router:{type, host, port, ...}, levels, sources,
// destinations, profiles, ...}], server?, mock?}. Each saved router keeps its own panel setup because levels,
// port numbers and profiles only make sense for that router. resolve() turns the active entry back into the
// single-router shape validateUltrix() and the panel runtime already understand.
const ROUTER_TYPES={swp08:{label:'Ross Ultrix / SW-P-08',port:2000},videohub:{label:'Blackmagic Videohub',port:9990}};
const DEFAULT_TITLE='Router Panel',LEGACY_TITLE='Ultrix Panel',ROUTER_ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Upgrades a pre-multi-router config (top-level `router`); already-migrated configs only gain a default type. */
function migrate(config){
 if(!isObject(config))return config;
 if(Array.isArray(config.routers))return {...config,routers:config.routers.map(r=>isObject(r)&&isObject(r.router)&&r.router.type===undefined?{...r,router:{type:'swp08',...r.router}}:r)};
 const {title,server,mock,activeRouter,...panel}=config;
 return {title:title===undefined||title===LEGACY_TITLE?DEFAULT_TITLE:title,...(server!==undefined&&{server}),...(mock!==undefined&&{mock}),activeRouter:'router-1',routers:[{id:'router-1',name:'Ultrix',...panel,router:isObject(panel.router)?{type:'swp08',...panel.router}:panel.router}]};
}
function resolveRouter(config,entry){
 const {id,name,...panel}=entry;
 return {title:config.title,...(config.server!==undefined&&{server:config.server}),...(config.mock!==undefined&&{mock:config.mock}),...panel,routerId:id,routerName:name};
}
/** The active router as a single-router config. */
function resolve(config){
 const c=migrate(config),entry=isObject(c)&&Array.isArray(c.routers)&&c.routers.find(r=>isObject(r)&&r.id===c.activeRouter);
 if(!entry)throw Error('Choose which saved router is active');
 return resolveRouter(c,entry);
}
/** Validates every saved router (not only the active one), so switching routers can never load a broken setup. */
function validateRouterPanel(input){
 const c=migrate(input);
 if(!isObject(c))throw Error('Configuration must be an object');
 if(c.title!==undefined&&(typeof c.title!=='string'||!c.title.trim()||c.title.length>256))throw Error('Panel title needs a name of 1–256 characters');
 if(!Array.isArray(c.routers)||c.routers.length<1||c.routers.length>32)throw Error('Save between 1 and 32 routers');
 const ids=new Set();
 for(const r of c.routers){
  if(!isObject(r))throw Error('Each router must be an object');
  if(typeof r.name!=='string'||!r.name.trim()||r.name.length>256)throw Error('Each router needs a name of 1–256 characters');
  if(typeof r.id!=='string'||!ROUTER_ID.test(r.id))throw Error(`Router "${r.name}" needs an ID of lowercase letters, numbers and dashes`);
  if(ids.has(r.id))throw Error(`Router ID "${r.id}" is used by two routers`);ids.add(r.id);
  if(!isObject(r.router)||!Object.hasOwn(ROUTER_TYPES,r.router.type))throw Error(`Router "${r.name}" needs a type: ${Object.values(ROUTER_TYPES).map(t=>t.label).join(' or ')}`);
  if(r.router.type==='videohub'&&Array.isArray(r.levels)&&r.levels.length!==1)throw Error(`Router "${r.name}": a Videohub has exactly one level`);
  try{validateUltrix(resolveRouter(c,r));}catch(error){throw Error(`Router "${r.name}": ${error.message}`);}
 }
 if(typeof c.activeRouter!=='string'||!ids.has(c.activeRouter))throw Error('Choose which saved router is active');
 return c;
}
module.exports={validateUltrix,validateRouterPanel,migrate,resolve,ROUTER_TYPES,DEFAULT_TITLE};
