import React, { useSyncExternalStore } from 'react';
import ConfigProvider from 'antd/es/config-provider';
import antdTheme from 'antd/es/theme';
import zhCN from 'antd/es/locale/zh_CN';
import type { ThemeConfig } from 'antd/es/config-provider/context';

function getThemeSnapshot(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function subscribeTheme(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => 'light');
}

const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: { colorPrimary: '#2563eb', borderRadius: 6, fontSize: 13 },
};

const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#1668dc',
    colorBgContainer: '#141414',
    colorBgElevated: '#1f1f1f',
    colorBorder: '#424242',
    colorBorderSecondary: '#303030',
    borderRadius: 6,
    fontSize: 13,
  },
};

/** Shared locale/theme for both the editor canvas and the published viewer. */
export const AntdSurface: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mode = useResolvedTheme();
  return (
    <ConfigProvider locale={zhCN} theme={mode === 'dark' ? darkTheme : lightTheme}>
      {children}
    </ConfigProvider>
  );
};
