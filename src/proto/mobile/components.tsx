import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Bookmark,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  FileText,
  Home,
  Inbox,
  Info,
  Layers,
  Menu,
  Mic,
  Minus,
  MoreHorizontal,
  Plus,
  ScanLine,
  Search,
  Send,
  Shield,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp,
  User,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { CaptureMode } from '../../capture/CaptureMode';
import type { CompProps, RootAttrs } from '../registry/components';
import { isActionChain, type PropValue, type ProtoNode } from '../types';
import { resolveFormInstanceKey } from '../runtime/runtime';
import { useResolvedTheme } from '../registry/AntdSurface';
import { PreviewDataContext, useMaterialTables } from '../runtime/PreviewData';
import { usePageStore } from '../store/usePageStore';
import { useProtoStore } from '../../store/useProtoStore';
import { columnLabel, defaultDisplayColumns, type Row } from '../runtime/mock';
import { resolveBoundForeignKeySpec } from '../ai/templates';
import { mobileOptions } from './options';
import { OVERLAY_TYPES } from '../registry/meta';
import {
  collectionBindingErrors,
  rowsForSource,
  sourceForeignKeyErrors,
} from '../table/model';
import { declaredColumnOptions } from '../database/enumContract';
import { childRowScope } from '../runtime/runtime';
import { resolveCanonicalRow, useAutoSelectFirstRow, useCollectionSourceRow, useSourceRow } from '../runtime/sourceRow';
import { matchesWhenCondition, resolveKanbanStatusColumn } from '../runtime/pokaYoke';
import {
  applyUIStackRows,
  UIStackEmptyBannerHint,
  UIStackPageErrorResult,
  useUIStackState,
} from '../runtime/uiStackLens';
import { useI18n } from '../../i18n';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

function rootWith(
  root: RootAttrs,
  extra: { className?: string; style?: React.CSSProperties; onClick?: (e: React.MouseEvent) => void },
) {
  return {
    ...root,
    className: cx(extra.className, root.className),
    style: extra.style || root.style ? { ...extra.style, ...root.style } : undefined,
    onClick: root.onClick ?? extra.onClick,
  };
}

// ───────────────────────── Gemini Mobile Design Tokens ─────────────────────────

export type MobileAccent = 'gemini' | 'blue' | 'violet' | 'emerald' | 'amber' | 'rose' | 'obsidian' | 'lime_forest';
export type MobileAppearance = 'light' | 'dark';
export type MobileSurfaceBg = 'mist' | 'pure' | 'warm_paper' | 'sage_field' | 'oled_carbon' | 'ocean_glow';
export type MobileMotionMode = 'smooth' | 'snappy' | 'none';

const VALID_SURFACE_BGS = new Set<MobileSurfaceBg>([
  'mist',
  'pure',
  'warm_paper',
  'sage_field',
  'oled_carbon',
  'ocean_glow',
]);

export function normalizeMobileSurfaceBg(raw: unknown): MobileSurfaceBg {
  return typeof raw === 'string' && VALID_SURFACE_BGS.has(raw as MobileSurfaceBg)
    ? (raw as MobileSurfaceBg)
    : 'mist';
}

export function normalizeMobileMotion(raw: unknown): MobileMotionMode {
  return raw === 'none' ? 'none' : raw === 'snappy' ? 'snappy' : 'smooth';
}

export function canAnimateMobileOverlayExit(
  isCapture: boolean,
  motionMode: MobileMotionMode,
  staticOverlay?: boolean,
): boolean {
  return (
    !staticOverlay &&
    !isCapture &&
    motionMode !== 'none' &&
    typeof window !== 'undefined' &&
    typeof Element !== 'undefined' &&
    typeof Element.prototype.getAnimations === 'function' &&
    !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

export const MobileAppearanceOverrideContext = createContext<MobileAppearance | null>(null);
export const MobileScreenPortalContext = createContext<HTMLDivElement | null>(null);
export const MobileMotionContext = createContext<MobileMotionMode>('smooth');
export const MobileOverlayExitContext = createContext<(() => void) | null>(null);

const ROW_CONTEXT_REQUIRED_CALLS = new Set(['deleteRow', 'updateRow', 'selectRow']);

export function actionChainRequiresBoundRow(chain: PropValue | undefined): boolean {
  if (!isActionChain(chain)) return false;
  return chain.calls.some(
    (c) =>
      ROW_CONTEXT_REQUIRED_CALLS.has(c.name) ||
      (c.name === 'navigate' && c.args.length >= 2 && c.args[1] !== undefined),
  );
}

export function isolatedStaticItemScope(
  scope: CompProps['scope'],
  staticRecord: Row | undefined,
): CompProps['scope'] {
  const cleanParams = { ...(scope.params ?? {}) };
  delete cleanParams.row;
  delete cleanParams.tableId;
  return {
    ...scope,
    staticItem: staticRecord,
    isolatePageRow: true,
    row: undefined,
    tableId: undefined,
    expectedTableId: undefined,
    params: cleanParams,
  };
}

export type ParsedProgressValue =
  | { kind: 'valid'; pct: number }
  | { kind: 'missing' }
  | { kind: 'invalid' };

export function parseProgressMetric(raw: unknown): ParsedProgressValue {
  if (raw === null || raw === undefined) return { kind: 'missing' };
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { kind: 'valid', pct: Math.max(0, Math.min(100, raw)) }
      : { kind: 'invalid' };
  }
  const str = String(raw).trim();
  if (!str) return { kind: 'missing' };
  const cleaned = str.endsWith('%') ? str.slice(0, -1).trim() : str;
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return { kind: 'invalid' };
  const num = Number(cleaned);
  return Number.isFinite(num)
    ? { kind: 'valid', pct: Math.max(0, Math.min(100, num)) }
    : { kind: 'invalid' };
}

export const SplitMetricText: React.FC<{
  value: string | number;
  splitDecimal?: boolean;
  className?: string;
  decimalClassName?: string;
}> = ({ value, splitDecimal = true, className, decimalClassName }) => {
  const raw = String(value ?? '');
  if (!splitDecimal) {
    return <span className={cx('tabular-nums', className)}>{raw}</span>;
  }
  const match = raw.match(/^(.*?\d)(\.\d+)(.*)$/);
  if (!match) {
    return <span className={cx('tabular-nums', className)}>{raw}</span>;
  }
  const [, whole, decimal, suffix] = match;
  return (
    <span className={cx('tabular-nums', className)} data-split-metric="1">
      <span>{whole}</span>
      <span
        data-metric-decimal="1"
        className={cx('text-[0.64em] font-semibold opacity-55', decimalClassName)}
      >
        {decimal}
      </span>
      {suffix ? <span className="text-[0.68em] font-semibold opacity-75 ml-0.5">{suffix}</span> : null}
    </span>
  );
};

export function interactiveBoxProps(enabled: boolean, onActivate: () => void) {
  if (!enabled) return {};
  return {
    role: 'button' as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onActivate();
      } else if (e.key === ' ') {
        e.preventDefault();
      }
    },
    onKeyUp: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

export function resolveMobileAppearance(
  rawAppearance: unknown,
  workspaceTheme: 'light' | 'dark',
  previewOverride?: MobileAppearance | null,
  rawSurfaceBg?: unknown,
): MobileAppearance {
  if (previewOverride === 'light' || previewOverride === 'dark') return previewOverride;
  if (rawAppearance === 'dark') return 'dark';
  if (rawAppearance === 'light') return 'light';
  if (rawSurfaceBg === 'oled_carbon' || rawSurfaceBg === 'ocean_glow') return 'dark';
  return workspaceTheme === 'dark' ? 'dark' : 'light';
}

export interface MobileTheme {
  appearance: MobileAppearance;
  accent: MobileAccent;
  surfaceBg: MobileSurfaceBg;
  isDark: boolean;
  elevated: boolean;
  pageBg: string;
  cardBg: string;
  subtleBg: string;
  inputBg: string;
  placeholderCls: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  dangerText: string;
  glassBg: string;
  pillActiveSurface: string;
  pillActiveBg: string;
  pillActiveText: string;
  accentSolidBg: string;
  accentSoftBg: string;
  accentText: string;
}

const ACCENT_MAP: Record<
  MobileAccent,
  {
    solidLight: string;
    solidDark: string;
    softBgLight: string;
    softTextLight: string;
    softBgDark: string;
    softTextDark: string;
    textLight: string;
    textDark: string;
  }
> = {
  gemini: {
    solidLight: 'bg-[#1A73E8] text-white',
    solidDark: 'bg-[#8AB4F8] text-[#062E6F]',
    softBgLight: 'bg-[#D3E3FD]',
    softTextLight: 'text-[#041E49]',
    softBgDark: 'bg-[#1B3A6B] ring-1 ring-inset ring-[#8AB4F8]/25',
    softTextDark: 'text-[#D3E3FD]',
    textLight: 'text-[#1A73E8]',
    textDark: 'text-[#8AB4F8]',
  },
  blue: {
    solidLight: 'bg-blue-600 text-white',
    solidDark: 'bg-blue-500 text-white',
    softBgLight: 'bg-blue-100/90',
    softTextLight: 'text-blue-900',
    softBgDark: 'bg-blue-500/20 ring-1 ring-inset ring-blue-400/25',
    softTextDark: 'text-blue-200',
    textLight: 'text-blue-600',
    textDark: 'text-blue-400',
  },
  violet: {
    solidLight: 'bg-violet-600 text-white',
    solidDark: 'bg-violet-500 text-white',
    softBgLight: 'bg-violet-100/90',
    softTextLight: 'text-violet-900',
    softBgDark: 'bg-violet-500/20 ring-1 ring-inset ring-violet-400/25',
    softTextDark: 'text-violet-200',
    textLight: 'text-violet-600',
    textDark: 'text-violet-300',
  },
  emerald: {
    solidLight: 'bg-emerald-600 text-white',
    solidDark: 'bg-emerald-400 text-slate-950',
    softBgLight: 'bg-emerald-100/90',
    softTextLight: 'text-emerald-900',
    softBgDark: 'bg-emerald-500/20 ring-1 ring-inset ring-emerald-400/25',
    softTextDark: 'text-emerald-200',
    textLight: 'text-emerald-600',
    textDark: 'text-emerald-300',
  },
  amber: {
    solidLight: 'bg-amber-500 text-slate-950',
    solidDark: 'bg-amber-400 text-slate-950',
    softBgLight: 'bg-amber-100/90',
    softTextLight: 'text-amber-950',
    softBgDark: 'bg-amber-500/20 ring-1 ring-inset ring-amber-400/25',
    softTextDark: 'text-amber-200',
    textLight: 'text-amber-600',
    textDark: 'text-amber-300',
  },
  rose: {
    solidLight: 'bg-rose-600 text-white',
    solidDark: 'bg-rose-500 text-white',
    softBgLight: 'bg-rose-100/90',
    softTextLight: 'text-rose-900',
    softBgDark: 'bg-rose-500/20 ring-1 ring-inset ring-rose-400/25',
    softTextDark: 'text-rose-200',
    textLight: 'text-rose-600',
    textDark: 'text-rose-300',
  },
  obsidian: {
    solidLight: 'bg-[#111315] text-white',
    solidDark: 'bg-[#F4F5F6] text-[#111315]',
    softBgLight: 'bg-[#E5E7EB]',
    softTextLight: 'text-[#111315]',
    softBgDark: 'bg-white/14 ring-1 ring-inset ring-white/20',
    softTextDark: 'text-[#F4F5F6]',
    textLight: 'text-[#111315]',
    textDark: 'text-[#F4F5F6]',
  },
  lime_forest: {
    solidLight: 'bg-[#143021] text-[#D9F99D]',
    solidDark: 'bg-[#A3E635] text-[#0B1911]',
    softBgLight: 'bg-[#E2F0DC]',
    softTextLight: 'text-[#122B1D]',
    softBgDark: 'bg-[#1A3525] ring-1 ring-inset ring-[#A3E635]/30',
    softTextDark: 'text-[#D9F99D]',
    textLight: 'text-[#164E32]',
    textDark: 'text-[#A3E635]',
  },
};

function createMobileTheme(
  appearance: MobileAppearance = 'light',
  accent: MobileAccent = 'gemini',
  surfaceBg: MobileSurfaceBg = 'mist',
  elevated = false,
): MobileTheme {
  const isDark = appearance === 'dark';
  const ac = ACCENT_MAP[accent] ?? ACCENT_MAP.gemini;
  const softSurface = isDark ? ac.softBgDark : ac.softBgLight;
  const softText = isDark ? ac.softTextDark : ac.softTextLight;

  const pageBg = isDark
    ? surfaceBg === 'ocean_glow'
      ? 'pf-mobile-surface-ocean bg-[#08111E] text-[#F1F5F9]'
      : surfaceBg === 'oled_carbon'
      ? 'pf-mobile-surface-oled bg-[#0B0C0E] text-[#F3F4F6]'
      : surfaceBg === 'pure'
      ? 'bg-[#0E0E0F] text-[#E3E3E3]'
      : 'bg-[#131314] text-[#E3E3E3]'
    : surfaceBg === 'warm_paper'
    ? 'pf-mobile-surface-warm bg-[#F8F5F0] text-[#1C1917]'
    : surfaceBg === 'sage_field'
    ? 'pf-mobile-surface-sage bg-[#EEF2EB] text-[#132018]'
    : surfaceBg === 'pure'
    ? 'bg-white text-[#1F1F1F]'
    : 'bg-[#F0F4F9] text-[#1F1F1F]';

  const cardBg = isDark
    ? elevated
      ? surfaceBg === 'ocean_glow'
        ? 'bg-[#182840] ring-1 ring-inset ring-sky-300/[0.12]'
        : 'bg-[#282A2E] ring-1 ring-inset ring-white/[0.07]'
      : surfaceBg === 'ocean_glow'
      ? 'bg-[#101C2E]/92 ring-1 ring-inset ring-sky-300/[0.12] shadow-[0_10px_28px_-10px_rgba(2,6,23,0.8)]'
      : surfaceBg === 'oled_carbon'
      ? 'bg-[#16181D] ring-1 ring-inset ring-white/[0.08] shadow-[0_10px_28px_-10px_rgba(0,0,0,0.75)]'
      : surfaceBg === 'pure'
      ? 'bg-[#1A1B1E] ring-1 ring-inset ring-white/[0.07]'
      : 'bg-[#1E1F20] ring-1 ring-inset ring-white/[0.06] shadow-[0_6px_22px_-8px_rgba(0,0,0,0.55)]'
    : elevated
    ? 'bg-white ring-1 ring-inset ring-slate-200/75 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.04)]'
    : surfaceBg === 'warm_paper'
    ? 'bg-white shadow-[0_4px_18px_-6px_rgba(28,25,23,0.06)] ring-1 ring-inset ring-stone-900/[0.04]'
    : surfaceBg === 'sage_field'
    ? 'bg-white shadow-[0_4px_18px_-6px_rgba(16,40,24,0.06)] ring-1 ring-inset ring-emerald-950/[0.04]'
    : surfaceBg === 'pure'
    ? 'bg-[#F4F7FC]'
    : 'bg-white shadow-[0_2px_14px_-4px_rgba(15,23,42,0.05)]';

  const subtleBg = isDark
    ? surfaceBg === 'ocean_glow'
      ? elevated
        ? 'bg-[#203350]'
        : 'bg-[#17263C]'
      : surfaceBg === 'oled_carbon'
      ? elevated
        ? 'bg-[#282C35]'
        : 'bg-[#20232A]'
      : elevated
      ? 'bg-[#32353B]'
      : 'bg-[#282A2E]'
    : surfaceBg === 'warm_paper'
    ? 'bg-[#EDE8E0]/90'
    : surfaceBg === 'sage_field'
    ? 'bg-[#E1E8DC]/90'
    : 'bg-[#E6ECF5]/85';

  const inputBg = isDark
    ? surfaceBg === 'ocean_glow'
      ? 'bg-[#16243A] text-[#F1F5F9] ring-1 ring-inset ring-sky-300/[0.12]'
      : elevated
      ? 'bg-[#34373D] text-[#E3E3E3] ring-1 ring-inset ring-white/[0.08]'
      : 'bg-[#282B30] text-[#E3E3E3] ring-1 ring-inset ring-white/[0.07]'
    : elevated
    ? 'bg-[#EEF3FA] text-[#1F1F1F]'
    : surfaceBg === 'warm_paper'
    ? 'bg-[#EFEAE2] text-[#1C1917]'
    : surfaceBg === 'sage_field'
    ? 'bg-[#E4EBE0] text-[#132018]'
    : 'bg-[#E9EEF6] text-[#1F1F1F]';

  const glassBg = isDark
    ? surfaceBg === 'ocean_glow'
      ? 'bg-[#0E1929]/88 backdrop-blur-xl'
      : 'bg-[#1B1C20]/90 backdrop-blur-xl'
    : surfaceBg === 'warm_paper'
    ? 'bg-[#FAF8F5]/90 backdrop-blur-xl shadow-[0_8px_30px_-8px_rgba(28,25,23,0.12)]'
    : surfaceBg === 'sage_field'
    ? 'bg-[#F5F8F3]/90 backdrop-blur-xl shadow-[0_8px_30px_-8px_rgba(16,40,24,0.12)]'
    : 'bg-white/88 backdrop-blur-xl shadow-[0_8px_30px_-8px_rgba(15,23,42,0.12)]';

  return {
    appearance,
    accent,
    surfaceBg,
    isDark,
    elevated,
    pageBg,
    cardBg,
    subtleBg,
    inputBg,
    placeholderCls: isDark ? 'placeholder:text-[#8E918F]' : 'placeholder:text-[#747775]',
    textPrimary: isDark
      ? surfaceBg === 'ocean_glow'
        ? 'text-[#F1F5F9]'
        : 'text-[#E3E3E3]'
      : surfaceBg === 'warm_paper'
      ? 'text-[#1C1917]'
      : surfaceBg === 'sage_field'
      ? 'text-[#132018]'
      : 'text-[#1F1F1F]',
    textSecondary: isDark ? 'text-[#C4C7C5]' : 'text-[#444746]',
    textMuted: isDark ? 'text-[#9AA0A6]' : 'text-[#6E7270]',
    dangerText: isDark ? 'text-rose-400' : 'text-rose-600',
    glassBg,
    pillActiveSurface: softSurface,
    pillActiveBg: `${softSurface} ${softText}`,
    pillActiveText: softText,
    accentSolidBg: isDark ? ac.solidDark : ac.solidLight,
    accentSoftBg: `${softSurface} ${softText}`,
    accentText: isDark ? ac.textDark : ac.textLight,
  };
}

const DEFAULT_MOBILE_THEME = createMobileTheme('light', 'gemini', 'mist', false);
export const MobileThemeContext = createContext<MobileTheme | null>(null);
export function useMobileTheme(): MobileTheme {
  return useContext(MobileThemeContext) ?? DEFAULT_MOBILE_THEME;
}

export function MobilePageTheme({
  appearance,
  accent,
  surfaceBg,
  elevated = false,
  children,
}: {
  appearance: MobileAppearance;
  accent?: unknown;
  surfaceBg?: unknown;
  elevated?: boolean;
  children: React.ReactNode;
}) {
  const theme = useMemo(
    () =>
      createMobileTheme(
        appearance,
        typeof accent === 'string' && Object.hasOwn(ACCENT_MAP, accent) ? (accent as MobileAccent) : 'gemini',
        normalizeMobileSurfaceBg(surfaceBg),
        elevated,
      ),
    [appearance, accent, surfaceBg, elevated],
  );
  return <MobileThemeContext.Provider value={theme}>{children}</MobileThemeContext.Provider>;
}
const MobileFormIdContext = createContext<string | null>(null);
const MobileFormTableContext = createContext<string | undefined>(undefined);

const MOBILE_ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  Home,
  Layers,
  User,
  Compass,
  Zap,
  TrendingUp,
  Bell,
  Bookmark,
  Shield,
  ShoppingBag,
  Star,
  Clock,
  Wallet,
  FileText,
  ScanLine,
  Camera,
  Search,
  Plus,
};

function resolveMobileIcon(name?: string, fallback: LucideIcon = Sparkles): LucideIcon {
  if (!name) return fallback;
  const normalized = name.trim();
  if (MOBILE_ICON_MAP[normalized]) return MOBILE_ICON_MAP[normalized];
  const lower = normalized.toLowerCase();
  const hit = Object.entries(MOBILE_ICON_MAP).find(([k]) => k.toLowerCase() === lower);
  return hit ? hit[1] : fallback;
}

function useTableDataRows(tableId?: string): Row[] {
  const { isEn } = useI18n();
  const preview = useContext(PreviewDataContext);
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const schema = useMemo(() => tables.find((t) => t.id === tableId), [tables, tableId]);
  const storeRows = usePageStore((s) => (tableId ? s.tableRows[tableId] : undefined));
  const getRows = usePageStore((s) => s.getRows);
  const suppliers = useProtoStore((s) => s.suppliers);
  const purchaseOrderItems = useProtoStore((s) => s.purchaseOrderItems);
  return useMemo(() => {
    if (!tableId) return [];
    const raw = preview ? preview.rows[tableId] ?? [] : storeRows ?? getRows(tableId);
    return applyUIStackRows(raw, schema, uiState, isEn);
  }, [tableId, preview, storeRows, getRows, suppliers, purchaseOrderItems, schema, uiState, isEn]);
}

function matchesFilter(row: Row, staticFilter: unknown, runtimeFilter?: Record<string, unknown>): boolean {
  const checkObj = (f: Record<string, unknown>) => {
    for (const [k, val] of Object.entries(f)) {
      if (val === undefined || val === null || val === '') continue;
      if (k === '__keyword') {
        const kw = String(val).toLowerCase().trim();
        if (kw && !Object.values(row).some((cell) => String(cell ?? '').toLowerCase().includes(kw))) {
          return false;
        }
        continue;
      }
      if (row[k] !== val) return false;
    }
    return true;
  };
  if (staticFilter && typeof staticFilter === 'object' && !Array.isArray(staticFilter)) {
    if (!checkObj(staticFilter as Record<string, unknown>)) return false;
  }
  if (runtimeFilter && !checkObj(runtimeFilter)) return false;
  return true;
}

// ───────────────────────── 1. Layout Containers ─────────────────────────

const MobilePage: React.FC<CompProps> = ({ p, kids, children, root, rt, renderNode }) => {
  const { tr } = useI18n();
  const workspaceTheme = useResolvedTheme();
  const uiState = useUIStackState();
  const isCapture = useContext(CaptureMode);
  const previewOverride = useContext(MobileAppearanceOverrideContext);
  const surfaceBg = normalizeMobileSurfaceBg(p.surfaceBg);
  const appearance = resolveMobileAppearance(p.appearance, workspaceTheme, previewOverride, surfaceBg);
  const accent: MobileAccent =
    typeof p.accent === 'string' && Object.hasOwn(ACCENT_MAP, p.accent) ? (p.accent as MobileAccent) : 'gemini';
  const motionMode: MobileMotionMode =
    p.motion === 'none' ? 'none' : p.motion === 'snappy' ? 'snappy' : 'smooth';
  const theme = useMemo(() => createMobileTheme(appearance, accent, surfaceBg, false), [appearance, accent, surfaceBg]);

  const topNodes = kids.filter((k) => k.type === 'MTopBar');
  const rawBottomNodes = kids.filter(
    (k) =>
      k.type === 'MFloatingBar' ||
      k.type === 'MTabBar' ||
      k.type === 'MBottomDock' ||
      (k.type === 'MComposerBar' && k.props.docked !== false),
  );
  const bottomNodes = [
    ...rawBottomNodes.filter((k) => k.type === 'MFloatingBar'),
    ...rawBottomNodes.filter((k) => k.type !== 'MFloatingBar'),
  ];
  const pinnedSet = new Set<ProtoNode>([...topNodes, ...rawBottomNodes]);
  const bodyNodes = kids.filter((k) => !pinnedSet.has(k) && !OVERLAY_TYPES.has(k.type));
  const leadingAnnotation = children.length > kids.length ? children[0] : null;
  const shouldStagger = !rt.isDesign && !isCapture && motionMode !== 'none';

  const padCls =
    p.padding === 'none' ? 'px-0 py-0' : p.padding === 'compact' ? 'px-3 py-2.5' : 'px-4 py-3.5';

  return (
    <MobileMotionContext.Provider value={motionMode}>
      <MobileThemeContext.Provider value={theme}>
        <div
          {...rootWith(root, {
            className: cx(
              'pf-mobile-scope pf-mobile-page flex-[1_0_auto] flex flex-col min-h-full w-full min-w-0 relative',
              theme.pageBg,
            ),
            style: {
              containerType: 'inline-size',
              colorScheme: theme.isDark ? 'dark' : 'light',
            },
          })}
          data-mobile-appearance={appearance}
          data-surface-bg={surfaceBg}
          data-motion={motionMode}
          data-capture-mode={isCapture ? '1' : undefined}
          data-design-mode={rt.isDesign ? '1' : undefined}
        >
          {leadingAnnotation}
          {topNodes.length > 0 && (
            <div className="sticky top-0 z-20 shrink-0">{topNodes.map((n) => renderNode(n))}</div>
          )}

          <div className={cx('flex-1 flex flex-col gap-3.5 min-w-0', padCls, bottomNodes.length > 0 && 'pb-5')}>
            {uiState === 'empty' && typeof p.emptyTitle === 'string' && p.emptyTitle.trim() && (
              <UIStackEmptyBannerHint emptyTitle={p.emptyTitle.trim()} />
            )}
            {uiState === 'error' && (p.errorFallback === 'result_403' || p.errorFallback === 'result_500') ? (
              <UIStackPageErrorResult
                mobile
                mode={p.errorFallback}
                title={typeof p.errorTitle === 'string' ? p.errorTitle : undefined}
                description={typeof p.errorDescription === 'string' ? p.errorDescription : undefined}
                onRecover={() => useProtoStore.getState().setUIState('normal')}
              />
            ) : bodyNodes.length > 0 ? (
              bodyNodes.map((n, idx) =>
                shouldStagger ? (
                  <div
                    key={n.pfId}
                    className="pf-mobile-stagger-item min-w-0"
                    style={{ '--pf-stagger-idx': idx } as React.CSSProperties}
                  >
                    {renderNode(n)}
                  </div>
                ) : (
                  renderNode(n)
                ),
              )
            ) : (
              <div
                className={cx(
                  'rounded-[22px] p-7 text-center my-4 border border-dashed',
                  theme.isDark
                    ? 'border-white/15 bg-white/[0.03] text-[#9AA0A6]'
                    : 'border-slate-300/80 bg-white/60 text-slate-400',
                )}
              >
                <Sparkles className="w-6 h-6 mx-auto mb-2 opacity-60" aria-hidden="true" />
                <div className="text-[13px] font-medium">
                  {rt.isDesign
                    ? tr('从左侧拖入 Gemini 现代移动物料开始设计', 'Drop mobile materials from the left palette to start designing')
                    : tr('暂无页面内容', 'No content')}
                </div>
              </div>
            )}
          </div>

          {bottomNodes.length > 0 && (
            <div
              className="sticky bottom-0 z-20 shrink-0 mt-auto"
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
              {bottomNodes.map((n) => renderNode(n))}
            </div>
          )}
        </div>
      </MobileThemeContext.Provider>
    </MobileMotionContext.Provider>
  );
};

