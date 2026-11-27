(() => {
  function summary(listing, individual = false) {
    const element = document.createElement('div');
    element.className = 'flex flex-wrap items-center gap-2';
    const count = Number(listing.ratingCount) || 0;
    const average = Number(listing.ratingAverage) || 0;
    const rounded = Math.max(0, Math.min(5, Math.round(average)));
    const stars = document.createElement('span');
    stars.className = 'text-lg tracking-wide text-amber-500';
    stars.setAttribute('aria-hidden', 'true');
    stars.textContent = '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
    const label = document.createElement('span');
    label.className = 'text-sm font-semibold text-slate-600';
    label.textContent = individual ? `${average} out of 5` : count
      ? `${average.toFixed(1)} out of 5 · ${count} ${count === 1 ? 'tenant rating' : 'tenant ratings'}`
      : 'No tenant ratings yet';
    element.append(stars, label);
    return element;
  }

  function mount(container, listing) {
    container.replaceChildren();
    if (listing.registrationStatus === 'unregistered') return;
    container.append(summary(listing));
    if (!listing.ratingCount || !/^bh-[1-9]\d*$/.test(listing.id)) return;

    const details = document.createElement('details');
    details.className = 'room-inventory-details mt-2';
    const heading = document.createElement('summary');
    heading.textContent = 'Tenant feedback';
    const content = document.createElement('div');
    content.className = 'mt-2 space-y-2 text-sm';
    details.append(heading, content);
    container.append(details);

    async function load(page) {
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      status.textContent = 'Loading tenant feedback…';
      content.replaceChildren(status);
      try {
        const response = await fetch(`/api/boarding-houses/${listing.id}/reviews?page=${page}`);
        if (!response.ok) throw new Error('Could not load feedback.');
        const result = await response.json();
        if (!details.isConnected) return;
        content.replaceChildren();
        if (!result.data.length) {
          status.textContent = 'No written feedback yet.';
          content.append(status);
        }
        for (const review of result.data) {
          const item = document.createElement('article');
          item.className = 'rounded-xl border border-slate-200 p-3';
          item.append(summary({ ratingAverage: review.rating, ratingCount: 1 }, true));
          const comment = document.createElement('p');
          comment.className = 'whitespace-pre-wrap break-words text-slate-700';
          comment.textContent = review.comment;
          item.append(comment);
          content.append(item);
        }
        if (result.pages > 1) {
          const controls = document.createElement('div');
          controls.className = 'flex flex-wrap items-center justify-center gap-3';
          const label = document.createElement('span');
          label.textContent = `Page ${result.page} of ${result.pages}`;
          const button = (text, target, disabled) => {
            const control = document.createElement('button');
            control.type = 'button';
            control.className = 'rounded-lg border border-slate-300 px-3 py-2 text-emerald-800';
            control.textContent = text;
            control.disabled = disabled;
            control.onclick = () => load(target);
            return control;
          };
          controls.append(button('Previous', page - 1, page <= 1), label, button('Next', page + 1, page >= result.pages));
          content.append(controls);
        }
      } catch {
        status.textContent = 'Could not load feedback. Close this section and reopen to retry.';
        content.replaceChildren(status);
      }
    }
    details.addEventListener('toggle', () => {
      if (details.open) load(1);
    });
  }

  window.DormPropertyReviews = { mount };
})();
