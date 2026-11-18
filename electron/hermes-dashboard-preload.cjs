// Official Hermes web i18n contract (web/src/i18n/context.tsx).
// A visual preference only: no native functions or credentials are exposed.
try {
  if (!localStorage.getItem('hermes-locale')) localStorage.setItem('hermes-locale', 'zh');
} catch {}
