import { translateDynamicMessage } from './dynamicMap';

export type Locale = 'zh-CN' | 'en-US';

export const LOCALE_STORAGE_KEY = 'protoflow-locale';

const DEFAULT_TITLES: Record<Locale, { app: string; viewer: string }> = {
  'zh-CN': {
    app: 'Alex — AI 时代可运行原型与数据流转沙盒',
    viewer: 'Alex · 在线交互原型演示',
  },
  'en-US': {
    app: 'Alex — AI Interactive Prototype & Data Flow Workbench',
    viewer: 'Alex · Interactive Prototype Viewer',
  },
};

const KNOWN_DEFAULT_TITLES = new Set([
  DEFAULT_TITLES['zh-CN'].app,
  DEFAULT_TITLES['en-US'].app,
  DEFAULT_TITLES['zh-CN'].viewer,
  DEFAULT_TITLES['en-US'].viewer,
]);

let cachedLocale: Locale | null = null;
const listeners = new Set<() => void>();
let storageListenerBound = false;

export function normalizeLocale(input?: string | null): Locale | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^zh\b/i.test(trimmed) || trimmed.toLowerCase().startsWith('zh')) return 'zh-CN';
  if (/^en\b/i.test(trimmed) || trimmed.toLowerCase().startsWith('en')) return 'en-US';
  return null;
}

/**
 * Resolve OS / browser preferred locale.
 * Chinese OS/browser environments resolve to 'zh-CN'; all other environments resolve to 'en-US'.
 */
export function detectSystemLocale(
  languages?: readonly string[] | null,
  primaryLanguage?: string | null,
): Locale {
  if (Array.isArray(languages)) {
    for (const entry of languages) {
      const normalized = normalizeLocale(entry);
      if (normalized) return normalized;
    }
  }
  const fallback = normalizeLocale(primaryLanguage);
  if (fallback) return fallback;
  return 'en-US';
}

function isAutomatedTestEnvironment(): boolean {
  const g = globalThis as Record<string, unknown>;
  if (g.__PROTOFLOW_FORCE_SYSTEM_LOCALE__ === true) return false;
  if (g.__PROTOFLOW_TEST_LOCALE__) return false;
  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
    if (/jsdom|Node\.js/i.test(navigator.userAgent)) return true;
  }
  const proc = (globalThis as { process?: { versions?: { node?: string }; env?: Record<string, string | undefined> } }).process;
  if (proc?.versions?.node) {
    if (proc.env?.PROTOFLOW_LOCALE) return false;
    if (typeof window === 'undefined') return true;
    const desktop = (window as unknown as { protoflowDesktop?: { isElectron?: boolean } }).protoflowDesktop;
    if (!desktop?.isElectron) return true;
  }
  return false;
}

function readStoredLocale(): Locale | null {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.__PROTOFLOW_TEST_LOCALE__ === 'string') {
    const forced = normalizeLocale(g.__PROTOFLOW_TEST_LOCALE__);
    if (forced) return forced;
  }
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc?.env?.PROTOFLOW_LOCALE) {
    const envLocale = normalizeLocale(proc.env.PROTOFLOW_LOCALE);
    if (envLocale) return envLocale;
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      const parsed = normalizeLocale(raw);
      if (parsed) return parsed;
    }
  } catch {
    // Ignore storage access errors in sandboxed iframes or restricted contexts
  }
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.locale) {
    const attrLocale = normalizeLocale(document.documentElement.dataset.locale);
    if (attrLocale) return attrLocale;
  }
  return null;
}

export function resolveInitialLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  if (isAutomatedTestEnvironment()) return 'zh-CN';
  if (typeof navigator !== 'undefined') {
    return detectSystemLocale(navigator.languages, navigator.language);
  }
  return 'zh-CN';
}

function syncDomAndHost(locale: Locale, notifyDesktop = false): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    const htmlLang = locale === 'en-US' ? 'en' : 'zh-CN';
    if (document.documentElement.lang !== htmlLang) {
      document.documentElement.lang = htmlLang;
    }
    if (document.documentElement.dataset.locale !== locale) {
      document.documentElement.dataset.locale = locale;
    }
    if (typeof document.title === 'string' && KNOWN_DEFAULT_TITLES.has(document.title)) {
      const isViewer =
        document.title === DEFAULT_TITLES['zh-CN'].viewer ||
        document.title === DEFAULT_TITLES['en-US'].viewer;
      document.title = isViewer ? DEFAULT_TITLES[locale].viewer : DEFAULT_TITLES[locale].app;
    }
  }
  if (notifyDesktop && typeof window !== 'undefined') {
    const desktop = (
      window as unknown as { protoflowDesktop?: { setLocale?: (l: Locale) => Promise<unknown> } }
    ).protoflowDesktop;
    void desktop?.setLocale?.(locale)?.catch?.(() => {});
  }
}

