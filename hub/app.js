const $=s=>document.querySelector(s);
let selected=null,signature='';
function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',2500);}
function render(data){
 $('#running').textContent=data.services.filter(s=>s.state==='running').length+' / 3';$('#version').textContent='v'+data.version;$('#footerVersion').textContent='v'+data.version;$('#adminPort').textContent=data.adminPort;
 $('#connection').className='dot good';$('#status').textContent='Connected to this Mac · Status updates every 3 seconds';
 const next=JSON.stringify(data.services);if(next===signature)return;signature=next;$('#services').replaceChildren();
 for(const s of data.services){
  const card=node('article',undefined,'card '+s.id),top=node('div',undefined,'cardTop');top.append(node('span',({dsan:'DS',lux:'LX',power:'PW'})[s.id],'symbol'),node('span',s.state,'badge '+s.state));card.append(top,node('h2',s.name),node('p',s.detail,'detail'));
  const port=node('div',undefined,'port');port.append(node('span','WEB INTERFACE PORT'),node('strong',s.port));card.append(port,node('p','NETWORK ACCESS','urlLabel'));
  const urls=node('div',undefined,'urls');for(const url of s.urls){const row=node('div',undefined,'url'),copy=node('button','Copy','copy');copy.setAttribute('aria-label','Copy '+s.name+' URL '+url);copy.onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('Network URL copied');}catch{toast('Copy unavailable. Select and copy the URL.');}};row.append(node('code',url),copy);urls.append(row);}if(!s.urls.length)urls.append(node('p','No LAN address available','muted'));card.append(urls);
  const access=node('div',undefined,'accessLine'),edit=node('button','Change','textButton');edit.setAttribute('aria-label','Change access for '+s.name);edit.onclick=()=>{selected=s.id;$('#accessTitle').textContent=s.name;$('#password').value='';$('#accessError').textContent='';$('#access').showModal();};access.append(node('span',s.protected?'Password required':s.urls.length?'Open on the show network':'Local access · no password'),edit);card.append(access);
  if(s.error)card.append(node('p',s.error,'error'));
  const open=node('a','Open dashboard ↗','open');open.href=s.localURL;open.target='_blank';open.rel='noreferrer';open.setAttribute('aria-disabled',s.state!=='running');card.append(open);$('#services').append(card);
 }
}
async function refresh(){try{const r=await fetch('/api/status');if(!r.ok)throw Error();render(await r.json());}catch{$('#connection').className='dot';$('#status').textContent='Tech Hub is disconnected. Reopen the Mac app.';$('#running').textContent='— / 3';document.querySelectorAll('.open').forEach(a=>a.setAttribute('aria-disabled','true'));signature='';}}
$('#cancel').onclick=()=>$('#access').close();
$('#accessForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const r=await fetch('/api/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selected,password:$('#password').value})});const result=await r.json();if(!r.ok)throw Error(result.error);$('#access').close();toast('Service access updated');await refresh();}catch(error){$('#accessError').textContent=error.message;}finally{button.disabled=false;}};
refresh();setInterval(refresh,3000);
