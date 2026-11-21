const fs = require('node:fs');
const path = require('node:path');

let currentLocale = null;
let storageFilePath = null;
const listeners = new Set();

function normalizeLocale(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^zh\b/i.test(trimmed) || trimmed.toLowerCase().startsWith('zh')) return 'zh-CN';
  if (/^en\b/i.test(trimmed) || trimmed.toLowerCase().startsWith('en')) return 'en-US';
  return null;
}

function initMainI18n(app) {
  try {
    if (app && typeof app.getPath === 'function') {
      storageFilePath = path.join(app.getPath('userData'), 'locale-preference.json');
      if (fs.existsSync(storageFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(storageFilePath, 'utf8'));
        const saved = normalizeLocale(parsed?.locale);
        if (saved) {
          currentLocale = saved;
          return currentLocale;
        }
      }
    }
  } catch {
    // Ignore corrupt or inaccessible preference file
  }
  const envLocale = normalizeLocale(process.env.PROTOFLOW_LOCALE);
  if (envLocale) {
    currentLocale = envLocale;
    return currentLocale;
  }
  try {
    const sysLocale = app && typeof app.getLocale === 'function' ? app.getLocale() : Intl.DateTimeFormat().resolvedOptions().locale;
    currentLocale = normalizeLocale(sysLocale) || 'en-US';
  } catch {
    currentLocale = 'zh-CN';
  }
  return currentLocale;
}

function getMainLocale() {
  if (!currentLocale) {
    const envLocale = normalizeLocale(process.env.PROTOFLOW_LOCALE);
    if (envLocale) return envLocale;
    // In unit tests without initMainI18n(app), preserve backward-compatible zh-CN default
    return 'zh-CN';
  }
  return currentLocale;
}

function isMainEn(explicitLocale) {
  return (explicitLocale || getMainLocale()) === 'en-US';
}

function setMainLocale(nextLocale) {
  const normalized = normalizeLocale(nextLocale) || 'zh-CN';
  const changed = currentLocale !== normalized;
  currentLocale = normalized;
  if (storageFilePath) {
    try {
      fs.mkdirSync(path.dirname(storageFilePath), { recursive: true });
      fs.writeFileSync(storageFilePath, JSON.stringify({ locale: normalized }, null, 2), 'utf8');
    } catch {
      // Ignore write failures
    }
  }
  if (changed) {
    for (const fn of listeners) {
      try { fn(normalized); } catch { /* ignore listener errors */ }
    }
  }
  return normalized;
}

function onMainLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function tr(zh, en, explicitLocale) {
  return isMainEn(explicitLocale) ? en : zh;
}

module.exports = {
  normalizeLocale,
  initMainI18n,
  getMainLocale,
  isMainEn,
  setMainLocale,
  onMainLocaleChange,
  tr,
};
