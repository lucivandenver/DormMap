/* ========================================================
   DORMMAP GLOBAL SYSTEM LANGUAGE SYNC
   Applies the language selected on the Landing Page across
   ALL pages of the overall system (Login, Register, Dashboards, etc.)
   ======================================================== */

(function () {
  const savedLang = localStorage.getItem('dormmap_landing_lang');
  
  // If no saved language or English, default behavior applies
  if (!savedLang || savedLang === 'en') {
    return;
  }

  // Map regional PH dialect keys to Google Translate targets
  let targetCode = savedLang;
  if (['ceb', 'hil', 'ilo', 'pam', 'pag', 'war'].includes(savedLang)) {
    targetCode = 'tl';
  }

  // Set cookie for site-wide Google Translate persistence
  document.cookie = `googtrans=/en/${targetCode}; path=/;`;
  if (location.hostname) {
    document.cookie = `googtrans=/en/${targetCode}; path=/; domain=.${location.hostname};`;
  }

  // Global Google Translate callback for all system pages
  window.googleTranslateGlobalInit = function () {
    new google.translate.TranslateElement(
      {
        pageLanguage: 'en',
        includedLanguages: 'ar,bn,zh-CN,zh-TW,ceb,nl,en,tl,fr,de,hi,ilo,ja,ko,ms,pt,ru,es,th,vi',
        autoDisplay: false,
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE
      },
      'google_translate_global_element'
    );

    setTimeout(() => {
      const select = document.querySelector('.goog-te-combo');
      if (select) {
        select.value = targetCode;
        select.dispatchEvent(new Event('change'));
      }
    }, 500);
  };

  // Inject invisible Google Translate script on page load
  window.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('google-translate-global-script')) return;

    const container = document.createElement('div');
    container.id = 'google_translate_global_element';
    container.style.display = 'none';
    document.body.appendChild(container);

    const s = document.createElement('script');
    s.id = 'google-translate-global-script';
    s.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateGlobalInit';
    document.head.appendChild(s);
  });
})();
