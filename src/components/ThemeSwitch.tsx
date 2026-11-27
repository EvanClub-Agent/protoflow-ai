import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useI18n } from '../i18n';

export type ThemeMode = 'system' | 'light' | 'dark';

const storageKey = 'color-scheme';
const systemQuery = '(prefers-color-scheme: dark)';
const nextMode = { light: 'dark', dark: 'system', system: 'light' } as const;
const icons = { light: Sun, dark: Moon, system: Monitor };

function parseMode(value: string | null): ThemeMode {
  return value === 'system' || value === 'dark' ? value : 'light';
}

export function useThemePreference() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try { return parseMode(window.localStorage.getItem(storageKey)); }
    catch { return 'light'; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(systemQuery).matches);
  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', mode === 'system' ? 'light dark' : resolved);
  }, [mode, resolved]);

  useEffect(() => {
    const media = window.matchMedia(systemQuery);
    const onSystemChange = () => setSystemDark(media.matches);
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setMode(parseMode(event.newValue));
    };
    onSystemChange();
    media.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function cycle() {
    const next = nextMode[mode];
    setMode(next);
    try { window.localStorage.setItem(storageKey, next); }
    catch { /* The current session can still switch without browser storage. */ }
  }
  return { mode, resolved, cycle };
}

export function ThemeSwitch({ mode, resolved, cycle }: ReturnType<typeof useThemePreference>) {
  const { tr } = useI18n();
  const Icon = icons[mode];
  const appearance = resolved === 'dark' ? tr('深色', 'Dark') : tr('浅色', 'Light');
  const label = tr(
    `切换主题（当前：${mode === 'system' ? '跟随系统·' : ''}${appearance}）`,
    `Switch theme (Current: ${mode === 'system' ? 'System · ' : ''}${appearance})`
  );
  return (
    <div className="relative group flex items-center">
      <button type="button" onClick={cycle} aria-label={label}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition">
        <Icon className="w-3.5 h-3.5" />
      </button>
      <div role="tooltip" className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:opacity-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap">
        <span className="text-xs font-medium tracking-tight">{label}</span>
      </div>
    </div>
  );
}
