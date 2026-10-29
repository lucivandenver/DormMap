(() => {
  const portals={'/admin':'super_admin','/barangay-dashboard':'barangay','/owner-dashboard':'boarding_house_owner','/tenant-dashboard':'tenant'};
  const role=portals[location.pathname.replace(/\/$/,'')];if(!role)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let unread=0,timer,loading=false,queued=false;
  let bell=document.querySelector('#notifBtn,#quickNotifBtn');
  if(!bell){bell=document.createElement('button');bell.type='button';bell.className='portal-bell';bell.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10 21h4"/></svg>';const theme=document.getElementById('themeToggle');if(theme)theme.before(bell);else document.querySelector('header')?.append(bell);}
  if(!bell)return;
  bell.removeAttribute('onclick');bell.onclick=null;bell.setAttribute('aria-label','Notifications');bell.setAttribute('aria-expanded','false');
  const count=document.createElement('span');count.className='portal-unread';count.hidden=true;bell.append(count);
  const panel=document.createElement('section');panel.className='portal-notification-panel';panel.hidden=true;panel.setAttribute('aria-label','Recent notifications');
  panel.innerHTML='<div class="portal-notification-heading"><strong>Notifications</strong><button type="button" data-read-all>Mark all read</button><button type="button" data-close aria-label="Close notifications">×</button></div><p class="portal-live-state" aria-live="polite">Connecting to live updates…</p><div data-notification-items></div>';
  document.body.append(panel);
  const state=panel.querySelector('.portal-live-state');
  const toggle=()=>{panel.hidden=!panel.hidden;bell.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){refresh();panel.querySelector('[data-read-all]').focus();}};
  bell.addEventListener('click',toggle);
  panel.querySelector('[data-close]').onclick=()=>{panel.hidden=true;bell.setAttribute('aria-expanded','false');bell.focus();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden)panel.querySelector('[data-close]').click();});
  document.addEventListener('click',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!bell.contains(event.target)){panel.hidden=true;bell.setAttribute('aria-expanded','false');}});
  async function read(id,source){const res=await fetch('/api/portal/notifications/read',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(id?{id,source}:{})});if(!res.ok)throw Error('Unable to mark notification as read.');}
  panel.querySelector('[data-read-all]').onclick=async()=>{try{await read();await refresh();}catch(error){state.textContent=error.message;}};
  function renderItems(container,items){
    container.innerHTML=items.length?items.map(n=>`<button type="button" class="portal-notification-item ${n.isRead?'':'is-unread'}" data-notice="${esc(n.source)}:${Number(n.id)}"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span><small>${esc(new Date(n.createdAt).toLocaleString())}${n.isRead?'':' · Unread'}</small></button>`).join(''):'<p class="portal-empty">You are all caught up.</p>';
    container.querySelectorAll('[data-notice]').forEach(button=>button.onclick=async()=>{const item=items.find(n=>`${n.source}:${n.id}`===button.dataset.notice);try{await read(item.id,item.source);panel.hidden=true;location.hash=new URL(item.url,location.origin).hash;await refresh();}catch(error){state.textContent=error.message;}});
  }
  async function refresh(){if(loading){queued=true;return;}loading=true;try{
    const res=await fetch('/api/portal/notifications',{cache:'no-store'});if(!res.ok){if([401,403].includes(res.status))state.textContent='Sign in again to receive updates.';return;}const data=await res.json();unread=data.unread;
    count.textContent=unread>99?'99+':String(unread);count.hidden=!unread;bell.classList.toggle('has-updates',unread>0);bell.setAttribute('aria-label',`Notifications: ${unread} unread`);
    document.querySelectorAll('#notifBadge,#quickNotifBadge').forEach(el=>{el.textContent=unread;el.classList.toggle('hidden',!unread);});
    renderItems(panel.querySelector('[data-notification-items]'),data.items);
    const containers=document.querySelectorAll('#notificationsList,#notificationsContainer,#notificationList');containers.forEach(el=>renderItems(el,data.items));
    const categories={messages:0,applications:0,owners:0,barangays:0,dashboard:0,houses:0};data.items.filter(n=>!n.isRead).forEach(n=>{const hash=new URL(n.url,location.origin).hash.slice(1);if(hash in categories)categories[hash]++;});
    Object.entries(data.pending||{}).forEach(([key,value])=>{categories[key]=Math.max(categories[key]||0,value);});
    document.querySelectorAll('nav button,#nav button,.nav-item').forEach(button=>{const key=button.dataset.view||button.dataset.panel||button.id.replace('btn-','');const qty=categories[key==='messaging'?'messages':key]||0;let badge=button.querySelector('.portal-nav-count');if(qty&&!badge){badge=document.createElement('span');badge.className='portal-nav-count';button.append(badge);}if(badge){badge.textContent=qty;badge.hidden=!qty;}button.classList.toggle('portal-attention',qty>0);});
  }catch{state.textContent='Connection interrupted. Retrying automatically.';}finally{loading=false;if(queued){queued=false;schedule();}}}
  function schedule(){clearTimeout(timer);timer=setTimeout(refresh,250);}
  async function refreshVisible(){
    if([...document.querySelectorAll('[id$="Modal"],[role="dialog"]')].some(el=>el.getClientRects().length)||document.querySelector('dialog[open],.swal2-container')||document.activeElement?.matches('input,textarea,select'))return;
    const section=[...document.querySelectorAll('section[data-panel],section[data-view],.tab-content')].find(el=>!el.classList.contains('hidden'));
    const tab=section?.dataset.panel||section?.dataset.view||section?.id.replace('tab-','');
    const functions={super_admin:{overview:'loadOverview',owners:'loadOwners',barangays:'loadBarangayAccounts',submissions:'loadSubmissions',renewals:'loadPermitRenewals',audit:'loadAudit'},barangay:{overview:'loadOverview',applications:'loadApplications',data_requests:'loadBarangayDataRequests',renewals:'loadBarangayPermitRenewals',owners:'loadOwners',houses:'loadHouses',messages:'loadMessages',submissions:'loadSubmissions'},boarding_house_owner:{overview:'loadOverview',profile:'loadBoardingHouses',maintenance:'loadOwnerMaintenance',applications:'loadPendingApplications',messages:'loadMessages',rooms:'loadRooms',tenants:'loadTenants',payments:'loadPayments',inquiries:'loadInquiries'},tenant:{dashboard:'loadOverview',messaging:'loadConversations',payments:'loadPaymentHistory',maintenance:'loadMaintenance',documents:'loadDocuments','browse-dorms':'loadBrowseBoardingHouses'}};
    const fn=window[functions[role]?.[tab]];if(typeof fn==='function'){try{await fn();}catch(error){console.warn('Live view refresh:',error.message);}}
    if(role==='boarding_house_owner'&&tab==='messages'){const peer=document.querySelector('#msgRecipientId')?.value;if(peer&&typeof window.openChat==='function')await window.openChat(Number(peer));}
  }
  let visibleTimer;function changed(){schedule();clearTimeout(visibleTimer);visibleTimer=setTimeout(refreshVisible,500);}
  const stream=new EventSource('/api/portal/events');stream.addEventListener('portal-update',()=>{state.textContent='Live updates connected';changed();});stream.onerror=()=>{state.textContent='Reconnecting… Saved notifications remain available.';};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)changed();});window.addEventListener('hashchange',schedule);
  setInterval(()=>{if(!document.hidden)changed();},30000); // resync after missed events or restarts
  // Refresh after successful writes, including local actions. No document reload.
  const original=window.fetch;window.fetch=async function(input,options){const response=await original.apply(this,arguments);const method=String(options?.method||'GET').toUpperCase();if(response.ok&&!['GET','HEAD'].includes(method)&&!String(input).includes('/api/portal/'))changed();return response;};
  window.DormMapPortal={refresh};
  refresh();
})();
