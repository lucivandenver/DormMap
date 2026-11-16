(() => {
  const filePath = /^\/(?:uploads\/[a-z0-9_.-]+|documents\/[0-9a-f-]{36}\/[a-z0-9_.-]+)$/i;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function render(url, label = 'Document') {
    if (typeof url !== 'string' || !filePath.test(url)) {
      return '<p class="text-sm text-slate-500">No file attached.</p>';
    }
    const safeLabel = escape(label);
    const image = /\.(?:jpe?g|png|webp|gif)$/i.test(url);
    const pdf = /\.pdf$/i.test(url);
    return `<div class="mt-2 w-full space-y-2">
      ${image ? `<img loading="lazy" src="${url}" alt="${safeLabel}" class="max-h-72 max-w-full rounded-lg border border-slate-200 object-contain" data-document-preview>
        <p hidden class="text-sm text-rose-800">This photo is unavailable. Ask the uploader to submit it again.</p>` : ''}
      <a href="${url}" target="_blank" rel="noopener" class="inline-block text-sm font-semibold text-emerald-800 underline">
        ${image || pdf ? 'Open' : 'Download'} ${safeLabel}
      </a>
    </div>`;
  }

  document.addEventListener('error', event => {
    if (!event.target.matches?.('img[data-document-preview]')) return;
    event.target.hidden = true;
    event.target.nextElementSibling.hidden = false;
  }, true);
  function attachment(documents, name) {
    if (typeof documents === 'string') {
      try { documents = JSON.parse(documents); } catch { return null; }
    }
    return documents?.[name];
  }

  window.DormMapPreview = { render, attachment };
})();
