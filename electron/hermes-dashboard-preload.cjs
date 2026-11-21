// Official Hermes web i18n contract (web/src/i18n/context.tsx).
// A visual preference only: no native functions or credentials are exposed.
try {
  const arg =
    typeof process !== 'undefined' && Array.isArray(process.argv)
      ? process.argv.find((item) => typeof item === 'string' && item.startsWith('--alex-locale='))
      : undefined;
  const hostLang = arg ? arg.slice('--alex-locale='.length).trim().toLowerCase() : '';
  const fallbackLang =
    (typeof process !== 'undefined' && process.env && process.env.PROTOFLOW_LOCALE) ||
    (typeof navigator !== 'undefined' && navigator.language) ||
    'zh';
  const target = (hostLang || String(fallbackLang).toLowerCase()).startsWith('en') ? 'en' : 'zh';
  if (!localStorage.getItem('hermes-locale')) {
    localStorage.setItem('hermes-locale', target);
  }
} catch {}
