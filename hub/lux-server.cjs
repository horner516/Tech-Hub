const path=require('node:path');
const root=path.resolve(process.argv[2]);
const {startLanServer}=require(path.join(root,'electron','lan-server.cjs'));
startLanServer({root:path.join(root,'dashboard'),host:'127.0.0.1',preferredPort:Number(process.env.TECH_HUB_BACKEND_PORT),strictPort:true,deviceStorePath:path.join(process.env.TECH_HUB_DATA_DIR,'devices.json')}).then(lan=>{
  console.log('LUX_LINK_READY '+lan.port);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{lan.server.closeAllConnections();lan.server.close(()=>process.exit(0));});
}).catch(error=>{console.error(error);process.exitCode=1;});
