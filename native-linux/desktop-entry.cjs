'use strict';
const path=require('node:path');
function quote(value){return '"'+value.replace(/[%]/g,'%%').replace(/[\\"`$]/g,c=>'\\'+c).replace(/\\/g,'\\\\')+'"';}
const root=process.argv[2];
if(!root||/[\r\n]/.test(root))throw Error('Invalid installation directory');
console.log('[Desktop Entry]\nType=Application\nName=Tech Hub\nComment=Open the Tech Hub control page\nExec='+quote(path.join(root,'resources/node'))+' '+quote(path.join(root,'open.cjs'))+'\nIcon=applications-system\nTerminal=false\nCategories=Network;Utility;');
