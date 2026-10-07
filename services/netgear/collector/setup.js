const form=document.querySelector('#settings');
const message=document.querySelector('#message');
const source=document.querySelector('#sourceAddress');
const bind=document.querySelector('#bindAddress');
const rescan=document.querySelector('#rescan');
const securityLevel=document.querySelector('#securityLevel');
const authField=document.querySelector('#authField');
const privField=document.querySelector('#privField');
const levelBadge=document.querySelector('#levelBadge');
const levelBadges={authPriv:'SHA-512 + AES',authNoPriv:'SHA-512, no encryption',noAuthNoPriv:'No authentication'};
let current={};

function updateSecurityFields(){
  const level=securityLevel.value;
  const needsAuth=level!=='noAuthNoPriv';
  const needsPriv=level==='authPriv';
  authField.hidden=!needsAuth;
  form.elements.authKey.disabled=!needsAuth;
  privField.hidden=!needsPriv;
  form.elements.privKey.disabled=!needsPriv;
  levelBadge.textContent=levelBadges[level]||levelBadges.authPriv;
}

function option(item){
  const element=document.createElement('option');
  element.value=item.address;
  element.textContent=`${item.name}  ·  ${item.address}  (${item.cidr})`;
  return element;
}

async function loadInterfaces(){
  rescan.disabled=true;
  rescan.textContent='Discovering interfaces…';
  try{
    const response=await fetch('/api/interfaces');
    const data=await response.json();
    source.replaceChildren(new Option('Detect automatically',''));
    bind.replaceChildren(new Option('All available interfaces','0.0.0.0'));
    for(const item of data.interfaces){source.append(option(item));bind.append(option(item))}
    source.value=current.sourceAddress||'';
    bind.value=current.bindAddress||'0.0.0.0';if(current.managed){bind.disabled=true;bind.title='Tech Hub manages the web interface port and binding.';}
    if(!source.value&&current.sourceAddress){const custom=new Option(`Saved interface · ${current.sourceAddress}`,current.sourceAddress);source.append(custom);source.value=current.sourceAddress}
    if(!bind.value&&current.bindAddress){const custom=new Option(`Saved interface · ${current.bindAddress}`,current.bindAddress);bind.append(custom);bind.value=current.bindAddress}
    rescan.textContent=`↻ ${data.interfaces.length} interface${data.interfaces.length===1?'':'s'} found`;
  }catch{rescan.textContent='Could not discover interfaces'}finally{rescan.disabled=false}
}

async function load(){
  const response=await fetch('/api/config');
  current=await response.json();
  for(const key of ['subnet','username','pollSeconds','statusSeconds','discoverySeconds','webUsername'])form.elements[key].value=current[key]??'';
  showEditing();
  securityLevel.value=current.securityLevel||'authPriv';
  updateSecurityFields();
  if(current.hasAuthKey){form.elements.authKey.placeholder='Saved — leave blank to keep';document.querySelector('#authHint').textContent='A key is securely retained locally.'}
  if(current.hasPrivKey){form.elements.privKey.placeholder='Saved — leave blank to keep';document.querySelector('#privHint').textContent='An AES key is securely retained locally.'}
  await loadInterfaces();
}

function showEditing(){
  form.elements.editingEnabled.checked=!!current.editingEnabled;
  form.elements.endpointMdns.checked=current.endpointMdns!==false;
  form.elements.arpRouters.value=current.arpRouters||'';
  form.elements.arpSnmp.value=current.arpSnmp||'v3';
  updateArpFields();
  if(current.hasArpCommunity){form.elements.arpCommunity.placeholder='Saved — leave blank to keep';document.querySelector('#arpCommunityHint').textContent='A community is retained locally.'}
  document.querySelector('#arpStatus').textContent=Object.entries(current.arpStatus||{}).map(([ip,s])=>`${ip}: ${s.error?`not read (${s.error})`:`${s.entries} entries`}`).join(' · ');
  const badge=document.querySelector('#editBadge');
  const ready=current.editingEnabled&&current.hasEditPin&&current.hasWebPassword&&current.profileAssignmentReady;
  badge.textContent=ready?'ON':current.editingEnabled?'NOT READY':'OFF';
  badge.className=ready?'on':'off';
  const note=document.querySelector('#assignmentNote');
  note.hidden=!!current.profileAssignmentReady;
  note.textContent=current.profileAssignmentReason||'';
  if(current.hasWebPassword){form.elements.webPassword.placeholder='Saved — leave blank to keep';document.querySelector('#webPasswordHint').textContent='A password is retained locally.'}
  document.querySelector('#clearPinField').hidden=!current.hasEditPin;
  form.elements.editPin.placeholder=current.hasEditPin?'Saved — leave blank to keep':'Set an edit PIN';
  document.querySelector('#pinHint').textContent=`${current.hasEditPin?'A PIN is set. Enter a new one to replace it; this signs out every unlocked dashboard.':'Dashboards ask for this before changing a VLAN.'} ${current.pinRule||''}`;
}

function updateArpFields(){const v2c=form.elements.arpSnmp.value==='v2c';document.querySelector('#arpCommunityField').hidden=!v2c;form.elements.arpCommunity.disabled=!v2c}

async function waitForDashboard(){
  for(let i=0;i<30;i++){
    try{await fetch('/',{mode:'no-cors',cache:'no-store'});return true}
    catch{await new Promise(resolve=>setTimeout(resolve,1000))}
  }
  return false;
}

rescan.addEventListener('click',loadInterfaces);
securityLevel.addEventListener('change',updateSecurityFields);
form.elements.arpSnmp.addEventListener('change',updateArpFields);
form.addEventListener('submit',async event=>{
  event.preventDefault();
  message.className='busy';
  message.textContent='Saving settings and starting discovery…';
  const data=Object.fromEntries(new FormData(form));
  try{
    const response=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error);
    message.className='success';
    message.textContent=result.restartRequired?'Settings saved. Restart Netgear Discovery to apply the client interface change.':'Settings saved. Waiting for the dashboard…';
    for(const key of ['authKey','privKey','webPassword','editPin','arpCommunity'])form.elements[key].value='';
    form.elements.clearEditPin.checked=false;
    if(result.restartRequired)return;
    if(await waitForDashboard())location.href='/';
    else{message.className='error';message.textContent='Settings were saved, but the dashboard did not start. Restart Netgear Discovery and check logs/dashboard.log if needed.'}
  }catch(error){message.className='error';message.textContent=error.message}
});

load().catch(()=>{message.className='error';message.textContent='Could not load server settings. Start Netgear Discovery and try again.'});
