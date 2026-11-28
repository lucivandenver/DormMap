const recovery = document.querySelector('[data-password-recovery]');
recovery?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = recovery.querySelector('button[type="submit"]');
  if (button.disabled) return;
  const status = recovery.querySelector('[data-recovery-status]');
  const reset = recovery.elements.namedItem('token');
  const label = button.textContent.trim();
  button.disabled = true;
  button.textContent = reset ? 'Updating…' : 'Sending…';
  status.textContent = '';
  try {
    const response = await fetch(recovery.action, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams(new FormData(recovery)),
      signal: AbortSignal.timeout(18000)
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Please try again.');
    if (reset) {
      location.assign('/login?passwordUpdated=1');
      return;
    }
    status.textContent = data.message;
    DormMapFeedback.show(data.message);
  } catch (error) {
    status.textContent = ['TimeoutError', 'TypeError', 'SyntaxError'].includes(error.name)
      ? 'The request did not finish. Please try again.' : error.message;
    DormMapFeedback.show(status.textContent, 'error');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
});
