import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import ConfigProvider from 'antd/es/config-provider';
import antdTheme from 'antd/es/theme';
import zhCN from 'antd/es/locale/zh_CN';
import enUS from 'antd/es/locale/en_US';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/en';
import type { ThemeConfig } from 'antd/es/config-provider/context';
import { useLocale } from '../../i18n';
import { useCanvasTheme } from '../theme/ProtoCanvasThemeScope';
import { buildAntdThemeConfig } from '../theme/designTokens';

function getThemeSnapshot(): 'light' | 'dark' {
  if (typeof document === 'undefined' || !document.documentElement) return 'light';
  return document.documentElement.dataset?.theme === 'dark' ? 'dark' : 'light';
}

function subscribeTheme(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined' || !document.documentElement || typeof MutationObserver === 'undefined') {
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
  const hostMode = useSyncExternalStore<'light' | 'dark'>(subscribeTheme, getThemeSnapshot, () => 'light');
  const canvasTheme = useCanvasTheme();
  return canvasTheme ? canvasTheme.effectiveMode : hostMode;
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

/** Shared locale/theme for both the editor canvas and the published viewer.
 * When rendered inside <ProtoCanvasThemeScope>, applies project Design Tokens strictly to the canvas. */
export const AntdSurface: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mode = useResolvedTheme();
  const canvasTheme = useCanvasTheme();
  const locale = useLocale();
  const isEn = locale === 'en-US';

  useEffect(() => {
    dayjs.locale(isEn ? 'en' : 'zh-cn');
  }, [isEn]);

  const themeConfig = useMemo<ThemeConfig>(() => {
    if (!canvasTheme || !canvasTheme.rawTokens) {
      return mode === 'dark' ? darkTheme : lightTheme;
    }
    return buildAntdThemeConfig(canvasTheme.rawTokens, mode);
  }, [canvasTheme, mode]);

  return (
    <ConfigProvider locale={isEn ? enUS : zhCN} theme={themeConfig}>
      {children}
    </ConfigProvider>
  );
};
