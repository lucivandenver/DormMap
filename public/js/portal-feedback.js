(() => {
  const duration = 1000;
  let popupTimer;

  function show(message, status = 'success', description = '') {
    const banner = document.getElementById('portalFeedback');
    if (status === 'pending') {
      if (!banner) return;
      banner.className = 'mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800';
      banner.setAttribute('role', 'status');
      banner.textContent = message;
      banner.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (banner) {
      banner.className = 'hidden';
      banner.textContent = '';
    }
    clearTimeout(popupTimer);
    document.querySelector('.portal-feedback-popup')?.remove();
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
    const swal = window.Swal;
    if (!dialog && swal?.fire && (!swal.isVisible?.() || swal.getPopup?.()?.classList.contains('portal-transient-alert'))) {
      return swal.fire({
        position: 'center',
        icon: status,
        titleText: message,
        text: description,
        timer: duration,
        showConfirmButton: false,
        backdrop: false,
        heightAuto: false,
        customClass: { popup: 'portal-transient-alert' },
        showClass: { popup: '' },
        hideClass: { popup: '' }
      });
    }

    const popup = document.createElement('div');
    popup.className = 'portal-feedback-popup';
    popup.setAttribute('role', status === 'error' ? 'alert' : 'status');
    popup.textContent = description ? `${message} ${description}` : message;
    (dialog || document.body).append(popup);
    popupTimer = setTimeout(() => popup.remove(), duration);
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
