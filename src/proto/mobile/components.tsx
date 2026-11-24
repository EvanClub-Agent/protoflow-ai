import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Bookmark,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
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
  TrendingDown,
  TrendingUp,
  User,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CompProps, RootAttrs } from '../registry/components';
import { isActionChain, type PropValue, type ProtoNode } from '../types';
import { useResolvedTheme } from '../registry/AntdSurface';
import { PreviewDataContext, useMaterialTables } from '../runtime/PreviewData';
import { usePageStore } from '../store/usePageStore';
import { useProtoStore } from '../../store/useProtoStore';
import { columnLabel, defaultDisplayColumns, type Row } from '../runtime/mock';
import { resolveBoundForeignKeySpec } from '../ai/templates';
import { mobileOptions } from './options';
import { OVERLAY_TYPES } from '../registry/meta';
import { rowsForSource, sourceForeignKeyErrors } from '../table/model';
import { useSourceRow } from '../runtime/sourceRow';
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

export type MobileAccent = 'gemini' | 'blue' | 'violet' | 'emerald' | 'amber' | 'rose';
export type MobileAppearance = 'light' | 'dark';

export const MobileAppearanceOverrideContext = createContext<MobileAppearance | null>(null);
export const MobileScreenPortalContext = createContext<HTMLDivElement | null>(null);

function interactiveBoxProps(enabled: boolean, onActivate: () => void) {
  if (!enabled) return {};
  return {
    role: 'button' as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onActivate();
      } else if (e.key === ' ') {
        e.preventDefault();
      }
    },
    onKeyUp: (e: React.KeyboardEvent) => {
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
): MobileAppearance {
  if (previewOverride === 'light' || previewOverride === 'dark') return previewOverride;
  if (rawAppearance === 'dark') return 'dark';
  return workspaceTheme === 'dark' ? 'dark' : 'light';
}

export interface MobileTheme {
  appearance: MobileAppearance;
  accent: MobileAccent;
  surfaceBg: 'mist' | 'pure';
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
};

