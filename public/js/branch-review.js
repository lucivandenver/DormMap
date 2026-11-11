(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const actionLabels = { approve: 'Approve', revision: 'Request changes', reject: 'Reject', suspend: 'Suspend' };
  const reviewActions = {
    pending: ['approve', 'revision', 'reject'],
    revision_requested: ['approve', 'revision', 'reject'],
    approved: ['suspend'],
    suspended: ['approve'],
  };

  window.renderBarangayBranchCards = branches => branches.map(branch => {
    const actions = reviewActions[branch.approvalStatus] || [];
    const property = [branch.barangay, branch.propertyType, branch.floorCount && `${branch.floorCount} floor(s)`]
      .filter(Boolean).map(escapeHtml).join(' · ');
    return `
      <article class="rounded-xl border border-slate-200 p-4 space-y-2">
        <div class="flex flex-wrap justify-between gap-2">
          <div>
            <b>${escapeHtml(branch.name)}</b>
            <p class="text-xs text-slate-500">${property}</p>
            ${branch.ownerName ? `<p class="text-xs text-slate-500">${escapeHtml(branch.ownerName)} · ${escapeHtml(branch.mainPropertyName || 'Main boarding house')}</p>` : ''}
          </div>
          <span class="badge status-${escapeHtml(branch.approvalStatus)} capitalize">${escapeHtml(branch.approvalStatus.replaceAll('_', ' '))}</span>
        </div>
        <p class="text-xs">${escapeHtml(branch.address)}</p>
        ${branch.reviewNote ? `<p class="text-xs text-slate-600">${escapeHtml(branch.reviewNote)}</p>` : ''}
        ${actions.length ? `<div class="flex flex-wrap gap-2">${actions.map(action => `
          <button type="button" data-review-branch="${branch.id}" data-action="${action}" class="rounded-full border px-3 py-2 text-xs font-bold">${actionLabels[action]}</button>
        `).join('')}</div>` : ''}
      </article>`;
  }).join('');
})();
