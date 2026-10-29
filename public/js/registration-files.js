(() => {
  const boot = () => {
    document.querySelectorAll('#ownerWizardForm input[type="file"],#registerForm input[type="file"]').forEach(input => {
      let objectUrl;
      input.accept = input.name.startsWith('gallery') || input.name === 'profilePicture' ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,application/pdf';
      const preview = document.createElement('div'); preview.className = 'registration-file-preview'; preview.setAttribute('aria-live','polite'); input.after(preview);
      input.addEventListener('change', () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        preview.replaceChildren(); input.setCustomValidity('');
        const file = input.files[0]; if (!file) return;
        if (file.size > 5*1024*1024 || !input.accept.split(',').includes(file.type)) { input.value = ''; input.setCustomValidity('Choose a supported file up to 5 MB.'); preview.textContent = 'Choose JPG, PNG, WEBP, or an allowed PDF, up to 5 MB.'; return; }
        const name = document.createElement('span'); name.textContent = `${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`; preview.append(name);
        if (file.type.startsWith('image/')) { const image = document.createElement('img'); objectUrl = URL.createObjectURL(file); image.src = objectUrl; image.alt = 'Selected file preview'; preview.append(image); }
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