function createMobileTheme(
  appearance: MobileAppearance = 'light',
  accent: MobileAccent = 'gemini',
  surfaceBg: 'mist' | 'pure' = 'mist',
  elevated = false,
): MobileTheme {
  const isDark = appearance === 'dark';
  const ac = ACCENT_MAP[accent] ?? ACCENT_MAP.gemini;
  const softSurface = isDark ? ac.softBgDark : ac.softBgLight;
  const softText = isDark ? ac.softTextDark : ac.softTextLight;
  return {
    appearance,
    accent,
    surfaceBg,
    isDark,
    elevated,
    pageBg: isDark
      ? surfaceBg === 'pure'
        ? 'bg-[#0E0E0F] text-[#E3E3E3]'
        : 'bg-[#131314] text-[#E3E3E3]'
      : surfaceBg === 'pure'
      ? 'bg-white text-[#1F1F1F]'
      : 'bg-[#F0F4F9] text-[#1F1F1F]',
    cardBg: isDark
      ? elevated
        ? 'bg-[#282A2E] ring-1 ring-inset ring-white/[0.07]'
        : surfaceBg === 'pure'
        ? 'bg-[#1A1B1E] ring-1 ring-inset ring-white/[0.07]'
        : 'bg-[#1E1F20] ring-1 ring-inset ring-white/[0.06] shadow-[0_6px_22px_-8px_rgba(0,0,0,0.55)]'
      : elevated
      ? 'bg-white ring-1 ring-inset ring-slate-200/75 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.04)]'
      : surfaceBg === 'pure'
      ? 'bg-[#F4F7FC]'
      : 'bg-white shadow-[0_2px_14px_-4px_rgba(15,23,42,0.05)]',
    subtleBg: isDark ? (elevated ? 'bg-[#32353B]' : 'bg-[#282A2E]') : 'bg-[#E6ECF5]/85',
    inputBg: isDark
      ? elevated
        ? 'bg-[#34373D] text-[#E3E3E3] ring-1 ring-inset ring-white/[0.08]'
        : 'bg-[#282B30] text-[#E3E3E3] ring-1 ring-inset ring-white/[0.07]'
      : elevated
      ? 'bg-[#EEF3FA] text-[#1F1F1F]'
      : 'bg-[#E9EEF6] text-[#1F1F1F]',
    placeholderCls: isDark ? 'placeholder:text-[#8E918F]' : 'placeholder:text-[#747775]',
    textPrimary: isDark ? 'text-[#E3E3E3]' : 'text-[#1F1F1F]',
    textSecondary: isDark ? 'text-[#C4C7C5]' : 'text-[#444746]',
    textMuted: isDark ? 'text-[#9AA0A6]' : 'text-[#747775]',
    dangerText: isDark ? 'text-rose-400' : 'text-rose-600',
    glassBg: isDark
      ? 'bg-[#1B1C20]/90 backdrop-blur-xl'
      : 'bg-white/88 backdrop-blur-xl shadow-[0_8px_30px_-8px_rgba(15,23,42,0.12)]',
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
        surfaceBg === 'pure' ? 'pure' : 'mist',
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
  const preview = useContext(PreviewDataContext);
  const storeRows = usePageStore((s) => (tableId ? s.tableRows[tableId] : undefined));
  const getRows = usePageStore((s) => s.getRows);
  const suppliers = useProtoStore((s) => s.suppliers);
  const purchaseOrderItems = useProtoStore((s) => s.purchaseOrderItems);
  return useMemo(() => {
    if (!tableId) return [];
    if (preview) return preview.rows[tableId] ?? [];
    return storeRows ?? getRows(tableId);
  }, [tableId, preview, storeRows, getRows, suppliers, purchaseOrderItems]);
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
  const previewOverride = useContext(MobileAppearanceOverrideContext);
  const appearance = resolveMobileAppearance(p.appearance, workspaceTheme, previewOverride);
  const accent: MobileAccent =
    typeof p.accent === 'string' && Object.hasOwn(ACCENT_MAP, p.accent) ? (p.accent as MobileAccent) : 'gemini';
  const surfaceBg: 'mist' | 'pure' = p.surfaceBg === 'pure' ? 'pure' : 'mist';
  const theme = useMemo(() => createMobileTheme(appearance, accent, surfaceBg, false), [appearance, accent, surfaceBg]);

  const topNodes = kids.filter((k) => k.type === 'MTopBar');
  const bottomNodes = kids.filter(
    (k) =>
      k.type === 'MTabBar' ||
      k.type === 'MBottomDock' ||
      (k.type === 'MComposerBar' && k.props.docked !== false),
  );
  const pinnedSet = new Set<ProtoNode>([...topNodes, ...bottomNodes]);
  const bodyNodes = kids.filter((k) => !pinnedSet.has(k) && !OVERLAY_TYPES.has(k.type));
  const leadingAnnotation = children.length > kids.length ? children[0] : null;

  const padCls =
    p.padding === 'none' ? 'px-0 py-0' : p.padding === 'compact' ? 'px-3 py-2.5' : 'px-4 py-3.5';

  return (
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
      >
        {leadingAnnotation}
        {topNodes.length > 0 && (
          <div className="sticky top-0 z-20 shrink-0">{topNodes.map((n) => renderNode(n))}</div>
        )}

        <div className={cx('flex-1 flex flex-col gap-3.5 min-w-0', padCls, bottomNodes.length > 0 && 'pb-5')}>
          {bodyNodes.length > 0 ? (
            bodyNodes.map((n) => renderNode(n))
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
  );
};

const MSurface: React.FC<CompProps> = ({ p, children, root, rt, scope }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
  const padCls = p.padding === 'sm' ? 'p-3' : p.padding === 'lg' ? 'p-5' : 'p-4';
  const tone = (p.tone as string) || 'card';

  const surfaceCls =
    tone === 'subtle'
      ? cx(theme.subtleBg, theme.textPrimary)
      : tone === 'accent'
      ? theme.accentSoftBg
      : cx(theme.cardBg, theme.textPrimary);

  const inner = (
    <div
      className={cx(
        'rounded-[22px] space-y-3',
        surfaceCls,
        padCls,
      )}
    >
      {(p.title || p.extra || p.subtitle) && (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {p.title && (
              <h3
                className={cx(
                  'text-[15px] font-semibold tracking-tight leading-snug',
                  tone === 'accent' ? theme.pillActiveText : theme.textPrimary,
                )}
                style={{ textWrap: 'balance' } as React.CSSProperties}
              >
                {p.title}
              </h3>
            )}
            {p.subtitle && <p className={cx('text-[12px] mt-0.5', theme.textMuted)}>{p.subtitle}</p>}
          </div>
          {p.extra && (
            <button
              type="button"
              onClick={() => rt.run(p.onExtraClick as PropValue, scope)}
              className={cx(
                "relative min-h-[36px] px-2.5 rounded-full text-[12px] font-medium inline-flex items-center gap-0.5 shrink-0 cursor-pointer transition hover:opacity-80 after:content-[''] after:absolute after:-inset-y-1 after:-inset-x-1",
                theme.accentText,
              )}
            >
              <span>{p.extra}</span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {children.length > 0 ? (
        <div className="space-y-2.5">{children}</div>
      ) : (
        rt.isDesign && (
          <div className={cx('py-4 text-center text-[12px] rounded-2xl', theme.subtleBg, theme.textMuted)}>
            {tr('拖入子组件至此卡片', 'Drop child components into this card')}
          </div>
        )
      )}
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

  return (
    <nav
      aria-label={tr('底部主导航', 'Bottom navigation')}
      {...rootWith(root, {
        className: cx(
          floating ? 'px-4 pb-2 pt-1' : 'w-full',
        ),
      })}
    >
      <div
        className={cx(
          'flex items-center justify-around',
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
                const actionNavigates =
                  Boolean(it.page) ||
                  !it.onClick ||
                  (isActionChain(it.onClick) && it.onClick.calls.some((c) => c.name === 'navigate'));
                if (!rt.isDesign && actionNavigates) setLocalActive(key);
                if (it.onClick) {
                  void rt.run(it.onClick, scope);
                } else if (it.page) {
                  void rt.run({ $kind: 'actions', calls: [{ name: 'navigate', args: [it.page] }] }, scope);
                }
              }}
              className="relative flex-1 min-h-[46px] flex flex-col items-center justify-center gap-0.5 rounded-full cursor-pointer transition"
            >
              <span
                className={cx(
                  'px-4 py-1 rounded-full inline-flex items-center justify-center relative transition-colors',
                  isActive ? theme.pillActiveSurface : 'bg-transparent',
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
                  'text-[11px] leading-tight',
                  isActive ? cx('font-semibold', theme.textPrimary) : theme.textMuted,
                )}
              >
                {it.title || tr(`导航${idx + 1}`, `Tab ${idx + 1}`)}
              </span>
            </button>
          );
        })}
      </div>
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
  const isBanner = p.mode === 'banner';

  if (isBanner) {
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
  const { tr, td } = useI18n();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const rawRows = useTableDataRows(tableId);
  const {row:sourceRow, tableId:sourceTableId} = useSourceRow(scope, rt.pageId, p.sourceForeignKey !== undefined);
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
    return items
      .filter((it) =>
        matchesFilter(
          { id: '', title: it.title ?? '', subtitle: it.subtitle ?? '', price: it.price ?? '', tag: it.tag ?? '' },
          p.filter,
          runtimeFilter,
        ),
      )
      .map((it, idx) => ({
        id: `item-${idx}`,
        row: { id: `item-${idx}`, ...it } as Row,
        title: it.title || tr(`精选内容 ${idx + 1}`, `Featured Item ${idx + 1}`),
        subtitle: it.subtitle || '',
        price: it.price || '',
        tag: it.tag || '',
      }));
  }, [tableId, rawRows, p.sourceForeignKey, sourceRow, sourceTableId, tables, p.filter, p.items, runtimeFilter, titleKey, subKey, priceKey, tagKey, tr]);

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
          const activate = () => void rt.run(p.onItemClick as PropValue, { ...scope, row: c.row, tableId });
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
        const activate = () => void rt.run(p.onItemClick as PropValue, { ...scope, row: c.row, tableId });
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
  const source = useSourceRow(scope, rt.pageId, p.sourceForeignKey !== undefined);
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
    onClick?: PropValue;
  }[];

  if (bindingErrors.length) return <div {...rootWith(root, {className:'rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800'})} role="alert">{td(bindingErrors[0])}</div>;

  if (!tableId) {
    const demoItems = (
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
                    {rowActions.map((act, aIdx) => (
                      <button
                        key={aIdx}
                        type="button"
                        onClick={() => rt.run(act.onClick, rowScope)}
                        className={cx(
                          "relative min-h-[36px] px-3.5 rounded-full text-[12px] font-semibold cursor-pointer transition after:content-[''] after:absolute after:-inset-y-1 after:inset-x-0",
                          act.danger
                            ? theme.isDark
                              ? 'bg-rose-500/18 text-rose-300 ring-1 ring-inset ring-rose-400/25'
                              : 'bg-rose-500/12 text-rose-600'
                            : act.primary
                            ? theme.accentSolidBg
                            : theme.pillActiveBg,
                        )}
                      >
                        {act.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const records = typeof p.sourceForeignKey === 'string' ? rowsForSource(rawRows, p.sourceForeignKey, tableId, source, tables) : rawRows;
  const rows = records.filter((r) => matchesFilter(r, p.filter, runtimeFilter));

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
        const rowScope = { ...scope, row: r, tableId };
        const statusVal = statusField && r[statusField] != null ? String(r[statusField]) : '';
        const activateCard = () => void rt.run(p.onCardClick as PropValue, rowScope);
        const hasCardClick = Boolean(p.onCardClick) && !rt.isDesign;
        const cardTitle = titleField && r[titleField] != null ? String(r[titleField]) : tr('未配置标题或暂无值', 'Untitled');
        return (
          <div
            key={r.id}
            onClick={activateCard}
            {...interactiveBoxProps(hasCardClick && rowActions.length === 0, activateCard)}
            className={cx('rounded-[22px] p-4 space-y-3 cursor-pointer transition-transform active:scale-[0.99]', theme.cardBg)}
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
                {rowActions.map((act, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => rt.run(act.onClick, rowScope)}
                    className={cx(
                      "relative min-h-[36px] px-4 rounded-full text-[12px] font-semibold cursor-pointer transition-transform active:scale-95 after:content-[''] after:absolute after:-inset-y-1 after:inset-x-0",
                      act.danger
                        ? theme.isDark
                          ? 'bg-rose-500/18 text-rose-300 ring-1 ring-inset ring-rose-400/25'
                          : 'bg-rose-50 text-rose-600'
                        : act.primary
                        ? theme.accentSolidBg
                        : theme.pillActiveBg,
                    )}
                  >
                    {act.label}
                  </button>
                ))}
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
  const contextRow = (scope.row ?? scope.params?.row) as Row | undefined;

  const autoRowItems = useMemo(() => {
    if (!tableSchema) return [];
    const cols = tableSchema.columns.filter((c) => !c.isPrimaryKey).slice(0, 8);
    return cols.map((c) => ({
      title: columnLabel(c),
      value: (scope.tableId ?? scope.params?.tableId) === tableSchema.id && contextRow?.[c.name] != null ? String(contextRow[c.name]) : '—',
      description: undefined as string | undefined,
      icon: undefined as string | undefined,
      arrow: false,
      onClick: undefined as PropValue | undefined,
    }));
  }, [tableSchema, contextRow, scope.tableId, scope.params?.tableId]);

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
  const trendCls =
    tone === 'down'
      ? theme.isDark
        ? 'bg-rose-500/16 text-rose-300 ring-1 ring-inset ring-rose-400/25'
        : 'bg-rose-100/90 text-rose-700'
      : tone === 'neutral'
      ? cx(theme.subtleBg, theme.textSecondary)
      : theme.isDark
      ? 'bg-emerald-500/16 text-emerald-300 ring-1 ring-inset ring-emerald-400/25'
      : 'bg-emerald-100/90 text-emerald-800';

  const activate = () => void rt.run(p.onClick as PropValue, scope);
  return (
    <div
      {...rootWith(root, {
        onClick: p.onClick ? activate : undefined,
        className: cx('rounded-[22px] p-4 flex items-end justify-between gap-3', theme.cardBg, p.onClick && 'cursor-pointer'),
      })}
      {...interactiveBoxProps(Boolean(p.onClick) && !rt.isDesign, activate)}
    >
      <div className="space-y-1.5 min-w-0">
        <div className={cx('text-[12.5px] font-medium', theme.textMuted)}>{p.title || tr('核心指标', 'Key Metric')}</div>
        <div className="flex items-baseline gap-1">
          <span className={cx('text-[24px] font-bold tracking-tight tabular-nums', theme.textPrimary)}>
            {p.value ?? '0'}
          </span>
          {p.unit && <span className={cx('text-[12px]', theme.textMuted)}>{p.unit}</span>}
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
              <stop offset="0%" stopColor={theme.isDark ? '#8AB4F8' : '#4285F4'} />
              <stop offset="100%" stopColor={theme.isDark ? '#C58AF9' : '#9B72CB'} />
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
  const values = rt.formValues[node.pfId] ?? {};
  const row = (scope.row ?? scope.params?.row) as Row | undefined;

  useEffect(() => {
    if (
      !rt.isDesign &&
      row &&
      p.table &&
      (scope.tableId ?? scope.params?.tableId) === p.table &&
      Object.keys(values).length === 0
    ) {
      const { id: _id, ...rest } = row;
      rt.setFormValues(node.pfId, rest);
    }
  }, [rt.isDesign, row, p.table, scope.tableId, scope.params?.tableId, node.pfId]);

  return (
    <MobileFormIdContext.Provider value={node.pfId}>
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
      disabled={Boolean(p.disabled)}
      {...rootWith(root, {
        onClick: () => rt.run(p.onClick as PropValue, scope),
        className: cx(
          'rounded-full font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-45',
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

const MBottomSheet: React.FC<CompProps> = ({ p, kids, children, root, rt, scope, live, staticOverlay, renderNode }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
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
  if (!live) return null;
  const z = 40 + (scope.overlayIndex ?? 0) * 2;
  return (
    <div
      className="absolute inset-0 flex flex-col justify-end overflow-hidden"
      style={{ zIndex: z, overscrollBehavior: 'contain' }}
    >
      <div
        className={cx(
          'absolute inset-0 backdrop-blur-[1.5px] pf-fade-in',
          theme.isDark ? 'bg-black/65' : 'bg-black/45',
        )}
        onClick={close}
      />
      <div className="relative z-10 h-full pointer-events-none w-full flex flex-col justify-end pf-slide-up">{sheetCard}</div>
    </div>
  );
};

const MDialog: React.FC<CompProps> = ({ p, children, root, rt, scope, live, staticOverlay }) => {
  const { tr } = useI18n();
  const theme = useMobileTheme();
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
          className={cx('flex-1 min-h-[44px] rounded-full text-[13.5px] font-semibold cursor-pointer', theme.subtleBg, theme.textPrimary)}
        >
          {(p.cancelText as string) || tr('取消', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={() => (p.onConfirm ? rt.run(p.onConfirm as PropValue, scope) : close())}
          className={cx(
            'flex-1 min-h-[44px] rounded-full text-[13.5px] font-semibold cursor-pointer',
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
  if (!live) return null;
  const z = 40 + (scope.overlayIndex ?? 0) * 2;
  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-hidden p-4"
      style={{ zIndex: z, overscrollBehavior: 'contain' }}
    >
      <div
        className={cx(
          'absolute inset-0 backdrop-blur-[1.5px] pf-fade-in',
          theme.isDark ? 'bg-black/65' : 'bg-black/45',
        )}
        onClick={close}
      />
      <div className="relative z-10 flex items-center justify-center w-full h-full min-h-0 pointer-events-none pf-pop-in">
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
  toasts: { id: number; message: string; type: 'success' | 'info' | 'warning' | 'error' }[];
  confirmState: { message: string } | null;
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
              <div className={cx('text-[16px] font-semibold', theme.textPrimary)}>{tr('操作确认', 'Confirm Action')}</div>
              <p className={cx('text-[13px] leading-relaxed', theme.textMuted)}>{td(confirmState.message)}</p>
            </div>
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
                onClick={() => onResolveConfirm(true)}
                className={cx('flex-1 min-h-[44px] rounded-full text-[13.5px] font-semibold cursor-pointer', theme.accentSolidBg)}
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
                'max-w-full px-4 py-2.5 rounded-full text-[12.5px] font-medium shadow-xl flex items-center gap-2 backdrop-blur-md pf-fade-in',
                theme.isDark
                  ? 'bg-[#282A2E]/95 text-[#E3E3E3] ring-1 ring-inset ring-white/14'
                  : 'bg-slate-900/92 text-white',
              )}
            >
              <ToastStatusIcon type={t.type} size={15} />
              <span className="truncate">{td(t.message)}</span>
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
  const { tr, td } = useI18n();
  const theme = useMobileTheme();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const rawRows = useTableDataRows(tableId);
  const { row: sourceRow, tableId: sourceTableId } = useSourceRow(scope, rt.pageId, p.sourceForeignKey !== undefined);
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
    return items
      .filter((it) =>
        matchesFilter(
          {
            id: '',
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
        id: `mcard-${idx}`,
        row: { id: `mcard-${idx}`, ...it } as Row,
        title: String(it.title || tr(`卡片项 ${idx + 1}`, `Card ${idx + 1}`)),
        subtitle: String(it.subtitle || ''),
        image: String(it.image || ''),
        price: String(it.price || ''),
        tag: String(it.tag || ''),
      }));
  }, [tableId, rawRows, p.sourceForeignKey, sourceRow, sourceTableId, tables, p.filter, p.items, runtimeFilter, titleKey, subKey, imgKey, priceKey, tagKey, tr]);

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
        const activate = () => void rt.run(p.onItemClick as PropValue, { ...scope, row: c.row, tableId });
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
  MBottomSheet,
  MDialog,
};