function ensureStorageListener(): void {
  if (storageListenerBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return;
  }
  storageListenerBound = true;
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
      const next = resolveInitialLocale();
      if (next !== cachedLocale) {
        cachedLocale = next;
        syncDomAndHost(next, false);
        listeners.forEach((fn) => fn());
      }
    }
  });
}

export function getLocale(): Locale {
  // Re-evaluate in automated tests if DOM/localStorage was reset between test cases
  if (cachedLocale === null || isAutomatedTestEnvironment()) {
    const resolved = resolveInitialLocale();
    if (cachedLocale !== resolved) {
      cachedLocale = resolved;
      syncDomAndHost(resolved, false);
    }
  }
  ensureStorageListener();
  return cachedLocale;
}

export function isEnLocale(explicitLocale?: Locale): boolean {
  return (explicitLocale ?? getLocale()) === 'en-US';
}

export interface DesktopLocaleBridge {
  getLocale?: () => Promise<string | null | undefined>;
  setLocale?: (locale: Locale) => Promise<unknown>;
}

export function hasSavedRendererLocale(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY)) !== null;
    }
  } catch {
    // Ignore restricted storage contexts
  }
  return false;
}

export function hydrateLocale(next: Locale): void {
  const normalized = normalizeLocale(next) ?? 'zh-CN';
  const prev = cachedLocale;
  cachedLocale = normalized;
  syncDomAndHost(normalized, false);
  if (prev !== normalized) {
    listeners.forEach((fn) => fn());
  }
}

/**
 * Synchronize renderer & desktop main-process locale at startup without clobbering
 * a previously saved desktop preference when renderer localStorage is empty.
 */
export async function syncDesktopBootLocale(desktop?: DesktopLocaleBridge | null): Promise<Locale> {
  if (!desktop) return getLocale();
  if (hasSavedRendererLocale()) {
    const saved = getLocale();
    await desktop.setLocale?.(saved)?.catch?.(() => {});
    return saved;
  }
  if (typeof desktop.getLocale === 'function') {
    try {
      const hostLocale = normalizeLocale(await desktop.getLocale());
      if (hostLocale) {
        hydrateLocale(hostLocale);
        return hostLocale;
      }
    } catch {
      // Ignore IPC errors and keep renderer fallback
    }
  }
  return getLocale();
}

export function setLocale(next: Locale): void {
  const normalized = normalizeLocale(next) ?? 'zh-CN';
  const prev = cachedLocale;
  cachedLocale = normalized;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    }
  } catch {
    // Session can still switch in memory without localStorage
  }
  syncDomAndHost(normalized, true);
  if (prev !== normalized) {
    listeners.forEach((fn) => fn());
  }
}

export function resetLocaleCache(): void {
  cachedLocale = null;
  const next = getLocale();
  syncDomAndHost(next, false);
  listeners.forEach((fn) => fn());
}

export function toggleLocale(): Locale {
  const next: Locale = getLocale() === 'en-US' ? 'zh-CN' : 'en-US';
  setLocale(next);
  return next;
}

export function subscribeLocale(listener: () => void): () => void {
  ensureStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Isomorphic bilingual selector: returns `en` when active (or explicit) locale is 'en-US', otherwise `zh`.
 */
export function tr<T>(zh: T, en: T, explicitLocale?: Locale): T {
  return (explicitLocale ?? getLocale()) === 'en-US' ? en : zh;
}

/**
 * Bidirectionally translate dynamic runtime / backend / validation messages to match the active locale.
 */
export function td(message: string, explicitLocale?: Locale): string {
  if (!message) return message;
  const active = explicitLocale ?? getLocale();
  return translateDynamicMessage(message, active);
}

/**
 * Format HTTP Accept-Language header value for the active locale.
 */
export function getAcceptLanguageHeader(explicitLocale?: Locale): string {
  return (explicitLocale ?? getLocale()) === 'en-US' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9';
}