const MSurface: React.FC<CompProps> = ({ p, children, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const padCls = p.padding === 'sm' ? 'p-3' : p.padding === 'lg' ? 'p-5' : 'p-4';
  const tone = (p.tone as string) || 'card';
  const isInverted = tone === 'inverted';

  const surfaceCls = isInverted
    ? 'pf-mobile-wallet-mesh text-[#F4F5F6] ring-1 ring-inset ring-white/10 shadow-[0_14px_30px_-10px_rgba(0,0,0,0.45)]'
    : tone === 'subtle'
    ? cx(theme.subtleBg, theme.textPrimary)
    : tone === 'accent'
    ? theme.accentSoftBg
    : cx(theme.cardBg, theme.textPrimary);

  const bodyContent =
    children.length > 0 ? (
      isInverted ? (
        <MobilePageTheme appearance="dark" accent={theme.accent} surfaceBg="oled_carbon" elevated={true}>
          <div className="space-y-2.5">{children}</div>
        </MobilePageTheme>
      ) : (
        <div className="space-y-2.5">{children}</div>
      )
    ) : (
      rt.isDesign && (
        <div
          className={cx(
            'py-4 text-center text-[12px] rounded-2xl',
            isInverted ? 'bg-white/[0.06] text-white/60' : cx(theme.subtleBg, theme.textMuted),
          )}
        >
          {tr('拖入子组件至此卡片', 'Drop child components into this card')}
        </div>
      )
    );

  const inner = (
    <div
      className={cx(
        'rounded-[22px] space-y-3',
        surfaceCls,
        padCls,
      )}
      style={isInverted ? { colorScheme: 'dark' } : undefined}
      data-surface-tone={tone}
    >
      {(p.title || p.extra || p.subtitle) && (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {p.title && (
              <h3
                className={cx(
                  'text-[15px] font-semibold tracking-tight leading-snug',
                  isInverted ? 'text-white' : tone === 'accent' ? theme.pillActiveText : theme.textPrimary,
                )}
                style={{ textWrap: 'balance' } as React.CSSProperties}
              >
                {p.title}
              </h3>
            )}
            {p.subtitle && (
              <p className={cx('text-[12px] mt-0.5', isInverted ? 'text-white/65' : theme.textMuted)}>
                {p.subtitle}
              </p>
            )}
          </div>
          {p.extra && (
            <button
              type="button"
              onClick={() => rt.run(p.onExtraClick as PropValue, scope)}
              className={cx(
                "relative min-h-[36px] px-2.5 rounded-full text-[12px] font-medium inline-flex items-center gap-0.5 shrink-0 cursor-pointer transition hover:opacity-80 after:content-[''] after:absolute after:-inset-y-1 after:-inset-x-1",
                isInverted ? 'text-white/85' : theme.accentText,
              )}
            >
              <span>{p.extra}</span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {bodyContent}
    </div>
  );

  if (tone === 'glow') {
    return (
      <div
        {...rootWith(root, {
          className: cx(
            'p-[1.5px] rounded-[23.5px]',
            theme.isDark
              ? 'bg-gradient-to-br from-[#8AB4F8]/80 via-[#C58AF9]/75 to-[#F28B82]/80'
              : 'bg-gradient-to-br from-[#4285F4]/70 via-[#9B72CB]/65 to-[#D96570]/70',
          ),
        })}
      >
        {inner}
      </div>
    );
  }

  return <div {...rootWith(root, {})}>{inner}</div>;
};

const BENTO_TONES_LIGHT: Record<string, string> = {
  card: 'bg-white text-[#1F1F1F] shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]',
  blue: 'bg-[#E8F0FE] text-[#041E49]',
  violet: 'bg-[#F3E8FD] text-[#3B0764]',
  emerald: 'bg-[#E6F4EA] text-[#064E3B]',
  amber: 'bg-[#FEF7E0] text-[#78350F]',
};
const BENTO_TONES_DARK: Record<string, string> = {
  card: 'bg-[#1E1F20] text-[#E3E3E3] ring-1 ring-inset ring-white/[0.06]',
  blue: 'bg-[#152847] text-[#D3E3FD] ring-1 ring-inset ring-[#8AB4F8]/20',
  violet: 'bg-[#26183A] text-[#E9D5FF] ring-1 ring-inset ring-[#C58AF9]/20',
  emerald: 'bg-[#102C22] text-[#A7F3D0] ring-1 ring-inset ring-[#34D399]/20',
  amber: 'bg-[#30230E] text-[#FDE68A] ring-1 ring-inset ring-[#FBBF24]/20',
};

const MBentoGrid: React.FC<CompProps> = ({ p, children, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const cols = Math.max(1, Math.min(3, Number(p.cols ?? 2)));
  const gridCls = cols === 1 ? 'grid-cols-1' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2';
  const items = (Array.isArray(p.items) ? p.items : []) as {
    title?: string;
    subtitle?: string;
    icon?: string;
    badge?: string;
    tone?: string;
    onClick?: PropValue;
  }[];

  return (
    <div {...rootWith(root, { className: cx('grid gap-2.5', gridCls) })}>
      {items.map((item, idx) => {
        const Icon = resolveMobileIcon(item.icon, Sparkles);
        const featured = p.layout === 'featured' && idx === 0 && cols >= 2;
        const toneKey = item.tone || 'card';
        const palette = theme.isDark
          ? BENTO_TONES_DARK[toneKey] ?? BENTO_TONES_DARK.card
          : BENTO_TONES_LIGHT[toneKey] ?? BENTO_TONES_LIGHT.card;
        return (
          <button
            key={idx}
            type="button"
            onClick={() => {
              if (item.onClick) void rt.run(item.onClick, scope);
              else void rt.run(p.onItemClick as PropValue, { ...scope, params: { ...scope.params, index: idx, title: item.title } });
            }}
            className={cx(
              'text-left rounded-[22px] p-4 flex flex-col justify-between gap-3 min-h-[108px] cursor-pointer transition-transform active:scale-[0.98]',
              palette,
              featured && 'col-span-2 min-h-[120px]',
            )}
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span
                className={cx(
                  'w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0',
                  theme.isDark ? 'bg-white/12' : 'bg-black/[0.05]',
                )}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
              </span>
              {item.badge && (
                <span
                  className={cx(
                    'px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide',
                    theme.isDark ? 'bg-white/14' : 'bg-black/[0.07]',
                  )}
                >
                  {item.badge}
                </span>
              )}
            </div>
            <div className="space-y-0.5 min-w-0 w-full">
              <div className="text-[14px] font-semibold leading-snug truncate">{item.title || tr(`模块 ${idx + 1}`, `Tile ${idx + 1}`)}</div>
              {item.subtitle && (
                <div className="text-[11.5px] opacity-80 leading-snug line-clamp-2">{item.subtitle}</div>
              )}
            </div>
          </button>
        );
      })}
      {children}
    </div>
  );
};

const MScrollRow: React.FC<CompProps> = ({ p, children, root, rt }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const gap = Math.max(4, Number(p.gap ?? 12));
  const peek = p.peek !== false;
  return (
    <div {...rootWith(root, { className: 'space-y-2' })}>
      {p.title && (
        <div className={cx('text-[14px] font-semibold px-0.5', theme.textPrimary)}>{p.title}</div>
      )}
      {children.length > 0 ? (
        <div
          className="flex overflow-x-auto pb-1 no-scrollbar"
          style={{
            gap,
            scrollSnapType: 'x proximity',
            touchAction: 'pan-x pan-y',
          }}
        >
          {children.map((child, idx) => (
            <div
              key={idx}
              className="shrink-0"
              style={{
                width: peek ? '78%' : '100%',
                scrollSnapAlign: 'start',
              }}
            >
              {child}
            </div>
          ))}
        </div>
      ) : (
        rt.isDesign && (
          <div
            className={cx(
              'rounded-[20px] py-5 px-4 text-center text-[12px] border border-dashed',
              theme.isDark ? 'border-white/15 bg-white/[0.03]' : 'border-slate-300/80 bg-white/60',
              theme.textMuted,
            )}
          >
            {tr('拖入横向卡片或指标组件至此横滑容器', 'Drop cards or metrics into this horizontal row')}
          </div>
        )
      )}
    </div>
  );
};

// ───────────────────────── 2. Glass Navigation ─────────────────────────

const MTopBar: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const leftMode = (p.leftMode as string) || 'back';
  const rightIcon = (p.rightIcon as string) || 'avatar';

  const RightLucide =
    rightIcon === 'bell'
      ? Bell
      : rightIcon === 'more'
      ? MoreHorizontal
      : rightIcon === 'plus'
      ? Plus
      : rightIcon === 'scan'
      ? ScanLine
      : null;

  return (
    <header
      {...rootWith(root, {
        className: cx(
          'px-3 py-1.5 min-h-[52px] flex items-center justify-between gap-2',
          theme.textPrimary,
          p.transparent
            ? 'bg-transparent'
            : cx(theme.glassBg, theme.isDark && 'border-b border-white/[0.06]'),
        ),
      })}
    >
      <div className="w-11 flex items-center justify-start shrink-0">
        {leftMode !== 'none' && (
          <button
            type="button"
            aria-label={leftMode === 'back' ? tr('返回', 'Back') : leftMode === 'menu' ? tr('打开导航菜单', 'Open menu') : tr('智能助手', 'Assistant')}
            onClick={() => rt.run(p.onLeftClick as PropValue, scope)}
            className={cx(
              'w-11 h-11 rounded-full inline-flex items-center justify-center cursor-pointer transition-transform active:scale-95',
              theme.textPrimary,
              theme.isDark ? 'hover:bg-white/10' : 'hover:bg-black/[0.05]',
            )}
          >
            {leftMode === 'back' && <ArrowLeft className="w-5 h-5" aria-hidden="true" />}
            {leftMode === 'menu' && <Menu className="w-5 h-5" aria-hidden="true" />}
            {leftMode === 'sparkle' && (
              <Sparkles
                className={cx('w-5 h-5', theme.isDark ? 'text-[#8AB4F8]' : 'text-[#4285F4]')}
                aria-hidden="true"
              />
            )}
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1 flex flex-col items-center text-center">
        <button
          type="button"
          onClick={() => rt.run(p.onTitleClick as PropValue, scope)}
          className={cx(
            'inline-flex items-center gap-1 px-3 py-1 rounded-full max-w-full cursor-pointer transition',
            p.titleDropdown && (theme.isDark ? 'bg-white/[0.08]' : 'bg-black/[0.04]'),
          )}
        >
          <span className={cx('text-[15.5px] font-semibold tracking-tight truncate', theme.textPrimary)}>
            {p.title || tr('页面标题', 'Page Title')}
          </span>
          {p.titleDropdown && <ChevronDown className={cx('w-4 h-4 shrink-0', theme.textMuted)} aria-hidden="true" />}
        </button>
        {p.subtitle && <span className={cx('text-[11px] truncate max-w-full', theme.textMuted)}>{p.subtitle}</span>}
      </div>

      <div className="w-11 flex items-center justify-end shrink-0">
        {rightIcon === 'avatar' && (
          <button
            type="button"
            aria-label={tr('个人账户', 'Account')}
            onClick={() => rt.run(p.onRightClick as PropValue, scope)}
            className="w-11 h-11 inline-flex items-center justify-center cursor-pointer"
          >
            <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white text-[12px] font-bold inline-flex items-center justify-center shadow-xs">
              A
            </span>
          </button>
        )}
        {RightLucide && (
          <button
            type="button"
            aria-label={tr('顶部操作', 'Top action')}
            onClick={() => rt.run(p.onRightClick as PropValue, scope)}
            className={cx(
              'w-11 h-11 rounded-full inline-flex items-center justify-center cursor-pointer transition-transform active:scale-95',
              theme.textPrimary,
              theme.isDark ? 'hover:bg-white/10' : 'hover:bg-black/[0.05]',
            )}
          >
            <RightLucide className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
};

const MTabBar: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { isEn, tr } = useI18n();
  const theme = useMobileTheme();
  const [localActive, setLocalActive] = useState<string | null>(null);
  useEffect(() => {
    setLocalActive(null);
  }, [p.activeKey]);

  const items = (Array.isArray(p.items) && p.items.length
    ? p.items
    : isEn
    ? [
        { key: 'home', title: 'Explore', icon: 'Sparkles' },
        { key: 'tasks', title: 'Tasks', icon: 'Layers' },
        { key: 'mine', title: 'Profile', icon: 'User' },
      ]
    : [
        { key: 'home', title: '探索', icon: 'Sparkles' },
        { key: 'tasks', title: '待办', icon: 'Layers' },
        { key: 'mine', title: '我的', icon: 'User' },
      ]) as {
    key?: string;
    title?: string;
    icon?: string;
    badge?: string;
    page?: string;
    onClick?: PropValue;
  }[];

  const activeKey = localActive ?? ((p.activeKey as string) || items[0]?.key || '0');
  const floating = p.variant !== 'docked';
  const avatarText = typeof p.avatarText === 'string' ? p.avatarText.trim() : '';
  const avatarImage = typeof p.avatarImage === 'string' ? p.avatarImage.trim() : '';
  const showDetachedAvatar = floating && Boolean(avatarText || avatarImage);

  const tabIsland = (
    <div
      className={cx(
        'flex items-center justify-around',
        showDetachedAvatar && 'flex-1 min-w-0',
        theme.glassBg,
        floating
          ? cx(
              'rounded-full px-2 py-1.5',
              theme.isDark
                ? 'border border-white/12 shadow-[0_14px_34px_-6px_rgba(0,0,0,0.75)]'
                : 'border border-white/80 shadow-[0_10px_30px_-6px_rgba(15,23,42,0.14)]',
            )
          : cx('px-2 py-1.5', theme.isDark ? 'border-t border-white/10' : 'border-t border-slate-200/70'),
      )}
    >
      {items.map((it, idx) => {
        const key = it.key || String(idx);
        const isActive = key === activeKey;
        const Icon = resolveMobileIcon(it.icon, idx === 0 ? Sparkles : idx === 1 ? Layers : User);
        return (
          <button
            key={key}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              const hasConfirmGate =
                isActionChain(it.onClick) && it.onClick.calls.some((c) => c.name === 'confirm');
              const actionNavigates =
                Boolean(it.page) ||
                !it.onClick ||
                (isActionChain(it.onClick) && it.onClick.calls.some((c) => c.name === 'navigate'));
              if (!rt.isDesign && actionNavigates && !hasConfirmGate) setLocalActive(key);
              if (it.onClick) {
                void rt.run(it.onClick, scope);
              } else if (it.page) {
                void rt.run({ $kind: 'actions', calls: [{ name: 'navigate', args: [it.page] }] }, scope);
              }
            }}
            className="relative flex-1 min-h-[46px] flex flex-col items-center justify-center gap-0.5 rounded-full cursor-pointer transition-transform active:scale-[0.96]"
          >
            <span
              className={cx(
                'px-4 py-1 rounded-full inline-flex items-center justify-center relative transition-all duration-200',
                isActive ? cx(theme.pillActiveSurface, 'scale-100') : 'bg-transparent',
              )}
            >
              <Icon
                className={cx('w-[18px] h-[18px]', isActive ? theme.pillActiveText : theme.textMuted)}
                aria-hidden="true"
              />
              {it.badge && (
                <span className="absolute -top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold inline-flex items-center justify-center">
                  {it.badge}
                </span>
              )}
            </span>
            <span
              className={cx(
                'text-[11px] leading-tight truncate max-w-full px-1',
                isActive ? cx('font-semibold', theme.textPrimary) : theme.textMuted,
              )}
            >
              {it.title || tr(`导航${idx + 1}`, `Tab ${idx + 1}`)}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <nav
      aria-label={tr('底部主导航', 'Bottom navigation')}
      {...rootWith(root, {
        className: cx(
          floating ? 'px-4 pb-2 pt-1' : 'w-full',
        ),
      })}
    >
      {showDetachedAvatar ? (
        <div className="flex items-center gap-2.5" data-tabbar-layout="split-avatar">
          {tabIsland}
          <button
            type="button"
            aria-label={tr('个人中心', 'Profile')}
            onClick={() => void rt.run(p.onAvatarClick as PropValue, scope)}
            className={cx(
              'w-[54px] h-[54px] rounded-full shrink-0 inline-flex items-center justify-center overflow-hidden cursor-pointer transition-transform active:scale-95',
              theme.glassBg,
              theme.isDark
                ? 'border border-white/14 shadow-[0_14px_34px_-6px_rgba(0,0,0,0.75)]'
                : 'border border-white/85 shadow-[0_10px_30px_-6px_rgba(15,23,42,0.16)]',
            )}
          >
            {avatarImage ? (
              <img src={avatarImage} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className={cx('w-10 h-10 rounded-full inline-flex items-center justify-center text-[13px] font-bold', theme.accentSolidBg)}>
                {avatarText.slice(0, 2)}
              </span>
            )}
          </button>
        </div>
      ) : (
        tabIsland
      )}
    </nav>
  );
};

const MPillTabs: React.FC<CompProps> = ({ node, p, kids, root, rt, renderNode }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const tabIdPrefix = useId();
  const activeIdx = rt.tabs[node.pfId] ?? 0;
  const variant = (p.variant as string) || 'pill';

  const tabKids = kids.filter((k) => k.type === 'MTab');
  const itemList = (Array.isArray(p.items) ? p.items : []) as {
    title?: string;
    value?: string;
    badge?: string;
  }[];

  const entries =
    tabKids.length > 0
      ? tabKids.map((k, idx) => ({
          label: String(k.props.title ?? tr(`页签 ${idx + 1}`, `Tab ${idx + 1}`)),
          badge: k.props.badge !== undefined ? String(k.props.badge) : undefined,
          value: '',
        }))
      : itemList.map((it, idx) => ({
          label: it.title || tr(`选项 ${idx + 1}`, `Option ${idx + 1}`),
          badge: it.badge,
          value: it.value ?? '',
        }));

  const selectIndex = (idx: number) => rt.setTab(node.pfId, idx);

  return (
    <div {...rootWith(root, { className: 'space-y-3' })}>
      <div
        role="tablist"
        aria-label={tr('内容分类切换', 'Category tabs')}
        className={cx(
          'flex items-center overflow-x-auto no-scrollbar',
          variant === 'segmented'
            ? cx('p-1 rounded-full', theme.subtleBg)
            : 'gap-2 pb-0.5',
        )}
        style={{ scrollSnapType: 'inline proximity', touchAction: 'manipulation' }}
      >
        {entries.map((entry, idx) => {
          const selected = idx === activeIdx;
          return (
            <button
              key={idx}
              id={`${tabIdPrefix}-tab-${idx}`}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectIndex(idx)}
              style={{ scrollSnapAlign: 'start' }}
              className={cx(
                "relative shrink-0 min-h-[40px] px-4 rounded-full text-[13px] font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition after:content-[''] after:absolute after:-inset-y-1 after:inset-x-0",
                variant === 'segmented' && 'flex-1',
                variant === 'underline'
                  ? cx(
                      'rounded-none px-3',
                      selected
                        ? cx(theme.textPrimary, 'font-semibold after:content-[""] after:absolute after:inset-x-2 after:bottom-0 after:border-b-[2.5px] after:border-current')
                        : theme.textMuted,
                    )
                  : selected
                  ? variant === 'segmented'
                    ? cx(theme.cardBg, theme.textPrimary, 'font-semibold')
                    : cx(theme.pillActiveBg, 'font-semibold')
                  : cx(
                      variant === 'segmented' ? 'bg-transparent' : theme.subtleBg,
                      theme.textSecondary,
                    ),
              )}
            >
              <span>{entry.label}</span>
              {entry.badge && (
                <span
                  className={cx(
                    'px-1.5 py-0.2 rounded-full text-[10.5px] font-semibold',
                    selected
                      ? theme.isDark
                        ? 'bg-white/15'
                        : 'bg-black/[0.08]'
                      : theme.isDark
                      ? 'bg-white/10'
                      : 'bg-black/[0.06]',
                  )}
                >
                  {entry.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tabKids.length > 0 && (
        <div>
          {tabKids.map((tabNode, idx) => (
            <div
              key={tabNode.pfId}
              role="tabpanel"
              aria-labelledby={`${tabIdPrefix}-tab-${idx}`}
              hidden={idx !== activeIdx}
            >
              {idx === activeIdx && <div className="space-y-3">{renderNode(tabNode)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const MTab: React.FC<CompProps> = ({ children, root }) => (
  <div {...rootWith(root, { className: 'space-y-3' })}>{children}</div>
);

const MSearchPill: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const [kw, setKw] = useState('');

  const handleChange = (val: string) => {
    setKw(val);
    if (typeof p.target === 'string' && p.target) {
      const prev = rt.filters[p.target] ?? {};
      rt.setFilter(p.target, { ...prev, __keyword: val });
    }
  };

  return (
    <search {...rootWith(root, { className: 'flex items-center gap-2' })}>
      <div
        className={cx(
          'flex-1 min-h-[46px] pl-4 pr-2.5 rounded-full flex items-center gap-2 transition focus-within:ring-2 focus-within:ring-[#8AB4F8]/45',
          theme.inputBg,
        )}
      >
        <Search className={cx('w-4 h-4 shrink-0', theme.textMuted)} aria-hidden="true" />
        <input
          type="search"
          aria-label={(p.placeholder as string) || tr('搜索关键词', 'Search keywords')}
          value={kw}
          readOnly={rt.isDesign}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={(p.placeholder as string) || tr('搜索...', 'Search...')}
          className={cx(
            'flex-1 min-w-0 bg-transparent text-[13.5px] focus:outline-none',
            theme.textPrimary,
            theme.placeholderCls,
          )}
        />
        {kw && !rt.isDesign && (
          <button
            type="button"
            aria-label={tr('清空搜索', 'Clear search')}
            onClick={() => handleChange('')}
            className={cx(
              "relative w-9 h-9 rounded-full inline-flex items-center justify-center opacity-80 hover:opacity-100 cursor-pointer shrink-0 after:content-[''] after:absolute after:-inset-1",
              theme.textSecondary,
            )}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
        {p.showVoice && (
          <button
            type="button"
            aria-label={tr('语音搜索', 'Voice search')}
            onClick={() => {
              if (p.onVoiceClick) {
                void rt.run(p.onVoiceClick as PropValue, scope);
              } else if (!rt.isDesign) {
                void rt.run({ $kind: 'actions', calls: [{ name: 'toast', args: [tr('请说出搜索关键词', 'Speak your search query'), 'info'] }] }, scope);
              }
            }}
            className={cx(
              "relative w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer transition hover:opacity-85 after:content-[''] after:absolute after:-inset-1",
              theme.textMuted,
            )}
          >
            <Mic className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {p.showFilter && (
        <button
          type="button"
          aria-label={tr('打开筛选条件', 'Open filters')}
          onClick={() => {
            if (typeof p.filterOverlay === 'string' && p.filterOverlay) {
              void rt.run({ $kind: 'actions', calls: [{ name: 'openDrawer', args: [p.filterOverlay] }] }, scope);
            } else {
              void rt.run(p.onFilterClick as PropValue, scope);
            }
          }}
          className={cx(
            'w-[46px] h-[46px] rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer transition-transform active:scale-95',
            theme.inputBg,
          )}
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </search>
  );
};

// ───────────────────────── 3. Content, Business & AI Display ─────────────────────────

const MHeroHeader: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const mode = (p.mode as string) || 'greeting';
  const splitDec = p.splitDecimal !== false;

  if (mode === 'wallet') {
    const rawValue = p.value !== undefined && p.value !== null ? String(p.value).trim() : '';
    const hasValue = rawValue.length > 0;
    return (
      <div
        {...rootWith(root, {
          className:
            'pf-mobile-wallet-mesh rounded-[26px] p-5 text-[#F8FAFC] space-y-4 ring-1 ring-inset ring-white/12 shadow-[0_18px_38px_-12px_rgba(15,23,42,0.48)]',
          style: { colorScheme: 'dark' },
        })}
        data-hero-mode="wallet"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white/70">
            <Wallet className="w-3.5 h-3.5 text-white/80" aria-hidden="true" />
            <span>{p.eyebrow || p.title || tr('总资产估值', 'Available Balance')}</span>
          </span>
          {Boolean(p.accountMask) && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/10 ring-1 ring-inset ring-white/15 text-[11px] font-mono tracking-wider text-white/90">
              {String(p.accountMask)}
            </span>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            {hasValue ? (
              <SplitMetricText
                value={rawValue}
                splitDecimal={splitDec}
                className="text-[34px] font-bold tracking-tight leading-none text-white"
              />
            ) : (
              <span
                data-missing-value="1"
                className="text-[32px] font-semibold tracking-tight leading-none text-white/45 tabular-nums"
              >
                —
              </span>
            )}
            {Boolean(p.statusBadge) && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-400/18 text-emerald-300 ring-1 ring-inset ring-emerald-400/30 text-[11px] font-semibold">
                {String(p.statusBadge)}
              </span>
            )}
          </div>
          {hasValue && p.title && (
            <div className="text-[13px] font-medium text-white/85">{String(p.title)}</div>
          )}
          {Boolean(p.subtitle) && (
            <p className="text-[12px] text-white/65 leading-relaxed">{String(p.subtitle)}</p>
          )}
        </div>

        {(Boolean(p.actionText) || Boolean(p.secondaryActionText)) && (
          <div className="flex items-center gap-2.5 pt-0.5">
            {Boolean(p.actionText) && (
              <button
                type="button"
                onClick={() => rt.run(p.onAction as PropValue, scope)}
                className="flex-1 min-h-[42px] px-4 rounded-full bg-white text-[#0F172A] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-transform active:scale-[0.98]"
              >
                <span>{String(p.actionText)}</span>
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            {Boolean(p.secondaryActionText) && (
              <button
                type="button"
                onClick={() => rt.run(p.onSecondaryAction as PropValue, scope)}
                className="flex-1 min-h-[42px] px-4 rounded-full bg-white/12 text-white ring-1 ring-inset ring-white/16 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-transform active:scale-[0.98]"
              >
                <span>{String(p.secondaryActionText)}</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (mode === 'metric_hero') {
    const rawValue = p.value !== undefined && p.value !== null ? String(p.value).trim() : '';
    const hasValue = rawValue.length > 0;
    return (
      <div
        {...rootWith(root, {
          className: cx('rounded-[24px] p-5 space-y-3', theme.cardBg),
        })}
        data-hero-mode="metric_hero"
      >
        <div className="flex items-center justify-between gap-2">
          {Boolean(p.eyebrow) && (
            <span className={cx('text-[12px] font-semibold tracking-wide', theme.textMuted)}>
              {String(p.eyebrow)}
            </span>
          )}
          {Boolean(p.accountMask) && (
            <span className={cx('inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold', theme.pillActiveBg)}>
              {String(p.accountMask)}
            </span>
          )}
        </div>

        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            {hasValue ? (
              <SplitMetricText
                value={rawValue}
                splitDecimal={splitDec}
                className={cx('text-[38px] font-semibold tracking-tight leading-none', theme.textPrimary)}
              />
            ) : (
              <span
                data-missing-value="1"
                className={cx('text-[36px] font-semibold tracking-tight leading-none opacity-45 tabular-nums', theme.textMuted)}
              >
                —
              </span>
            )}
            <h2
              className={cx('text-[15px] font-semibold leading-snug pt-0.5', theme.textPrimary)}
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              {p.title || tr('整体履约达成率', 'Overall Fulfillment Progress')}
            </h2>
          </div>
          {Boolean(p.statusBadge) && (
            <span
              className={cx(
                'inline-flex items-center px-3 py-1 rounded-full text-[11.5px] font-semibold',
                theme.isDark
                  ? 'bg-amber-400/16 text-amber-200 ring-1 ring-inset ring-amber-400/25'
                  : 'bg-amber-100/90 text-amber-900',
              )}
            >
              {String(p.statusBadge)}
            </span>
          )}
        </div>

        {Boolean(p.subtitle) && (
          <p className={cx('text-[12.5px] leading-relaxed', theme.textMuted)}>{String(p.subtitle)}</p>
        )}

        {(Boolean(p.actionText) || Boolean(p.secondaryActionText)) && (
          <div className="flex items-center gap-2 pt-1">
            {Boolean(p.actionText) && (
              <button
                type="button"
                onClick={() => rt.run(p.onAction as PropValue, scope)}
                className={cx(
                  'min-h-[38px] px-4 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95',
                  theme.accentSolidBg,
                )}
              >
                <span>{String(p.actionText)}</span>
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            {Boolean(p.secondaryActionText) && (
              <button
                type="button"
                onClick={() => rt.run(p.onSecondaryAction as PropValue, scope)}
                className={cx(
                  'min-h-[38px] px-4 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95',
                  theme.subtleBg,
                  theme.textPrimary,
                )}
              >
                <span>{String(p.secondaryActionText)}</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (mode === 'banner') {
    return (
      <div
        {...rootWith(root, {
          className: cx(
            'rounded-[24px] p-5 bg-gradient-to-br text-white space-y-3',
            theme.isDark
              ? 'from-[#174EA6] via-[#4C3599] to-[#8C2D6B] ring-1 ring-inset ring-white/15 shadow-[0_14px_32px_-8px_rgba(0,0,0,0.6)]'
              : 'from-[#1A73E8] via-[#6D5CE7] to-[#C850C0] shadow-[0_12px_28px_-8px_rgba(66,133,244,0.45)]',
          ),
        })}
      >
        {p.eyebrow && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-xs text-[11px] font-medium">
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            <span>{p.eyebrow}</span>
          </span>
        )}
        <div className="space-y-1">
          <h2
            className="text-[21px] font-bold tracking-tight leading-snug"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            {p.title || tr('焕新移动体验', 'Modern Mobile Experience')}
          </h2>
          {p.subtitle && <p className="text-[12.5px] text-white/85 leading-relaxed">{p.subtitle}</p>}
        </div>
        {p.actionText && (
          <button
            type="button"
            onClick={() => rt.run(p.onAction as PropValue, scope)}
            className="min-h-[38px] px-4 rounded-full bg-white text-slate-900 text-[12.5px] font-semibold inline-flex items-center gap-1 cursor-pointer shadow-xs active:scale-95 transition"
          >
            <span>{p.actionText}</span>
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div {...rootWith(root, { className: 'pt-2 pb-1 px-1 space-y-1.5' })}>
      {p.eyebrow && (
        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium">
          <Sparkles className={cx('w-3.5 h-3.5', theme.isDark ? 'text-[#8AB4F8]' : 'text-[#4285F4]')} aria-hidden="true" />
          <span className={theme.textSecondary}>{p.eyebrow}</span>
        </div>
      )}
      <h1
        className={cx(
          'text-[26px] font-bold tracking-tight leading-tight bg-gradient-to-r bg-clip-text text-transparent inline-block',
          theme.isDark
            ? 'from-[#8AB4F8] via-[#C58AF9] to-[#F28B82]'
            : 'from-[#4285F4] via-[#9B72CB] to-[#D96570]',
        )}
        style={{ textWrap: 'balance' } as React.CSSProperties}
      >
        {p.title || tr('你好，Alex', 'Hello, Alex')}
      </h1>
      {p.subtitle && (
        <p className={cx('text-[15px] font-medium leading-snug', theme.textMuted)}>{p.subtitle}</p>
      )}
      {p.actionText && (
        <div className="pt-1.5">
          <button
            type="button"
            onClick={() => rt.run(p.onAction as PropValue, scope)}
            className={cx(
              'min-h-[38px] px-4 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95',
              theme.pillActiveBg,
            )}
          >
            <span>{p.actionText}</span>
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};

const FEED_GRADIENTS = [
  'from-[#D3E3FD] via-[#E8F0FE] to-[#F3E8FD]',
  'from-[#E6F4EA] via-[#D2E3FC] to-[#E8F0FE]',
  'from-[#FEF7E0] via-[#FCE8E6] to-[#F3E8FD]',
  'from-[#F3E8FD] via-[#E8F0FE] to-[#E6F4EA]',
];
const FEED_GRADIENTS_DARK = [
  'from-[#172B4D] via-[#1E293B] to-[#2B193D]',
  'from-[#0F2E22] via-[#172B4D] to-[#1E293B]',
  'from-[#33260D] via-[#3B1D2A] to-[#2B193D]',
  'from-[#2B193D] via-[#172B4D] to-[#0F2E22]',
];

const MFeedList: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { isEn, tr, td } = useI18n();
  const uiState = useUIStackState();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const rawRows = useTableDataRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const bindingErrors = sourceForeignKeyErrors(p, tables);
  const runtimeFilter = rt.filters[node.pfId];
  const layout = (p.layout as string) || 'waterfall';

  const titleKey = p.titleField, subKey = p.subtitleField, priceKey = p.priceField, tagKey = p.tagField;
  const cell = (row: Row, key: unknown) => typeof key === 'string' && row[key] != null ? String(row[key]) : '';

  const cards = useMemo(() => {
    if (tableId) {
      const records = typeof p.sourceForeignKey === 'string'
        ? rowsForSource(rawRows, p.sourceForeignKey, tableId, {row:sourceRow,tableId:sourceTableId}, tables) : rawRows;
      return records
        .filter((r) => matchesFilter(r, p.filter, runtimeFilter))
        .map((r) => ({
          id: r.id,
          row: r,
          title: cell(r, titleKey) || tr('未配置标题或暂无值', 'Untitled'),
          subtitle: cell(r, subKey),
          price: cell(r, priceKey),
          tag: cell(r, tagKey),
        }));
    }
    const items = (Array.isArray(p.items) ? p.items : []) as {
      title?: string;
      subtitle?: string;
      price?: string;
      tag?: string;
    }[];
    const projectedItems = applyUIStackRows(
      items.map((it, idx) => ({ id: `item-${idx}`, ...it })),
      undefined,
      uiState,
      isEn,
    );
    return projectedItems
      .filter((it) =>
        matchesFilter(
          { id: it.id, title: String(it.title ?? ''), subtitle: String(it.subtitle ?? ''), price: String(it.price ?? ''), tag: String(it.tag ?? '') },
          p.filter,
          runtimeFilter,
        ),
      )
      .map((it, idx) => ({
        id: it.id,
        row: it,
        title: String(it.title || tr(`精选内容 ${idx + 1}`, `Featured Item ${idx + 1}`)),
        subtitle: String(it.subtitle || ''),
        price: String(it.price || ''),
        tag: String(it.tag || ''),
      }));
  }, [tableId, rawRows, p.sourceForeignKey, sourceRow, sourceTableId, tables, p.filter, p.items, runtimeFilter, titleKey, subKey, priceKey, tagKey, tr, uiState, isEn]);

  if (bindingErrors.length) return <div {...rootWith(root, {className:'rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800'})} role="alert">{td(bindingErrors[0])}</div>;

  if (cards.length === 0) {
    return (
      <div {...rootWith(root, { className: cx('rounded-[22px] py-10 text-center', theme.cardBg, theme.textMuted) })}>
        <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <div className="text-[13px]">{tr('暂无匹配的内容', 'No matching items')}</div>
      </div>
    );
  }

  if (layout === 'media') {
    return (
      <div {...rootWith(root, { className: 'space-y-2.5' })}>
        {cards.map((c, idx) => {
          const grad = (theme.isDark ? FEED_GRADIENTS_DARK : FEED_GRADIENTS)[idx % 4];
          const activate = () => void rt.run(p.onItemClick as PropValue, childRowScope(scope, c.row, tableId, fkSourceTableId));
          return (
            <div
              key={c.id}
              onClick={activate}
              {...interactiveBoxProps(Boolean(p.onItemClick) && !rt.isDesign, activate)}
              className={cx(
                'rounded-[22px] p-3 flex items-center gap-3.5 cursor-pointer transition-transform active:scale-[0.99]',
                theme.cardBg,
              )}
            >
              <div
                className={cx(
                  'w-20 rounded-2xl bg-gradient-to-br shrink-0 flex items-center justify-center',
                  grad,
                  theme.isDark ? 'text-white/75' : 'text-slate-700/60',
                )}
                style={{ aspectRatio: '1 / 1' }}
              >
                <Sparkles className="w-6 h-6" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {c.tag && (
                  <span className={cx('inline-block px-2 py-0.5 rounded-full text-[10px] font-medium', theme.subtleBg, theme.textSecondary)}>
                    {c.tag}
                  </span>
                )}
                <div className={cx('text-[14px] font-semibold leading-snug truncate', theme.textPrimary)}>
                  {c.title}
                </div>
                {c.subtitle && <div className={cx('text-[12px] truncate', theme.textMuted)}>{c.subtitle}</div>}
                <div className="flex items-center justify-between pt-1">
                  <span className={cx('text-[15px] font-bold tabular-nums', theme.accentText)}>{c.price}</span>
                  {p.actionText && (
                    <span className={cx('px-3 py-1 rounded-full text-[11.5px] font-semibold', theme.pillActiveBg)}>
                      {p.actionText}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      {...rootWith(root, {
        className: cx('grid gap-2.5', layout === 'showcase' ? 'grid-cols-1' : 'grid-cols-2'),
      })}
    >
      {cards.map((c, idx) => {
        const grad = (theme.isDark ? FEED_GRADIENTS_DARK : FEED_GRADIENTS)[idx % 4];
        const activate = () => void rt.run(p.onItemClick as PropValue, childRowScope(scope, c.row, tableId, fkSourceTableId));
        return (
          <div
            key={c.id}
            onClick={activate}
            {...interactiveBoxProps(Boolean(p.onItemClick) && !rt.isDesign, activate)}
            className={cx(
              'rounded-[22px] overflow-hidden flex flex-col justify-between cursor-pointer transition-transform active:scale-[0.98]',
              theme.cardBg,
            )}
          >
            <div
              className={cx(
                'w-full bg-gradient-to-br p-3 flex flex-col justify-between',
                grad,
                theme.isDark ? 'text-white/75' : 'text-slate-700/60',
              )}
              style={{ aspectRatio: layout === 'showcase' ? '16 / 9' : '4 / 3' }}
            >
              <div className="flex justify-between items-start">
                {c.tag ? (
                  <span
                    className={cx(
                      'px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold backdrop-blur-md',
                      theme.isDark ? 'bg-black/45 text-[#E3E3E3] ring-1 ring-white/12' : 'bg-white/80 text-slate-800',
                    )}
                  >
                    {c.tag}
                  </span>
                ) : (
                  <span />
                )}
              </div>
              <Sparkles className="w-5 h-5 self-end" aria-hidden="true" />
            </div>

            <div className="p-3.5 space-y-1.5 flex-1 flex flex-col justify-between">
              <div className="space-y-0.5">
                <div className={cx('text-[13.5px] font-semibold leading-snug line-clamp-2', theme.textPrimary)}>
                  {c.title}
                </div>
                {c.subtitle && (
                  <div className={cx('text-[11.5px] line-clamp-1', theme.textMuted)}>{c.subtitle}</div>
                )}
              </div>
              {(c.price || p.actionText) && (
                <div className="flex items-center justify-between gap-2 pt-1.5">
                  <span className={cx('text-[14.5px] font-bold tabular-nums truncate', theme.accentText)}>
                    {c.price}
                  </span>
                  {p.actionText && (
                    <span className={cx('px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0', theme.pillActiveBg)}>
                      {p.actionText}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

function statusToneCls(status: string, isDark: boolean): string {
  const s = status.toLowerCase();
  if (/通过|完成|qualified|confirmed|completed|approved|enabled|active|normal|done|pass|已入库|正常/.test(s)) {
    return isDark
      ? 'bg-emerald-500/16 text-emerald-300 ring-1 ring-inset ring-emerald-400/25'
      : 'bg-emerald-100/90 text-emerald-800';
  }
  if (/驳回|异常|rejected|disabled|failed|error|overdue|fail|超期|失败/.test(s)) {
    return isDark
      ? 'bg-rose-500/16 text-rose-300 ring-1 ring-inset ring-rose-400/25'
      : 'bg-rose-100/90 text-rose-800';
  }
  if (/待|pending|unconfirmed|in progress|review|进行/.test(s)) {
    return isDark
      ? 'bg-amber-500/16 text-amber-300 ring-1 ring-inset ring-amber-400/25'
      : 'bg-amber-100/90 text-amber-900';
  }
  return isDark ? 'bg-white/10 text-[#C4C7C5]' : 'bg-[#E6ECF5] text-[#444746]';
}

const MTaskList: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { isEn, tr, td } = useI18n();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const schema = tables.find((t) => t.id === tableId);
  const rawRows = useTableDataRows(tableId);
  const source = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const { fkSourceTableId } = source;
  const bindingErrors = sourceForeignKeyErrors(p, tables);
  const runtimeFilter = rt.filters[node.pfId];

  const defaultCols = useMemo(() => (schema ? defaultDisplayColumns(schema, 5) : []), [schema]);
  const titleField = typeof p.titleField === 'string' ? p.titleField : undefined;
  const statusField = typeof p.statusField === 'string' ? p.statusField : undefined;

  const configuredFields = useMemo<{ dataIndex: string; title: string; render?: string }[]>(() => {
    if (Array.isArray(p.fields) && p.fields.length) {
      return p.fields as { dataIndex: string; title: string; render?: string }[];
    }
    return defaultCols
      .filter((c) => c.name !== titleField && c.name !== statusField)
      .slice(0, 3)
      .map((c) => ({ dataIndex: c.name, title: columnLabel(c) }));
  }, [p.fields, defaultCols, titleField, statusField]);

  const rowActions = (Array.isArray(p.rowActions) ? p.rowActions : []) as {
    label: string;
    primary?: boolean;
    danger?: boolean;
    disabledWhenField?: string;
    disabledWhenValue?: string;
    disabledReason?: string;
    hiddenWhenField?: string;
    hiddenWhenValue?: string;
    onClick?: PropValue;
  }[];

  const uiState = useUIStackState();
  const autoSelectFirst = Boolean(p.autoSelectFirst);
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  const resolvedBoundRows = useMemo(() => {
    if (!tableId || bindingErrors.length) return [];
    const recs = typeof p.sourceForeignKey === 'string' ? rowsForSource(rawRows, p.sourceForeignKey, tableId, source, tables) : rawRows;
    return recs.filter((r) => matchesFilter(r, p.filter, runtimeFilter));
  }, [tableId, bindingErrors.length, p.sourceForeignKey, rawRows, source, tables, p.filter, runtimeFilter]);

  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: source.row?.id,
    visibleRows: resolvedBoundRows,
    autoSelectFirst,
    runtimeQuery: runtimeFilter,
  });

  if (bindingErrors.length) return <div {...rootWith(root, {className:'rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800'})} role="alert">{td(bindingErrors[0])}</div>;

  if (!tableId) {
    const rawDemoItems = (
      Array.isArray(p.items)
        ? p.items
        : isEn
        ? [
            {
              title: 'Annual Cloud Capacity Expansion Request',
              status: 'Pending',
              summary: 'Dept: AI Platform R&D · Vendor: PrimeCloud Tech',
              meta: '¥128,000 · 10m ago',
            },
            {
              title: 'East Hub Smart Warehouse Receiving',
              status: 'Approved',
              summary: 'Inspector: Lin Feng · 12 standard hardware items',
              meta: '¥64,500 · Today 09:30',
            },
          ]
        : [
            {
              title: '年度云资源扩容采购申请',
              status: '待审批',
              summary: '申请部门：AI 平台研发部 · 供应商：优选云科技',
              meta: '¥128,000 · 10分钟前',
            },
            {
              title: '华东智能仓首批设备到货验收',
              status: '已通过',
              summary: '验收人：林峰 · 共 12 项标准硬件明细',
              meta: '¥64,500 · 今天 09:30',
            },
          ]
    ) as {
      title?: string;
      status?: string;
      summary?: string;
      meta?: string;
    }[];
    const demoItems = applyUIStackRows(
      rawDemoItems.map((it, idx) => ({ id: `demo-${idx}`, ...it })),
      undefined,
      uiState,
      isEn,
    ) as {
      id: string;
      title?: string;
      status?: string;
      summary?: string;
      meta?: string;
    }[];
    const filteredDemo = demoItems.filter((it) =>
      matchesFilter(
        { id: '', title: it.title ?? '', status: it.status ?? '', summary: it.summary ?? '', meta: it.meta ?? '' },
        p.filter,
        runtimeFilter,
      ),
    );
    if (filteredDemo.length === 0) {
      return (
        <div {...rootWith(root, { className: cx('rounded-[22px] py-10 text-center', theme.cardBg, theme.textMuted) })}>
          <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
          <div className="text-[13px]">{tr('当前筛选下暂无业务单据', 'No records match the current filter')}</div>
        </div>
      );
    }
    return (
      <div {...rootWith(root, { className: 'space-y-2.5' })}>
        {filteredDemo.map((it, idx) => {
          const demoRow: Row = {
            id: `demo-${idx}`,
            title: it.title ?? '',
            status: it.status ?? '',
            summary: it.summary ?? '',
            meta: it.meta ?? '',
          };
          const rowScope = { ...scope, row: demoRow };
          const activateCard = () => void rt.run(p.onCardClick as PropValue, rowScope);
          const hasCardClick = Boolean(p.onCardClick) && !rt.isDesign;
          return (
            <div
              key={idx}
              onClick={activateCard}
              {...interactiveBoxProps(hasCardClick && rowActions.length === 0, activateCard)}
              className={cx('rounded-[22px] p-4 space-y-2.5 cursor-pointer transition-transform active:scale-[0.99]', theme.cardBg)}
            >
              <div className="flex items-start justify-between gap-2">
                {hasCardClick && rowActions.length > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      activateCard();
                    }}
                    className={cx('text-left text-[14.5px] font-semibold leading-snug cursor-pointer', theme.textPrimary)}
                  >
                    {it.title || tr(`任务单据 #${idx + 1}`, `Task #${idx + 1}`)}
                  </button>
                ) : (
                  <span className={cx('text-[14.5px] font-semibold leading-snug', theme.textPrimary)}>
                    {it.title || tr(`任务单据 #${idx + 1}`, `Task #${idx + 1}`)}
                  </span>
                )}
                {it.status && (
                  <span className={cx('px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0', statusToneCls(it.status, theme.isDark))}>
                    {it.status}
                  </span>
                )}
              </div>
              {it.summary && <p className={cx('text-[12.5px] leading-relaxed', theme.textSecondary)}>{it.summary}</p>}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className={cx('text-[11.5px]', theme.textMuted)}>{it.meta}</span>
                {rowActions.length > 0 && (
                  <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                    {rowActions.map((act, aIdx) => {
                      if (!rt.isDesign && matchesWhenCondition(demoRow, act.hiddenWhenField, act.hiddenWhenValue)) return null;
                      const actDisabled = !rt.isDesign && matchesWhenCondition(demoRow, act.disabledWhenField, act.disabledWhenValue);
                      return (
                        <button
                          key={aIdx}
                          type="button"
                          disabled={actDisabled}
                          title={actDisabled && act.disabledReason ? act.disabledReason : undefined}
                          onClick={() => {
                            if (!rt.isDesign && !actDisabled) void rt.run(act.onClick, rowScope);
                          }}
                          className={cx(
                            "relative min-h-[36px] px-3.5 rounded-full text-[12px] font-semibold transition after:content-[''] after:absolute after:-inset-y-1 after:inset-x-0",
                            actDisabled
                              ? 'opacity-45 cursor-not-allowed bg-slate-200/70 text-slate-400'
                              : cx(
                                  'cursor-pointer',
                                  act.danger
                                    ? theme.isDark
                                      ? 'bg-rose-500/18 text-rose-300 ring-1 ring-inset ring-rose-400/25'
                                      : 'bg-rose-500/12 text-rose-600'
                                    : act.primary
                                    ? theme.accentSolidBg
                                    : theme.pillActiveBg,
                                ),
                          )}
                        >
                          {act.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const rows = resolvedBoundRows;

  if (rows.length === 0) {
    return (
      <div {...rootWith(root, { className: cx('rounded-[22px] py-10 text-center', theme.cardBg, theme.textMuted) })}>
        <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <div className="text-[13px]">{tr('当前筛选下暂无业务单据', 'No records match the current filter')}</div>
      </div>
    );
  }

  return (
    <div {...rootWith(root, { className: 'space-y-2.5' })}>
      {rows.map((r) => {
        const rowScope = childRowScope(scope, r, tableId, fkSourceTableId);
        const statusVal = statusField && r[statusField] != null ? String(r[statusField]) : '';
        const isActive = Boolean(tableId && activeRowId === r.id);
        const activateCard = () => {
          if (!rt.isDesign && autoSelectFirst && tableId) rt.setActiveRow?.(tableId, r.id, fkSourceTableId);
          void rt.run(p.onCardClick as PropValue, rowScope);
        };
        const hasCardClick = (Boolean(p.onCardClick) || autoSelectFirst) && !rt.isDesign;
        const cardTitle = titleField && r[titleField] != null ? String(r[titleField]) : tr('未配置标题或暂无值', 'Untitled');
        return (
          <div
            key={r.id}
            data-row-id={r.id}
            data-active-row={isActive ? '1' : undefined}
            onClick={activateCard}
            {...interactiveBoxProps(hasCardClick && rowActions.length === 0, activateCard)}
            className={cx(
              'rounded-[22px] p-4 space-y-3 cursor-pointer transition-transform active:scale-[0.99]',
              theme.cardBg,
              isActive && 'ring-2 ring-blue-500/50',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              {hasCardClick && rowActions.length > 0 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    activateCard();
                  }}
                  className={cx('text-left text-[14.5px] font-semibold leading-snug cursor-pointer', theme.textPrimary)}
                >
                  {cardTitle}
                </button>
              ) : (
                <div className={cx('text-[14.5px] font-semibold leading-snug', theme.textPrimary)}>
                  {cardTitle}
                </div>
              )}
              {statusVal && (
                <span className={cx('px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0', statusToneCls(statusVal, theme.isDark))}>
                  {statusVal}
                </span>
              )}
            </div>

            {configuredFields.length > 0 && (
              <div className={cx('rounded-2xl p-3 space-y-1.5', theme.subtleBg)}>
                {configuredFields.map((f) => {
                  const rawVal = r[f.dataIndex];
                  const isEmpty = rawVal === undefined || rawVal === null || rawVal === '';
                  const numCandidate = typeof rawVal === 'number' ? rawVal : Number(rawVal);
                  const isValidMoney = !isEmpty && f.render === 'money' && !Number.isNaN(numCandidate) && String(rawVal).trim() !== '';
                  const formatted = isEmpty
                    ? '—'
                    : isValidMoney
                    ? `¥${numCandidate.toLocaleString()}`
                    : f.render === 'date'
                    ? String(rawVal).replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/ 00:00(:00)?$/, '').slice(0, 16)
                    : String(rawVal);
                  return (
                    <div key={f.dataIndex} className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className={theme.textMuted}>{f.title}</span>
                      {!isEmpty && f.render === 'tag' ? (
                        <span className={cx('px-2 py-0.5 rounded-full text-[11px] font-semibold truncate max-w-[65%]', statusToneCls(String(rawVal), theme.isDark))}>
                          {String(rawVal)}
                        </span>
                      ) : (
                        <span className={cx('font-medium truncate max-w-[65%]', (isValidMoney || f.render === 'date') && 'tabular-nums', theme.textPrimary)}>
                          {formatted}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {rowActions.length > 0 && (
              <div className="flex items-center justify-end gap-2.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
                {rowActions.map((act, idx) => {
                  if (!rt.isDesign && matchesWhenCondition(r, act.hiddenWhenField, act.hiddenWhenValue)) return null;
                  const actDisabled = !rt.isDesign && matchesWhenCondition(r, act.disabledWhenField, act.disabledWhenValue);
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={actDisabled}
                      title={actDisabled && act.disabledReason ? act.disabledReason : undefined}
                      onClick={() => {
                        if (!rt.isDesign && !actDisabled) void rt.run(act.onClick, rowScope);
                      }}
                      className={cx(
                        "relative min-h-[36px] px-4 rounded-full text-[12px] font-semibold transition-transform after:content-[''] after:absolute after:-inset-y-1 after:inset-x-0",
                        actDisabled
                          ? 'opacity-45 cursor-not-allowed bg-slate-200/70 text-slate-400'
                          : cx(
                              'cursor-pointer active:scale-95',
                              act.danger
                                ? theme.isDark
                                  ? 'bg-rose-500/18 text-rose-300 ring-1 ring-inset ring-rose-400/25'
                                  : 'bg-rose-50 text-rose-600'
                                : act.primary
                                ? theme.accentSolidBg
                                : theme.pillActiveBg,
                            ),
                      )}
                    >
                      {act.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const MListGroup: React.FC<CompProps> = ({ p, children, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableSchema = typeof p.table === 'string' ? tables.find((t) => t.id === p.table) : undefined;
  const source = useSourceRow(scope, rt.pageId, Boolean(tableSchema), tableSchema?.id);
  const contextRow = (scope.row ?? scope.params?.row ?? source.row) as Row | undefined;
  const contextTableId = scope.tableId ?? (scope.params?.tableId as string | undefined) ?? source.tableId;

  const autoRowItems = useMemo(() => {
    if (!tableSchema) return [];
    const cols = tableSchema.columns.filter((c) => !c.isPrimaryKey).slice(0, 8);
    return cols.map((c) => ({
      title: columnLabel(c),
      value: contextTableId === tableSchema.id && contextRow?.[c.name] != null ? String(contextRow[c.name]) : '—',
      description: undefined as string | undefined,
      icon: undefined as string | undefined,
      arrow: false,
      onClick: undefined as PropValue | undefined,
    }));
  }, [tableSchema, contextRow, contextTableId]);

  const propItems = (Array.isArray(p.items) ? p.items : []) as {
    title?: string;
    description?: string;
    value?: string;
    icon?: string;
    arrow?: boolean;
    onClick?: PropValue;
  }[];

  const finalItems = propItems.length > 0 ? propItems : autoRowItems;

  return (
    <div {...rootWith(root, { className: 'space-y-1.5' })}>
      {p.title && (
        <div className={cx('px-2 text-[12px] font-semibold tracking-wide', theme.textMuted)}>{p.title}</div>
      )}
      <div className={cx('rounded-[22px] overflow-hidden divide-y', theme.cardBg, theme.isDark ? 'divide-white/[0.06]' : 'divide-slate-100')}>
        {finalItems.map((it, idx) => {
          const Icon = it.icon ? resolveMobileIcon(it.icon, FileText) : null;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => it.onClick && rt.run(it.onClick, scope)}
              className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer transition hover:opacity-90"
            >
              <div className="flex items-center gap-3 min-w-0">
                {Icon && (
                  <span className={cx('w-8 h-8 rounded-full inline-flex items-center justify-center shrink-0', theme.subtleBg, theme.textSecondary)}>
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className={cx('text-[14px] font-medium truncate', theme.textPrimary)}>
                    {it.title || tr(`项目 ${idx + 1}`, `Item ${idx + 1}`)}
                  </div>
                  {it.description && (
                    <div className={cx('text-[11.5px] truncate mt-0.5', theme.textMuted)}>{it.description}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 max-w-[48%]">
                {it.value && <span className={cx('text-[13px] truncate', theme.textMuted)}>{it.value}</span>}
                {it.arrow && <ChevronRight className={cx('w-4 h-4 shrink-0', theme.textMuted)} aria-hidden="true" />}
              </div>
            </button>
          );
        })}
        {children}
      </div>
    </div>
  );
};

const MListItem: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const Icon = p.icon ? resolveMobileIcon(p.icon as string, FileText) : null;
  return (
    <button
      type="button"
      {...rootWith(root, {
        onClick: () => rt.run(p.onClick as PropValue, scope),
        className: 'w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer transition',
      })}
    >
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className={cx('w-8 h-8 rounded-full inline-flex items-center justify-center shrink-0', theme.subtleBg, p.danger ? theme.dangerText : theme.textSecondary)}>
            <Icon className="w-4 h-4" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <div className={cx('text-[14px] font-medium truncate', p.danger ? theme.dangerText : theme.textPrimary)}>
            {p.title || tr('列表项', 'List Item')}
          </div>
          {p.description && <div className={cx('text-[11.5px] truncate mt-0.5', theme.textMuted)}>{p.description}</div>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {p.value && <span className={cx('text-[13px]', theme.textMuted)}>{p.value}</span>}
        {p.arrow !== false && <ChevronRight className={cx('w-4 h-4', theme.textMuted)} aria-hidden="true" />}
      </div>
    </button>
  );
};

const MStatCard: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const gradId = useId();
  const tone = (p.trendTone as string) || 'up';
  const isInverted = p.tone === 'inverted';
  const effectiveDark = isInverted || theme.isDark;
  const trendCls =
    tone === 'down'
      ? effectiveDark
        ? 'bg-rose-500/16 text-rose-300 ring-1 ring-inset ring-rose-400/25'
        : 'bg-rose-100/90 text-rose-700'
      : tone === 'neutral'
      ? isInverted
        ? 'bg-white/12 text-white/80'
        : cx(theme.subtleBg, theme.textSecondary)
      : effectiveDark
      ? 'bg-emerald-500/16 text-emerald-300 ring-1 ring-inset ring-emerald-400/25'
      : 'bg-emerald-100/90 text-emerald-800';

  const activate = () => void rt.run(p.onClick as PropValue, scope);
  return (
    <div
      {...rootWith(root, {
        onClick: p.onClick ? activate : undefined,
        className: cx(
          'rounded-[22px] p-4 flex items-end justify-between gap-3 transition-transform',
          isInverted
            ? 'pf-mobile-wallet-mesh text-[#F8FAFC] ring-1 ring-inset ring-white/10 shadow-[0_14px_30px_-10px_rgba(0,0,0,0.45)]'
            : theme.cardBg,
          p.onClick && 'cursor-pointer active:scale-[0.98]',
        ),
        style: isInverted ? { colorScheme: 'dark' } : undefined,
      })}
      {...interactiveBoxProps(Boolean(p.onClick) && !rt.isDesign, activate)}
      data-stat-tone={isInverted ? 'inverted' : 'card'}
    >
      <div className="space-y-1.5 min-w-0">
        <div className={cx('text-[12.5px] font-medium', isInverted ? 'text-white/70' : theme.textMuted)}>
          {p.title || tr('核心指标', 'Key Metric')}
        </div>
        <div className="flex items-baseline gap-1">
          <SplitMetricText
            value={String(p.value ?? '0')}
            splitDecimal={p.splitDecimal !== false}
            className={cx('text-[24px] font-bold tracking-tight', isInverted ? 'text-white' : theme.textPrimary)}
          />
          {p.unit && (
            <span className={cx('text-[12px]', isInverted ? 'text-white/65' : theme.textMuted)}>{p.unit}</span>
          )}
        </div>
        {p.trend && (
          <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold', trendCls)}>
            {tone === 'down' ? <TrendingDown className="w-3 h-3" aria-hidden="true" /> : <TrendingUp className="w-3 h-3" aria-hidden="true" />}
            <span>{p.trend}</span>
          </span>
        )}
      </div>

      {p.sparkline !== false && (
        <svg viewBox="0 0 88 38" className="w-20 h-9 shrink-0 overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={isInverted ? '#A3E635' : effectiveDark ? '#8AB4F8' : '#4285F4'} />
              <stop offset="100%" stopColor={isInverted ? '#34D399' : effectiveDark ? '#C58AF9' : '#9B72CB'} />
            </linearGradient>
          </defs>
          <path
            d={tone === 'down' ? 'M2 8 C 22 10, 34 22, 54 24 S 74 32, 86 34' : 'M2 32 C 20 30, 32 18, 50 19 S 70 7, 86 5'}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="2.75"
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  );
};

const MChatStream: React.FC<CompProps> = ({ p, root }) => {
  const { isEn } = useI18n();
  const theme = useMobileTheme();
  const messages = (Array.isArray(p.messages) && p.messages.length
    ? p.messages
    : isEn
    ? [
        { role: 'user', title: 'Help me prioritize key tasks for today' },
        {
          role: 'assistant',
          title: 'I summarized your schedule and operational data: 3 high-priority approvals and 1 quarterly brief await review.',
          highlight: 'Top priority: East Hub replenishment order (est. 14% faster fulfillment)',
        },
      ]
    : [
        { role: 'user', title: '帮我梳理今天的重点优先事项' },
        { role: 'assistant', title: '已为你整合日程与业务数据：当前有 3 项高优审批与 1 份季度简报待确认。', highlight: '优先处理：华东区智能仓补货单（预计节省 14% 调拨时效）' },
      ]) as { role?: string; title?: string; highlight?: string }[];

  return (
    <div {...rootWith(root, { className: 'space-y-4 py-1' })}>
      {messages.map((msg, idx) => {
        if (msg.role === 'user') {
          return (
            <div key={idx} className="flex justify-end">
              <div
                className={cx(
                  'max-w-[82%] rounded-[22px] rounded-br-md px-4 py-2.5 text-[13.5px] leading-relaxed',
                  theme.subtleBg,
                  theme.textPrimary,
                )}
              >
                {msg.title}
              </div>
            </div>
          );
        }
        return (
          <div key={idx} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-gradient-to-tr from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white inline-flex items-center justify-center shadow-2xs">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
              <span className={cx('text-[12.5px] font-semibold', theme.textSecondary)}>
                {p.assistantName || 'Gemini'}
              </span>
            </div>
            <div className={cx('pl-8 space-y-2.5 text-[14px] leading-relaxed', theme.textPrimary)}>
              <p>{msg.title}</p>
              {msg.highlight && (
                <div className={cx('rounded-2xl p-3.5 text-[12.5px] font-medium', theme.cardBg)}>
                  {msg.highlight}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const MComposerBar: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const [text, setText] = useState('');
  const chips = typeof p.suggestions === 'string'
    ? p.suggestions.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    : [];

  const handleSend = () => {
    void rt.run(p.onSend as PropValue, { ...scope, params: { ...scope.params, message: text } });
    if (!rt.isDesign) setText('');
  };

  return (
    <div
      {...rootWith(root, {
        className: cx(
          'px-3 pb-2.5 pt-1.5 space-y-2',
          p.docked !== false &&
            (theme.isDark
              ? 'bg-gradient-to-t from-[#131314] via-[#131314]/85 to-transparent'
              : 'bg-gradient-to-t from-black/[0.04] to-transparent'),
        ),
      })}
    >
      {chips.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5" style={{ touchAction: 'pan-x pan-y' }}>
          {chips.map((chip, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                if (!rt.isDesign) setText(chip);
              }}
              className={cx(
                "relative shrink-0 min-h-[36px] px-3 rounded-full text-[12px] font-medium cursor-pointer transition after:content-[''] after:absolute after:-inset-y-1 after:inset-x-0",
                theme.cardBg,
                theme.textSecondary,
              )}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <div
        className={cx(
          'min-h-[54px] rounded-full px-1.5 py-1 flex items-center gap-1.5',
          theme.glassBg,
          theme.isDark
            ? 'border border-white/12 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.65)]'
            : 'border border-white shadow-[0_8px_28px_-6px_rgba(15,23,42,0.14)]',
        )}
      >
        {p.showMedia !== false && (
          <button
            type="button"
            aria-label={tr('添加图片或附件', 'Add image or attachment')}
            onClick={() => rt.run(p.onPlusClick as PropValue, scope)}
            className={cx('w-11 h-11 rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer transition-transform active:scale-95', theme.subtleBg, theme.textSecondary)}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
        <input
          type="text"
          aria-label={(p.placeholder as string) || tr('输入问题或指令', 'Ask a question or enter a command')}
          value={text}
          readOnly={rt.isDesign}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={(p.placeholder as string) || tr('输入问题或指令...', 'Ask a question or enter a command...')}
          className={cx(
            'flex-1 min-w-0 bg-transparent text-[13.5px] px-1.5 focus:outline-none',
            theme.textPrimary,
            theme.placeholderCls,
          )}
        />
        {p.showMedia !== false && !text && (
          <button
            type="button"
            aria-label={tr('语音输入', 'Voice input')}
            onClick={() => {
              if (p.onVoiceClick) {
                void rt.run(p.onVoiceClick as PropValue, scope);
              } else if (!rt.isDesign) {
                void rt.run({ $kind: 'actions', calls: [{ name: 'toast', args: [tr('正在聆听语音指令...', 'Listening for voice command...'), 'info'] }] }, scope);
              }
            }}
            className={cx('w-11 h-11 rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer transition-transform active:scale-95', theme.textSecondary)}
          >
            <Mic className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          aria-label={tr('发送', 'Send')}
          onClick={handleSend}
          className={cx(
            'w-11 h-11 rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer transition-transform active:scale-95',
            theme.accentSolidBg,
          )}
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

// ───────────────────────── 4. Filled Touch Form Controls ─────────────────────────

const MForm: React.FC<CompProps> = ({ node, p, children, root, rt, scope }) => {
  const theme = useMobileTheme();
  const preview = useContext(PreviewDataContext);
  const instanceId = resolveFormInstanceKey(node.pfId, p.table, scope);
  const values = rt.formValues[instanceId] ?? {};
  const row = (scope.row ?? scope.params?.row) as Row | undefined;

  useEffect(() => {
    if (
      !rt.isDesign &&
      row &&
      p.table &&
      (scope.tableId ?? scope.params?.tableId) === p.table &&
      Object.keys(values).length === 0
    ) {
      const canonical = resolveCanonicalRow(p.table, row, preview?.rows) ?? row;
      const { id: _id, ...rest } = canonical;
      rt.setFormValues(instanceId, rest);
    }
  }, [rt.isDesign, instanceId, row?.id, p.table, scope.tableId, scope.params?.tableId]);

  return (
    <MobileFormIdContext.Provider value={instanceId}>
      <MobileFormTableContext.Provider value={typeof p.table === 'string' && p.table ? p.table : undefined}>
        <div {...rootWith(root, { className: cx('rounded-[22px] p-4 space-y-3.5', theme.cardBg) })}>
          {p.title && <div className={cx('text-[14.5px] font-semibold', theme.textPrimary)}>{p.title}</div>}
          <div className="space-y-3">{children}</div>
        </div>
      </MobileFormTableContext.Provider>
    </MobileFormIdContext.Provider>
  );
};

function useMobileFieldBinding(node: ProtoNode, nameProp: unknown, rt: CompProps['rt']) {
  const { tr, td } = useI18n();
  const parentForm = useContext(MobileFormIdContext);
  const formId = parentForm ?? node.pfId;
  // Standalone controls keep local runtime state. A form must use an explicit business field.
  const fieldName = typeof nameProp === 'string' && nameProp.trim() ? nameProp : parentForm ? undefined : node.pfId;
  const value = fieldName ? rt.formValues[formId]?.[fieldName] : undefined;
  const rawErr = fieldName ? rt.formErrors[formId]?.[fieldName] : tr('请配置表单字段名', 'Please configure field name');
  const error = rawErr ? td(rawErr) : undefined;
  const setValue = (next: unknown) => { if (fieldName) rt.setFormValue(formId, fieldName, next); };
  return { value, error, setValue, fieldName, formId };
}

const MField: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const inputId = useId();
  const descId = useId();
  const { value, error, setValue } = useMobileFieldBinding(node, p.name, rt);
  const inputType = (p.inputType as string) || 'text';
  const strVal = value === undefined || value === null ? '' : String(value);
  const hasDesc = Boolean(error || p.helperText);

  const onChangeVal = (raw: string) => {
    const parsed =
      inputType === 'number' || inputType === 'amount'
        ? raw === ''
          ? null
          : Number(raw)
        : raw;
    setValue(parsed);
    void rt.run(p.onChange as PropValue, scope);
  };

  return (
    <div {...rootWith(root, { className: 'space-y-1.5' })}>
      {p.label && (
        <label htmlFor={inputId} className={cx('block text-[12.5px] font-medium px-1', theme.textSecondary)}>
          <span>{p.label}</span>
          {p.required && <span aria-hidden="true" className={cx('ml-0.5', theme.dangerText)}>*</span>}
        </label>
      )}
      {inputType === 'textarea' ? (
        <textarea
          id={inputId}
          rows={3}
          value={strVal}
          required={Boolean(p.required)}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasDesc ? descId : undefined}
          readOnly={rt.isDesign || Boolean(p.readOnly)}
          onChange={(e) => onChangeVal(e.target.value)}
          placeholder={(p.placeholder as string) || tr('请输入...', 'Enter...')}
          className={cx(
            'w-full rounded-2xl px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4285F4]/40',
            theme.inputBg,
            theme.placeholderCls,
          )}
        />
      ) : (
        <div
          className={cx(
            'min-h-[48px] rounded-2xl px-4 flex items-center gap-2 focus-within:ring-2 focus-within:ring-[#4285F4]/40',
            theme.inputBg,
          )}
        >
          {inputType === 'amount' && <span className={cx('text-[18px] font-bold', theme.textSecondary)} aria-hidden="true">¥</span>}
          <input
            id={inputId}
            type={inputType === 'number' || inputType === 'amount' ? 'number' : inputType === 'phone' ? 'tel' : 'text'}
            inputMode={inputType === 'amount' ? 'decimal' : inputType === 'number' ? 'numeric' : inputType === 'phone' ? 'tel' : undefined}
            autoComplete={inputType === 'phone' ? 'tel' : undefined}
            value={strVal}
            required={Boolean(p.required)}
            aria-invalid={error ? true : undefined}
            aria-describedby={hasDesc ? descId : undefined}
            readOnly={rt.isDesign || Boolean(p.readOnly)}
            onChange={(e) => onChangeVal(e.target.value)}
            placeholder={(p.placeholder as string) || tr('请输入...', 'Enter...')}
            className={cx(
              'flex-1 min-w-0 bg-transparent focus:outline-none',
              theme.placeholderCls,
              inputType === 'amount' ? 'text-[18px] font-semibold tabular-nums' : 'text-[14px]',
            )}
          />
        </div>
      )}
      {error ? (
        <p id={descId} role="alert" className={cx('text-[11.5px] px-1', theme.dangerText)}>{error}</p>
      ) : (
        p.helperText && <p id={descId} className={cx('text-[11.5px] px-1', theme.textMuted)}>{p.helperText}</p>
      )}
    </div>
  );
};

function offsetDateIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MSheetPicker: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { tr, td } = useI18n();
  const theme = useMobileTheme();
  const portalEl = useContext(MobileScreenPortalContext);
  const controlId = useId();
  const descId = useId();
  const { value, error, setValue } = useMobileFieldBinding(node, p.name, rt);
  const [open, setOpen] = useState(false);
  const formTableId = useContext(MobileFormTableContext);
  const fkRows = useTableDataRows(typeof p.table === 'string' ? p.table : undefined);
  const tables = useMaterialTables();
  const fkSchema = typeof p.table === 'string' ? tables.find((t) => t.id === p.table) : undefined;
  const fkSpec = useMemo(
    () =>
      formTableId && typeof p.name === 'string' && p.name
        ? resolveBoundForeignKeySpec(formTableId, p.name, tables)
        : null,
    [formTableId, p.name, tables],
  );
  const qualifiedOnly = Boolean(
    fkSpec?.qualifiedOnly && (!fkSchema || fkSpec.refTable.id === fkSchema.id),
  );

  const { options, issue } = useMemo(() => mobileOptions(p.options, p.table === undefined ? undefined : {
    table: fkSchema, rows: fkRows, labelField: p.labelField, valueField: p.valueField, qualifiedOnly,
  }), [fkSchema, fkRows, p.table, p.labelField, p.valueField, p.options, qualifiedOnly]);
  const mode = (p.mode as string) ?? 'single';
  const isDateOrTime = mode === 'date' || mode === 'time';
  const readOnly = rt.isDesign || Boolean(p.readOnly);
  const selectedLabel = !isDateOrTime
    ? options.find(o => o.value === value)?.label
    : typeof value === 'string' ? value : '';
  const hasDesc = Boolean(issue || error);

  const commitValue = (nextVal: string | number) => {
    setValue(nextVal);
    setOpen(false);
    void rt.run(p.onChange as PropValue, scope);
  };

  const sheetTitle = String(p.label || (mode === 'date' ? tr('选择日期', 'Select Date') : mode === 'time' ? tr('选择时间', 'Select Time') : tr('请选择', 'Select')));
  const datePresets = [
    { label: tr('今天', 'Today'), val: offsetDateIso(0) },
    { label: tr('明天', 'Tomorrow'), val: offsetDateIso(1) },
    { label: tr('3 天后', 'In 3 days'), val: offsetDateIso(3) },
    { label: tr('7 天后', 'In 7 days'), val: offsetDateIso(7) },
  ];
  const timePresets = ['09:00', '12:00', '14:30', '18:00'];

  const pickerPanel = (
    <div
      data-mobile-appearance={theme.appearance}
      role="dialog"
      aria-modal="true"
      aria-label={sheetTitle}
      style={{ overscrollBehavior: 'contain', colorScheme: theme.isDark ? 'dark' : 'light' }}
      className={cx(
        'pf-mobile-scope pointer-events-auto w-full rounded-t-[28px] flex flex-col max-h-[68%] min-h-0 overflow-hidden',
        theme.isDark
          ? 'bg-[#1E1F20] text-[#E3E3E3] ring-1 ring-inset ring-white/10 shadow-[0_-16px_44px_rgba(0,0,0,0.65)]'
          : 'bg-[#F8FAFD] text-[#1F1F1F] shadow-[0_-12px_40px_rgba(0,0,0,0.22)]',
      )}
    >
      <div className="pt-2.5 pb-1 flex justify-center shrink-0">
        <span className={cx('w-9 h-1 rounded-full', theme.isDark ? 'bg-white/25' : 'bg-slate-300')} />
      </div>
      <div className="px-5 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className={cx('text-[15.5px] font-semibold truncate', theme.textPrimary)}>{sheetTitle}</div>
        <button
          type="button"
          aria-label={tr('关闭选择面板', 'Close picker')}
          onClick={() => setOpen(false)}
          className={cx('w-11 h-11 rounded-full inline-flex items-center justify-center cursor-pointer shrink-0', theme.subtleBg, theme.textSecondary)}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="pf-mobile-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-5 pt-1 space-y-2" style={{ overscrollBehavior: 'contain' }}>
        {isDateOrTime ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(mode === 'date' ? datePresets : timePresets.map((t) => ({ label: t, val: t }))).map((preset) => {
                const active = selectedLabel === preset.val;
                return (
                  <button
                    key={preset.val}
                    type="button"
                    onClick={() => commitValue(preset.val)}
                    className={cx(
                      'min-h-[42px] px-4 rounded-full text-[13px] font-medium cursor-pointer transition',
                      active ? cx(theme.pillActiveBg, 'font-semibold') : cx(theme.subtleBg, theme.textPrimary),
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <input
              type={mode}
              aria-label={sheetTitle}
              value={selectedLabel ?? ''}
              onChange={(e) => {
                setValue(e.target.value);
                void rt.run(p.onChange as PropValue, scope);
              }}
              style={{ colorScheme: theme.isDark ? 'dark' : 'light' }}
              className={cx('w-full min-h-[48px] rounded-2xl px-4 text-[14px] tabular-nums focus:outline-none', theme.inputBg)}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={cx('w-full min-h-[46px] rounded-full text-[14px] font-semibold cursor-pointer', theme.accentSolidBg)}
            >
              {tr('完成', 'Done')}
            </button>
          </div>
        ) : (
          options.map((opt) => {
            const active = value === opt.value;
            return (
              <button
                key={`${typeof opt.value}:${opt.value}`}
                disabled={opt.disabled}
                type="button"
                onClick={() => commitValue(opt.value)}
                className={cx(
                  'w-full min-h-[46px] px-4 rounded-2xl flex items-center justify-between text-[14px] cursor-pointer transition disabled:opacity-45',
                  active ? cx(theme.pillActiveBg, 'font-semibold') : cx(theme.subtleBg, theme.textPrimary, 'hover:opacity-90'),
                )}
              >
                <span className="truncate">{opt.label}</span>
                {active && <Check className="w-4 h-4 shrink-0" aria-hidden="true" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const sheetOverlay = open && !readOnly ? (
    portalEl ? (
      createPortal(
        <div className="pointer-events-auto absolute inset-0 z-[75] flex flex-col justify-end overflow-hidden" style={{ overscrollBehavior: 'contain' }}>
          <div
            className={cx('absolute inset-0 backdrop-blur-[1.5px] pf-fade-in', theme.isDark ? 'bg-black/65' : 'bg-black/45')}
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-h-full flex flex-col justify-end pf-slide-up">{pickerPanel}</div>
        </div>,
        portalEl,
      )
    ) : (
      <div className="mt-1.5">{pickerPanel}</div>
    )
  ) : null;

  const TriggerRightIcon = mode === 'date' ? Calendar : mode === 'time' ? Clock : ChevronDown;
  const fallbackPlaceholder =
    (p.placeholder as string) || (mode === 'date' ? tr('点击选择日期', 'Tap to select date') : mode === 'time' ? tr('点击选择时间', 'Tap to select time') : tr('点击选择', 'Tap to select'));

  return (
    <div {...rootWith(root, { className: 'space-y-1.5' })}>
      {p.label && (
        <label htmlFor={controlId} className={cx('block text-[12.5px] font-medium px-1', theme.textSecondary)}>
          <span>{p.label}</span>
          {p.required && <span aria-hidden="true" className={cx('ml-0.5', theme.dangerText)}>*</span>}
        </label>
      )}
      <button
        id={controlId}
        disabled={Boolean(p.readOnly) || (!isDateOrTime && (!!issue || options.length === 0))}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-invalid={hasDesc ? true : undefined}
        aria-describedby={hasDesc ? descId : undefined}
        type="button"
        onClick={() => {
          if (!readOnly) setOpen((v) => !v);
        }}
        className={cx(
          'w-full min-h-[48px] rounded-2xl px-4 flex items-center justify-between gap-2 text-left cursor-pointer transition disabled:opacity-60',
          theme.inputBg,
        )}
      >
        <span className={cx('text-[14px] truncate', isDateOrTime && 'tabular-nums', !selectedLabel && theme.textMuted)}>
          {selectedLabel || (isDateOrTime || options.length ? fallbackPlaceholder : tr('暂无可选项', 'No options available'))}
        </span>
        <TriggerRightIcon className={cx('w-4 h-4 shrink-0', theme.textMuted)} aria-hidden="true" />
      </button>

      {sheetOverlay}
      {issue && <p id={descId} role="alert" className={cx('text-xs', theme.dangerText)}>{td(issue)}</p>}
      {!issue && error && <p id={descId} role="alert" className={cx('text-[11.5px] px-1', theme.dangerText)}>{error}</p>}
    </div>
  );
};

const MChipSelect: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { td } = useI18n();
  const theme = useMobileTheme();
  const { value, error, setValue } = useMobileFieldBinding(node, p.name, rt);
  const { options, issue } = useMemo(() => mobileOptions(p.options), [p.options]);
  const multiple = Boolean(p.multiple);
  const selectedList = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];

  const toggle = (val: string | number) => {
    if (rt.isDesign) return;
    if (multiple) {
      const next = selectedList.includes(val) ? selectedList.filter((x) => x !== val) : [...selectedList, val];
      setValue(next);
    } else {
      setValue(val);
    }
    void rt.run(p.onChange as PropValue, scope);
  };

  return (
    <div {...rootWith(root, { className: 'space-y-2' })}>
      {p.label && (
        <div className={cx('text-[12.5px] font-medium px-1', theme.textSecondary)}>
          <span>{p.label}</span>
          {p.required && <span className={cx('ml-0.5', theme.dangerText)}>*</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selectedList.includes(opt.value);
          return (
            <button
              key={`${typeof opt.value}:${opt.value}`}
              disabled={opt.disabled}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(opt.value)}
              className={cx(
                'min-h-[40px] px-4 rounded-full text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95',
                active
                  ? cx(theme.pillActiveBg, 'font-semibold ring-1 ring-inset ring-current/20')
                  : cx(theme.inputBg, theme.textSecondary),
              )}
            >
              {active && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
      {issue && <p role="alert" className={cx('text-xs', theme.dangerText)}>{td(issue)}</p>}
      {error && <p className={cx('text-[11.5px] px-1', theme.dangerText)}>{error}</p>}
    </div>
  );
};

const MMediaInput: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const scanInputId = useId();
  const { value, error, setValue, fieldName } = useMobileFieldBinding(node, p.name, rt);
  const variant = (p.variant as string) || 'switch';
  const min = Number(p.min ?? 1);
  const max = Number(p.max ?? 99);

  useEffect(() => {
    if (rt.isDesign || !fieldName || value !== undefined) return;
    if (variant === 'stepper') setValue(min);
    else if (variant === 'switch') setValue(true);
  }, [rt.isDesign, fieldName, value, variant, min]);

  const requiredBadge = p.required ? <span aria-hidden="true" className={cx('ml-0.5', theme.dangerText)}>*</span> : null;
  const errorNode = error ? <p role="alert" className={cx('text-[11.5px] px-1', theme.dangerText)}>{error}</p> : null;

  if (variant === 'image') {
    const imgs = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div {...rootWith(root, { className: 'space-y-2' })}>
        {p.label && (
          <div className={cx('text-[12.5px] font-medium px-1', theme.textSecondary)}>
            <span>{p.label}</span>
            {requiredBadge}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2.5">
          {imgs.map((label, idx) => (
            <div
              key={idx}
              className={cx('relative rounded-2xl flex items-center justify-center text-[11px] font-medium p-2 text-center', theme.pillActiveBg)}
              style={{ aspectRatio: '1 / 1' }}
            >
              <span className="truncate px-1">{label}</span>
              {!rt.isDesign && (
                <button
                  type="button"
                  aria-label={tr(`移除 ${label}`, `Remove ${label}`)}
                  onClick={() => {
                    const next = imgs.filter((_, i) => i !== idx);
                    setValue(next.length > 0 ? next : undefined);
                    void rt.run(p.onChange as PropValue, scope);
                  }}
                  className={cx(
                    "absolute top-1 right-1 w-6 h-6 rounded-full inline-flex items-center justify-center cursor-pointer after:content-[''] after:absolute after:-inset-2",
                    theme.isDark ? 'bg-black/55 text-white' : 'bg-slate-900/60 text-white',
                  )}
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              if (!rt.isDesign) {
                setValue([...imgs, tr(`照片_${imgs.length + 1}.jpg`, `Photo_${imgs.length + 1}.jpg`)]);
                void rt.run(p.onChange as PropValue, scope);
              }
            }}
            className={cx(
              'rounded-2xl flex flex-col items-center justify-center gap-1 cursor-pointer transition-transform active:scale-95',
              theme.inputBg,
            )}
            style={{ aspectRatio: '1 / 1' }}
          >
            <Camera className={cx('w-5 h-5', theme.textSecondary)} aria-hidden="true" />
            <span className={cx('text-[11px]', theme.textMuted)}>{tr('拍照 / 上传', 'Photo / Upload')}</span>
          </button>
        </div>
        {errorNode}
      </div>
    );
  }

  if (variant === 'scan') {
    const code = value ? String(value) : '';
    return (
      <div {...rootWith(root, { className: 'space-y-1.5' })}>
        {p.label && (
          <label htmlFor={scanInputId} className={cx('block text-[12.5px] font-medium px-1', theme.textSecondary)}>
            <span>{p.label}</span>
            {requiredBadge}
          </label>
        )}
        <div className={cx('min-h-[48px] rounded-2xl pl-4 pr-1.5 flex items-center gap-2', theme.inputBg)}>
          <input
            id={scanInputId}
            type="text"
            value={code}
            required={Boolean(p.required)}
            aria-invalid={error ? true : undefined}
            readOnly={rt.isDesign}
            onChange={(e) => {
              setValue(e.target.value);
              void rt.run(p.onChange as PropValue, scope);
            }}
            placeholder={tr('扫描或输入条码/单号...', 'Scan or enter barcode / ID...')}
            className={cx('flex-1 min-w-0 bg-transparent text-[14px] font-mono focus:outline-none', theme.placeholderCls)}
          />
          <button
            type="button"
            aria-label={tr('模拟扫码', 'Simulate scan')}
            onClick={() => {
              if (!rt.isDesign) {
                setValue(`SN-${Math.floor(100000 + Math.random() * 900000)}`);
                void rt.run(p.onChange as PropValue, scope);
              }
            }}
            className={cx(
              "relative min-h-[40px] px-3.5 rounded-full inline-flex items-center gap-1 text-[12px] font-semibold cursor-pointer after:content-[''] after:absolute after:-inset-y-1 after:inset-x-0",
              theme.pillActiveBg,
            )}
          >
            <ScanLine className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{tr('扫码', 'Scan')}</span>
          </button>
        </div>
        {errorNode}
      </div>
    );
  }

  if (variant === 'stepper') {
    const num = typeof value === 'number' ? value : min;
    return (
      <div {...rootWith(root, { className: 'space-y-1.5' })}>
        <div className={cx('min-h-[54px] rounded-2xl px-4 py-2 flex items-center justify-between gap-3', theme.inputBg)}>
          <div className="min-w-0">
            <div className={cx('text-[14px] font-medium', theme.textPrimary)}>
              <span>{p.label || tr('数量', 'Quantity')}</span>
              {requiredBadge}
            </div>
            {p.description && <div className={cx('text-[11.5px]', theme.textMuted)}>{p.description}</div>}
          </div>
          <div className="inline-flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-label={tr(`减少${p.label || '数量'}`, `Decrease ${p.label || 'Quantity'}`)}
              onClick={() => {
                if (!rt.isDesign) {
                  setValue(Math.max(min, num - 1));
                  void rt.run(p.onChange as PropValue, scope);
                }
              }}
              className={cx('w-11 h-11 rounded-full inline-flex items-center justify-center cursor-pointer transition-transform active:scale-95', theme.cardBg, theme.textPrimary)}
            >
              <Minus className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className={cx('min-w-[28px] text-center text-[15px] font-semibold tabular-nums', theme.textPrimary)}>{num}</span>
            <button
              type="button"
              aria-label={tr(`增加${p.label || '数量'}`, `Increase ${p.label || 'Quantity'}`)}
              onClick={() => {
                if (!rt.isDesign) {
                  setValue(Math.min(max, num + 1));
                  void rt.run(p.onChange as PropValue, scope);
                }
              }}
              className={cx('w-11 h-11 rounded-full inline-flex items-center justify-center cursor-pointer transition-transform active:scale-95', theme.pillActiveBg)}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        {errorNode}
      </div>
    );
  }

  const checked = Boolean(value ?? true);
  return (
    <div {...rootWith(root, { className: 'space-y-1.5' })}>
      <div className={cx('min-h-[52px] rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3', theme.inputBg)}>
        <div className="min-w-0">
          <div className={cx('text-[14px] font-medium', theme.textPrimary)}>
            <span>{p.label || tr('开关选项', 'Toggle Option')}</span>
            {requiredBadge}
          </div>
          {p.description && <div className={cx('text-[11.5px]', theme.textMuted)}>{p.description}</div>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={String(p.label || tr('开关', 'Toggle'))}
          onClick={() => {
            if (!rt.isDesign) {
              setValue(!checked);
              void rt.run(p.onChange as PropValue, scope);
            }
          }}
          className={cx(
            "relative w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 flex items-center after:content-[''] after:absolute after:-inset-y-2 after:inset-x-0",
            checked
              ? cx(theme.accentSolidBg, 'justify-end')
              : theme.isDark
              ? 'bg-white/20 justify-start'
              : 'bg-slate-300 justify-start',
          )}
        >
          <span
            className={cx(
              'w-5 h-5 rounded-full shadow-xs block',
              checked && theme.isDark && (theme.accent === 'gemini' || theme.accent === 'emerald' || theme.accent === 'amber')
                ? 'bg-slate-950'
                : 'bg-white',
            )}
          />
        </button>
      </div>
      {errorNode}
    </div>
  );
};

// ───────────────────────── 5. Pill Actions & Bottom Dock ─────────────────────────

const MButton: React.FC<CompProps> = ({ p, text, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const hasWhenGuard = Boolean(p.disabledWhenField || p.hiddenWhenField);
  const source = useSourceRow(scope, rt.pageId, hasWhenGuard);
  const ctxRow = (scope.row ?? scope.params?.row ?? source.row) as Record<string, unknown> | undefined;
  if (!rt.isDesign && matchesWhenCondition(ctxRow, p.hiddenWhenField, p.hiddenWhenValue)) {
    return null;
  }
  const guardedDisabled = !rt.isDesign && matchesWhenCondition(ctxRow, p.disabledWhenField, p.disabledWhenValue);
  const isDisabled = Boolean(p.disabled) || guardedDisabled;
  const disabledReason =
    guardedDisabled && typeof p.disabledReason === 'string' && p.disabledReason.trim()
      ? p.disabledReason.trim()
      : undefined;
  const variant = (p.variant as string) || 'primary';
  const size = (p.size as string) || 'md';
  const Icon = p.icon ? resolveMobileIcon(p.icon as string, Sparkles) : null;

  const heightCls =
    size === 'sm'
      ? "relative min-h-[40px] px-4 text-[12.5px] after:content-[''] after:absolute after:-inset-y-0.5 after:inset-x-0"
      : size === 'lg'
      ? 'min-h-[52px] px-6 text-[15px]'
      : 'min-h-[46px] px-5 text-[14px]';
  const styleCls = p.danger
    ? 'bg-rose-600 text-white'
    : variant === 'gradient'
    ? 'bg-gradient-to-r from-[#4285F4] via-[#8E65C5] to-[#D96570] text-white shadow-[0_8px_20px_-6px_rgba(66,133,244,0.5)]'
    : variant === 'tonal'
    ? theme.pillActiveBg
    : variant === 'outline'
    ? cx('border border-current/25', theme.textPrimary)
    : variant === 'ghost'
    ? theme.accentText
    : theme.accentSolidBg;

  return (
    <button
      type="button"
      disabled={isDisabled}
      title={disabledReason}
      data-disabled-reason={disabledReason}
      {...rootWith(root, {
        onClick: () => {
          if (!rt.isDesign && !isDisabled) void rt.run(p.onClick as PropValue, scope);
        },
        className: cx(
          'rounded-full font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed',
          heightCls,
          styleCls,
          p.block !== false && 'w-full',
        ),
      })}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
      <span>{text || tr('继续', 'Continue')}</span>
    </button>
  );
};

const MBottomDock: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const isCommerce = p.mode === 'commerce';

  return (
    <div
      {...rootWith(root, {
        className: cx(
          'px-4 py-3 flex items-center justify-between gap-3',
          theme.glassBg,
          theme.isDark ? 'border-t border-white/10' : 'border-t border-white/90',
        ),
      })}
    >
      {isCommerce && (
        <div className="min-w-0 shrink-0">
          <div className={cx('text-[11px]', theme.textMuted)}>{p.summaryLabel || tr('合计', 'Total')}</div>
          <div className={cx('text-[19px] font-bold tabular-nums leading-tight', theme.accentText)}>
            {p.price || '—'}
          </div>
        </div>
      )}

      <div className={cx('flex items-center gap-2.5', isCommerce ? 'flex-1 justify-end' : 'w-full')}>
        {p.secondaryText && (
          <button
            type="button"
            onClick={() => rt.run(p.onSecondary as PropValue, scope)}
            className={cx(
              'min-h-[46px] px-5 rounded-full text-[13.5px] font-semibold cursor-pointer transition-transform active:scale-95',
              !isCommerce && 'flex-1',
              theme.subtleBg,
              theme.textPrimary,
            )}
          >
            {p.secondaryText}
          </button>
        )}
        <button
          type="button"
          onClick={() => rt.run(p.onPrimary as PropValue, scope)}
          className={cx(
            'min-h-[46px] px-6 rounded-full text-[14px] font-semibold cursor-pointer transition-transform active:scale-95 flex-1',
            p.danger ? 'bg-rose-600 text-white' : theme.accentSolidBg,
          )}
        >
          {p.primaryText || tr('确认提交', 'Submit')}
        </button>
      </div>
    </div>
  );
};

// ───────────────────────── 6. In-Viewport Touch Overlays ─────────────────────────

function useOverlayExitAnimation(
  live: boolean | undefined,
  staticOverlay: boolean | undefined,
  isCapture: boolean,
  motionMode: MobileMotionMode,
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const onHostExitSettled = useContext(MobileOverlayExitContext);
  const onHostExitSettledRef = useRef(onHostExitSettled);
  onHostExitSettledRef.current = onHostExitSettled;

  const effectiveLive = Boolean(live) && onHostExitSettled === null;
  const [closing, setClosing] = useState(false);
  const prevLiveRef = useRef(effectiveLive);
  const canAnimate = canAnimateMobileOverlayExit(isCapture, motionMode, staticOverlay);
  const initiatingClose = !effectiveLive && prevLiveRef.current && canAnimate;
  const effectiveClosing = !effectiveLive && (closing || initiatingClose);

  useEffect(() => {
    if (effectiveLive) {
      prevLiveRef.current = true;
      setClosing(false);
      return undefined;
    }

    if (prevLiveRef.current && canAnimate) {
      prevLiveRef.current = false;
      setClosing(true);
      let cancelled = false;
      const settle = async () => {
        await Promise.race([
          new Promise<void>((r) => requestAnimationFrame(() => r())),
          new Promise<void>((r) => setTimeout(r, 32)),
        ]);
        if (cancelled) return;
        const anims = [
          ...(typeof panelRef.current?.getAnimations === 'function' ? panelRef.current.getAnimations() : []),
          ...(typeof backdropRef.current?.getAnimations === 'function' ? backdropRef.current.getAnimations() : []),
        ];
        if (anims.length > 0) {
          await Promise.race([
            Promise.allSettled(anims.map((a) => a.finished)),
            new Promise((r) => setTimeout(r, 340)),
          ]);
        }
        if (!cancelled) {
          setClosing(false);
          onHostExitSettledRef.current?.();
        }
      };
      void settle();
      return () => {
        cancelled = true;
      };
    }

    prevLiveRef.current = false;
    setClosing(false);
    onHostExitSettledRef.current?.();
    return undefined;
  }, [effectiveLive, canAnimate]);

  return {
    mounted: effectiveLive || effectiveClosing,
    closing: effectiveClosing,
    panelRef,
    backdropRef,
    inertProps: effectiveClosing ? { inert: '' } : undefined,
  };
}

const MBottomSheet: React.FC<CompProps> = ({ p, kids, children, root, rt, scope, live, staticOverlay, renderNode }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const isCapture = useContext(CaptureMode);
  const motionMode = useContext(MobileMotionContext);
  const sheetExit = useOverlayExitAnimation(live, staticOverlay, isCapture, motionMode);
  const close = () => rt.run({ $kind: 'actions', calls: [{ name: 'closeOverlay', args: [] }] }, scope);
  const maxHeightCls =
    p.size === 'compact' ? 'max-h-[52%]' : p.size === 'tall' ? 'max-h-[88%]' : 'max-h-[72%]';

  const hasStructuredKids = Array.isArray(kids) && kids.length > 0;
  const dockNodes = hasStructuredKids ? kids.filter((k) => k.type === 'MBottomDock') : [];
  const bodyNodes = hasStructuredKids ? kids.filter((k) => k.type !== 'MBottomDock') : [];
  const leadingAnnotation = hasStructuredKids && children.length > kids.length ? children[0] : null;

  const sheetCard = (
    <div
      {...rootWith(root, {
        className: cx(
          'pf-mobile-scope pointer-events-auto w-full rounded-t-[28px] flex flex-col',
          theme.isDark
            ? 'bg-[#1E1F20] text-[#E3E3E3] ring-1 ring-inset ring-white/10 shadow-[0_-16px_44px_rgba(0,0,0,0.65)]'
            : 'bg-[#F8FAFD] text-[#1F1F1F] shadow-[0_-12px_40px_rgba(0,0,0,0.22)]',
          !staticOverlay && cx(maxHeightCls, 'min-h-0 overflow-hidden'),
        ),
        style: { overscrollBehavior: 'contain', colorScheme: theme.isDark ? 'dark' : 'light' },
      })}
      data-mobile-appearance={theme.appearance}
      data-motion={motionMode}
      data-design-mode={rt.isDesign ? '1' : undefined}
      data-capture-mode={isCapture ? '1' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={String(p.title ?? tr('底部面板', 'Bottom sheet'))}
    >
      {leadingAnnotation}
      {/* Grabber Handle */}
      <div className="pt-2.5 pb-1 flex justify-center shrink-0">
        <span className={cx('w-9 h-1 rounded-full', theme.isDark ? 'bg-white/25' : 'bg-slate-300')} />
      </div>
      <div className="px-5 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className={cx('text-[16px] font-semibold truncate', theme.textPrimary)}>{p.title || tr('详情面板', 'Details')}</div>
          {p.subtitle && <div className={cx('text-[12px] truncate', theme.textMuted)}>{p.subtitle}</div>}
        </div>
        <button
          type="button"
          aria-label={tr('关闭抽屉', 'Close sheet')}
          onClick={close}
          className={cx('w-11 h-11 rounded-full inline-flex items-center justify-center cursor-pointer shrink-0', theme.subtleBg, theme.textSecondary)}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <MobilePageTheme
        appearance={theme.appearance}
        accent={theme.accent}
        surfaceBg={theme.surfaceBg}
        elevated={true}
      >
        <div
          className={cx(
            'min-h-0 flex-1 px-4 pt-1 space-y-3',
            dockNodes.length > 0 ? 'pb-3' : 'pb-5',
            !staticOverlay && 'pf-mobile-scroll overflow-y-auto overflow-x-hidden',
          )}
          style={{ overscrollBehavior: 'contain' }}
        >
          {hasStructuredKids ? (
            bodyNodes.length > 0 ? (
              bodyNodes.map((n) => renderNode(n))
            ) : dockNodes.length === 0 ? (
              <div className={cx('rounded-2xl py-8 text-center text-[12.5px]', theme.subtleBg, theme.textMuted)}>
                {tr('拖入表单、列表或操作栏至此半屏抽屉', 'Drop forms, lists, or actions into this bottom sheet')}
              </div>
            ) : null
          ) : children.length > 0 ? (
            children
          ) : (
            <div className={cx('rounded-2xl py-8 text-center text-[12.5px]', theme.subtleBg, theme.textMuted)}>
              {tr('拖入表单、列表或操作栏至此半屏抽屉', 'Drop forms, lists, or actions into this bottom sheet')}
            </div>
          )}
        </div>
        {dockNodes.length > 0 && (
          <div className="shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            {dockNodes.map((n) => renderNode(n))}
          </div>
        )}
      </MobilePageTheme>
    </div>
  );

  if (staticOverlay) {
    return (
      <div
        className={cx(
          'flex-[1_0_auto] min-h-full flex flex-col justify-end pt-14',
          theme.isDark ? 'bg-[#0D0E11] text-[#E3E3E3]' : 'bg-slate-900/25',
        )}
      >
        {sheetCard}
      </div>
    );
  }
  if (!sheetExit.mounted) return null;
  const z = 40 + (scope.overlayIndex ?? 0) * 2;
  return (
    <div
      className="absolute inset-0 flex flex-col justify-end overflow-hidden"
      style={{ zIndex: z, overscrollBehavior: 'contain' }}
      aria-hidden={sheetExit.closing ? 'true' : undefined}
    >
      <div
        ref={sheetExit.backdropRef}
        {...sheetExit.inertProps}
        data-closing={sheetExit.closing ? '' : undefined}
        className={cx(
          'absolute inset-0 backdrop-blur-[1.5px] pf-sheet-backdrop',
          theme.isDark ? 'bg-black/65' : 'bg-black/45',
        )}
        onClick={close}
      />
      <div
        ref={sheetExit.panelRef}
        {...sheetExit.inertProps}
        data-closing={sheetExit.closing ? '' : undefined}
        className="relative z-10 h-full pointer-events-none w-full flex flex-col justify-end pf-sheet-panel"
      >
        {sheetCard}
      </div>
    </div>
  );
};

const MDialog: React.FC<CompProps> = ({ p, children, root, rt, scope, live, staticOverlay }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const isCapture = useContext(CaptureMode);
  const motionMode = useContext(MobileMotionContext);
  const dialogExit = useOverlayExitAnimation(live, staticOverlay, isCapture, motionMode);
  const close = () => rt.run({ $kind: 'actions', calls: [{ name: 'closeOverlay', args: [] }] }, scope);

  const card = (
    <div
      {...rootWith(root, {
        className: cx(
          'pf-mobile-scope w-[calc(100%-40px)] max-w-[320px] rounded-[26px] p-5 flex flex-col gap-4',
          theme.isDark
            ? 'bg-[#1E1F20] text-[#E3E3E3] ring-1 ring-inset ring-white/12 shadow-[0_24px_54px_rgba(0,0,0,0.75)]'
            : 'bg-white text-[#1F1F1F] shadow-2xl',
          !staticOverlay && 'max-h-full min-h-0 overflow-hidden',
        ),
        style: { overscrollBehavior: 'contain', colorScheme: theme.isDark ? 'dark' : 'light' },
      })}
      data-mobile-appearance={theme.appearance}
      data-motion={motionMode}
      data-design-mode={rt.isDesign ? '1' : undefined}
      data-capture-mode={isCapture ? '1' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={String(p.title ?? tr('确认弹窗', 'Confirm dialog'))}
    >
      <div
        className={cx(
          'space-y-4 min-h-0',
          !staticOverlay && 'pf-mobile-scroll flex-1 overflow-y-auto overflow-x-hidden',
        )}
        style={{ overscrollBehavior: 'contain' }}
      >
        <div className="space-y-1.5 text-center">
          <div className={cx('text-[16.5px] font-semibold', theme.textPrimary)}>{p.title || tr('确认操作', 'Confirm Action')}</div>
          {p.description && <p className={cx('text-[13px] leading-relaxed', theme.textMuted)}>{p.description}</p>}
        </div>
        {children.length > 0 && (
          <MobilePageTheme
            appearance={theme.appearance}
            accent={theme.accent}
            surfaceBg={theme.surfaceBg}
            elevated={true}
          >
            <div className="space-y-2.5">{children}</div>
          </MobilePageTheme>
        )}
      </div>
      <div className="flex items-center gap-2.5 pt-1 shrink-0">
        <button
          type="button"
          onClick={close}
          className={cx('flex-1 min-h-[44px] rounded-full text-[13.5px] font-semibold cursor-pointer transition-transform active:scale-[0.98]', theme.subtleBg, theme.textPrimary)}
        >
          {(p.cancelText as string) || tr('取消', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={() => (p.onConfirm ? rt.run(p.onConfirm as PropValue, scope) : close())}
          className={cx(
            'flex-1 min-h-[44px] rounded-full text-[13.5px] font-semibold cursor-pointer transition-transform active:scale-[0.98]',
            p.danger ? 'bg-rose-600 text-white' : theme.accentSolidBg,
          )}
        >
          {(p.confirmText as string) || tr('确定', 'OK')}
        </button>
      </div>
    </div>
  );

  if (staticOverlay) {
    return (
      <div
        className={cx(
          'flex-[1_0_auto] min-h-full flex justify-center p-4',
          theme.isDark ? 'bg-[#0D0E11] text-[#E3E3E3]' : 'bg-slate-900/25',
        )}
        style={{ alignItems: 'safe center' }}
      >
        {card}
      </div>
    );
  }
  if (!dialogExit.mounted) return null;
  const z = 40 + (scope.overlayIndex ?? 0) * 2;
  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-hidden p-4"
      style={{ zIndex: z, overscrollBehavior: 'contain' }}
      aria-hidden={dialogExit.closing ? 'true' : undefined}
    >
      <div
        ref={dialogExit.backdropRef}
        {...dialogExit.inertProps}
        data-closing={dialogExit.closing ? '' : undefined}
        className={cx(
          'absolute inset-0 backdrop-blur-[1.5px] pf-sheet-backdrop',
          theme.isDark ? 'bg-black/65' : 'bg-black/45',
        )}
        onClick={close}
      />
      <div
        ref={dialogExit.panelRef}
        {...dialogExit.inertProps}
        data-closing={dialogExit.closing ? '' : undefined}
        className="relative z-10 flex items-center justify-center w-full h-full min-h-0 pointer-events-none pf-dialog-panel"
      >
        <div className="pointer-events-auto flex items-center justify-center w-full max-h-full min-h-0">{card}</div>
      </div>
    </div>
  );
};

export function ToastStatusIcon({ type, size = 15 }: { type?: string; size?: number }) {
  if (type === 'error') return <AlertCircle size={size} className="text-rose-400 shrink-0" aria-hidden="true" />;
  if (type === 'warning') return <AlertTriangle size={size} className="text-amber-400 shrink-0" aria-hidden="true" />;
  if (type === 'info') return <Info size={size} className="text-sky-400 shrink-0" aria-hidden="true" />;
  return <CheckCircle2 size={size} className="text-emerald-400 shrink-0" aria-hidden="true" />;
}

export interface MobileRuntimeFeedbackProps {
  toasts: {
    id: number;
    message: string;
    type: 'success' | 'info' | 'warning' | 'error';
    undoAction?: { label: string; onUndo: () => void };
  }[];
  confirmState: { message: string; matchText?: string } | null;
  onResolveConfirm: (ok: boolean) => void;
  topOffset?: number;
}

export const MobileRuntimeFeedback: React.FC<MobileRuntimeFeedbackProps> = ({
  toasts,
  confirmState,
  onResolveConfirm,
  topOffset = 12,
}) => {
  const { tr, td } = useI18n();
  const theme = useMobileTheme();
  const [typedMatch, setTypedMatch] = useState('');
  const requiredMatch = typeof confirmState?.matchText === 'string' ? confirmState.matchText.trim() : '';
  const isMatched = !requiredMatch || typedMatch.trim() === requiredMatch;

  useEffect(() => {
    setTypedMatch('');
  }, [confirmState]);

  return (
    <>
      {confirmState && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={tr('操作确认', 'Confirm action')}
          className="absolute inset-0 z-[85] flex items-center justify-center p-5 overflow-hidden"
          style={{ overscrollBehavior: 'contain' }}
        >
          <div
            className={cx(
              'absolute inset-0 backdrop-blur-[2px] pf-fade-in',
              theme.isDark ? 'bg-black/70' : 'bg-black/45',
            )}
            onClick={() => onResolveConfirm(false)}
          />
          <div
            className={cx(
              'relative z-10 w-full max-w-[308px] rounded-[26px] p-5 space-y-4 pf-pop-in',
              theme.isDark
                ? 'bg-[#1E1F20] text-[#E3E3E3] ring-1 ring-inset ring-white/12 shadow-[0_24px_54px_rgba(0,0,0,0.75)]'
                : 'bg-white text-[#1F1F1F] shadow-2xl',
            )}
          >
            <div className="space-y-1.5 text-center">
              <div className={cx('text-[16px] font-semibold', theme.textPrimary)}>
                {requiredMatch ? tr('高危操作确认', 'High-Risk Confirmation') : tr('操作确认', 'Confirm Action')}
              </div>
              <p className={cx('text-[13px] leading-relaxed', theme.textMuted)}>{td(confirmState.message)}</p>
            </div>
            {requiredMatch && (
              <div className="space-y-2 rounded-2xl bg-rose-500/10 p-3 text-left">
                <div className="text-[11.5px] text-rose-500 leading-snug">
                  {tr('请输入', 'Type')}{' '}
                  <code
                    data-testid="confirm-match-target"
                    className="px-1.5 py-0.5 rounded bg-rose-500/15 font-mono font-semibold select-all"
                  >
                    {requiredMatch}
                  </code>{' '}
                  {tr('以确认：', 'to confirm:')}
                </div>
                <input
                  type="text"
                  data-testid="confirm-match-input"
                  value={typedMatch}
                  onChange={(e) => setTypedMatch(e.target.value)}
                  placeholder={requiredMatch}
                  className={cx(
                    'w-full min-h-[38px] rounded-xl px-3 text-[13px] font-mono focus:outline-none ring-1 ring-inset ring-rose-400/40',
                    theme.inputBg,
                    theme.textPrimary,
                  )}
                />
              </div>
            )}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => onResolveConfirm(false)}
                className={cx('flex-1 min-h-[44px] rounded-full text-[13.5px] font-semibold cursor-pointer', theme.subtleBg, theme.textPrimary)}
              >
                {tr('取消', 'Cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-submit-btn"
                disabled={!isMatched}
                onClick={() => {
                  if (isMatched) onResolveConfirm(true);
                }}
                className={cx(
                  'flex-1 min-h-[44px] rounded-full text-[13.5px] font-semibold transition',
                  requiredMatch
                    ? 'bg-rose-600 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'
                    : cx('cursor-pointer', theme.accentSolidBg),
                )}
              >
                {tr('确认', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{ top: topOffset }}
          className="absolute inset-x-4 z-[90] flex flex-col items-center gap-2 pointer-events-none"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                'pointer-events-auto max-w-full px-4 py-2.5 rounded-full text-[12.5px] font-medium shadow-xl flex items-center gap-2 backdrop-blur-md pf-fade-in',
                theme.isDark
                  ? 'bg-[#282A2E]/95 text-[#E3E3E3] ring-1 ring-inset ring-white/14'
                  : 'bg-slate-900/92 text-white',
              )}
            >
              <ToastStatusIcon type={t.type} size={15} />
              <span className="truncate">{td(t.message)}</span>
              {t.undoAction && (
                <button
                  type="button"
                  data-testid="toast-undo-btn"
                  onClick={() => t.undoAction?.onUndo()}
                  className="ml-1 shrink-0 rounded-full bg-blue-500/25 px-2.5 py-0.5 text-[11.5px] font-semibold text-blue-300 hover:bg-blue-500/40 cursor-pointer transition"
                >
                  {t.undoAction.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

const MOBILE_BANNER_GRADIENTS: Record<string, string> = {
  gemini: 'from-blue-600 via-indigo-600 to-violet-600 text-white',
  blue: 'from-blue-600 via-sky-500 to-cyan-500 text-white',
  violet: 'from-violet-600 via-purple-600 to-fuchsia-500 text-white',
  emerald: 'from-emerald-600 via-teal-500 to-cyan-600 text-white',
  amber: 'from-amber-500 via-orange-500 to-rose-500 text-white',
};

const MBannerCarousel: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const height = Math.min(360, Math.max(100, Math.round(Number(p.height ?? 164))));
  const loop = p.loop !== false;
  const rawItems = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  const slides = rawItems.length
    ? rawItems
    : [{ title: tr('AI 智能随行助手', 'AI Companion'), subtitle: tr('多模态识别与实时摘要', 'Multimodal live insights'), badge: 'NEW', tone: 'gemini' }];

  const [activeIndex, setActiveIndex] = useState(0);
  const [settledText, setSettledText] = useState('');
  const settledRef = useRef(0);

  const computeNearest = useCallback(() => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return 0;
    return Math.max(0, Math.min(slides.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
  }, [slides.length]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hasScrollEnd: boolean = 'onscrollend' in (el as object);
    const onSettle = () => {
      const next = computeNearest();
      setActiveIndex(next);
      if (next !== settledRef.current) {
        settledRef.current = next;
        setSettledText(tr(`第 ${next + 1} 张，共 ${slides.length} 张`, `Slide ${next + 1} of ${slides.length}`));
      }
    };
    const onScroll = () => {
      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          const next = computeNearest();
          setActiveIndex((prev) => (prev === next ? prev : next));
        });
      }
      if (!hasScrollEnd) {
        clearTimeout(timer);
        timer = setTimeout(onSettle, 120);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    if (hasScrollEnd) el.addEventListener('scrollend', onSettle);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
      if (hasScrollEnd) el.removeEventListener('scrollend', onSettle);
    };
  }, [computeNearest, slides.length, tr]);

  const scrollToSlide = (idx: number) => {
    const count = slides.length;
    if (!count) return;
    const target = loop ? ((idx % count) + count) % count : Math.max(0, Math.min(count - 1, idx));
    setActiveIndex(target);
    const el = trackRef.current;
    if (el) {
      const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left: target * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    }
  };

  return (
    <section
      {...rootWith(root, { className: 'relative overflow-clip rounded-[22px] select-none' })}
      aria-roledescription="carousel"
      aria-label={String(p.title || tr('精选活动海报', 'Featured banners'))}
    >
      <div
        ref={trackRef}
        tabIndex={0}
        role="group"
        aria-label={tr('海报列表', 'Banner slides')}
        className="flex w-full overflow-x-auto"
        style={{
          height,
          scrollSnapType: 'x mandatory',
          overscrollBehaviorX: 'contain',
          scrollbarWidth: 'none',
          touchAction: 'manipulation',
        }}
      >
        {slides.map((slide, idx) => {
          const tone = MOBILE_BANNER_GRADIENTS[String(slide.tone ?? '')] ?? MOBILE_BANNER_GRADIENTS[['gemini', 'violet', 'emerald', 'amber'][idx % 4]];
          const clickable = Boolean(slide.onClick) && !rt.isDesign;
          return (
            <div
              key={idx}
              role="group"
              aria-roledescription="slide"
              aria-label={tr(`${idx + 1} / ${slides.length}`, `${idx + 1} of ${slides.length}`)}
              onClick={() => {
                if (clickable) void rt.run(slide.onClick as PropValue, scope);
              }}
              className={cx(
                'relative flex h-full shrink-0 basis-full flex-col justify-between p-4 bg-gradient-to-br',
                tone,
                clickable && 'cursor-pointer',
              )}
              style={{ scrollSnapAlign: 'center' }}
            >
              {Boolean(slide.image) && (
                <img src={String(slide.image)} alt="" className="absolute inset-0 block h-full w-full object-cover opacity-35" />
              )}
              <div className="relative z-[1]">
                {Boolean(slide.badge) && (
                  <span className="inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-semibold backdrop-blur-xs">
                    {String(slide.badge)}
                  </span>
                )}
              </div>
              <div className="relative z-[1] space-y-0.5 pb-3">
                <div className="text-[16px] font-bold leading-snug">{String(slide.title ?? tr(`活动海报 ${idx + 1}`, `Banner ${idx + 1}`))}</div>
                {Boolean(slide.subtitle) && <div className="text-[12px] text-white/85 truncate">{String(slide.subtitle)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{settledText}</p>
      {slides.length > 1 && (
        <nav aria-label={tr('选择海报', 'Choose slide')} className="absolute inset-x-0 bottom-1.5 z-10 flex items-center justify-center gap-1">
          {slides.map((slide, idx) => {
            const active = idx === activeIndex;
            return (
              <button
                key={idx}
                type="button"
                aria-label={tr(`切换到第 ${idx + 1} 张：${String(slide.title ?? '')}`, `Go to slide ${idx + 1}: ${String(slide.title ?? '')}`)}
                aria-current={active ? 'true' : undefined}
                onClick={() => scrollToSlide(idx)}
                style={{ touchAction: 'manipulation' }}
                className="inline-flex h-6 min-w-6 items-center justify-center cursor-pointer"
              >
                <span className={cx('block h-1.5 rounded-full transition-all', active ? 'w-5 bg-white' : 'w-1.5 bg-white/55')} />
              </button>
            );
          })}
        </nav>
      )}
    </section>
  );
};

const MCardGrid: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { isEn, tr, td } = useI18n();
  const uiState = useUIStackState();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const rawRows = useTableDataRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const bindingErrors = sourceForeignKeyErrors(p, tables);
  const runtimeFilter = rt.filters[node.pfId];
  const cols = Math.min(2, Math.max(1, Math.round(Number(p.cols ?? 2))));

  const titleKey = p.titleField, subKey = p.subtitleField, imgKey = p.imageField, priceKey = p.priceField, tagKey = p.tagField;
  const cell = (row: Row, key: unknown) => (typeof key === 'string' && row[key] != null ? String(row[key]) : '');

  const cards = useMemo(() => {
    if (tableId) {
      const records =
        typeof p.sourceForeignKey === 'string'
          ? rowsForSource(rawRows, p.sourceForeignKey, tableId, { row: sourceRow, tableId: sourceTableId }, tables)
          : rawRows;
      return records
        .filter((r) => matchesFilter(r, p.filter, runtimeFilter))
        .map((r) => ({
          id: r.id,
          row: r,
          title: cell(r, titleKey) || tr('未命名内容', 'Untitled'),
          subtitle: cell(r, subKey),
          image: cell(r, imgKey),
          price: cell(r, priceKey),
          tag: cell(r, tagKey),
        }));
    }
    const items = (Array.isArray(p.items) ? p.items : []) as Record<string, unknown>[];
    const projected = applyUIStackRows(
      items.map((it, idx) => ({ id: `mcard-${idx}`, ...it })),
      undefined,
      uiState,
      isEn,
    );
    return projected
      .filter((it) =>
        matchesFilter(
          {
            id: it.id,
            title: String(it.title ?? ''),
            subtitle: String(it.subtitle ?? ''),
            price: String(it.price ?? ''),
            tag: String(it.tag ?? ''),
          },
          p.filter,
          runtimeFilter,
        ),
      )
      .map((it, idx) => ({
        id: it.id,
        row: it,
        title: String(it.title || tr(`卡片项 ${idx + 1}`, `Card ${idx + 1}`)),
        subtitle: String(it.subtitle || ''),
        image: String(it.image || ''),
        price: String(it.price || ''),
        tag: String(it.tag || ''),
      }));
  }, [tableId, rawRows, p.sourceForeignKey, sourceRow, sourceTableId, tables, p.filter, p.items, runtimeFilter, titleKey, subKey, imgKey, priceKey, tagKey, tr, uiState, isEn]);

  if (bindingErrors.length) {
    return (
      <div {...rootWith(root, { className: 'rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">
        {td(bindingErrors[0])}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div {...rootWith(root, { className: cx('rounded-[22px] py-10 text-center', theme.cardBg, theme.textMuted) })}>
        <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <div className="text-[13px]">{tr('暂无匹配的卡片内容', 'No matching items')}</div>
      </div>
    );
  }

  const actionText = typeof p.actionText === 'string' && p.actionText ? p.actionText : tr('查看', 'View');

  return (
    <div
      {...rootWith(root, { className: 'grid gap-2.5' })}
      style={{ ...root.style, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {cards.map((c, idx) => {
        const grad = (theme.isDark ? FEED_GRADIENTS_DARK : FEED_GRADIENTS)[idx % 4];
        const activate = () => void rt.run(p.onItemClick as PropValue, childRowScope(scope, c.row, tableId, fkSourceTableId));
        return (
          <div
            key={c.id}
            onClick={activate}
            {...interactiveBoxProps(Boolean(p.onItemClick) && !rt.isDesign, activate)}
            className={cx(
              'overflow-clip rounded-[20px] flex flex-col justify-between cursor-pointer transition-transform active:scale-[0.99] min-w-0',
              theme.cardBg,
            )}
          >
            <div>
              {c.image ? (
                <img src={c.image} alt={c.title} className="block w-full object-cover" style={{ aspectRatio: '4 / 3' }} />
              ) : (
                <div
                  className={cx(
                    'w-full bg-gradient-to-br flex items-center justify-between px-3',
                    grad,
                    theme.isDark ? 'text-white/80' : 'text-slate-700/70',
                  )}
                  style={{ aspectRatio: '16 / 10' }}
                >
                  <ShoppingBag className="w-5 h-5" aria-hidden="true" />
                  {c.tag && (
                    <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-xs', theme.isDark ? 'bg-black/35 text-white' : 'bg-white/85 text-slate-700')}>
                      {c.tag}
                    </span>
                  )}
                </div>
              )}
              <div className="p-3 pb-2 space-y-1 min-w-0">
                <div className={cx('text-[13px] font-semibold truncate', theme.textPrimary)}>{c.title}</div>
                {c.subtitle && <div className={cx('text-[11px] truncate', theme.textMuted)}>{c.subtitle}</div>}
              </div>
            </div>
            <div className="px-3 pb-3 pt-1 flex items-center justify-between gap-1.5">
              <span className={cx('text-[13.5px] font-bold tabular-nums truncate', theme.accentText)}>{c.price || c.tag}</span>
              <span className={cx('shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-semibold', theme.subtleBg, theme.textPrimary)}>
                {actionText}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const MRepeater: React.FC<CompProps> = ({ node, p, kids, root, rt, scope, renderNode, renderMirroredNode }) => {
  const { isEn, tr, td } = useI18n();
  const uiState = useUIStackState();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const schema = tables.find((t) => t.id === tableId);
  const rawRows = useTableDataRows(tableId);
  const source = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const { fkSourceTableId } = source;
  const runtimeFilter = rt.filters[node.pfId];
  const layout = p.layout === 'grid' || p.layout === 'scroll' ? p.layout : 'stack';
  const cols = Math.max(1, Math.min(2, Math.round(Number(p.cols ?? 2))));
  const pageSize = Math.max(1, Math.round(Number(p.pageSize ?? 8)));
  const autoSelectFirst = Boolean(p.autoSelectFirst);

  const sampleRows = useMemo<Row[]>(
    () => [
      {
        id: 'mrep-1',
        title: tr('智能门店晨检复盘', 'Smart Store Morning Check'),
        subtitle: tr('已完成 12 项设备巡检 · 准确率 100%', '12 checks done · 100% pass'),
        status: tr('正常', 'Healthy'),
      },
      {
        id: 'mrep-2',
        title: tr('冷链温控预警复核', 'Cold-Chain Temp Review'),
        subtitle: tr('2 号冷柜瞬时波动 +1.2℃', 'Freezer #2 +1.2°C spike'),
        status: tr('待处理', 'Pending'),
      },
    ],
    [tr],
  );

  const model = useMemo((): { rows: Row[] } | { error: string } => {
    try {
      if (tableId && !schema) {
        throw new Error(tr(`未找到关联数据表 ${tableId}`, `Bound table "${tableId}" not found`));
      }
      const fkErrors = tableId ? sourceForeignKeyErrors(p, tables) : [];
      if (fkErrors.length) throw new Error(fkErrors[0]);
      const base =
        tableId && schema
          ? typeof p.sourceForeignKey === 'string'
            ? rowsForSource(rawRows, p.sourceForeignKey, tableId, source, tables)
            : rawRows
          : applyUIStackRows(sampleRows, undefined, uiState, isEn);
      return { rows: base.filter((r) => matchesFilter(r, p.filter, runtimeFilter)).slice(0, pageSize) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [tableId, schema, p, tables, rawRows, source, sampleRows, runtimeFilter, pageSize, tr, uiState, isEn]);

  const validRows = 'error' in model ? [] : model.rows;
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: source.row?.id,
    visibleRows: validRows,
    autoSelectFirst,
    runtimeQuery: runtimeFilter,
  });

  if ('error' in model && model.error !== undefined) {
    return (
      <div {...rootWith(root, { className: 'rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">
        {td(model.error)}
      </div>
    );
  }
  if ('error' in model) return null;

  if (kids.length === 0) {
    return (
      <div {...rootWith(root, { className: cx('rounded-[22px] p-5 text-center text-[12px]', theme.subtleBg, theme.textMuted) })}>
        {tr('在 MRepeater 内拖入 MSurface / MButton 等移动组件，用 {{row.字段}} 绑定数据', 'Drop MSurface / MButton inside MRepeater and bind with {{row.field}}')}
      </div>
    );
  }

  if (model.rows.length === 0) {
    if (rt.isDesign && uiState === 'normal') {
      return (
        <div {...rootWith(root, { className: 'space-y-2.5' })}>
          {kids.map((k) => renderNode(k, { row: sampleRows[0], tableId }))}
        </div>
      );
    }
    return (
      <div
        {...rootWith(root, { className: cx('rounded-[22px] py-8 text-center', theme.cardBg, theme.textMuted) })}
        data-ui-stack="empty"
      >
        <Inbox className="w-7 h-7 mx-auto mb-1.5 opacity-50" aria-hidden="true" />
        <div className="text-[12.5px]">{String(p.emptyText || tr('暂无相关内容', 'No items found'))}</div>
      </div>
    );
  }

  const containerCls =
    layout === 'scroll'
      ? 'flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory'
      : layout === 'grid'
      ? cx('grid gap-2.5', cols === 1 ? 'grid-cols-1' : 'grid-cols-2')
      : 'space-y-2.5';

  return (
    <div {...rootWith(root, { className: containerCls })}>
      {model.rows.map((row, idx) => {
        const clickable = (Boolean(p.onItemClick) || autoSelectFirst) && !rt.isDesign;
        const isActive = Boolean(tableId && activeRowId === row.id);
        const renderFn = rt.isDesign && idx > 0 && renderMirroredNode ? renderMirroredNode : renderNode;
        return (
          <div
            key={row.id}
            data-row-id={row.id}
            data-active-row={isActive ? '1' : undefined}
            onClick={() => {
              if (!clickable) return;
              if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, row.id, fkSourceTableId);
              if (p.onItemClick) void rt.run(p.onItemClick as PropValue, childRowScope(scope, row, tableId, fkSourceTableId));
            }}
            className={cx(
              'min-w-0 rounded-[22px] transition',
              layout === 'scroll' && 'min-w-[240px] max-w-[280px] shrink-0 snap-start',
              clickable && 'cursor-pointer active:scale-[0.99]',
              isActive && 'ring-2 ring-blue-500/60',
              rt.isDesign && idx > 0 && 'opacity-90',
            )}
          >
            {kids.map((k) => renderFn(k, { row, tableId, collectionSourceTableId: fkSourceTableId }))}
          </div>
        );
      })}
    </div>
  );
};

const MKanban: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { isEn, tr, td } = useI18n();
  const uiState = useUIStackState();
  const theme = useMobileTheme();
  const preview = useContext(PreviewDataContext);
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const schema = tables.find((t) => t.id === tableId);
  const rawRows = useTableDataRows(tableId);
  const source = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const { fkSourceTableId } = source;
  const runtimeFilter = rt.filters[node.pfId];
  const allowMove = p.allowMove !== false;
  const autoSelectFirst = Boolean(p.autoSelectFirst);
  const [activeLaneIdx, setActiveLaneIdx] = useState(0);
  const [sampleRows, setSampleRows] = useState<Row[]>(() => [
    { id: 'mkb-1', title: '旗舰店陈列焕新巡检', subtitle: '静安中心店 · 陈店长', metric: '高优', status: '待接单' },
    { id: 'mkb-2', title: '冷链车次到货扫码签收', subtitle: '沪A·88291 · 16箱生鲜', metric: '¥24,800', status: '处理中' },
    { id: 'mkb-3', title: '季度消防设施安全复查', subtitle: '后仓与配电间全检', metric: '100%', status: '待验收' },
  ]);

  const model = useMemo(() => {
    try {
      if (tableId && !schema) {
        throw new Error(tr(`未找到关联数据表 ${tableId}`, `Bound table "${tableId}" not found`));
      }
      const fkErrors = tableId ? sourceForeignKeyErrors(p, tables) : [];
      if (fkErrors.length) throw new Error(fkErrors[0]);

      const nonPk = schema?.columns.filter((c) => !c.isPrimaryKey) ?? [];
      const statusInfo = resolveKanbanStatusColumn(schema, p.statusField, p.lanes);
      const statusCol = statusInfo.statusCol;
      const statusKey = statusInfo.statusKey;

      const base =
        tableId && schema
          ? typeof p.sourceForeignKey === 'string'
            ? rowsForSource(rawRows, p.sourceForeignKey, tableId, source, tables)
            : rawRows
          : applyUIStackRows(sampleRows, undefined, uiState, isEn);
      const filtered = base.filter((r) => matchesFilter(r, p.filter, runtimeFilter));

      const configuredLanes = Array.isArray(p.lanes)
        ? (p.lanes as unknown[]).map((x) => String(x)).filter(Boolean)
        : [];
      const enumLanes = statusCol ? (declaredColumnOptions(statusCol) ?? []).map(option => String(option.value)) : [];
      const rowLanes = [...new Set(filtered.map((r) => String(r[statusKey] ?? '')).filter(Boolean))];
      const lanes = configuredLanes.length
        ? configuredLanes
        : enumLanes.length
        ? enumLanes
        : rowLanes.length
        ? rowLanes
        : [tr('待接单', 'Queued'), tr('处理中', 'Active'), tr('已结单', 'Done')];

      const allLanes = [...lanes];
      for (const rl of rowLanes) {
        if (!allLanes.includes(rl)) allLanes.push(rl);
      }

      const titleKey =
        (typeof p.titleField === 'string' && p.titleField) ||
        nonPk.find((c) => c.name !== statusKey)?.name ||
        'title';
      const subtitleKey =
        (typeof p.subtitleField === 'string' && p.subtitleField) ||
        nonPk.find((c) => c.name !== statusKey && c.name !== titleKey)?.name ||
        'subtitle';
      const metricKey = (typeof p.metricField === 'string' && p.metricField) || (schema ? '' : 'metric');

      return {
        rows: filtered,
        lanes: allLanes,
        moveTargets: new Set(lanes),
        statusKey,
        statusWritable: statusInfo.writable,
        titleKey,
        subtitleKey,
        metricKey,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [tableId, schema, p, tables, rawRows, source, sampleRows, runtimeFilter, tr, uiState, isEn]);

  const validRows = 'error' in model ? [] : model.rows;
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: source.row?.id,
    visibleRows: validRows,
    autoSelectFirst,
    runtimeQuery: runtimeFilter,
  });

  if ('error' in model && model.error !== undefined) {
    return (
      <div {...rootWith(root, { className: 'rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">
        {td(model.error)}
      </div>
    );
  }
  if ('error' in model) return null;

  if (uiState === 'empty' && model.rows.length === 0) {
    return (
      <div
        {...rootWith(root, { className: cx('rounded-[22px] py-8 text-center text-[12.5px]', theme.cardBg, theme.textMuted) })}
        data-ui-stack="empty"
      >
        <Inbox className="w-7 h-7 mx-auto mb-1.5 opacity-50" aria-hidden="true" />
        <div>{tr('暂无待流转事项', 'No items on board')}</div>
      </div>
    );
  }

  const safeLaneIdx = Math.min(activeLaneIdx, Math.max(0, model.lanes.length - 1));
  const canMutate = allowMove && model.statusWritable && !rt.isDesign && !preview && uiState === 'normal';
  const canMoveTo = (lane: string) => canMutate && model.moveTargets.has(lane);
  const moveCard = (row: Row, nextLane: string) => {
    if (!canMoveTo(nextLane)) return;
    if (tableId && schema) {
      try {
        usePageStore.getState().updateRow(tableId, row.id, { [model.statusKey]: nextLane });
      } catch {
        // Ignore strict enum mismatch if lane is custom
      }
    } else {
      setSampleRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [model.statusKey]: nextLane } : r)));
    }
  };

  const rowActions = (Array.isArray(p.rowActions) ? p.rowActions : []) as {
    label?: string;
    primary?: boolean;
    danger?: boolean;
    disabledWhenField?: string;
    disabledWhenValue?: string;
    disabledReason?: string;
    hiddenWhenField?: string;
    hiddenWhenValue?: string;
    onClick?: PropValue;
  }[];

  return (
    <div {...rootWith(root, { className: 'space-y-3' })}>
      {/* Touch-friendly pill lane switcher */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {model.lanes.map((lane, idx) => {
          const count = model.rows.filter((r) => String(r[model.statusKey] ?? model.lanes[0]) === lane).length;
          const active = idx === safeLaneIdx;
          return (
            <button
              key={lane}
              type="button"
              onClick={() => setActiveLaneIdx(idx)}
              className={cx(
                'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition cursor-pointer',
                active ? theme.accentSolidBg : cx(theme.cardBg, theme.textSecondary),
              )}
            >
              <span>{td(lane)}</span>
              <span className={cx('rounded-full px-1.5 py-0.2 text-[10.5px] tabular-nums', active ? 'bg-white/25' : theme.subtleBg)}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active lane cards */}
      <div className="space-y-2.5" data-kanban-lane={model.lanes[safeLaneIdx]}>
        {(() => {
          const lane = model.lanes[safeLaneIdx];
          const laneRows = model.rows.filter((r) => String(r[model.statusKey] ?? model.lanes[0]) === lane);
          if (laneRows.length === 0) {
            return (
              <div className={cx('rounded-[22px] py-8 text-center text-[12.5px]', theme.cardBg, theme.textMuted)}>
                {tr('该状态泳道下暂无事项', 'No items in this stage')}
              </div>
            );
          }
          return laneRows.map((row) => {
            const titleText = String(row[model.titleKey] ?? row.id);
            const subText = model.subtitleKey && row[model.subtitleKey] != null ? String(row[model.subtitleKey]) : '';
            const metricText = model.metricKey && row[model.metricKey] != null ? String(row[model.metricKey]) : '';
            const isActive = Boolean(tableId && activeRowId === row.id);
            const clickable = (Boolean(p.onCardClick) || autoSelectFirst) && !rt.isDesign;

            return (
              <div
                key={row.id}
                data-row-id={row.id}
                data-active-row={isActive ? '1' : undefined}
                onClick={() => {
                  if (!clickable) return;
                  if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, row.id, fkSourceTableId);
                  if (p.onCardClick) void rt.run(p.onCardClick as PropValue, childRowScope(scope, row, tableId, fkSourceTableId));
                }}
                className={cx(
                  'rounded-[22px] p-4 space-y-2.5 transition',
                  theme.cardBg,
                  clickable && 'cursor-pointer active:scale-[0.99]',
                  isActive && 'ring-2 ring-blue-500/60',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className={cx('text-[14px] font-semibold leading-snug', theme.textPrimary)}>{titleText}</div>
                  {metricText && (
                    <span className={cx('shrink-0 text-[12.5px] font-bold tabular-nums', theme.accentText)}>{metricText}</span>
                  )}
                </div>
                {subText && <div className={cx('text-[12px] leading-relaxed', theme.textSecondary)}>{subText}</div>}
                {(canMutate || rowActions.length > 0) && (
                  <div className="flex items-center justify-between gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      {safeLaneIdx > 0 && canMoveTo(model.lanes[safeLaneIdx - 1]) && (
                        <button
                          type="button"
                          onClick={() => {
                            moveCard(row, model.lanes[safeLaneIdx - 1]);
                            setActiveLaneIdx(safeLaneIdx - 1);
                          }}
                          className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium cursor-pointer', theme.subtleBg, theme.textSecondary)}
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>{td(model.lanes[safeLaneIdx - 1])}</span>
                        </button>
                      )}
                      {safeLaneIdx < model.lanes.length - 1 && canMoveTo(model.lanes[safeLaneIdx + 1]) && (
                        <button
                          type="button"
                          onClick={() => {
                            moveCard(row, model.lanes[safeLaneIdx + 1]);
                            setActiveLaneIdx(safeLaneIdx + 1);
                          }}
                          className={cx('inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold cursor-pointer', theme.pillActiveBg)}
                        >
                          <span>{tr('推进至', 'To')} {td(model.lanes[safeLaneIdx + 1])}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {rowActions.map((act, ai) => {
                        if (!rt.isDesign && matchesWhenCondition(row, act.hiddenWhenField, act.hiddenWhenValue)) return null;
                        const actDisabled = !rt.isDesign && matchesWhenCondition(row, act.disabledWhenField, act.disabledWhenValue);
                        return (
                          <button
                            key={ai}
                            type="button"
                            disabled={actDisabled}
                            title={actDisabled && act.disabledReason ? act.disabledReason : undefined}
                            onClick={() => {
                              if (!rt.isDesign && !actDisabled && act.onClick) void rt.run(act.onClick, childRowScope(scope, row, tableId, fkSourceTableId));
                            }}
                            className={cx(
                              'rounded-full px-3 py-1 text-[11.5px] font-semibold',
                              actDisabled
                                ? 'opacity-45 cursor-not-allowed bg-slate-200/70 text-slate-400'
                                : cx('cursor-pointer', act.danger ? 'bg-rose-500/12 text-rose-600' : act.primary ? theme.accentSolidBg : theme.pillActiveBg),
                            )}
                          >
                            {act.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
};

function parseMobileDateKey(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(raw).trim());
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

const MCalendar: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { tr, td, isEn } = useI18n();
  const uiState = useUIStackState();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const schema = tables.find((t) => t.id === tableId);
  const rawRows = useTableDataRows(tableId);
  const source = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const { fkSourceTableId } = source;
  const runtimeFilter = rt.filters[node.pfId];
  const autoSelectFirst = Boolean(p.autoSelectFirst);

  const sampleAgenda = useMemo<Row[]>(
    () => [
      { id: 'mcal-1', date: '2026-11-24', title: tr('09:30 华东核心客户驻场回访', '09:30 Key Account Onsite Visit'), subtitle: tr('张江高科园区 B 座', 'Zhangjiang Tech Park'), status: tr('已确认', 'Confirmed') },
      { id: 'mcal-2', date: '2026-11-24', title: tr('14:00 季度供应链履约评审会', '14:00 Supply Chain SLA Review'), subtitle: tr('线上会议室 · 采购与仓储协同', 'Online Sync'), status: tr('待开始', 'Upcoming') },
      { id: 'mcal-3', date: '2026-11-25', title: tr('10:00 新签门店设备验收交付', '10:00 New Store Handover'), subtitle: tr('徐汇旗舰店', 'Xuhui Flagship'), status: tr('计划中', 'Planned') },
    ],
    [tr],
  );

  const model = useMemo(() => {
    try {
      if (tableId && !schema) {
        throw new Error(tr(`未找到关联数据表 ${tableId}`, `Bound table "${tableId}" not found`));
      }
      const fkErrors = tableId ? sourceForeignKeyErrors(p, tables) : [];
      if (fkErrors.length) throw new Error(fkErrors[0]);

      const cols = schema?.columns ?? [];
      const dateCol =
        (typeof p.dateField === 'string' && p.dateField ? cols.find((c) => c.name === p.dateField) : undefined) ??
        cols.find((c) => /DATE|TIMESTAMP/i.test(c.dataType) || /date|time|day|deadline|at$/i.test(c.name));
      const dateKey = (typeof p.dateField === 'string' && p.dateField) || dateCol?.name || 'date';
      const titleKey =
        (typeof p.titleField === 'string' && p.titleField) ||
        cols.find((c) => !c.isPrimaryKey && c.name !== dateKey)?.name ||
        'title';
      const subtitleKey =
        (typeof p.subtitleField === 'string' && p.subtitleField) ||
        cols.find((c) => !c.isPrimaryKey && c.name !== dateKey && c.name !== titleKey)?.name ||
        'subtitle';
      const statusKey =
        (typeof p.statusField === 'string' && p.statusField) ||
        cols.find((c) => /status|state|stage/i.test(c.name))?.name ||
        'status';

      const base =
        tableId && schema
          ? typeof p.sourceForeignKey === 'string'
            ? rowsForSource(rawRows, p.sourceForeignKey, tableId, source, tables)
            : rawRows
          : applyUIStackRows(sampleAgenda, undefined, uiState, isEn);
      const filtered = base.filter((r) => matchesFilter(r, p.filter, runtimeFilter));
      const dated = filtered
        .map((row) => ({ row, dayKey: parseMobileDateKey(row[dateKey]) }))
        .filter((x): x is { row: Row; dayKey: string } => x.dayKey !== null);

      return { rows: filtered, dated, dateKey, titleKey, subtitleKey, statusKey };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [tableId, schema, p, tables, rawRows, source, sampleAgenda, uiState, isEn, runtimeFilter, tr]);

  const firstDayKey = 'error' in model ? '2026-11-24' : model.dated[0]?.dayKey ?? '2026-11-24';
  const [selectedDay, setSelectedDay] = useState<string>(firstDayKey);
  useEffect(() => {
    setSelectedDay(firstDayKey);
  }, [firstDayKey]);

  const validRows = 'error' in model ? [] : model.rows;
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: source.row?.id,
    visibleRows: validRows,
    autoSelectFirst,
    runtimeQuery: runtimeFilter,
  });

  if ('error' in model && model.error !== undefined) {
    return (
      <div {...rootWith(root, { className: 'rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">
        {td(model.error)}
      </div>
    );
  }
  if ('error' in model) return null;

  if (uiState === 'empty' && model.dated.length === 0) {
    return (
      <div
        {...rootWith(root, {
          className: cx('rounded-[22px] py-8 px-4 text-center text-[12.5px]', theme.cardBg, theme.textMuted),
        })}
        data-ui-stack="empty"
      >
        {String(p.emptyText || tr('暂无排期日程事项', 'No scheduled agenda events'))}
      </div>
    );
  }

  // Build strip of 7 days (week) or 14 days around selectedDay
  const stripCount = p.mode === 'month' ? 14 : 7;
  const anchorDate = new Date(`${selectedDay}T00:00:00`);
  const baseDate = Number.isNaN(anchorDate.getTime()) ? new Date('2026-11-24T00:00:00') : anchorDate;
  const dowOffset = (baseDate.getDay() + 6) % 7;
  const stripStart = new Date(baseDate);
  stripStart.setDate(baseDate.getDate() - dowOffset);

  const weekdayShort = isEn ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['一', '二', '三', '四', '五', '六', '日'];
  const eventCounts = new Map<string, number>();
  for (const d of model.dated) eventCounts.set(d.dayKey, (eventCounts.get(d.dayKey) ?? 0) + 1);

  const dayStrip = Array.from({ length: stripCount }).map((_, idx) => {
    const dt = new Date(stripStart);
    dt.setDate(stripStart.getDate() + idx);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return {
      key,
      dayNum: dt.getDate(),
      wk: weekdayShort[idx % 7],
      count: eventCounts.get(key) ?? 0,
    };
  });

  const agendaRows = model.dated.filter((d) => d.dayKey === selectedDay).map((d) => d.row);

  return (
    <div {...rootWith(root, { className: cx('rounded-[22px] p-4 space-y-3.5', theme.cardBg) })}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className={cx('w-4 h-4', theme.accentText)} aria-hidden="true" />
          <span className={cx('text-[14.5px] font-semibold', theme.textPrimary)}>
            {String(p.title || tr('日程安排', 'Schedule'))}
          </span>
        </div>
        <span className={cx('text-[11.5px] font-medium tabular-nums', theme.textMuted)}>{selectedDay}</span>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {dayStrip.map((d) => {
          const isSel = d.key === selectedDay;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => setSelectedDay(d.key)}
              className={cx(
                'flex flex-col items-center justify-center rounded-2xl py-2 transition cursor-pointer',
                isSel ? theme.accentSolidBg : cx(theme.subtleBg, theme.textPrimary),
              )}
            >
              <span className={cx('text-[10px]', isSel ? 'opacity-85' : theme.textMuted)}>{d.wk}</span>
              <span className="mt-0.5 text-[13px] font-bold tabular-nums">{d.dayNum}</span>
              <span
                className={cx(
                  'mt-1 h-1.5 w-1.5 rounded-full',
                  d.count > 0 ? (isSel ? 'bg-white' : 'bg-blue-500') : 'bg-transparent',
                )}
              />
            </button>
          );
        })}
      </div>

      <div className="space-y-2 pt-1">
        {agendaRows.length === 0 ? (
          <div className={cx('rounded-2xl py-5 text-center text-[12px]', theme.subtleBg, theme.textMuted)}>
            {tr('当日暂无排期事项', 'No scheduled events for this day')}
          </div>
        ) : (
          agendaRows.map((row) => {
            const titleText = String(row[model.titleKey] ?? row.id);
            const subText = model.subtitleKey && row[model.subtitleKey] != null ? String(row[model.subtitleKey]) : '';
            const statusVal = model.statusKey && row[model.statusKey] != null ? String(row[model.statusKey]) : '';
            const isActive = Boolean(tableId && activeRowId === row.id);
            const clickable = (Boolean(p.onEventClick) || autoSelectFirst) && !rt.isDesign;

            return (
              <div
                key={row.id}
                data-row-id={row.id}
                data-active-row={isActive ? '1' : undefined}
                onClick={() => {
                  if (!clickable) return;
                  if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, row.id, fkSourceTableId);
                  if (p.onEventClick) void rt.run(p.onEventClick as PropValue, childRowScope(scope, row, tableId, fkSourceTableId));
                }}
                className={cx(
                  'flex items-start justify-between gap-2.5 rounded-2xl p-3 transition',
                  theme.subtleBg,
                  clickable && 'cursor-pointer active:scale-[0.99]',
                  isActive && 'ring-2 ring-blue-500/60',
                )}
              >
                <div className="min-w-0 space-y-0.5">
                  <div className={cx('text-[13px] font-semibold leading-snug', theme.textPrimary)}>{titleText}</div>
                  {subText && <div className={cx('text-[11.5px] truncate', theme.textMuted)}>{subText}</div>}
                </div>
                {statusVal && (
                  <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold', statusToneCls(statusVal, theme.isDark))}>
                    {td(statusVal)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const MAiInsightCard: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const items = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  const tone = (p.tone as string) || 'glow';

  if (tone === 'dark_brief') {
    return (
      <div
        {...rootWith(root, {
          className:
            'pf-mobile-brief-mesh rounded-[24px] p-5 text-[#F4F7F4] space-y-3.5 ring-1 ring-inset ring-[#A3E635]/20 shadow-[0_16px_34px_-10px_rgba(9,18,14,0.5)]',
          style: { colorScheme: 'dark' },
        })}
        data-insight-tone="dark_brief"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#A3E635]/18 text-[#D9F99D] ring-1 ring-inset ring-[#A3E635]/35 text-[11px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#A3E635]" aria-hidden="true" />
            <span>{String(p.badge || tr('今日简报', "Today's Brief"))}</span>
          </span>
          {Boolean(p.timestamp) && (
            <span className="text-[11.5px] font-medium text-white/60">{String(p.timestamp)}</span>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="text-[17px] font-semibold tracking-tight text-white">
            {String(p.title || tr('AI 智能助手建议', 'AI Assistant Insight'))}
          </div>
          {Boolean(p.summary) && (
            <p className="text-[13px] leading-relaxed text-white/80">{String(p.summary)}</p>
          )}
        </div>

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2.5 rounded-2xl px-3.5 py-2.5 bg-white/[0.07] ring-1 ring-inset ring-white/10"
              >
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold truncate text-white">{String(it.title ?? '')}</div>
                  {Boolean(it.detail) && (
                    <div className="text-[11px] truncate mt-0.5 text-white/65">{String(it.detail)}</div>
                  )}
                </div>
                {Boolean(it.actionLabel) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!rt.isDesign && it.onClick) void rt.run(it.onClick as PropValue, scope);
                    }}
                    className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold bg-[#ECFCCB] text-[#0F2417] cursor-pointer transition-transform active:scale-95"
                  >
                    {String(it.actionLabel)}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {Boolean(p.primaryActionLabel) && (
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => {
                if (!rt.isDesign && p.onPrimaryAction) void rt.run(p.onPrimaryAction as PropValue, scope);
              }}
              className="flex-1 min-h-[42px] px-4 rounded-full bg-[#ECFCCB] text-[#0F2417] text-[13px] font-semibold inline-flex items-center justify-center cursor-pointer transition-transform active:scale-[0.98]"
            >
              {String(p.primaryActionLabel)}
            </button>
            <button
              type="button"
              aria-label={String(p.primaryActionLabel)}
              onClick={() => {
                if (!rt.isDesign && p.onPrimaryAction) void rt.run(p.onPrimaryAction as PropValue, scope);
              }}
              className="w-[42px] h-[42px] rounded-full bg-white/12 text-[#ECFCCB] ring-1 ring-inset ring-white/16 inline-flex items-center justify-center shrink-0 cursor-pointer transition-transform active:scale-95"
            >
              <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      {...rootWith(root, {
        className: cx(
          'p-[1.5px] rounded-[23.5px]',
          theme.isDark
            ? 'bg-gradient-to-br from-[#8AB4F8]/80 via-[#C58AF9]/75 to-[#F28B82]/80'
            : 'bg-gradient-to-br from-[#4285F4]/70 via-[#9B72CB]/65 to-[#D96570]/70',
        ),
      })}
    >
      <div className={cx('rounded-[22px] p-4 space-y-3', theme.cardBg)}>
        <div
          onClick={() => {
            if (!rt.isDesign && p.onPrimaryAction) void rt.run(p.onPrimaryAction as PropValue, scope);
          }}
          className={cx('flex items-start justify-between gap-2', Boolean(p.onPrimaryAction) && !rt.isDesign && 'cursor-pointer')}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#4285F4] to-[#9B72CB] text-white">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
            <span className={cx('text-[14.5px] font-semibold truncate', theme.textPrimary)}>
              {String(p.title || tr('AI 智能助手建议', 'AI Assistant Insight'))}
            </span>
          </div>
          {Boolean(p.badge) && (
            <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold', theme.pillActiveBg)}>
              {String(p.badge)}
            </span>
          )}
        </div>

        {Boolean(p.summary) && (
          <p className={cx('text-[12.5px] leading-relaxed', theme.textSecondary)}>{String(p.summary)}</p>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div
                key={idx}
                className={cx('flex items-center justify-between gap-2.5 rounded-2xl px-3 py-2.5', theme.subtleBg)}
              >
                <div className="min-w-0">
                  <div className={cx('text-[12.5px] font-semibold truncate', theme.textPrimary)}>{String(it.title ?? '')}</div>
                  {Boolean(it.detail) && (
                    <div className={cx('text-[11px] truncate mt-0.5', theme.textMuted)}>{String(it.detail)}</div>
                  )}
                </div>
                {Boolean(it.actionLabel) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!rt.isDesign && it.onClick) void rt.run(it.onClick as PropValue, scope);
                    }}
                    className={cx('shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold cursor-pointer', theme.accentSolidBg)}
                  >
                    {String(it.actionLabel)}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const PROGRESS_TONE_FILL: Record<string, { fill: string; stroke: string }> = {
  forest: { fill: 'bg-[#1B4332]', stroke: '#22C55E' },
  emerald: { fill: 'bg-emerald-600', stroke: '#10B981' },
  amber: { fill: 'bg-amber-500', stroke: '#F59E0B' },
  rose: { fill: 'bg-rose-500', stroke: '#F43F5E' },
  blue: { fill: 'bg-blue-600', stroke: '#3B82F6' },
  violet: { fill: 'bg-violet-600', stroke: '#8B5CF6' },
  obsidian: { fill: 'bg-[#181A1F]', stroke: '#94A3B8' },
};

const MProgressList: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { isEn, tr, td } = useI18n();
  const preview = useContext(PreviewDataContext);
  const uiState = useUIStackState();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const schema = useMemo(() => tables.find((t) => t.id === tableId), [tables, tableId]);
  const rawRows = useTableDataRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const bindingErrors = useMemo(
    () => collectionBindingErrors('MProgressList', p, tables),
    [p, tables],
  );
  const scopedRows = useMemo(
    () =>
      tableId
        ? bindingErrors.length > 0
          ? []
          : typeof p.sourceForeignKey === 'string'
          ? rowsForSource(rawRows, p.sourceForeignKey, tableId, { row: sourceRow, tableId: sourceTableId }, tables)
          : rawRows
        : [],
    [rawRows, tables, tableId, p.sourceForeignKey, sourceRow, sourceTableId, bindingErrors.length],
  );
  const runtimeFilter = rt.filters[node.pfId];
  const filteredRows = useMemo(
    () => scopedRows.filter((r) => matchesFilter(r, p.filter, runtimeFilter)),
    [scopedRows, p.filter, runtimeFilter],
  );

  const entries = useMemo(() => {
    if (tableId) {
      const cols = schema ? defaultDisplayColumns(schema) : [];
      const labelKey = typeof p.labelField === 'string' && p.labelField ? p.labelField : cols[0]?.name || 'id';
      const valKey = typeof p.valueField === 'string' ? p.valueField.trim() : '';
      const targetKey = typeof p.targetField === 'string' ? p.targetField.trim() : '';
      const statusKey = typeof p.statusField === 'string' ? p.statusField.trim() : '';
      return filteredRows.map((row, idx) => {
        const parsedVal = valKey && Object.prototype.hasOwnProperty.call(row, valKey)
          ? parseProgressMetric(row[valKey])
          : { kind: 'missing' as const };
        const parsedTarget =
          targetKey && Object.prototype.hasOwnProperty.call(row, targetKey)
            ? parseProgressMetric(row[targetKey])
            : null;
        const pct = parsedVal.kind === 'valid' ? parsedVal.pct : null;
        const target = parsedTarget?.kind === 'valid' ? parsedTarget.pct : undefined;
        const statusStr = statusKey && row[statusKey] != null ? String(row[statusKey]) : '';
        const tone =
          parsedVal.kind !== 'valid' ||
          /异常|风险|驳回|滞后|overdue|risk|low/i.test(statusStr) ||
          (pct !== null && target !== undefined && pct + 10 < target)
            ? 'amber'
            : idx % 2 === 0
            ? 'forest'
            : 'emerald';
        return {
          id: String(row.id ?? idx),
          label: td(String(row[labelKey] ?? row.id)),
          metricState: parsedVal.kind,
          value: pct,
          target,
          subtitle: statusStr ? td(statusStr) : undefined,
          tone,
          row,
          staticRecord: undefined as Row | undefined,
          onClick: undefined as PropValue | undefined,
        };
      });
    }

    const rawStaticItems = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
    const projectedItems = applyUIStackRows(
      rawStaticItems.map((it, idx) => ({ id: `prog-${idx}`, ...it })),
      undefined,
      uiState,
      isEn,
    );

    return projectedItems
      .filter((it) =>
        matchesFilter(
          {
            id: String(it.id ?? ''),
            label: String(it.label ?? it.title ?? ''),
            subtitle: String(it.subtitle ?? ''),
            tone: String(it.tone ?? ''),
          },
          p.filter,
          runtimeFilter,
        ),
      )
      .map((it, idx) => {
        const parsedVal = parseProgressMetric(it.value);
        const parsedTarget = it.target !== undefined ? parseProgressMetric(it.target) : null;
        const label = String(it.label ?? it.title ?? tr(`分项 ${idx + 1}`, `Item ${idx + 1}`));
        const staticRecord: Row = {
          id: String(it.id ?? `prog-${idx}`),
          label,
          value: parsedVal.kind === 'valid' ? parsedVal.pct : '',
          subtitle: it.subtitle ? String(it.subtitle) : '',
          tone: typeof it.tone === 'string' ? it.tone : 'forest',
        };
        return {
          id: String(it.id ?? idx),
          label,
          metricState: parsedVal.kind,
          value: parsedVal.kind === 'valid' ? parsedVal.pct : null,
          target: parsedTarget?.kind === 'valid' ? parsedTarget.pct : undefined,
          subtitle: it.subtitle ? String(it.subtitle) : undefined,
          tone: typeof it.tone === 'string' && PROGRESS_TONE_FILL[it.tone] ? it.tone : 'forest',
          row: undefined as Row | undefined,
          staticRecord,
          onClick: it.onClick as PropValue | undefined,
        };
      });
  }, [
    tableId,
    schema,
    p.labelField,
    p.valueField,
    p.targetField,
    p.statusField,
    p.items,
    p.filter,
    runtimeFilter,
    filteredRows,
    uiState,
    isEn,
    tr,
    td,
  ]);

  if (bindingErrors.length) {
    return (
      <div
        {...rootWith(root, {
          className: 'rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800',
        })}
        role="alert"
      >
        {td(bindingErrors[0])}
      </div>
    );
  }

  const variant = p.variant === 'gauge' ? 'gauge' : 'capsule';

  const getEntryActivation = (entry: (typeof entries)[number]) => {
    const action = entry.onClick ?? (p.onItemClick as PropValue | undefined);
    const canonicalRow =
      tableId && entry.row ? resolveCanonicalRow(tableId, entry.row, preview?.rows) ?? entry.row : undefined;
    const blockedByMissingRow =
      actionChainRequiresBoundRow(action) && (!tableId || !canonicalRow);
    const clickable = !rt.isDesign && Boolean(action) && !blockedByMissingRow;
    const activate = () => {
      if (!clickable || !action) return;
      const nextScope =
        tableId && canonicalRow
          ? childRowScope(scope, canonicalRow, tableId, fkSourceTableId)
          : isolatedStaticItemScope(scope, entry.staticRecord);
      void rt.run(action, nextScope);
    };
    const displayValue =
      entry.metricState === 'valid' && entry.value !== null
        ? `${entry.value}%`
        : entry.metricState === 'invalid'
        ? tr('无效值', 'Invalid')
        : '—';
    return { clickable, activate, displayValue };
  };

  return (
    <div {...rootWith(root, { className: cx('rounded-[22px] p-4 space-y-3', theme.cardBg) })} data-progress-variant={variant}>
      {(p.title || p.extra) && (
        <div className="flex items-center justify-between gap-2">
          {p.title && <h3 className={cx('text-[15px] font-semibold tracking-tight', theme.textPrimary)}>{String(p.title)}</h3>}
          {p.extra && (
            <button
              type="button"
              onClick={() => rt.run(p.onExtraClick as PropValue, scope)}
              className={cx('text-[12px] font-semibold inline-flex items-center gap-0.5 cursor-pointer', theme.accentText)}
            >
              <span>{String(p.extra)}</span>
              {Boolean(p.onExtraClick) && <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className={cx('rounded-2xl py-6 text-center text-[12.5px]', theme.subtleBg, theme.textMuted)}>
          {String(p.emptyText || tr('暂无进度数据', 'No progress records'))}
        </div>
      ) : variant === 'gauge' ? (
        <div className="space-y-3">
          <div className={cx('grid gap-2.5', entries.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
            {entries.slice(0, 2).map((entry) => {
              const palette = PROGRESS_TONE_FILL[entry.tone] ?? PROGRESS_TONE_FILL.forest;
              const arcLen = 125.6;
              const fillPct = entry.value ?? 0;
              const dashOffset = arcLen * (1 - fillPct / 100);
              const { clickable, activate, displayValue } = getEntryActivation(entry);
              return (
                <div
                  key={entry.id}
                  data-progress-item-id={entry.id}
                  onClick={clickable ? activate : undefined}
                  {...interactiveBoxProps(clickable, activate)}
                  className={cx(
                    'rounded-[18px] p-3 flex flex-col items-center text-center gap-1',
                    theme.subtleBg,
                    clickable && 'cursor-pointer active:scale-[0.98] transition-transform',
                  )}
                >
                  <svg viewBox="0 0 100 58" className="w-28 h-16 overflow-visible" aria-hidden="true">
                    <path
                      d="M 10 50 A 40 40 0 0 1 90 50"
                      fill="none"
                      stroke={theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.1)'}
                      strokeWidth="9"
                      strokeLinecap="round"
                    />
                    {entry.value !== null && (
                      <path
                        d="M 10 50 A 40 40 0 0 1 90 50"
                        fill="none"
                        stroke={palette.stroke}
                        strokeWidth="9"
                        strokeLinecap="round"
                        strokeDasharray={arcLen}
                        strokeDashoffset={dashOffset}
                      />
                    )}
                  </svg>
                  {entry.value !== null ? (
                    <SplitMetricText
                      value={displayValue}
                      className={cx('text-[20px] font-bold -mt-5', theme.textPrimary)}
                    />
                  ) : (
                    <span
                      data-missing-value="1"
                      className={cx('text-[18px] font-semibold -mt-5 tabular-nums', theme.textMuted)}
                    >
                      {displayValue}
                    </span>
                  )}
                  <div className={cx('text-[12px] font-semibold truncate max-w-full', theme.textPrimary)}>
                    {entry.label}
                  </div>
                  {entry.target !== undefined && (
                    <div className={cx('text-[10.5px] font-medium', theme.textMuted)}>
                      {tr(`计划 ${entry.target}%`, `Plan ${entry.target}%`)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {entries.slice(2).map((entry) => {
            const palette = PROGRESS_TONE_FILL[entry.tone] ?? PROGRESS_TONE_FILL.forest;
            const { clickable, activate, displayValue } = getEntryActivation(entry);
            return (
              <div
                key={entry.id}
                data-progress-item-id={entry.id}
                onClick={clickable ? activate : undefined}
                {...interactiveBoxProps(clickable, activate)}
                className={cx(
                  'space-y-1 rounded-xl p-2 -mx-1',
                  clickable && 'cursor-pointer active:scale-[0.99] transition-transform',
                )}
              >
                <div className="flex items-center justify-between text-[12px]">
                  <span className={cx('font-medium truncate', theme.textPrimary)}>{entry.label}</span>
                  <span className={cx('font-semibold tabular-nums', theme.textSecondary)}>
                    {displayValue}{entry.target !== undefined ? ` / ${entry.target}%` : ''}
                  </span>
                </div>
                <div className={cx('h-2.5 rounded-full overflow-hidden', theme.subtleBg)}>
                  {entry.value !== null && entry.value > 0 && (
                    <div
                      className={cx('h-full rounded-full pf-capsule-fill', palette.fill)}
                      style={{ width: `${entry.value}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map((entry) => {
            const palette = PROGRESS_TONE_FILL[entry.tone] ?? PROGRESS_TONE_FILL.forest;
            const { clickable, activate, displayValue } = getEntryActivation(entry);
            return (
              <div
                key={entry.id}
                data-progress-item-id={entry.id}
                onClick={clickable ? activate : undefined}
                {...interactiveBoxProps(clickable, activate)}
                className={cx(
                  'relative min-h-[48px] rounded-[18px] overflow-hidden flex items-center justify-between gap-2 px-3.5 py-2',
                  theme.subtleBg,
                  clickable && 'cursor-pointer active:scale-[0.98] transition-transform',
                )}
              >
                {entry.value !== null && entry.value > 0 && (
                  <div
                    className={cx('absolute inset-y-0 left-0 rounded-[18px] pf-capsule-fill opacity-90', palette.fill)}
                    style={{ width: `${Math.max(entry.value, 8)}%` }}
                    aria-hidden="true"
                  />
                )}
                {entry.target !== undefined && (
                  <div
                    className="absolute inset-y-1.5 w-[2px] rounded-full bg-white/75 dark:bg-white/65 z-[1]"
                    style={{ left: `${entry.target}%` }}
                    aria-hidden="true"
                  />
                )}
                <div className="relative z-10 min-w-0 flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-xs text-white text-[12.5px] font-semibold truncate">
                    {entry.label}
                  </span>
                  {entry.subtitle && (
                    <span className="px-2 py-0.5 rounded-full bg-white/85 text-slate-900 text-[10.5px] font-semibold shrink-0">
                      {entry.subtitle}
                    </span>
                  )}
                </div>
                <div className="relative z-10 shrink-0 flex items-center gap-1.5">
                  {entry.target !== undefined && (
                    <span className="px-2 py-0.5 rounded-full bg-white/85 text-slate-800 text-[10.5px] font-semibold tabular-nums">
                      {tr(`目标 ${entry.target}%`, `Plan ${entry.target}%`)}
                    </span>
                  )}
                  <span className="px-2.5 py-1 rounded-full bg-black/65 text-white text-[12px] font-bold">
                    {entry.value !== null ? (
                      <SplitMetricText value={displayValue} />
                    ) : (
                      <span data-missing-value="1">{displayValue}</span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export type ActivityTone = 'inflow' | 'outflow' | 'neutral';

export function activityAmount(amount: string, unsignedTone: ActivityTone, formatUnsigned: boolean) {
  if (/^[+-]?\p{Sc}?0+(?:\.0+)?(?:\s+[\p{L}%]+)?$/u.test(amount)) {
    return { amount: amount.replace(/^[+-]/, ''), tone: 'neutral' as const };
  }
  const tone = amount.startsWith('-') ? 'outflow' : amount.startsWith('+') ? 'inflow' : unsignedTone;
  if (formatUnsigned && /^\d/.test(amount) && tone !== 'neutral') {
    return { amount: (tone === 'outflow' ? '-' : '+') + amount, tone };
  }
  return { amount, tone };
}

const MActivityList: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { isEn, tr, td } = useI18n();
  const preview = useContext(PreviewDataContext);
  const uiState = useUIStackState();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const schema = useMemo(() => tables.find((t) => t.id === tableId), [tables, tableId]);
  const rawRows = useTableDataRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const bindingErrors = useMemo(
    () => collectionBindingErrors('MActivityList', p, tables),
    [p, tables],
  );
  const scopedRows = useMemo(
    () =>
      tableId
        ? bindingErrors.length > 0
          ? []
          : typeof p.sourceForeignKey === 'string'
          ? rowsForSource(rawRows, p.sourceForeignKey, tableId, { row: sourceRow, tableId: sourceTableId }, tables)
          : rawRows
        : [],
    [rawRows, tables, tableId, p.sourceForeignKey, sourceRow, sourceTableId, bindingErrors.length],
  );
  const runtimeFilter = rt.filters[node.pfId];
  const filteredRows = useMemo(
    () => scopedRows.filter((r) => matchesFilter(r, p.filter, runtimeFilter)),
    [scopedRows, p.filter, runtimeFilter],
  );
  const autoSelectFirst = Boolean(p.autoSelectFirst);
  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: sourceRow?.id,
    visibleRows: filteredRows,
    autoSelectFirst,
    runtimeQuery: runtimeFilter,
  });
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;

  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  const rowActions = (Array.isArray(p.rowActions) ? p.rowActions : []) as Record<string, PropValue>[];
  const splitDec = p.splitDecimal !== false;

  const entries = useMemo(() => {
    if (tableId) {
      const cols = schema ? defaultDisplayColumns(schema) : [];
      const titleKey = typeof p.titleField === 'string' && p.titleField ? p.titleField : cols[0]?.name || 'id';
      const subKey = typeof p.subtitleField === 'string' ? p.subtitleField : '';
      const amtKey = typeof p.amountField === 'string' ? p.amountField.trim() : '';
      const typeKey = typeof p.typeField === 'string' ? p.typeField : '';
      const iconKey = typeof p.iconField === 'string' ? p.iconField : '';
      return filteredRows.map((row, idx) => {
        const rawCell = amtKey && Object.prototype.hasOwnProperty.call(row, amtKey) ? row[amtKey] : undefined;
        const rawAmt =
          rawCell !== undefined && rawCell !== null && String(rawCell).trim() !== ''
            ? String(rawCell).trim()
            : '';
        const typeStr = typeKey && row[typeKey] != null ? String(row[typeKey]) : '';
        const unsignedTone = /inflow|income|return|退回|入库|收入|已退/i.test(typeStr)
          ? 'inflow'
          : /outflow|expense|claim|领用|出库|支出|扣减/i.test(typeStr) ? 'outflow' : 'neutral';
        const { amount, tone } = activityAmount(rawAmt, unsignedTone, true);
        return {
          id: String(row.id ?? idx),
          title: td(String(row[titleKey] ?? row.id)),
          subtitle: subKey && row[subKey] != null ? td(String(row[subKey])) : typeStr ? td(typeStr) : '',
          amount,
          missingAmount: !rawAmt,
          icon: iconKey && row[iconKey] != null ? String(row[iconKey]) : undefined,
          tone,
          row,
          staticRecord: undefined as Row | undefined,
          onClick: undefined as PropValue | undefined,
        };
      });
    }

    const rawStaticItems = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
    const projectedItems = applyUIStackRows(
      rawStaticItems.map((it, idx) => ({ id: `act-${idx}`, ...it })),
      undefined,
      uiState,
      isEn,
    );

    return projectedItems
      .filter((it) =>
        matchesFilter(
          {
            id: String(it.id ?? ''),
            title: String(it.title ?? ''),
            subtitle: String(it.subtitle ?? ''),
            amount: String(it.amount ?? ''),
            tone: String(it.tone ?? ''),
          },
          p.filter,
          runtimeFilter,
        ),
      )
      .map((it, idx) => {
        const amt = it.amount !== undefined && it.amount !== null ? String(it.amount).trim() : '';
        const unsignedTone = it.tone === 'inflow' || it.tone === 'outflow' ? it.tone : 'neutral';
        const { amount, tone } = activityAmount(amt, unsignedTone, false);
        const title = String(it.title ?? tr(`记录 ${idx + 1}`, `Activity ${idx + 1}`));
        const subtitle = it.subtitle ? String(it.subtitle) : '';
        const staticRecord: Row = {
          id: String(it.id ?? `act-${idx}`),
          title,
          subtitle,
          amount: amt,
          icon: typeof it.icon === 'string' ? it.icon : '',
          tone: it.tone === 'inflow' || it.tone === 'outflow' || it.tone === 'neutral' ? it.tone : tone,
        };
        return {
          id: String(it.id ?? idx),
          title,
          subtitle,
          amount,
          missingAmount: !amt,
          icon: typeof it.icon === 'string' ? it.icon : undefined,
          tone,
          row: undefined as Row | undefined,
          staticRecord,
          onClick: it.onClick as PropValue | undefined,
        };
      });
  }, [
    tableId,
    schema,
    p.titleField,
    p.subtitleField,
    p.amountField,
    p.typeField,
    p.iconField,
    p.items,
    p.filter,
    runtimeFilter,
    filteredRows,
    uiState,
    isEn,
    tr,
    td,
  ]);

  if (bindingErrors.length) {
    return (
      <div
        {...rootWith(root, {
          className: 'rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800',
        })}
        role="alert"
      >
        {td(bindingErrors[0])}
      </div>
    );
  }

  return (
    <div {...rootWith(root, { className: cx('rounded-[22px] p-4 space-y-3', theme.cardBg) })} data-activity-list="1">
      {(p.title || p.extra) && (
        <div className="flex items-center justify-between gap-2">
          {p.title && <h3 className={cx('text-[15px] font-semibold tracking-tight', theme.textPrimary)}>{String(p.title)}</h3>}
          {p.extra && (
            <button
              type="button"
              onClick={() => rt.run(p.onExtraClick as PropValue, scope)}
              className={cx('text-[12px] font-semibold inline-flex items-center gap-0.5 cursor-pointer', theme.accentText)}
            >
              <span>{String(p.extra)}</span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className={cx('rounded-2xl py-6 text-center text-[12.5px]', theme.subtleBg, theme.textMuted)}>
          {String(p.emptyText || tr('暂无流水记录', 'No activity records'))}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const canonicalRow =
              tableId && entry.row
                ? resolveCanonicalRow(tableId, entry.row, preview?.rows) ?? entry.row
                : undefined;
            const guardTargetRecord: Row | undefined = tableId ? canonicalRow : entry.staticRecord;
            const actionScope =
              tableId && canonicalRow
                ? childRowScope(scope, canonicalRow, tableId, fkSourceTableId)
                : isolatedStaticItemScope(scope, entry.staticRecord);

            const visibleActions = rowActions.filter(
              (ra) => !matchesWhenCondition(guardTargetRecord, ra.hiddenWhenField, ra.hiddenWhenValue),
            );
            const hasSwipeActions = visibleActions.length > 0;
            const isSwipedOpen = hasSwipeActions && openRowKey === entry.id;
            const isActive = Boolean(tableId && canonicalRow && activeRowId === canonicalRow.id);
            const DefaultIcon =
              entry.tone === 'inflow'
                ? ArrowDownLeft
                : entry.tone === 'outflow'
                ? ArrowUpRight
                : Wallet;
            const Icon = entry.icon ? resolveMobileIcon(entry.icon, DefaultIcon) : DefaultIcon;
            const iconBadgeCls =
              entry.tone === 'inflow'
                ? theme.isDark
                  ? 'bg-emerald-500/18 text-emerald-300'
                  : 'bg-emerald-100 text-emerald-700'
                : entry.tone === 'outflow'
                ? theme.isDark
                  ? 'bg-rose-500/18 text-rose-300'
                  : 'bg-rose-100/90 text-rose-700'
                : cx(theme.subtleBg, theme.textSecondary);
            const amountCls =
              entry.tone === 'inflow'
                ? theme.isDark
                  ? 'text-emerald-400'
                  : 'text-emerald-600'
                : entry.tone === 'outflow'
                ? theme.isDark
                  ? 'text-rose-300'
                  : 'text-[#1F1F1F]'
                : theme.textPrimary;

            const rowActionChain = entry.onClick ?? (p.onItemClick as PropValue | undefined);
            const rowActionBlocked =
              actionChainRequiresBoundRow(rowActionChain) && (!tableId || !canonicalRow);

            const activateRow = () => {
              if (rt.isDesign) return;
              if (isSwipedOpen) {
                setOpenRowKey(null);
                return;
              }
              if (autoSelectFirst && tableId && canonicalRow) {
                rt.setActiveRow?.(tableId, canonicalRow.id, fkSourceTableId);
              }
              if (rowActionBlocked || !rowActionChain) return;
              void rt.run(rowActionChain, actionScope);
            };

            const clickable =
              !rt.isDesign &&
              ((Boolean(rowActionChain) && !rowActionBlocked) || Boolean(autoSelectFirst && tableId && canonicalRow));

            const hiddenActionTrayAttrs =
              !isSwipedOpen && !rt.isDesign
                ? ({ 'aria-hidden': 'true', inert: '' } as unknown as React.HTMLAttributes<HTMLDivElement>)
                : {};

            return (
              <div
                key={entry.id}
                data-row-id={canonicalRow?.id ?? entry.id}
                data-active-row={isActive ? '1' : undefined}
                data-swiped={isSwipedOpen ? '1' : undefined}
                className="relative overflow-clip rounded-[18px] [container-type:inline-size]"
              >
                {/* The track spans the row and its tray. The difference is the actual reveal width. */}
                <div
                  className="flex w-max transition-[translate] duration-200 ease-out motion-reduce:transition-none"
                  style={{ translate: isSwipedOpen ? 'calc(100cqw - 100%) 0' : undefined }}
                >
                  <div
                    data-activity-row-surface="1"
                    onClick={clickable || isSwipedOpen ? activateRow : undefined}
                    {...interactiveBoxProps(clickable, activateRow)}
                    onTouchStart={(e) => {
                      if (!hasSwipeActions || rt.isDesign) return;
                      touchStartXRef.current = e.touches[0]?.clientX ?? null;
                    }}
                    onTouchEnd={(e) => {
                      if (!hasSwipeActions || rt.isDesign || touchStartXRef.current === null) return;
                      const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
                      const dx = endX - touchStartXRef.current;
                      touchStartXRef.current = null;
                      if (dx < -32) setOpenRowKey(entry.id);
                      else if (dx > 24 && isSwipedOpen) setOpenRowKey(null);
                    }}
                    className={cx(
                      'relative w-[100cqw] shrink-0 touch-pan-y min-h-[58px] rounded-[18px] px-3 py-2.5 flex items-center justify-between gap-2.5 transition-transform duration-200 ease-out',
                      theme.subtleBg,
                      clickable && 'cursor-pointer active:scale-[0.99]',
                      isActive && 'ring-2 ring-blue-500/60',
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={cx('w-10 h-10 rounded-full inline-flex items-center justify-center shrink-0', iconBadgeCls)}>
                        <Icon className="w-4 h-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className={cx('text-[13.5px] font-semibold truncate', theme.textPrimary)}>{entry.title}</div>
                        {entry.subtitle && (
                          <div className={cx('text-[11.5px] truncate mt-0.5', theme.textMuted)}>{entry.subtitle}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {entry.missingAmount ? (
                        <span
                          data-missing-value="1"
                          className={cx('text-[14px] font-semibold tabular-nums opacity-50', theme.textMuted)}
                        >
                          —
                        </span>
                      ) : (
                        <SplitMetricText
                          value={entry.amount}
                          splitDecimal={splitDec}
                          className={cx('text-[14.5px] font-bold tracking-tight', amountCls)}
                        />
                      )}
                      {hasSwipeActions && !rt.isDesign && (
                        <button
                          type="button"
                          aria-label={tr('展开行操作', 'Toggle row actions')}
                          aria-expanded={isSwipedOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenRowKey((prev) => (prev === entry.id ? null : entry.id));
                          }}
                          className={cx(
                            'w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer transition hover:opacity-80',
                            theme.textMuted,
                          )}
                        >
                          <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                  {hasSwipeActions && (
                    <div
                      data-swipe-actions="1"
                      {...hiddenActionTrayAttrs}
                      className={cx(
                        'flex w-max max-w-[calc(100cqw-44px)] shrink-0 items-center overflow-x-auto overscroll-x-contain gap-1.5 pr-1.5 pl-3',
                        !isSwipedOpen && !rt.isDesign && 'pointer-events-none',
                      )}
                    >
                      {visibleActions.map((ra, aIdx) => {
                        const lbl = String(ra.label ?? tr(`操作${aIdx + 1}`, `Action ${aIdx + 1}`));
                        const danger = Boolean(ra.danger);
                        const primary = Boolean(ra.primary);
                        const requiresRow = actionChainRequiresBoundRow(ra.onClick);
                        const missingTargetRecord = requiresRow && (!tableId || !canonicalRow);
                        const guardDisabled =
                          missingTargetRecord ||
                          matchesWhenCondition(
                            guardTargetRecord,
                            ra.disabledWhenField,
                            ra.disabledWhenValue,
                          );
                        const reason = missingTargetRecord
                          ? tr('静态演示项无物理表记录，已禁用行变更动作', 'Disabled: static item has no bound table row')
                          : typeof ra.disabledReason === 'string'
                          ? ra.disabledReason
                          : undefined;
                        return (
                          <button
                            key={aIdx}
                            type="button"
                            tabIndex={isSwipedOpen || rt.isDesign ? 0 : -1}
                            disabled={guardDisabled}
                            title={guardDisabled ? reason : undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (guardDisabled || rt.isDesign) return;
                              setOpenRowKey(null);
                              if (ra.onClick) void rt.run(ra.onClick, actionScope);
                            }}
                            className={cx(
                              'min-h-[38px] px-3.5 rounded-full text-[11.5px] font-semibold inline-flex items-center gap-1 shrink-0 transition-transform active:scale-95',
                              guardDisabled
                                ? 'opacity-45 cursor-not-allowed bg-slate-500/20 text-slate-400'
                                : danger
                                ? 'bg-rose-600 text-white cursor-pointer'
                                : primary
                                ? cx(theme.accentSolidBg, 'cursor-pointer')
                                : cx(theme.subtleBg, theme.textPrimary, 'cursor-pointer'),
                            )}
                          >
                            {danger && <Trash2 className="w-3 h-3" aria-hidden="true" />}
                            <span>{lbl}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const MFloatingBar: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const tone = (p.tone as string) || 'inverted';
  const isInverted = tone === 'inverted';
  const isAccent = tone === 'accent';
  const Icon = resolveMobileIcon(p.icon as string | undefined, Zap);
  const SecondaryIcon =
    typeof p.secondaryIcon === 'string' && p.secondaryIcon
      ? resolveMobileIcon(p.secondaryIcon, ChevronRight)
      : null;
  const progress =
    typeof p.progress === 'number' && Number.isFinite(p.progress)
      ? Math.max(0, Math.min(100, p.progress))
      : undefined;

  const barCls = isInverted
    ? 'bg-[#12151B]/95 text-[#F8FAFC] backdrop-blur-xl ring-1 ring-inset ring-white/14 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.58)]'
    : isAccent
    ? cx(theme.accentSolidBg, 'shadow-[0_12px_28px_-8px_rgba(15,23,42,0.3)]')
    : cx(
        theme.glassBg,
        theme.textPrimary,
        theme.isDark ? 'border border-white/12' : 'border border-white/85',
      );

  const activateWhole = () => {
    if (!rt.isDesign && p.onClick) void rt.run(p.onClick as PropValue, scope);
  };

  return (
    <div
      {...rootWith(root, {
        className: 'px-4 pb-1.5 pt-1',
      })}
      data-floating-bar={tone}
    >
      <div
        onClick={p.onClick ? activateWhole : undefined}
        {...interactiveBoxProps(Boolean(p.onClick) && !rt.isDesign, activateWhole)}
        style={isInverted ? { colorScheme: 'dark' } : undefined}
        className={cx(
          'relative overflow-hidden rounded-[22px] px-3 py-2.5 flex items-center justify-between gap-2.5',
          barCls,
          Boolean(p.onClick) && !rt.isDesign && 'cursor-pointer active:scale-[0.99] transition-transform',
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {typeof p.image === 'string' && p.image.trim() ? (
            <img src={p.image.trim()} alt="" className="w-9 h-9 rounded-xl object-cover shrink-0" />
          ) : (
            <span
              className={cx(
                'w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0',
                isInverted
                  ? 'bg-white/12 text-[#A3E635]'
                  : isAccent
                  ? 'bg-black/15 text-current'
                  : cx(theme.pillActiveBg),
              )}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[13px] font-semibold truncate">
                {String(p.title || tr('实时任务状态', 'Live Status'))}
              </span>
              {Boolean(p.badge) && (
                <span
                  className={cx(
                    'px-1.5 py-0.2 rounded-full text-[10px] font-bold shrink-0',
                    isInverted ? 'bg-[#A3E635]/20 text-[#D9F99D]' : 'bg-black/15 text-current',
                  )}
                >
                  {String(p.badge)}
                </span>
              )}
            </div>
            {Boolean(p.subtitle) && (
              <div
                className={cx(
                  'text-[11px] truncate',
                  isInverted ? 'text-white/65' : isAccent ? 'opacity-80' : theme.textMuted,
                )}
              >
                {String(p.subtitle)}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {Boolean(p.actionText) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!rt.isDesign) void rt.run((p.onAction ?? p.onClick) as PropValue, scope);
              }}
              className={cx(
                'min-h-[34px] px-3.5 rounded-full text-[12px] font-semibold inline-flex items-center justify-center cursor-pointer transition-transform active:scale-95',
                isInverted
                  ? 'bg-white text-[#0F172A]'
                  : isAccent
                  ? 'bg-white/95 text-[#0F172A]'
                  : theme.accentSolidBg,
              )}
            >
              {String(p.actionText)}
            </button>
          )}
          {SecondaryIcon && (
            <button
              type="button"
              aria-label={tr('快捷次要操作', 'Secondary action')}
              onClick={(e) => {
                e.stopPropagation();
                if (!rt.isDesign) void rt.run(p.onSecondaryClick as PropValue, scope);
              }}
              className={cx(
                'w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer transition-transform active:scale-95',
                isInverted ? 'bg-white/10 text-white' : 'bg-black/10 text-current',
              )}
            >
              <SecondaryIcon className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {progress !== undefined && (
          <div
            className={cx(
              'absolute inset-x-3 bottom-0 h-[2.5px] rounded-full overflow-hidden',
              isInverted ? 'bg-white/12' : 'bg-black/10',
            )}
            aria-hidden="true"
          >
            <div
              className={cx(
                'h-full rounded-full pf-capsule-fill',
                isInverted ? 'bg-[#A3E635]' : 'bg-current',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const MOBILE_REGISTRY: Record<string, React.FC<CompProps>> = {
  MobilePage,
  MSurface,
  MBentoGrid,
  MScrollRow,
  MTopBar,
  MTabBar,
  MPillTabs,
  MTab,
  MSearchPill,
  MHeroHeader,
  MFeedList,
  MBannerCarousel,
  MCardGrid,
  MRepeater,
  MKanban,
  MCalendar,
  MAiInsightCard,
  MProgressList,
  MActivityList,
  MTaskList,
  MListGroup,
  MListItem,
  MStatCard,
  MChatStream,
  MComposerBar,
  MForm,
  MField,
  MSheetPicker,
  MChipSelect,
  MMediaInput,
  MButton,
  MBottomDock,
  MFloatingBar,
  MBottomSheet,
  MDialog,
};
