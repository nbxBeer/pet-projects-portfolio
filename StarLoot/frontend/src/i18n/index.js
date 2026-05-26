import ru from './ru';
import en from './en';

const LANGS = { ru, en };
const STORAGE_KEY = 'starloot_lang';
const listeners = new Set();

// Detect language from Telegram WebApp
function detectLanguage() {
  try {
    const tg = window.Telegram?.WebApp;
    const langCode = tg?.initDataUnsafe?.user?.language_code || '';
    if (typeof langCode === 'string' && langCode.toLowerCase().startsWith('ru')) return 'ru';
  } catch (e) { /* fallback */ }
  return 'en';
}

function readStoredLanguage() {
  try {
    const saved = window.localStorage?.getItem(STORAGE_KEY);
    if (saved && LANGS[saved]) return saved;
  } catch (e) { /* ignore storage errors */ }
  return null;
}

let currentLang = readStoredLanguage() || detectLanguage();
let strings = LANGS[currentLang] || en;

/** Get nested value by dot-path: 'nav.expedition' → strings.nav.expedition */
function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

/**
 * Translate a key with optional interpolation.
 * @param {string} key - Dot-separated path, e.g. 'expedition.launch'
 * @param {Object} [params] - Interpolation values, e.g. { level: 5 }
 * @returns {string}
 */
export function t(key, params) {
  let val = getByPath(strings, key);
  if (val === undefined || val === null) {
    // Fallback to English
    val = getByPath(en, key);
  }
  if (val === undefined || val === null) return key;
  if (typeof val !== 'string') return val; // arrays, objects
  if (!params) return val;
  return val.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}

/** Get current language code */
export function getLang() {
  return currentLang;
}

/** Check if current language is Russian */
export function isRu() {
  return currentLang === 'ru';
}

/** Subscribe to language changes */
export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Change language */
export function setLang(lang, { persist = true } = {}) {
  if (!LANGS[lang]) return;
  if (currentLang === lang) return;

  currentLang = lang;
  strings = LANGS[lang] || en;

  if (persist) {
    try {
      window.localStorage?.setItem(STORAGE_KEY, lang);
    } catch (e) { /* ignore storage errors */ }
  }

  for (const listener of listeners) {
    try {
      listener(currentLang);
    } catch (e) { /* ignore listener errors */ }
  }
}
