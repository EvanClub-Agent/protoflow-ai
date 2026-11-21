import { useCallback, useSyncExternalStore } from 'react';
import {
  getLocale,
  setLocale,
  subscribeLocale,
  toggleLocale,
  td as runtimeTd,
  type Locale,
} from './runtime';

export {
  LOCALE_STORAGE_KEY,
  detectSystemLocale,
  getAcceptLanguageHeader,
  getLocale,
  hasSavedRendererLocale,
  hydrateLocale,
  isEnLocale,
  normalizeLocale,
  resetLocaleCache,
  resolveInitialLocale,
  setLocale,
  subscribeLocale,
  syncDesktopBootLocale,
  td,
  toggleLocale,
  tr,
  type DesktopLocaleBridge,
  type Locale,
} from './runtime';

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, () => 'zh-CN');
}

export function useI18n() {
  const locale = useLocale();
  const isEn = locale === 'en-US';
  const select = useCallback(
    <T,>(zh: T, en: T): T => (isEn ? en : zh),
    [isEn],
  );
  const translateDynamic = useCallback(
    (msg: string): string => runtimeTd(msg, locale),
    [locale],
  );
  return {
    locale,
    isEn,
    setLocale,
    toggleLocale,
    tr: select,
    td: translateDynamic,
  };
}
