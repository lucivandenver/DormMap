(() => {
  const portals={'/admin':'super_admin','/barangay-dashboard':'barangay','/owner-dashboard':'boarding_house_owner','/tenant-dashboard':'tenant'};
  const role=portals[location.pathname.replace(/\/$/,'')];if(!role||window.DormMapPortal)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let unread=0,timer,loading=false,queued=false;
  let bell=document.querySelector('#notifBtn,#quickNotifBtn');
  if(!bell){bell=document.createElement('button');bell.type='button';bell.className='portal-bell';bell.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10 21h4"/></svg>';const theme=document.getElementById('themeToggle');if(theme)theme.before(bell);else document.querySelector('header')?.append(bell);}
  if(!bell)return;
  bell.removeAttribute('onclick');bell.onclick=null;bell.setAttribute('aria-label','Activity');bell.setAttribute('aria-expanded','false');
  const count=document.createElement('span');count.className='portal-unread';count.hidden=true;count.setAttribute('aria-hidden','true');bell.append(count);
  const panel=document.createElement('section');panel.className='portal-notification-panel';panel.hidden=true;panel.setAttribute('aria-label','Recent notifications');
  panel.innerHTML='<div class="portal-notification-heading"><strong>Activity</strong><button type="button" data-read-all>Mark all read</button><button type="button" data-close aria-label="Close activity">×</button></div><p class="portal-live-state" aria-live="polite">Connecting to live updates…</p><div data-notification-items></div>';
  document.body.append(panel);
  const state=panel.querySelector('.portal-live-state');
  const notificationItems=panel.querySelector('[data-notification-items]');
  notificationItems.setAttribute('data-paginate', '');
  const toggle=()=>{panel.hidden=!panel.hidden;bell.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){refresh();panel.querySelector('[data-read-all]').focus();}};
  bell.addEventListener('click',toggle);
  panel.querySelector('[data-close]').onclick=()=>{panel.hidden=true;bell.setAttribute('aria-expanded','false');bell.focus();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden)panel.querySelector('[data-close]').click();});
  document.addEventListener('click',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!bell.contains(event.target)){panel.hidden=true;bell.setAttribute('aria-expanded','false');}});
  async function read(id,source){const res=await fetch('/api/portal/notifications/read',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(id?{id,source}:{})});if(!res.ok)throw Error('Unable to mark notification as read.');}
  function setUnread(value){unread=Math.max(0,Number(value)||0);count.textContent=unread>99?'99+':String(unread);count.hidden=!unread;bell.classList.toggle('has-updates',unread>0);bell.setAttribute('aria-label',`Activity: ${unread} unread`);}
  panel.querySelector('[data-read-all]').onclick=async()=>{try{await read();setUnread(0);renderItems(notificationItems,[]);await refresh();}catch(error){state.textContent=error.message;}};
  function renderItems(container,items){
    container.innerHTML=items.length?items.map(n=>`<button type="button" class="portal-notification-item ${n.isRead?'':'is-unread'}" data-notice="${esc(n.source)}:${Number(n.id)}"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span><small>${esc(new Date(n.createdAt).toLocaleString())}${n.isRead?'':' · Unread'}</small></button>`).join(''):'<p class="portal-empty">You are all caught up.</p>';
    container.querySelectorAll('[data-notice]').forEach(button=>button.onclick=async()=>{const item=items.find(n=>`${n.source}:${n.id}`===button.dataset.notice);try{await read(item.id,item.source);if(!item.isRead)setUnread(unread-1);button.remove();if(container===notificationItems&&!container.querySelector('[data-notice]'))renderItems(container,[]);panel.hidden=true;location.hash=new URL(item.url,location.origin).hash;await refresh();}catch(error){state.textContent=error.message;}});
  }
  async function refresh(){if(loading){queued=true;return;}loading=true;try{
    const res=await fetch('/api/portal/notifications',{cache:'no-store'});if(!res.ok){if([401,403].includes(res.status)){ unauthorized=true;stream?.close();stream=null;state.textContent='Sign in again to receive updates.'; }return;}const data=await res.json();unread=data.unread;
    setUnread(data.unread);
    renderItems(notificationItems,data.items.filter(item=>!item.isRead));
    const containers=document.querySelectorAll('#notificationsList,#notificationsContainer,#notificationList');containers.forEach(el=>renderItems(el,data.items));
    const categories={messages:0,applications:0,owners:0,barangays:0,dashboard:0,houses:0};data.items.filter(n=>!n.isRead).forEach(n=>{const hash=new URL(n.url,location.origin).hash.slice(1);if(hash in categories)categories[hash]++;});
    Object.entries(data.pending||{}).forEach(([key,value])=>{categories[key]=Math.max(categories[key]||0,value);});
    document.querySelectorAll('nav button,#nav button,.nav-item').forEach(button=>{const key=button.dataset.view||button.dataset.panel||button.id.replace('btn-','');const qty=categories[key==='messaging'?'messages':key]||0;let badge=button.querySelector('.portal-nav-count');if(qty&&!badge){badge=document.createElement('span');badge.className='portal-nav-count';button.append(badge);}if(badge){badge.textContent=qty;badge.hidden=!qty;}button.classList.toggle('portal-attention',qty>0);});
  }catch{state.textContent='Connection interrupted. Retrying automatically.';}finally{loading=false;if(queued){queued=false;schedule();}}}
  function schedule(){if(unauthorized||document.hidden||timer)return;timer=setTimeout(()=>{timer=null;refresh();},200);}
  async function refreshVisible(){
    if(document.hidden||[...document.querySelectorAll('[id$="Modal"],[role="dialog"]')].some(el=>el.getClientRects().length)||document.querySelector('dialog[open],.swal2-container')||document.activeElement?.matches('input,textarea,select')){
      pendingView=true;
      return;
    }
    pendingView=false;
    const section=[...document.querySelectorAll('section[data-panel],section[data-view],.tab-content')].find(el=>!el.classList.contains('hidden'));
    const tab=section?.dataset.panel||section?.dataset.view||section?.id.replace('tab-','');
    const functions={super_admin:{overview:'loadOverview',owners:'loadOwners',barangays:'loadBarangayAccounts',submissions:'loadSubmissions',renewals:'loadPermitRenewals',audit:'loadAudit'},barangay:{overview:'loadOverview',applications:'loadOwnerApplications',permits:'loadPermitMonitoring',data_requests:'loadBarangayDataRequests',renewals:'loadBarangayPermitRenewals',houses:'loadHouses',messages:'loadMessages',submissions:'loadSubmissions'},boarding_house_owner:{overview:'loadOverview',profile:'loadBoardingHouses',maintenance:'loadOwnerMaintenance',applications:'loadPendingApplications',messages:'loadMessages',rooms:'loadRooms',tenants:'loadTenants',payments:'loadPayments',inquiries:'loadInquiries'},tenant:{dashboard:'loadOverview','my-room':'loadRoomAndHistory',messaging:'loadConversations',payments:'loadPaymentHistory',maintenance:'loadMaintenance',documents:'loadDocuments','browse-dorms':'loadBrowseBoardingHouses'}};
    const fn=window[functions[role]?.[tab]];if(typeof fn==='function'){try{await fn();}catch(error){console.warn('Live view refresh:',error.message);}}
  }
  let visibleTimer, stream, socket, fallbackTimer;
  let pendingView = false, sseConnected = false, unauthorized = false, connectedBefore = false;
  function changed() {
    if (unauthorized) return;
    schedule();
    pendingView = true;
    if (!visibleTimer) visibleTimer = setTimeout(() => { visibleTimer = null; refreshVisible(); }, 400);
  }
  function startFallback() {
    if (unauthorized || socket?.connected || stream || typeof EventSource !== 'function') return;
    stream = new EventSource('/api/portal/events');
    stream.addEventListener('portal-update', () => {
      sseConnected = true;
      state.textContent = 'Live updates connected';
      changed();
    });
    stream.onerror = () => {
      sseConnected = false;
      state.textContent = 'Reconnecting… Saved notifications remain available.';
    };
  }
  function connectSocket(activeSocket) {
    if (socket === activeSocket) return;
    socket = activeSocket;
    const connected = () => {
      const recovering = connectedBefore || Boolean(stream);
      connectedBefore = true;
      clearTimeout(fallbackTimer);
      stream?.close();
      stream = null;
      sseConnected = false;
      state.textContent = 'Live updates connected';
      if (recovering || socket.recovered) changed();
      else schedule();
    };
    const disconnected = () => {
      state.textContent = 'Reconnecting… Saved notifications remain available.';
      startFallback();
    };
    socket.on('connect', connected);
    socket.on('connect_error', disconnected);
    socket.on('disconnect', disconnected);
    socket.on('portal-invalidate', changed);
    if (socket.connected) connected();
  }
  document.addEventListener('dormmap:socket-ready', event => connectSocket(event.detail));
  if (window.DormMapSocket?.socket) connectSocket(window.DormMapSocket.socket);
  fallbackTimer = setTimeout(startFallback, 2500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) changed(); });
  window.addEventListener('pageshow', event => { if (event.persisted) changed(); });
  window.addEventListener('hashchange', schedule);
  window.addEventListener('online', changed);
  document.addEventListener('focusout', () => { if (pendingView) changed(); });
  document.addEventListener('close', () => { if (pendingView) changed(); }, true);
  setInterval(() => {
    if (document.hidden || unauthorized) return;
    if (pendingView || (!socket?.connected && !sseConnected)) changed();
    else if (!panel.hidden) schedule();
  }, 30000);
  // Dashboard mutations already refresh their view. This only synchronizes badges after successful writes.
  const original = window.fetch;
  window.fetch = async function (input, options) {
    const response = await original.apply(this, arguments);
    const method = String(options?.method || input?.method || 'GET').toUpperCase();
    if (response.ok && !['GET','HEAD'].includes(method) && !String(input?.url || input).includes('/api/portal/')) schedule();
    return response;
  };
  window.DormMapPortal={refresh};
  refresh();
})();
