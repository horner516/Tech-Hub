'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const dir=process.env.TECH_HUB_DATA_DIR||path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'tech-hub');
try {
 const {adminPort}=JSON.parse(fs.readFileSync(path.join(dir,'runtime.json')));
 if(!Number.isInteger(adminPort)||adminPort<1||adminPort>65535)throw Error('Invalid administrator port');
 const child=spawn('xdg-open',[`http://127.0.0.1:${adminPort}/`],{stdio:'ignore'});
 child.on('error',()=>{console.error(`Open http://127.0.0.1:${adminPort}/ in your browser.`);process.exitCode=1;});
} catch(error){console.error('Start Tech Hub first: systemctl --user start tech-hub');process.exitCode=1;}
