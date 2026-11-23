(() => {
  const headers = { Accept: 'application/json' };
  const drafts = new WeakMap();

  async function post(url, body) {
    let response;
    try {
      response = await fetch(url, { method: 'POST', headers, body });
    } catch {
      throw new Error('Connection interrupted. Your entries are still here. Try submitting again.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Object.keys(data).length) {
      throw Object.assign(new Error(data.error || 'The server could not finish the submission. Please try again.'), { status: response.status });
    }
    return data;
  }

  async function reducePhoto(field, file) {
    if (!/^(?:branch\d+_)?gallery/.test(field) || file.size < 500_000 || !window.createImageBitmap) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      try { context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); }
      finally { bitmap.close(); }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
      if (blob?.type === 'image/webp' && blob.size < file.size) return new File([blob], 'property.webp', { type: blob.type });
    } catch { /* Upload the original if resizing is unavailable. */ }
    return file;
  }

  async function submit(form, status) {
    const body = new FormData(form);
    const files = [...body].filter(([field, value]) => value instanceof File && field !== 'profilePicture' && value.size);
    for (const [field, value] of [...body]) {
      if (value instanceof File && field !== 'profilePicture') body.delete(field);
    }
    if (!files.length) return post(form.action, body);
    let draft = drafts.get(form);
    if (!draft) {
      const { id } = await post('/owner-registration/uploads');
      draft = { id, files: new Map() };
      drafts.set(form, draft);
    }

    let next = 0;
    let completed = 0;
    let error;
    const manifest = [];
    const showProgress = () => { status.textContent = `Uploading attachments (${completed} of ${files.length})…`; };
    showProgress();
    const uploadNext = async () => {
      while (!error && next < files.length) {
        const [field, file] = files[next++];
        try {
          let saved = draft.files.get(field);
          if (saved?.file !== file) {
            const upload = new FormData();
            upload.set('file', await reducePhoto(field, file));
            const { extension } = await post(`/owner-registration/uploads/${draft.id}/${field}`, upload);
            saved = { file, extension };
            draft.files.set(field, saved);
          }
          manifest.push([field, saved.extension]);
          completed++;
          showProgress();
        } catch (cause) { error ||= cause; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, uploadNext));
    if (error) throw error;
    body.set('registrationDraft', draft.id);
    body.set('registrationFiles', JSON.stringify(manifest));
    status.textContent = 'Saving your application…';
    const result = await post(form.action, body);
    drafts.delete(form);
    return result;
  }

  window.submitOwnerRegistration = async (form, status) => {
    status.hidden = false;
    status.dataset.state = 'progress';
    status.textContent = 'Preparing your application…';
    status.scrollIntoView({ block: 'nearest' });
    try {
      try { return await submit(form, status); }
      catch (error) {
        if (error.status !== 410 || !drafts.has(form)) throw error;
        drafts.delete(form);
        return await submit(form, status);
      }
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.message;
      return null;
    }
  };
})();
