/* ========================================================
   DORMMAP LANDING PAGE MULTI-LANGUAGE TRANSLATOR
   Image 2 Minimal Dropdown Design + A-Z Native Language List
   Scope: Landing Page Only (home.xian)
   ======================================================== */

(function () {
  // A-Z Sorted Languages List (matching Image 2 minimalist style)
  const A_TO_Z_LANGUAGES = [
    { code: 'ar', name: 'Arabic', native: 'العَرَبِيَّةُ' },
    { code: 'bn', name: 'Bengali', native: 'বাংলা' },
    { code: 'zh-CN', name: 'Chinese (Simplified)', native: '简体中文' },
    { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文' },
    { code: 'ceb', name: 'Cebuano (Bisaya)', native: 'Cebuano' },
    { code: 'nl', name: 'Dutch', native: 'Nederlands' },
    { code: 'en', name: 'English', native: 'English' },
    { code: 'tl', name: 'Filipino / Tagalog', native: 'Tagalog' },
    { code: 'fr', name: 'French', native: 'Français' },
    { code: 'de', name: 'German', native: 'Deutsch' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
    { code: 'ilo', name: 'Ilocano', native: 'Ilokano' },
    { code: 'ja', name: 'Japanese', native: '日本語' },
    { code: 'ko', name: 'Korean', native: '한국어' },
    { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
    { code: 'pt', name: 'Portuguese', native: 'Português' },
    { code: 'ru', name: 'Russian', native: 'Русский' },
    { code: 'es', name: 'Spanish', native: 'Español' },
    { code: 'th', name: 'Thai', native: 'ไทย' },
    { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' }
  ];

  let currentLangCode = localStorage.getItem('dormmap_landing_lang') || 'en';

  // Google Translate Integration Callback
  window.googleTranslateElementInit = function () {
    new google.translate.TranslateElement(
      {
        pageLanguage: 'en',
        includedLanguages: 'ar,bn,zh-CN,zh-TW,ceb,nl,en,tl,fr,de,hi,ilo,ja,ko,ms,pt,ru,es,th,vi',
        autoDisplay: false,
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE
      },
      'google_translate_element'
    );

    if (currentLangCode && currentLangCode !== 'en') {
      setTimeout(() => applyGoogleLanguage(currentLangCode), 800);
    }
  };

  // Inject Google Translate script invisibly
  function loadGoogleTranslateScript() {
    if (document.getElementById('google-translate-script')) return;
    const container = document.createElement('div');
    container.id = 'google_translate_element';
    container.style.display = 'none';
    document.body.appendChild(container);

    const s = document.createElement('script');
    s.id = 'google-translate-script';
    s.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.head.appendChild(s);
  }

  function applyGoogleLanguage(langCode) {
    let targetCode = langCode;
    if (['ceb', 'ilo'].includes(langCode)) {
      targetCode = 'tl'; // Fallback mapping for Tagalog/Filipino
    }

    const select = document.querySelector('.goog-te-combo');
    if (select) {
      select.value = targetCode;
      select.dispatchEvent(new Event('change'));
    } else {
      setTimeout(() => applyGoogleLanguage(langCode), 400);
    }
  }

  // Update Display Label
  function updateLanguageLabel(langObj) {
    const displays = document.querySelectorAll('.current-lang-display');
    displays.forEach(el => {
      el.textContent = langObj.name || 'English';
    });
  }

  // Toggle minimal dropdown menu (Image 2 design)
  window.toggleLanguageDropdown = function (e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('langDropdownMenu');
    if (dropdown) {
      dropdown.classList.toggle('hidden');
    }
  };

  // Close dropdown on outside click
  window.addEventListener('click', (e) => {
    const container = document.getElementById('langDropdownContainer');
    const dropdown = document.getElementById('langDropdownMenu');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      if (container && !container.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    }
  });

  // Select Language from Image 2 minimal dropdown
  window.selectLanguage = function (code) {
    currentLangCode = code;
    localStorage.setItem('dormmap_landing_lang', code);

    const langObj = A_TO_Z_LANGUAGES.find(l => l.code === code) || { code: 'en', name: 'English', native: 'English' };
    updateLanguageLabel(langObj);

    const dropdown = document.getElementById('langDropdownMenu');
    if (dropdown) dropdown.classList.add('hidden');

    if (code === 'en') {
      const select = document.querySelector('.goog-te-combo');
      if (select) {
        select.value = 'en';
        select.dispatchEvent(new Event('change'));
      }
      document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.${location.hostname};`;
      window.location.reload();
      return;
    }

    applyGoogleLanguage(code);
  };

  // Render Image 2 Minimal Dropdown Items
  function renderDropdownItems() {
    const menu = document.getElementById('langDropdownMenu');
    if (!menu) return;

    menu.innerHTML = A_TO_Z_LANGUAGES.map(lang => {
      const isSelected = currentLangCode === lang.code;
      return `
        <button 
          type="button" 
          onclick="selectLanguage('${lang.code}')" 
          class="w-full text-left px-5 py-3 hover:bg-slate-50/90 transition flex items-center justify-between text-slate-700 text-sm cursor-pointer ${
            isSelected ? 'font-semibold text-emerald-800 bg-slate-50/50' : 'font-normal'
          }"
        >
          <span class="text-slate-800">${lang.native}</span>
          ${isSelected ? '<span class="text-xs text-emerald-700 font-bold">✓</span>' : ''}
        </button>
      `;
    }).join('');
  }

  // Initialize on DOM load
  window.addEventListener('DOMContentLoaded', () => {
    loadGoogleTranslateScript();
    renderDropdownItems();
    const active = A_TO_Z_LANGUAGES.find(l => l.code === currentLangCode) || { code: 'en', name: 'English' };
    updateLanguageLabel(active);
  });
})();
