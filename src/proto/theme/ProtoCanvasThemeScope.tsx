import React, { createContext, useContext, useMemo } from 'react';
import { CaptureMode } from '../../capture/CaptureMode';
import {
  buildScopedCssVariables,
  effectiveCanvasColorMode,
  normalizeDesktopAccent,
  normalizeDesktopMotion,
  normalizeDesktopSurfaceBg,
  resolveDesktopAccentColor,
  resolveDesktopAppearance,
  resolveDesignTokens,
  type DesktopAccent,
  type DesktopAppearance,
  type DesktopMotionMode,
  type DesktopSurfaceBg,
  type ProjectDesignTokens,
  type ResolvedDesignTokens,
} from './designTokens';

export interface CanvasThemeContextValue {
  rawTokens: ProjectDesignTokens | null;
  resolved: ResolvedDesignTokens;
  effectiveMode: 'light' | 'dark';
  surfaceBg: DesktopSurfaceBg | null;
  accent: DesktopAccent | null;
  accentColor: string;
  motion: DesktopMotionMode;
  hasPageScope?: boolean;
}

export const CanvasThemeContext = createContext<CanvasThemeContextValue | null>(null);
export const CardBodyContext = createContext<boolean>(false);
export const DesktopOverlayExitContext = createContext<(() => void) | null>(null);
export const DesktopOverlayPositionContext = createContext<'absolute' | 'fixed'>('absolute');

export function useCanvasTheme(): CanvasThemeContextValue | null {
  return useContext(CanvasThemeContext);
}

export function useInsideCardBody(): boolean {
  return useContext(CardBodyContext);
}

function readHostTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Strictly scopes project-level Design Tokens and optional `<Page>` atmosphere
 * props (`appearance`, `surfaceBg`, `accent`, `motion`) to the prototype canvas
 * or published viewer without mutating the ProtoFlow AI workbench shell UI.
 */
export const ProtoCanvasThemeScope: React.FC<{
  tokens?: ProjectDesignTokens | null;
  hostTheme?: 'light' | 'dark';
  pageAppearance?: unknown;
  previewAppearance?: DesktopAppearance | null;
  surfaceBg?: unknown;
  accent?: unknown;
  motion?: unknown;
  captureMode?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({
  tokens,
  hostTheme,
  pageAppearance,
  previewAppearance,
  surfaceBg,
  accent,
  motion,
  captureMode,
  className,
  children,
}) => {
  const isCaptureFromCtx = useContext(CaptureMode);
  const effectiveCapture = Boolean(captureMode || isCaptureFromCtx);
  const fallbackHost = hostTheme ?? readHostTheme();
  const baseMode = effectiveCanvasColorMode(tokens, fallbackHost);
  const effectiveMode = resolveDesktopAppearance(pageAppearance, baseMode, previewAppearance, surfaceBg);
  const resolvedSurfaceBg = normalizeDesktopSurfaceBg(surfaceBg);
  const resolvedAccent = normalizeDesktopAccent(accent);
  const resolvedMotion = normalizeDesktopMotion(motion);
  const resolved = useMemo(() => resolveDesignTokens(tokens), [tokens]);
  const accentColor = useMemo(
    () => resolveDesktopAccentColor(resolvedAccent, effectiveMode, resolved.primaryColor),
    [resolvedAccent, effectiveMode, resolved.primaryColor],
  );
  const cssVars = useMemo(
    () => buildScopedCssVariables(tokens, effectiveMode, resolvedAccent),
    [tokens, effectiveMode, resolvedAccent],
  );
  const hasPageScope =
    pageAppearance !== undefined ||
    previewAppearance !== undefined ||
    surfaceBg !== undefined ||
    accent !== undefined ||
    motion !== undefined;
  const ctx = useMemo<CanvasThemeContextValue>(
    () => ({
      rawTokens: tokens ?? null,
      resolved,
      effectiveMode,
      surfaceBg: resolvedSurfaceBg,
      accent: resolvedAccent,
      accentColor,
      motion: resolvedMotion,
      hasPageScope,
    }),
    [tokens, resolved, effectiveMode, resolvedSurfaceBg, resolvedAccent, accentColor, resolvedMotion, hasPageScope],
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
        data-surface-bg={resolvedSurfaceBg ?? undefined}
        data-accent={resolvedAccent ?? undefined}
        data-motion={resolvedMotion}
        data-capture-mode={effectiveCapture ? '1' : undefined}
        className={className ?? 'contents'}
        style={{ ...(cssVars as React.CSSProperties), colorScheme: effectiveMode }}
      >
        {children}
      </div>
    </CanvasThemeContext.Provider>
  );
};
