// These selects apply only to owner registration; barangay officials may still apply for any barangay.
(() => {
  async function refresh() {
    const selects = document.querySelectorAll('select[name="boardingHouseAddress"]');
    if (!selects.length) return;
    try {
      const response = await fetch('/api/eligible-barangays', { cache: 'no-store' });
      if (!response.ok) throw new Error('Availability check failed');
      const names = await response.json();
      const allowed = new Set(names.map(name => name.toLowerCase()));
      for (const select of selects) {
        for (const option of select.options) {
          if (!option.value) continue;
          const label = option.dataset.label || option.textContent;
          option.dataset.label = label;
          option.disabled = !allowed.has(option.value.toLowerCase());
          option.textContent = label + (option.disabled ? ' — awaiting approved official' : '');
          if (option.disabled && option.selected) select.value = '';
        }
        let hint = select.parentElement.querySelector('[data-barangay-availability]');
        if (!hint) { hint = document.createElement('p'); hint.dataset.barangayAvailability = ''; hint.className = 'mt-2 text-xs text-slate-500'; select.after(hint); }
        hint.textContent = names.length ? 'Only barangays with an approved, active official can receive applications.' : 'Owner registration will open once BPLO approves a barangay official.';
      }
    } catch { /* Submission is also checked on the server. Allow a later retry. */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh); else refresh();
  window.addEventListener('focus', refresh);
})();
