import React, { createContext, useContext, useMemo } from 'react';
import {
  buildScopedCssVariables,
  effectiveCanvasColorMode,
  resolveDesignTokens,
  type ProjectDesignTokens,
  type ResolvedDesignTokens,
} from './designTokens';

export interface CanvasThemeContextValue {
  rawTokens: ProjectDesignTokens | null;
  resolved: ResolvedDesignTokens;
  effectiveMode: 'light' | 'dark';
}

export const CanvasThemeContext = createContext<CanvasThemeContextValue | null>(null);

export function useCanvasTheme(): CanvasThemeContextValue | null {
  return useContext(CanvasThemeContext);
}

function readHostTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Strictly scopes project-level Design Tokens (primary color, border radius,
 * control density, surface style, and light/dark mode) to the prototype canvas
 * or published viewer without mutating the ProtoFlow AI workbench shell UI.
 */
export const ProtoCanvasThemeScope: React.FC<{
  tokens?: ProjectDesignTokens | null;
  hostTheme?: 'light' | 'dark';
  className?: string;
  children: React.ReactNode;
}> = ({ tokens, hostTheme, className, children }) => {
  const fallbackHost = hostTheme ?? readHostTheme();
  const effectiveMode = effectiveCanvasColorMode(tokens, fallbackHost);
  const resolved = useMemo(() => resolveDesignTokens(tokens), [tokens]);
  const cssVars = useMemo(() => buildScopedCssVariables(tokens, effectiveMode), [tokens, effectiveMode]);
  const ctx = useMemo<CanvasThemeContextValue>(
    () => ({ rawTokens: tokens ?? null, resolved, effectiveMode }),
    [tokens, resolved, effectiveMode],
  );

  return (
    <CanvasThemeContext.Provider value={ctx}>
      <div
        data-pf-theme-scope="1"
        data-pf-preset={resolved.preset}
        data-pf-density={resolved.density}
        data-pf-radius={resolved.radius}
        data-pf-surface={resolved.surfaceVariant}
        data-pf-mode={effectiveMode}
        className={className ?? 'contents'}
        style={cssVars as React.CSSProperties}
      >
        {children}
      </div>
    </CanvasThemeContext.Provider>
  );
};
