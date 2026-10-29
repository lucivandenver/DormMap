(() => {
 function boot(){
   const skip=document.createElement('a');skip.href='#dormmap-main-content';skip.textContent='Skip to main content';skip.className='dormmap-skip-link';
   const main=document.querySelector('main') || document.querySelector('.card-body');if(main){main.id=main.id || 'dormmap-main-content';skip.href='#'+main.id;main.tabIndex=-1;document.body.prepend(skip);}
   document.addEventListener('keydown',event=>{if(event.key==='Escape'){window.closeMobileSidebar?.();const menu=document.querySelector('#sidebar');if(window.innerWidth<1024&&menu){menu.classList.add('-translate-x-full');document.querySelector('#mobileOverlay')?.classList.add('hidden');}}});
   const portalButtons=[...document.querySelectorAll('#sidebar nav button')];
   if(portalButtons.length){
     const key=button=>button.dataset.view || button.dataset.panel || (button.id?.startsWith('btn-')?button.id.slice(4):'');
     let restoring=false;
     portalButtons.forEach(button=>button.addEventListener('click',()=>setTimeout(()=>{const panel=key(button);if(!restoring&&panel&&button.classList.contains('active')&&location.hash!=='#'+panel)history.pushState({dormmapPanel:panel},'', '#'+panel);},0)));
     const restore=()=>{const panel=location.hash.slice(1),button=portalButtons.find(button=>key(button)===panel) || (!panel ? portalButtons[0] : null);if(button){restoring=true;button.click();setTimeout(()=>{restoring=false;},0);}};
     window.addEventListener('popstate',restore);window.addEventListener('hashchange',restore);if(location.hash)setTimeout(restore,0);
   }
   document.querySelectorAll('.table-wrap,.overflow-x-auto').forEach(table=>{if(!table.querySelector('table'))return;table.tabIndex=0;table.setAttribute('aria-label','Scrollable data table');const hint=document.createElement('p');hint.className='table-scroll-hint';hint.textContent='Swipe or scroll horizontally to see all columns.';table.before(hint);});
   const menu=document.querySelector('#sidebar'),toggle=document.querySelector('#menuToggle');
   if(menu&&toggle){toggle.setAttribute('aria-controls','sidebar');toggle.setAttribute('aria-label','Open navigation menu');const sync=()=>toggle.setAttribute('aria-expanded',String(!menu.classList.contains('-translate-x-full')));new MutationObserver(sync).observe(menu,{attributes:true,attributeFilter:['class']});sync();menu.querySelectorAll('nav button,nav a').forEach(button=>button.addEventListener('click',()=>{if(window.innerWidth<1024){menu.classList.add('-translate-x-full');document.querySelector('#mobileOverlay')?.classList.add('hidden');main?.focus({preventScroll:true});}}));}
   document.querySelectorAll('nav button').forEach(button=>button.addEventListener('click',()=>{setTimeout(()=>{document.querySelectorAll('nav button').forEach(item=>{if(item.classList.contains('active'))item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});},0);}));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
