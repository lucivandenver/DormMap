/* ========================================================
   DORMMAP PWA REGISTRATION & INSTALLATION HANDLER
   App Name: DormMap
   App Icon: /images/dormmap-circle.png
   ======================================================== */

(function () {
  let deferredPrompt = null;

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          registration.onupdatefound = () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[DormMap PWA] New version ready.');
                }
              };
            }
          };
        })
        .catch((error) => {
          console.warn('[DormMap PWA] Service worker registration error:', error);
        });
    });
  }

  // Handle PWA Install Prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[DormMap PWA] Native install prompt captured.');

    // Ensure all install buttons are enabled and visible
    const installButtons = document.querySelectorAll('.pwa-install-btn');
    installButtons.forEach((btn) => {
      btn.style.display = 'inline-flex';
      btn.classList.remove('hidden');
    });

    window.dispatchEvent(new CustomEvent('pwaCanInstall', { detail: { prompt: deferredPrompt } }));
  });

  // Track successful installation
  window.addEventListener('appinstalled', () => {
    console.log('[DormMap PWA] DormMap was installed successfully!');
    deferredPrompt = null;
    const installButtons = document.querySelectorAll('.pwa-install-btn');
    installButtons.forEach((b) => (b.style.display = 'none'));
  });

  // Modal Guide Helper if prompt is handled by browser UI
  function showDormMapInstallGuide() {
    const existing = document.getElementById('dormmapInstallModal');
    if (existing) existing.remove();

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isStandalone) {
      alert('DormMap is already installed and running as a standalone app.');
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'dormmapInstallModal';
    modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-4';
    modal.innerHTML = `
      <div class="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 text-center animate-in fade-in zoom-in-95 duration-200">
        <button id="closeDormmapInstallModal" class="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition">✕</button>
        
        <div class="mx-auto w-20 h-20 rounded-2xl p-1 bg-white shadow-md border border-slate-100 mb-3 flex items-center justify-center">
          <img src="/images/dormmap-circle.png" alt="DormMap" class="w-full h-full object-cover rounded-xl shadow-xs">
        </div>
        
        <h3 class="text-xl font-black text-slate-900 tracking-tight">DormMap</h3>
        <p class="text-[11px] font-bold text-emerald-700 uppercase tracking-widest mt-0.5">Install Official Web App</p>
        <p class="text-xs text-slate-500 mt-2 leading-relaxed">Install DormMap on your device for instant access to accredited boarding houses, map navigation, and permit verification.</p>
        
        <div class="mt-4 space-y-2 text-left text-xs bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
          ${
            isIOS
              ? `
              <div class="flex items-start gap-2.5">
                <span class="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                <div>Tap the <strong>Share</strong> button <span class="font-mono text-sm">⎋</span> at the bottom of Safari.</div>
              </div>
              <div class="flex items-start gap-2.5">
                <span class="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                <div>Scroll down and select <strong>"Add to Home Screen"</strong>.</div>
              </div>
              `
              : `
              <div class="flex items-start gap-2.5">
                <span class="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                <div>Click the <strong>Install</strong> icon <span class="inline-block px-1.5 py-0.5 bg-white border border-slate-200 rounded font-semibold text-[10px]">🖥️</span> in your browser's address bar (top right).</div>
              </div>
              <div class="flex items-start gap-2.5">
                <span class="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                <div>Or click the browser menu <span class="font-bold">(⋮)</span> &rarr; select <strong>"Install DormMap"</strong>.</div>
              </div>
              `
          }
        </div>
        
        <button id="okDormmapInstallModal" class="mt-4 w-full rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold py-2.5 text-xs shadow-md transition active:scale-95">
          Got it
        </button>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('closeDormmapInstallModal').onclick = () => modal.remove();
    document.getElementById('okDormmapInstallModal').onclick = () => modal.remove();
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
  }

  // Expose global installer function
  window.installDormMapPWA = async function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`[DormMap PWA] User choice: ${outcome}`);
      deferredPrompt = null;
      if (outcome === 'accepted') {
        const installButtons = document.querySelectorAll('.pwa-install-btn');
        installButtons.forEach((b) => (b.style.display = 'none'));
      }
      return outcome;
    } else {
      showDormMapInstallGuide();
    }
  };
})();
