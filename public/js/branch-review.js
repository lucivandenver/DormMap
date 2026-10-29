(() => {
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function load(root) {
   const target=root.querySelector('[data-branch-list]');
   try {
     const response=await fetch(root.dataset.branchReview+'/branches',{cache:'no-store'}); const data=await response.json(); if(!response.ok)throw new Error(data.error);
     target.innerHTML=data.data.length?data.data.map(house=>`<article class="rounded-xl border border-slate-200 p-4 space-y-2"><div class="flex flex-wrap justify-between gap-2"><div><b>${esc(house.name)}</b><p class="text-xs text-slate-500">${esc(house.barangay)} · ${esc(house.propertyType)} · ${house.floorCount || 'Unspecified'} floors · Owner #${house.ownerId}</p></div><span class="text-xs font-bold">${esc(house.approvalStatus)}</span></div><p class="text-xs">${esc(house.address || '')}</p>${house.reviewNote?'<p class="text-xs text-rose-700">'+esc(house.reviewNote)+'</p>':''}<div class="flex flex-wrap gap-2">${['approve','revision','reject','suspend'].map(action=>`<button type="button" data-id="${house.id}" data-action="${action}" class="rounded-full border px-3 py-2 text-xs font-bold">${action}</button>`).join('')}</div></article>`).join(''):'No additional branch applications yet.';
   }catch(error){target.textContent=error.message || 'Unable to load branches.';}
 }
 function boot(){document.querySelectorAll('[data-branch-review]').forEach(root=>{
   root.querySelector('[data-branch-refresh]').addEventListener('click',()=>load(root));
   root.addEventListener('click',async event=>{const button=event.target.closest('[data-id][data-action]');if(!button)return;const note=button.dataset.action==='approve'?'Approved by assigned reviewer.':prompt('Review note (required):');if(note===null)return;button.disabled=true;try{const response=await fetch(root.dataset.branchReview+'/branches/'+button.dataset.id+'/review',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:button.dataset.action,note})});const data=await response.json();if(!response.ok)throw new Error(data.error);await load(root);}catch(error){root.querySelector('[data-branch-error]').textContent=error.message;}finally{button.disabled=false;}});load(root);
 });}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
