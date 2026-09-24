import { EventEmitter } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import { Swp08Client } from './swp08/client.js';
import { VideohubClient } from './videohub/client.js';
/** One client class per router type; both expose the same surface. */
export const clientFor=options=>options.type==='videohub'?new VideohubClient(options):new Swp08Client(options);
// Stable event surface for the HTTP panel while only the hardware connection is replaced.
export class ManagedRouter extends EventEmitter {
  constructor(factory=clientFor){super();this.factory=factory;this.client=null;this.connection=null;this.forwarders=[];}
  configure(config){
    const options={...config.router,levels:config.levels.length,destinations:config.destinations?.count??0};
    const {allowRouting,...connection}=options;
    if(this.client&&isDeepStrictEqual(connection,this.connection)){this.client.opts.allowRouting=allowRouting!==false;return false;}
    const next=this.factory(options);
    if(this.client){for(const [event,fn]of this.forwarders)this.client.off(event,fn);this.client.stop();}
    this.client=next;this.connection=connection;this.forwarders=['route','status','names','log'].map(event=>{const fn=(...args)=>this.emit(event,...args);next.on(event,fn);return[event,fn];});
    this.emit('status','disconnected');if(config.router.host)next.start();return true;
  }
  get status(){return this.client?.status??'disconnected';}get ready(){return this.client?.ready??false;}
  get allowRouting(){return this.client?.allowRouting??false;}get sourceNames(){return this.client?.sourceNames??new Map();}get destNames(){return this.client?.destNames??new Map();}get routes(){return this.client?.routes??new Map();}get namesLoadedAt(){return this.client?.namesLoadedAt??null;}
  get lastRx(){return this.client?.lastRx??0;}
  route(value){return this.client.route(value);}refreshNames(){return this.client.refreshNames();}stop(){this.client?.stop();}
}
