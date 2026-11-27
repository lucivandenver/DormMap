(() => {
  const banner = document.getElementById('portalFeedback');
  if (!banner) return;

  const base = 'mb-4 rounded-xl border px-4 py-3 text-sm font-medium';
  const colors = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
    pending: 'border-slate-200 bg-slate-50 text-slate-800'
  };
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

  async function confirm(message) {
    const openDialog = document.querySelector('dialog[open]');
    if (window.Swal?.fire && !openDialog) {
      const result = await window.Swal.fire({
        title: 'Confirm action',
        text: message,
        icon: 'question',
        position: 'center',
        showCancelButton: true,
        confirmButtonText: 'Continue',
        cancelButtonText: 'Cancel',
        focusCancel: true,
        confirmButtonColor: '#047857'
      });
      return result.isConfirmed;
    }

    const dialog = document.createElement('dialog');
    dialog.className = 'portal-confirm-dialog';
    dialog.setAttribute('aria-label', 'Confirm action');
    const text = document.createElement('p');
    text.textContent = message;
    const actions = document.createElement('form');
    actions.method = 'dialog';
    for (const [value, label] of [['cancel', 'Cancel'], ['continue', 'Continue']]) {
      const button = document.createElement('button');
      button.type = 'submit';
      button.value = value;
      button.textContent = label;
      button.autofocus = value === 'cancel';
      actions.append(button);
    }
    dialog.append(text, actions);
    document.body.append(dialog);
    return new Promise(resolve => {
      dialog.addEventListener('close', () => {
        resolve(dialog.returnValue === 'continue');
        dialog.remove();
      }, { once: true });
      dialog.showModal();
    });
  }

  window.DormMapFeedback = { show, confirm };
})();
