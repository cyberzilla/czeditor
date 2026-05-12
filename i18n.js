// CZEditor i18n — Internationalization Module
const CZi18n = (() => {
    let strings = {};
    let currentLang = 'id';
    const STORAGE_KEY = 'cz_ui_lang';

    // Get a translated string, with optional placeholder replacement
    // Usage: t('confirm_close_file', 'myfile.js') → "Tutup file 'myfile.js'?"
    function t(key, ...args) {
        let str = strings[key] || key;
        args.forEach((arg, i) => {
            str = str.replace(`{${i}}`, arg);
        });
        return str;
    }

    // Apply translations to all elements with data-i18n attribute
    function applyToDOM() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const attr = el.getAttribute('data-i18n-attr'); // e.g. 'title', 'placeholder'
            const val = t(key);
            if (attr) {
                el.setAttribute(attr, val);
            } else if (el.getAttribute('data-i18n-html') !== null) {
                el.innerHTML = val;
            } else {
                el.textContent = val;
            }
        });
    }

    // Load a language file and apply it
    async function loadLanguage(langCode) {
        try {
            const resp = await fetch(`i18n/${langCode}.json`, { cache: 'no-store' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            strings = await resp.json();
            currentLang = langCode;
            localStorage.setItem(STORAGE_KEY, langCode);
            document.documentElement.lang = langCode;
            applyToDOM();
            return true;
        } catch (e) {
            console.warn(`[i18n] Failed to load '${langCode}':`, e.message);
            return false;
        }
    }

    // Initialize: load saved language or detect from browser
    async function init() {
        const saved = localStorage.getItem(STORAGE_KEY);
        const browserLang = navigator.language?.substring(0, 2) || 'id';
        const lang = saved || (['en', 'id'].includes(browserLang) ? browserLang : 'id');
        await loadLanguage(lang);
    }

    // Get available languages by scanning known list
    function getAvailableLanguages() {
        return [
            { code: 'id', name: 'Bahasa Indonesia' },
            { code: 'en', name: 'English' }
        ];
    }

    function getCurrentLang() { return currentLang; }
    function getStrings() { return strings; }

    return { t, init, loadLanguage, applyToDOM, getAvailableLanguages, getCurrentLang, getStrings };
})();
