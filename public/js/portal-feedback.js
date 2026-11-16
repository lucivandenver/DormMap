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

  function show(message, status = 'success') {
    confirmation?.(false);
    confirmation = undefined;
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
