(() => {
  const banner = document.getElementById('portalFeedback');
  if (!banner) return;

  const base = 'mb-4 rounded-xl border px-4 py-3 text-sm font-medium';
  const colors = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
    pending: 'border-slate-200 bg-slate-50 text-slate-800'
  };
  let confirmation;
  let popupTimer;

  function popup(message, status) {
    const overlay = document.createElement('div');
    overlay.className = 'portal-feedback-popup';
    overlay.setAttribute('role', status === 'error' ? 'alert' : 'status');
    overlay.textContent = message;
    document.querySelector('.portal-feedback-popup')?.remove();
    (document.querySelector('dialog[open]') || document.body).append(overlay);
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => overlay.remove(), 500);
  }

  function show(message, status = 'success') {
    confirmation?.(false);
    confirmation = undefined;
    if (status === 'success' || status === 'error') {
      banner.className = 'portal-feedback-announcement';
      banner.setAttribute('role', status === 'error' ? 'alert' : 'status');
      banner.textContent = message;
      if (window.Swal?.fire && !window.Swal.isVisible?.() && !document.querySelector('dialog[open]')) {
        window.Swal.fire({ toast: true, position: 'top-end', icon: status, titleText: message, timer: 500, showConfirmButton: false, showClass: { popup: '' }, hideClass: { popup: '' } });
      } else {
        popup(message, status);
      }
      return;
    }
    banner.className = base + ' ' + colors[status];
    banner.setAttribute('role', status === 'error' ? 'alert' : 'status');
    banner.textContent = message;
    banner.scrollIntoView({ block: 'nearest' });
  }

  function confirm(message) {
    show(message, 'pending');
    const actions = document.createElement('div');
    actions.className = 'mt-2 flex gap-2';
    banner.append(actions);
    return new Promise(resolve => {
      confirmation = resolve;
      for (const [label, confirmed] of [['Continue', true], ['Cancel', false]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5';
        button.textContent = label;
        button.onclick = () => {
          confirmation = undefined;
          banner.className = 'hidden';
          banner.replaceChildren();
          resolve(confirmed);
        };
        actions.append(button);
      }
      actions.lastElementChild.focus({ preventScroll: true });
    });
  }

  window.DormMapFeedback = { show, confirm };
})();
