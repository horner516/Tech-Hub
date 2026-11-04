'use strict';
// Each module keeps its own setup UI; these shortcuts make it reachable in one place.
const definitions={
 dsan:[{id:'settings',label:'Settings',selector:'#open-settings, #mobile-settings'}],
 power:[{id:'devices',label:'Devices',selector:'#manage-button'},{id:'settings',label:'Settings',selector:'#settings-button'}],
 netgear:[{id:'settings',label:'Devices & settings',path:'/setup'}],
 ultrix:[{id:'settings',label:'Devices & settings',path:'/setup'}],
 rtoo:[{id:'settings',label:'Devices & settings',selector:'#openSettings'}],
 lux:[{id:'devices',label:'Add device',reveal:'#techhub-devices-tab',selector:'#techhub-add-device'},{id:'scan',label:'Scan',reveal:'#techhub-devices-tab',selector:'#techhub-scan'}],
};
module.exports={actionsFor:id=>definitions[id]||[]};
