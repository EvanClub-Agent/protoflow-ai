import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import DropdownAntd from 'antd/es/dropdown';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bookmark,
  Box,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  CreditCard,
  Database,
  FileText,
  Filter,
  Folder,
  Globe,
  Heart,
  Home,
  Inbox,
  Info,
  Layers,
  LayoutGrid,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Package,
  PanelLeft,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Tag as TagIcon,
  TrendingUp,
  Truck,
  User,
  Users,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CompProps, RootAttrs } from './components';
import type { PropValue } from '../types';
import { AntdSurface } from './AntdSurface';
import { useCanvasTheme, useInsideCardBody } from '../theme/ProtoCanvasThemeScope';
import {
  actionChainRequiresBoundRow,
  activityAmount,
  interactiveBoxProps,
  isolatedStaticItemScope,
  parseProgressMetric,
  SplitMetricText,
} from '../mobile/components';
import { PreviewDataContext, useMaterialTables } from '../runtime/PreviewData';
import { usePageStore } from '../store/usePageStore';
import { useProtoStore } from '../../store/useProtoStore';
import {
  collectionBindingErrors,
  matchesStaticRowFilter,
  rowsForSource,
  sourceForeignKeyErrors,
} from '../table/model';
import { declaredColumnOptions } from '../database/enumContract';
import { childRowScope } from '../runtime/runtime';
import { resolveCanonicalRow, useAutoSelectFirstRow, useCollectionSourceRow } from '../runtime/sourceRow';
import { matchesWhenCondition, resolveKanbanStatusColumn } from '../runtime/pokaYoke';
import { applyUIStackRows, useUIStackState } from '../runtime/uiStackLens';
import { defaultDisplayColumns, type Row } from '../runtime/mock';
import { tr, useI18n } from '../../i18n';

export function filterCardRows(rows: Row[], staticFilter: unknown, runtimeFilter?: Record<string, unknown>): Row[] {
  const matchesRuntime = (row: Row, f: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(f)) {
      if (v === undefined || v === null || v === '' || Array.isArray(v)) continue;
      const needle = String(v).toLowerCase();
      if (!needle.trim()) continue;
      if (k === '__keyword') {
        if (!Object.values(row).some((cell) => String(cell ?? '').toLowerCase().includes(needle.trim()))) return false;
      } else if (!String(row[k] ?? '').toLowerCase().includes(needle)) {
        return false;
      }
    }
    return true;
  };

  return rows.filter((r) => {
    if (!matchesStaticRowFilter(r, staticFilter)) return false;
    if (runtimeFilter && !matchesRuntime(r, runtimeFilter)) return false;
    return true;
  });
}

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

const ICON_MAP: Record<string, LucideIcon> = {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bookmark,
  Box,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  CreditCard,
  Database,
  FileText,
  Filter,
  Folder,
  Globe,
  Heart,
  Home,
  Inbox,
  Info,
  Layers,
  LayoutGrid,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Package,
  PanelLeft,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Tag: TagIcon,
  TrendingUp,
  Truck,
  User,
  Users,
  Wallet,
  Wrench,
  Zap,
};

export function resolveSemanticIcon(raw?: unknown, fallback: LucideIcon = Sparkles): LucideIcon {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const key = raw.trim();
  if (ICON_MAP[key]) return ICON_MAP[key];
  const lower = key.toLowerCase().replace(/[-_\s]/g, '');
  const match = Object.entries(ICON_MAP).find(([k]) => k.toLowerCase() === lower);
  return match ? match[1] : fallback;
}

function useDesktopBoundRows(tableId?: string): Row[] {
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

const NavMenu: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { tr: t } = useI18n();
  const canvasDark = useCanvasTheme()?.effectiveMode === 'dark';
  const mode = p.mode === 'horizontal' ? 'horizontal' : 'inline';
  const dark = p.theme === 'dark' || (node.props.theme === undefined && canvasDark);
  const collapsed = Boolean(p.collapsed) && mode === 'inline';
  const rawItems = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  const items = rawItems.length
    ? rawItems
    : [
        { key: 'overview', title: t('数据总览', 'Overview'), icon: 'LayoutGrid' },
        { key: 'orders', title: t('业务单据', 'Orders'), icon: 'ShoppingBag' },
      ];
  const [selectedKey, setSelectedKey] = useState<string>(() => String(p.activeKey ?? items[0]?.key ?? ''));
  useEffect(() => {
    if (typeof p.activeKey === 'string' && p.activeKey) setSelectedKey(p.activeKey);
  }, [p.activeKey]);

  const handleItem = (item: Record<string, unknown>, idx: number) => {
    const key = String(item.key ?? `item-${idx}`);
    setSelectedKey(key);
    if (rt.isDesign) return;
    if (typeof item.page === 'string' && item.page.trim()) {
      void rt.run({ $kind: 'actions', calls: [{ name: 'navigate', args: [item.page.trim()] }] }, scope);
    }
    if (item.onClick) {
      void rt.run(item.onClick as PropValue, { ...scope, params: { ...scope.params, key } });
    }
    if (p.onSelect) {
      void rt.run(p.onSelect as PropValue, { ...scope, params: { ...scope.params, key } });
    }
  };

  if (mode === 'horizontal') {
    return (
      <nav
        {...rootWith(root, {
          className: cx(
            'flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-2.5',
            dark ? 'border-slate-800 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800',
          ),
        })}
        aria-label={String(p.brandTitle || t('主导航', 'Main navigation'))}
      >
        {Boolean(p.brandTitle) && (
          <div className="flex items-center gap-2 font-semibold text-sm shrink-0">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white text-xs font-bold">
              {String(p.brandTitle).slice(0, 1)}
            </span>
            <span>{String(p.brandTitle)}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          {items.map((item, idx) => {
            const key = String(item.key ?? `item-${idx}`);
            const active = key === selectedKey;
            const IconComp = resolveSemanticIcon(item.icon, LayoutGrid);
            return (
              <button
                key={key}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => handleItem(item, idx)}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer',
                  active
                    ? dark
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-50 text-blue-700 font-semibold'
                    : dark
                    ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <IconComp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{String(item.title ?? key)}</span>
                {Boolean(item.badge) && (
                  <span className="rounded-full bg-rose-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-rose-600">
                    {String(item.badge)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav
      {...rootWith(root, {
        className: cx(
          'flex flex-col rounded-xl border p-2.5',
          collapsed ? 'w-16 items-center' : 'w-full',
          dark ? 'border-slate-800 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800',
        ),
      })}
      aria-label={String(p.brandTitle || t('侧边导航', 'Side navigation'))}
    >
      {Boolean(p.brandTitle) && (
        <div className={cx('mb-2 flex items-center gap-2.5 px-2.5 py-2', collapsed && 'justify-center px-0')}>
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white text-xs font-bold">
            {String(p.brandTitle).slice(0, 1)}
          </span>
          {!collapsed && <span className="truncate text-sm font-bold">{String(p.brandTitle)}</span>}
        </div>
      )}
      <div className="flex flex-col gap-1 w-full">
        {items.map((item, idx) => {
          const key = String(item.key ?? `item-${idx}`);
          const active = key === selectedKey;
          const IconComp = resolveSemanticIcon(item.icon, LayoutGrid);
          const title = String(item.title ?? key);
          return (
            <button
              key={key}
              type="button"
              title={collapsed ? title : undefined}
              aria-label={collapsed ? title : undefined}
              aria-current={active ? 'page' : undefined}
              onClick={() => handleItem(item, idx)}
              className={cx(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition cursor-pointer min-w-0',
                collapsed && 'justify-center px-0',
                active
                  ? dark
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-blue-50 text-blue-700 font-semibold'
                  : dark
                  ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <IconComp className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="flex-1 truncate text-left">{title}</span>}
              {!collapsed && Boolean(item.badge) && (
                <span
                  className={cx(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shrink-0',
                    active && dark ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700',
                  )}
                >
                  {String(item.badge)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

const COVER_TONES = [
  'from-blue-500/15 via-indigo-500/10 to-sky-500/15 text-blue-600',
  'from-violet-500/15 via-purple-500/10 to-fuchsia-500/15 text-violet-600',
  'from-emerald-500/15 via-teal-500/10 to-cyan-500/15 text-emerald-600',
  'from-amber-500/15 via-orange-500/10 to-rose-500/15 text-amber-600',
];

const CardGrid: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { tr: t, td, isEn } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const boundTable = useMemo(() => tables.find((tb) => tb.id === tableId), [tables, tableId]);
  const rawRows = useDesktopBoundRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const query = rt.filters[node.pfId];
  const cols = Math.min(4, Math.max(1, Math.round(Number(p.cols ?? 3))));
  const pageSize = Math.max(1, Math.round(Number(p.pageSize ?? 6)));
  const page = rt.pageNo[node.pfId] ?? 1;

  interface CardGridItem {
    id: string;
    row: Row;
    title: string;
    subtitle: string;
    tag: string;
    price: string;
    image: string;
  }

  const model = useMemo((): { cards: CardGridItem[] } | { error: string } => {
    try {
      if (tableId && !boundTable) {
        throw new Error(tr(`未找到绑定的物理表 ${tableId}`, `Bound physical table "${tableId}" not found`));
      }
      const fkErrors = tableId ? sourceForeignKeyErrors(p, tables) : [];
      if (fkErrors.length) throw new Error(fkErrors[0]);

      if (tableId && boundTable) {
        const scoped =
          typeof p.sourceForeignKey === 'string'
            ? rowsForSource(rawRows, p.sourceForeignKey, tableId, { row: sourceRow, tableId: sourceTableId }, tables)
            : rawRows;
        const filtered = filterCardRows(scoped, p.filter, query);
        const textCols = boundTable.columns.filter((c) => !c.isPrimaryKey);
        const titleKey = (p.titleField as string) || textCols[0]?.name || boundTable.columns[0]?.name || 'id';
        const subKey = (p.subtitleField as string) || textCols[1]?.name || '';
        const tagKey = (p.tagField as string) || '';
        const priceKey = (p.priceField as string) || '';
        const imgKey = (p.imageField as string) || '';
        const cell = (r: Row, k: string) => (k && r[k] != null ? String(r[k]) : '');
        return {
          cards: filtered.map((r) => ({
            id: String(r.id),
            row: r,
            title: cell(r, titleKey) || String(r.id),
            subtitle: cell(r, subKey),
            tag: cell(r, tagKey),
            price: cell(r, priceKey),
            image: cell(r, imgKey),
          })),
        };
      }

      const staticItems = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
      const synthesized: Row[] = staticItems.map((it, idx) => ({
        ...it,
        id: `card-${idx + 1}`,
        title: String(it.title ?? ''),
        subtitle: String(it.subtitle ?? ''),
        tag: String(it.tag ?? ''),
        price: String(it.price ?? ''),
        image: String(it.image ?? ''),
      }));
      const filtered = filterCardRows(applyUIStackRows(synthesized, undefined, uiState, isEn), p.filter, query);
      return {
        cards: filtered.map((r, idx) => ({
          id: String(r.id),
          row: r,
          title: String(r.title || t(`卡片项 ${idx + 1}`, `Card ${idx + 1}`)),
          subtitle: String(r.subtitle || ''),
          tag: String(r.tag || ''),
          price: String(r.price || ''),
          image: String(r.image || ''),
        })),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [tableId, boundTable, tables, p, rawRows, sourceRow, sourceTableId, query, t, uiState, isEn]);

  useEffect(() => {
    rt.setPageNo(node.pfId, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tableId, node.pfId]);

  const autoSelectFirst = Boolean(p.autoSelectFirst);
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  const validCards = 'error' in model ? [] : model.cards;
  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: sourceRow?.id,
    visibleRows: validCards,
    autoSelectFirst,
    runtimeQuery: query,
  });

  if ('error' in model && model.error !== undefined) {
    return (
      <div {...rootWith(root, { className: 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">
        {td(model.error)}
      </div>
    );
  }
  if ('error' in model) return null;

  const total = model.cards.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleCards = model.cards.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rowActions = Array.isArray(p.rowActions) ? (p.rowActions as Record<string, unknown>[]) : [];

  if (total === 0) {
    return (
      <div
        {...rootWith(root, {
          className: cx(
            'rounded-[18px] py-10 text-center',
            isDark
              ? 'bg-[#16181D] ring-1 ring-inset ring-white/[0.08] text-zinc-500'
              : 'bg-white ring-1 ring-inset ring-slate-900/[0.06] text-slate-400',
          ),
        })}
      >
        <Inbox className="mx-auto mb-2 h-7 w-7 opacity-50" aria-hidden="true" />
        <div className="text-xs">{t('暂无匹配的卡片记录', 'No matching card records')}</div>
      </div>
    );
  }

  return (
    <div {...rootWith(root, { className: 'space-y-3' })}>
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {visibleCards.map((card, idx) => {
          const clickable = (Boolean(p.onItemClick) || autoSelectFirst) && !rt.isDesign;
          const isActiveCard = Boolean(tableId && activeRowId === card.id);
          const triggerCard = () => {
            if (!clickable) return;
            if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, card.id, fkSourceTableId);
            if (p.onItemClick) void rt.run(p.onItemClick as PropValue, childRowScope(scope, card.row, tableId, fkSourceTableId));
          };
          return (
            <article
              key={card.id}
              data-row-id={card.id}
              data-active-row={isActiveCard ? '1' : undefined}
              onClick={triggerCard}
              {...interactiveBoxProps(clickable, triggerCard)}
              className={cx(
                'group flex flex-col overflow-clip rounded-[18px] transition duration-200 min-w-0',
                isDark
                  ? cx(
                      'bg-[#16181D] hover:ring-white/20',
                      isActiveCard ? 'ring-2 ring-blue-400/70' : 'ring-1 ring-inset ring-white/[0.08]',
                    )
                  : cx(
                      'bg-white shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)] hover:shadow-[0_10px_24px_-8px_rgba(15,23,42,0.1)] hover:ring-blue-500/30',
                      isActiveCard ? 'ring-2 ring-blue-500/75' : 'ring-1 ring-inset ring-slate-900/[0.06]',
                    ),
                clickable && 'cursor-pointer',
              )}
            >
              {p.showCover !== false && (
                card.image ? (
                  <img
                    src={card.image}
                    alt={card.title}
                    className={cx('block w-full object-cover', isDark ? 'bg-zinc-900' : 'bg-slate-100')}
                    style={{ aspectRatio: '16 / 9' }}
                  />
                ) : (
                  <div
                    className={cx('flex items-center justify-between bg-gradient-to-br px-4', COVER_TONES[idx % COVER_TONES.length])}
                    style={{ aspectRatio: '16 / 7' }}
                  >
                    <Sparkles className="h-6 w-6 opacity-80" aria-hidden="true" />
                    {card.tag && (
                      <span className={cx('rounded-full px-2.5 py-0.5 text-[11px] font-medium shadow-2xs', isDark ? 'bg-zinc-900/85 text-zinc-200' : 'bg-white/85 text-slate-700')}>
                        {card.tag}
                      </span>
                    )}
                  </div>
                )
              )}
              <div className="flex flex-1 flex-col justify-between gap-3 p-4 min-w-0">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className={cx('truncate text-sm font-semibold', isDark ? 'text-zinc-100' : 'text-slate-900')}>{card.title}</h4>
                    {(p.showCover === false || card.image) && card.tag && (
                      <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', isDark ? 'bg-blue-500/18 text-blue-300' : 'bg-blue-50 text-blue-700')}>
                        {card.tag}
                      </span>
                    )}
                  </div>
                  {card.subtitle && (
                    <p
                      className={cx('text-xs leading-relaxed', isDark ? 'text-zinc-400' : 'text-slate-500')}
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'clip' }}
                    >
                      {card.subtitle}
                    </p>
                  )}
                </div>
                {(card.price || rowActions.length > 0) && (
                  <div className={cx('flex items-center justify-between gap-2 border-t pt-2.5', isDark ? 'border-white/[0.06]' : 'border-slate-100')}>
                    <span className={cx('text-sm font-bold tabular-nums', isDark ? 'text-blue-400' : 'text-blue-600')}>{card.price}</span>
                    {rowActions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {rowActions.map((act, aIdx) => {
                          if (!rt.isDesign && matchesWhenCondition(card.row, act.hiddenWhenField, act.hiddenWhenValue)) return null;
                          const actDisabled = !rt.isDesign && matchesWhenCondition(card.row, act.disabledWhenField, act.disabledWhenValue);
                          return (
                            <button
                              key={aIdx}
                              type="button"
                              disabled={actDisabled}
                              title={actDisabled && typeof act.disabledReason === 'string' && act.disabledReason ? act.disabledReason : undefined}
                              onClick={() => {
                                if (!rt.isDesign && !actDisabled && act.onClick) {
                                  void rt.run(act.onClick as PropValue, childRowScope(scope, card.row, tableId, fkSourceTableId));
                                }
                              }}
                              className={cx(
                                'rounded-md px-2 py-1 text-xs font-medium transition',
                                actDisabled
                                  ? 'text-slate-400 opacity-50 cursor-not-allowed'
                                  : cx(
                                      'cursor-pointer',
                                      act.danger
                                        ? 'text-rose-600 hover:bg-rose-50'
                                        : 'text-blue-600 hover:bg-blue-50',
                                    ),
                              )}
                            >
                              {String(act.label ?? t('操作', 'Action'))}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-slate-500 tabular-nums">
          <span>{t(`共 ${total} 项`, `${total} items`)}</span>
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => rt.setPageNo(node.pfId, Math.max(1, safePage - 1))}
            className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40 cursor-pointer"
          >
            {t('上一页', 'Prev')}
          </button>
          <span>{safePage} / {totalPages}</span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => rt.setPageNo(node.pfId, Math.min(totalPages, safePage + 1))}
            className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40 cursor-pointer"
          >
            {t('下一页', 'Next')}
          </button>
        </div>
      )}
    </div>
  );
};

const Dropdown: React.FC<CompProps> = ({ p, children, root, rt, scope }) => {
  const { tr: t } = useI18n();
  const rawItems = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  const menuItems = rawItems.map((item, idx) => ({
    key: String(item.key ?? `menu-${idx}`),
    label: String(item.title ?? t(`菜单项 ${idx + 1}`, `Action ${idx + 1}`)),
    danger: Boolean(item.danger),
    disabled: Boolean(item.disabled),
  }));
  const byKey = new Map(rawItems.map((item, idx) => [String(item.key ?? `menu-${idx}`), item]));
  const btnType = String(p.buttonType ?? 'default');
  const btnCls =
    btnType === 'primary'
      ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
      : btnType === 'link'
      ? 'border-transparent bg-transparent text-blue-600 hover:text-blue-700 px-1.5'
      : btnType === 'text'
      ? 'border-transparent bg-transparent text-slate-700 hover:bg-slate-100 px-2'
      : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:text-blue-600';

  return (
    <div {...rootWith(root, { className: 'inline-flex' })}>
      <AntdSurface>
        <DropdownAntd
          trigger={[p.trigger === 'hover' ? 'hover' : 'click']}
          placement={(p.placement as 'bottomRight' | 'bottomLeft' | 'topRight' | 'topLeft') ?? 'bottomRight'}
          disabled={Boolean(p.disabled)}
          {...(rt.isDesign ? { open: false } : {})}
          menu={{
            items: menuItems,
            onClick: ({ key }) => {
              if (rt.isDesign) return;
              const hit = byKey.get(String(key));
              if (hit?.onClick) {
                void rt.run(hit.onClick as PropValue, { ...scope, params: { ...scope.params, key } });
              }
            },
          }}
        >
          {children.length > 0 ? (
            <span className="inline-flex items-center cursor-pointer">{children}</span>
          ) : (
            <button
              type="button"
              disabled={Boolean(p.disabled)}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition cursor-pointer disabled:opacity-50',
                btnCls,
              )}
            >
              <span>{String(p.label || t('更多操作', 'Actions'))}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-75" aria-hidden="true" />
            </button>
          )}
        </DropdownAntd>
      </AntdSurface>
    </div>
  );
};

const CAROUSEL_GRADIENTS: Record<string, string> = {
  blue: 'from-blue-600 via-indigo-600 to-sky-500 text-white',
  violet: 'from-violet-600 via-purple-600 to-fuchsia-500 text-white',
  emerald: 'from-emerald-600 via-teal-600 to-cyan-600 text-white',
  amber: 'from-amber-500 via-orange-500 to-rose-500 text-white',
  slate: 'from-slate-800 via-slate-900 to-slate-950 text-white',
};

const Carousel: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr: t } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const height = Math.min(640, Math.max(120, Math.round(Number(p.height ?? 220))));
  const loop = p.loop !== false;
  const showArrows = p.showArrows !== false;
  const rawItems = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  const slides = rawItems.length
    ? rawItems
    : [
        { title: t('智能协同原型工作台', 'Collaborative AI Prototyping'), subtitle: t('高保真还原与数据模型一体化', 'Unified high-fidelity design & data schema'), tag: 'Alex', tone: 'blue' },
      ];

  const [activeIndex, setActiveIndex] = useState(0);
  const [settledAnnouncement, setSettledAnnouncement] = useState('');
  const settledRef = useRef(0);

  const computeNearest = useCallback(() => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return 0;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    return Math.max(0, Math.min(slides.length - 1, idx));
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
        setSettledAnnouncement(t(`第 ${next + 1} 页，共 ${slides.length} 页`, `Slide ${next + 1} of ${slides.length}`));
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
  }, [computeNearest, slides.length, t]);

  const scrollToSlide = (targetIdx: number) => {
    const count = slides.length;
    if (!count) return;
    const wrapped = loop ? ((targetIdx % count) + count) % count : Math.max(0, Math.min(count - 1, targetIdx));
    setActiveIndex(wrapped);
    const el = trackRef.current;
    if (el) {
      const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left: wrapped * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    }
  };

  return (
    <section
      {...rootWith(root, { className: 'relative overflow-clip rounded-2xl select-none' })}
      aria-roledescription="carousel"
      aria-label={String(p.title || t('轮播推荐', 'Featured carousel'))}
    >
      {showArrows && slides.length > 1 && (
        <div className="pointer-events-none absolute inset-x-3 inset-y-0 z-10 flex items-center justify-between">
          <button
            type="button"
            aria-label={t('上一张幻灯片', 'Previous slide')}
            disabled={!loop && activeIndex <= 0}
            onClick={() => scrollToSlide(activeIndex - 1)}
            style={{ touchAction: 'manipulation' }}
            className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/45 text-white backdrop-blur-xs transition hover:bg-slate-900/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-35 cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('下一张幻灯片', 'Next slide')}
            disabled={!loop && activeIndex >= slides.length - 1}
            onClick={() => scrollToSlide(activeIndex + 1)}
            style={{ touchAction: 'manipulation' }}
            className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/45 text-white backdrop-blur-xs transition hover:bg-slate-900/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-35 cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <div
        ref={trackRef}
        tabIndex={0}
        role="group"
        aria-label={t('轮播内容列表', 'Slides')}
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
          const tone = CAROUSEL_GRADIENTS[String(slide.tone ?? '')] ?? CAROUSEL_GRADIENTS[['blue', 'violet', 'emerald', 'amber'][idx % 4]];
          const clickable = Boolean(slide.onClick) && !rt.isDesign;
          return (
            <div
              key={idx}
              role="group"
              aria-roledescription="slide"
              aria-label={t(`${idx + 1} / ${slides.length}`, `${idx + 1} of ${slides.length}`)}
              onClick={() => {
                if (clickable) void rt.run(slide.onClick as PropValue, scope);
              }}
              className={cx(
                'relative flex h-full shrink-0 basis-full flex-col justify-center px-10 py-6 bg-gradient-to-r',
                tone,
                clickable && 'cursor-pointer',
              )}
              style={{ scrollSnapAlign: 'center' }}
            >
              {Boolean(slide.image) && (
                <img
                  src={String(slide.image)}
                  alt=""
                  className="absolute inset-0 block h-full w-full object-cover opacity-35"
                />
              )}
              <div className="relative z-[1] max-w-xl space-y-2">
                {Boolean(slide.tag) && (
                  <span className="inline-block rounded-full bg-white/20 px-3 py-0.5 text-xs font-semibold backdrop-blur-xs">
                    {String(slide.tag)}
                  </span>
                )}
                <h3 className="text-xl font-bold tracking-tight">{String(slide.title ?? t(`幻灯片 ${idx + 1}`, `Slide ${idx + 1}`))}</h3>
                {Boolean(slide.subtitle) && <p className="text-sm text-white/85">{String(slide.subtitle)}</p>}
              </div>
            </div>
          );
        })}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {settledAnnouncement}
      </p>

      {slides.length > 1 && (
        <nav
          aria-label={t('选择轮播页', 'Choose a slide')}
          className="absolute inset-x-0 bottom-2.5 z-10 flex items-center justify-center gap-1.5"
        >
          {slides.map((slide, idx) => {
            const active = idx === activeIndex;
            return (
              <button
                key={idx}
                type="button"
                aria-label={t(`跳转到第 ${idx + 1} 张：${String(slide.title ?? '')}`, `Go to slide ${idx + 1}: ${String(slide.title ?? '')}`)}
                aria-current={active ? 'true' : undefined}
                onClick={() => scrollToSlide(idx)}
                style={{ touchAction: 'manipulation' }}
                className="group inline-flex h-6 min-w-6 items-center justify-center focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
              >
                <span
                  className={cx(
                    'block h-2 rounded-full transition-all',
                    active ? 'w-6 bg-white ring-2 ring-slate-900/25' : 'w-2 bg-white/55 group-hover:bg-white/80',
                  )}
                />
              </button>
            );
          })}
        </nav>
      )}
    </section>
  );
};

const TONE_ICON_STYLES: Record<string, string> = {
  default: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
};

const Icon: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const IconComp = resolveSemanticIcon(p.name, Sparkles);
  const size = Math.min(96, Math.max(12, Math.round(Number(p.size ?? 20))));
  const tone = String(p.tone ?? 'blue');
  const boxed = p.boxed !== false;
  const clickable = Boolean(p.onClick) && !rt.isDesign;
  const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : undefined;

  const content = (
    <IconComp
      style={{ width: size, height: size, color: typeof p.color === 'string' && p.color ? p.color : undefined }}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
    />
  );

  if (clickable) {
    return (
      <button
        type="button"
        aria-label={label || String(p.name || 'Icon')}
        onClick={() => void rt.run(p.onClick as PropValue, scope)}
        className={cx(
          'inline-flex items-center justify-center transition cursor-pointer',
          boxed ? cx('rounded-xl p-2', TONE_ICON_STYLES[tone] ?? TONE_ICON_STYLES.blue) : TONE_ICON_STYLES[tone]?.split(' ')[1],
          root.className,
        )}
        style={root.style}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      {...rootWith(root, {
        className: cx(
          'inline-flex items-center justify-center',
          boxed ? cx('rounded-xl p-2', TONE_ICON_STYLES[tone] ?? TONE_ICON_STYLES.blue) : TONE_ICON_STYLES[tone]?.split(' ')[1],
        ),
      })}
    >
      {content}
    </span>
  );
};

const Repeater: React.FC<CompProps> = ({ node, p, kids, root, rt, scope, renderNode, renderMirroredNode }) => {
  const { isEn, tr: t, td } = useI18n();
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const boundTable = useMemo(() => tables.find((tb) => tb.id === tableId), [tables, tableId]);
  const rawRows = useDesktopBoundRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const query = rt.filters[node.pfId];
  const cols = Math.min(4, Math.max(1, Math.round(Number(p.cols ?? 3))));
  const gap = Math.max(0, Math.min(48, Number(p.gap ?? 16)));
  const pageSize = Math.max(1, Math.round(Number(p.pageSize ?? 6)));
  const page = rt.pageNo[node.pfId] ?? 1;
  const autoSelectFirst = Boolean(p.autoSelectFirst);

  const sampleRows = useMemo<Row[]>(
    () => [
      {
        id: 'rep-sample-1',
        title: t('华东智能制造升级专案', 'East Manufacturing Upgrade'),
        subtitle: t('负责人：林致远 · 预计本季交付', 'Owner: Alex Lin · Q4 Delivery'),
        status: t('进行中', 'In Progress'),
        amount: '¥480,000',
        progress: 72,
      },
      {
        id: 'rep-sample-2',
        title: t('全渠道供应链协同二期', 'Omnichannel Supply Chain Ph.2'),
        subtitle: t('负责人：陈思琪 · 履约准时率 98.5%', 'Owner: Sarah Chen · SLA 98.5%'),
        status: t('待评审', 'In Review'),
        amount: '¥320,000',
        progress: 45,
      },
      {
        id: 'rep-sample-3',
        title: t('核心供应商准入年度复核', 'Annual Supplier Qualification'),
        subtitle: t('负责人：周明 · 已完成 18 家核验', 'Owner: Ming Zhou · 18 Verified'),
        status: t('已完成', 'Completed'),
        amount: '¥150,000',
        progress: 100,
      },
    ],
    [t],
  );

  const model = useMemo((): { rows: Row[] } | { error: string } => {
    try {
      if (tableId && !boundTable) {
        throw new Error(tr(`未找到绑定的物理表 ${tableId}`, `Bound physical table "${tableId}" not found`));
      }
      const fkErrors = tableId ? sourceForeignKeyErrors(p, tables) : [];
      if (fkErrors.length) throw new Error(fkErrors[0]);
      const base =
        tableId && boundTable
          ? typeof p.sourceForeignKey === 'string'
            ? rowsForSource(rawRows, p.sourceForeignKey, tableId, { row: sourceRow, tableId: sourceTableId }, tables)
            : rawRows
          : applyUIStackRows(sampleRows, undefined, uiState, isEn);
      return { rows: filterCardRows(base, p.filter, query) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [tableId, boundTable, tables, p, rawRows, sourceRow, sourceTableId, sampleRows, query, uiState, isEn]);

  useEffect(() => {
    rt.setPageNo(node.pfId, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tableId, node.pfId]);

  const validRows = 'error' in model ? [] : model.rows;
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: sourceRow?.id,
    visibleRows: validRows,
    autoSelectFirst,
    runtimeQuery: query,
  });

  if ('error' in model && model.error !== undefined) {
    return (
      <div {...rootWith(root, { className: 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">
        {td(model.error)}
      </div>
    );
  }
  if ('error' in model) return null;

  if (kids.length === 0) {
    return (
      <div {...rootWith(root, { className: 'rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center text-xs text-slate-500' })}>
        {t('在循环容器中拖入 Card / Flex / Tag / Button 等组件，使用 {{row.字段名}} 渲染单张业务卡片模板', 'Drop Card / Flex / Tag / Button inside Repeater and bind fields with {{row.field}}')}
      </div>
    );
  }

  const total = model.rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows = model.rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (total === 0) {
    if (rt.isDesign && uiState === 'normal') {
      // Keep template editable even when bound table has 0 rows in normal design mode
      return (
        <div {...rootWith(root, { className: 'space-y-2' })}>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
            <div className="min-w-0">{kids.map((k) => renderNode(k, { row: sampleRows[0], tableId }))}</div>
          </div>
        </div>
      );
    }
    return (
      <div
        {...rootWith(root, { className: 'rounded-xl border border-slate-200 bg-white py-10 text-center text-slate-400' })}
        data-ui-stack="empty"
      >
        <Inbox className="mx-auto mb-2 h-7 w-7 opacity-50" aria-hidden="true" />
        <div className="text-xs">{String(p.emptyText || t('暂无记录', 'No records'))}</div>
      </div>
    );
  }

  return (
    <div {...rootWith(root, { className: 'space-y-3' })}>
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}
      >
        {visibleRows.map((row, idx) => {
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
                'min-w-0 rounded-xl transition',
                clickable && 'cursor-pointer',
                isActive && 'ring-2 ring-blue-500/60 rounded-xl',
                rt.isDesign && idx > 0 && 'opacity-90',
              )}
            >
              {kids.map((k) => renderFn(k, { row, tableId, collectionSourceTableId: fkSourceTableId }))}
            </div>
          );
        })}
      </div>
      {(Boolean(p.pagination) || totalPages > 1) && (
        <div className="flex items-center justify-between pt-1 text-xs text-slate-500">
          <span>{t(`共 ${total} 条`, `${total} items`)}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1 || rt.isDesign}
              onClick={() => rt.setPageNo(node.pfId, Math.max(1, safePage - 1))}
              className="rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-40 cursor-pointer"
            >
              {t('上一页', 'Prev')}
            </button>
            <span className="tabular-nums px-1">{safePage} / {totalPages}</span>
            <button
              type="button"
              disabled={safePage >= totalPages || rt.isDesign}
              onClick={() => rt.setPageNo(node.pfId, Math.min(totalPages, safePage + 1))}
              className="rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-40 cursor-pointer"
            >
              {t('下一页', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const KANBAN_LANE_DOTS = ['bg-slate-400', 'bg-blue-500', 'bg-amber-500', 'bg-violet-500', 'bg-emerald-500', 'bg-rose-500'];

const Kanban: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { isEn, tr: t, td } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const uiState = useUIStackState();
  const preview = useContext(PreviewDataContext);
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const boundTable = useMemo(() => tables.find((tb) => tb.id === tableId), [tables, tableId]);
  const rawRows = useDesktopBoundRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const query = rt.filters[node.pfId];
  const allowMove = p.allowMove !== false;
  const autoSelectFirst = Boolean(p.autoSelectFirst);
  const [localSampleRows, setLocalSampleRows] = useState<Row[]>(() => [
    { id: 'kb-1', title: '星辰科技年度云平台续约', subtitle: '大客户一部 · 王凯', metric: '¥360,000', status: '待跟进', tag: '高优' },
    { id: 'kb-2', title: '远航物流 WMS 接口定制', subtitle: '华南区 · 李欣', metric: '¥185,000', status: '方案报价', tag: '定制' },
    { id: 'kb-3', title: '博雅医疗智能审方工作站', subtitle: '医疗行业线 · 赵敏', metric: '¥520,000', status: '商务谈判', tag: '战略' },
    { id: 'kb-4', title: '海川新能源集团采购中台', subtitle: '大客户二部 · 周杰', metric: '¥680,000', status: '已赢单', tag: '签约' },
  ]);
  const [dragRowId, setDragRowId] = useState<string | null>(null);

  const model = useMemo(() => {
    try {
      if (tableId && !boundTable) {
        throw new Error(tr(`未找到绑定的物理表 ${tableId}`, `Bound physical table "${tableId}" not found`));
      }
      const fkErrors = tableId ? sourceForeignKeyErrors(p, tables) : [];
      if (fkErrors.length) throw new Error(fkErrors[0]);

      const nonPk = boundTable?.columns.filter((c) => !c.isPrimaryKey) ?? [];
      const statusInfo = resolveKanbanStatusColumn(boundTable, p.statusField, p.lanes);
      const statusCol = statusInfo.statusCol;
      const statusKey = statusInfo.statusKey;

      const baseRows =
        tableId && boundTable
          ? typeof p.sourceForeignKey === 'string'
            ? rowsForSource(rawRows, p.sourceForeignKey, tableId, { row: sourceRow, tableId: sourceTableId }, tables)
            : rawRows
          : applyUIStackRows(localSampleRows, undefined, uiState, isEn);
      const filtered = filterCardRows(baseRows, p.filter, query);

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
        : [t('待处理', 'To Do'), t('进行中', 'In Progress'), t('已完成', 'Done')];

      // Include any extra status present in data so no record silently disappears
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
      const metricKey = (typeof p.metricField === 'string' && p.metricField) || (boundTable ? '' : 'metric');
      const tagKey = (typeof p.tagField === 'string' && p.tagField) || (boundTable ? '' : 'tag');

      return {
        rows: filtered,
        lanes: allLanes,
        moveTargets: new Set(lanes),
        statusKey,
        statusWritable: statusInfo.writable,
        titleKey,
        subtitleKey,
        metricKey,
        tagKey,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [tableId, boundTable, tables, p, rawRows, sourceRow, sourceTableId, localSampleRows, query, t, uiState, isEn]);

  const validRows = 'error' in model ? [] : model.rows;
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: sourceRow?.id,
    visibleRows: validRows,
    autoSelectFirst,
    runtimeQuery: query,
  });

  if ('error' in model && model.error !== undefined) {
    return (
      <div {...rootWith(root, { className: 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">
        {td(model.error)}
      </div>
    );
  }
  if ('error' in model) return null;

  if (uiState === 'empty' && model.rows.length === 0) {
    return (
      <div
        {...rootWith(root, { className: 'rounded-xl border border-slate-200 bg-white py-10 text-center text-slate-400' })}
        data-ui-stack="empty"
      >
        <Inbox className="mx-auto mb-2 h-7 w-7 opacity-50" aria-hidden="true" />
        <div className="text-xs">{String(p.emptyText || t('看板暂无待流转事项', 'No items on board'))}</div>
      </div>
    );
  }

  const canMutate = allowMove && model.statusWritable && !rt.isDesign && !preview && uiState === 'normal';
  const canMoveTo = (lane: string) => canMutate && model.moveTargets.has(lane);
  const moveCardToLane = (row: Row, targetLane: string) => {
    if (!canMoveTo(targetLane) || String(row[model.statusKey] ?? '') === targetLane) return;
    if (tableId && boundTable) {
      try {
        usePageStore.getState().updateRow(tableId, row.id, { [model.statusKey]: targetLane });
      } catch {
        // Ignore enum mismatch if custom lane label is not in strict SQL ENUM
      }
    } else {
      setLocalSampleRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [model.statusKey]: targetLane } : r)));
    }
  };

  const rowActions = Array.isArray(p.rowActions) ? (p.rowActions as Record<string, unknown>[]) : [];

  return (
    <div {...rootWith(root, { className: 'overflow-x-auto pb-1' })}>
      <div
        className="grid gap-3.5 min-w-[640px]"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, model.lanes.length)}, minmax(220px, 1fr))` }}
      >
        {model.lanes.map((lane, laneIdx) => {
          const laneRows = model.rows.filter((r) => String(r[model.statusKey] ?? model.lanes[0]) === lane);
          return (
            <section
              key={lane}
              data-kanban-lane={lane}
              onDragOver={(e) => {
                if (canMoveTo(lane)) e.preventDefault();
              }}
              onDrop={(e) => {
                if (!canMoveTo(lane) || !dragRowId) return;
                e.preventDefault();
                const dragged = model.rows.find((r) => r.id === dragRowId);
                setDragRowId(null);
                if (dragged) moveCardToLane(dragged, lane);
              }}
              className={cx(
                'flex flex-col rounded-[18px] p-3 min-h-[240px]',
                isDark
                  ? 'bg-white/[0.03] ring-1 ring-inset ring-white/[0.07]'
                  : 'bg-slate-50/85 ring-1 ring-inset ring-slate-900/[0.05]',
              )}
            >
              <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cx('h-2 w-2 rounded-full shrink-0', KANBAN_LANE_DOTS[laneIdx % KANBAN_LANE_DOTS.length])} />
                  <span className={cx('text-[13px] font-semibold truncate', isDark ? 'text-zinc-100' : 'text-slate-800')}>{td(lane)}</span>
                </div>
                <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', isDark ? 'bg-white/[0.08] text-zinc-300' : 'bg-slate-200/80 text-slate-600')}>
                  {laneRows.length}
                </span>
              </div>

              <div className="flex-1 space-y-2">
                {laneRows.map((row) => {
                  const titleText = String(row[model.titleKey] ?? row.id);
                  const subText = model.subtitleKey && row[model.subtitleKey] != null ? String(row[model.subtitleKey]) : '';
                  const metricText = model.metricKey && row[model.metricKey] != null ? String(row[model.metricKey]) : '';
                  const tagText = model.tagKey && row[model.tagKey] != null ? String(row[model.tagKey]) : '';
                  const isActive = Boolean(tableId && activeRowId === row.id);
                  const clickable = (Boolean(p.onCardClick) || autoSelectFirst) && !rt.isDesign;
                  const triggerKanbanCard = () => {
                    if (!clickable) return;
                    if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, row.id, fkSourceTableId);
                    if (p.onCardClick) void rt.run(p.onCardClick as PropValue, childRowScope(scope, row, tableId, fkSourceTableId));
                  };

                  return (
                    <article
                      key={row.id}
                      data-row-id={row.id}
                      data-active-row={isActive ? '1' : undefined}
                      draggable={canMutate}
                      onDragStart={() => setDragRowId(row.id)}
                      onDragEnd={() => setDragRowId(null)}
                      onClick={triggerKanbanCard}
                      {...interactiveBoxProps(clickable, triggerKanbanCard)}
                      className={cx(
                        'rounded-xl p-3 transition duration-150',
                        isDark
                          ? cx(
                              'bg-[#181B22] hover:ring-white/20',
                              isActive ? 'ring-2 ring-blue-400/70' : 'ring-1 ring-inset ring-white/[0.08]',
                            )
                          : cx(
                              'bg-white shadow-[0_2px_8px_-3px_rgba(15,23,42,0.06)] hover:shadow-xs hover:ring-blue-500/30',
                              isActive ? 'ring-2 ring-blue-500/70' : 'ring-1 ring-inset ring-slate-900/[0.06]',
                            ),
                        clickable && 'cursor-pointer',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className={cx('text-[13px] font-medium leading-snug', isDark ? 'text-zinc-100' : 'text-slate-900')}>{titleText}</div>
                        {tagText && (
                          <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', isDark ? 'bg-blue-500/18 text-blue-300' : 'bg-blue-50 text-blue-700')}>
                            {td(tagText)}
                          </span>
                        )}
                      </div>
                      {subText && <div className={cx('mt-1 text-[11.5px] truncate', isDark ? 'text-zinc-400' : 'text-slate-500')}>{subText}</div>}
                      {(metricText || canMutate || rowActions.length > 0) && (
                        <div className={cx('mt-2.5 flex items-center justify-between gap-2 pt-2 border-t', isDark ? 'border-white/[0.06]' : 'border-slate-100')}>
                          <span className={cx('text-[12px] font-semibold tabular-nums', isDark ? 'text-zinc-200' : 'text-slate-800')}>{metricText}</span>
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {rowActions.map((act, ai) => {
                              if (!rt.isDesign && matchesWhenCondition(row, act.hiddenWhenField, act.hiddenWhenValue)) return null;
                              const actDisabled = !rt.isDesign && matchesWhenCondition(row, act.disabledWhenField, act.disabledWhenValue);
                              return (
                                <button
                                  key={ai}
                                  type="button"
                                  disabled={actDisabled}
                                  title={actDisabled && typeof act.disabledReason === 'string' && act.disabledReason ? act.disabledReason : undefined}
                                  onClick={() => {
                                    if (!rt.isDesign && !actDisabled) void rt.run(act.onClick as PropValue, childRowScope(scope, row, tableId, fkSourceTableId));
                                  }}
                                  className={cx(
                                    'px-1.5 py-0.5 rounded text-[11px] font-medium',
                                    actDisabled
                                      ? 'text-slate-400 opacity-50 cursor-not-allowed'
                                      : cx('cursor-pointer', act.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-blue-600 hover:bg-blue-50'),
                                  )}
                                >
                                  {String(act.label ?? '')}
                                </button>
                              );
                            })}
                            {laneIdx > 0 && canMoveTo(model.lanes[laneIdx - 1]) && (
                              <button
                                type="button"
                                aria-label={t(`移至${model.lanes[laneIdx - 1]}`, `Move to ${model.lanes[laneIdx - 1]}`)}
                                title={t(`回退至：${model.lanes[laneIdx - 1]}`, `Move to ${model.lanes[laneIdx - 1]}`)}
                                onClick={() => moveCardToLane(row, model.lanes[laneIdx - 1])}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {laneIdx < model.lanes.length - 1 && canMoveTo(model.lanes[laneIdx + 1]) && (
                              <button
                                type="button"
                                aria-label={t(`推进至${model.lanes[laneIdx + 1]}`, `Advance to ${model.lanes[laneIdx + 1]}`)}
                                title={t(`推进至：${model.lanes[laneIdx + 1]}`, `Advance to ${model.lanes[laneIdx + 1]}`)}
                                onClick={() => moveCardToLane(row, model.lanes[laneIdx + 1])}
                                className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600 cursor-pointer"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
                {laneRows.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-[11px] text-slate-400">
                    {t('暂无卡片', 'Empty lane')}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

function parseIsoDay(raw: unknown): { year: number; month: number; day: number; key: string } | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, key };
}

const CalendarView: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { tr: t, td, isEn } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const insideCard = useInsideCardBody();
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const boundTable = useMemo(() => tables.find((tb) => tb.id === tableId), [tables, tableId]);
  const rawRows = useDesktopBoundRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const query = rt.filters[node.pfId];
  const autoSelectFirst = Boolean(p.autoSelectFirst);
  const [viewMode, setViewMode] = useState<'month' | 'week'>(p.view === 'week' ? 'week' : 'month');
  useEffect(() => {
    setViewMode(p.view === 'week' ? 'week' : 'month');
  }, [p.view]);

  const sampleEvents = useMemo<Row[]>(
    () => [
      { id: 'cal-1', date: '2026-11-04', title: t('核心供应商季度复审', 'Supplier Q4 Review'), status: t('已确认', 'Confirmed') },
      { id: 'cal-2', date: '2026-11-12', title: t('华东仓盘点锁库窗口', 'East Warehouse Audit'), status: t('执行中', 'Active') },
      { id: 'cal-3', date: '2026-11-18', title: t('大客户合同交付里程碑', 'Enterprise Milestone'), status: t('待办', 'Scheduled') },
      { id: 'cal-4', date: '2026-11-24', title: t('月度业财对账结转日', 'Monthly Finance Close'), status: t('重点', 'Key') },
    ],
    [t],
  );

  const model = useMemo(() => {
    try {
      if (tableId && !boundTable) {
        throw new Error(tr(`未找到绑定的物理表 ${tableId}`, `Bound physical table "${tableId}" not found`));
      }
      const fkErrors = tableId ? sourceForeignKeyErrors(p, tables) : [];
      if (fkErrors.length) throw new Error(fkErrors[0]);

      const cols = boundTable?.columns ?? [];
      const dateCol =
        (typeof p.dateField === 'string' && p.dateField ? cols.find((c) => c.name === p.dateField) : undefined) ??
        cols.find((c) => /DATE|TIMESTAMP/i.test(c.dataType) || /date|time|day|deadline|at$/i.test(c.name));
      const dateKey = (typeof p.dateField === 'string' && p.dateField) || dateCol?.name || 'date';
      const titleKey =
        (typeof p.titleField === 'string' && p.titleField) ||
        cols.find((c) => !c.isPrimaryKey && c.name !== dateKey)?.name ||
        'title';
      const statusKey =
        (typeof p.statusField === 'string' && p.statusField) ||
        cols.find((c) => /status|state|stage|type/i.test(c.name))?.name ||
        'status';

      const base =
        tableId && boundTable
          ? typeof p.sourceForeignKey === 'string'
            ? rowsForSource(rawRows, p.sourceForeignKey, tableId, { row: sourceRow, tableId: sourceTableId }, tables)
            : rawRows
          : applyUIStackRows(sampleEvents, undefined, uiState, isEn);
      const filtered = filterCardRows(base, p.filter, query);
      const events = filtered
        .map((row) => ({ row, parsed: parseIsoDay(row[dateKey]) }))
        .filter((x): x is { row: Row; parsed: NonNullable<ReturnType<typeof parseIsoDay>> } => x.parsed !== null);

      return { events, rows: filtered, dateKey, titleKey, statusKey };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [tableId, boundTable, tables, p, rawRows, sourceRow, sourceTableId, sampleEvents, uiState, isEn, query]);

  const firstAnchor = 'error' in model ? null : model.events[0]?.parsed ?? null;
  const [cursorYm, setCursorYm] = useState<{ year: number; month: number }>(() =>
    firstAnchor ? { year: firstAnchor.year, month: firstAnchor.month } : { year: 2026, month: 11 },
  );
  useEffect(() => {
    if (firstAnchor) setCursorYm({ year: firstAnchor.year, month: firstAnchor.month });
  }, [firstAnchor?.year, firstAnchor?.month]);

  const validRows = 'error' in model ? [] : model.rows;
  const activeRowId = tableId ? rt.activeRows?.[tableId] : undefined;
  useAutoSelectFirstRow({
    rt,
    tableId,
    sourceTableId: fkSourceTableId,
    sourceRowId: sourceRow?.id,
    visibleRows: validRows,
    autoSelectFirst,
    runtimeQuery: query,
  });

  if ('error' in model && model.error !== undefined) {
    return (
      <div {...rootWith(root, { className: 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">
        {td(model.error)}
      </div>
    );
  }
  if ('error' in model) return null;

  if (uiState === 'empty' && model.events.length === 0) {
    return (
      <div
        {...rootWith(root, {
          className: 'rounded-xl border border-dashed border-slate-200 bg-slate-50/60 py-10 text-center text-xs text-slate-400',
        })}
        data-ui-stack="empty"
      >
        {String(p.emptyText || t('暂无排期日程数据', 'No scheduled calendar events'))}
      </div>
    );
  }

  const daysInMonth = new Date(cursorYm.year, cursorYm.month, 0).getDate();
  const firstWeekday = new Date(cursorYm.year, cursorYm.month - 1, 1).getDay(); // 0=Sun
  const mondayOffset = (firstWeekday + 6) % 7;
  const totalSlots = viewMode === 'week' ? 7 : Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const startDay = viewMode === 'week' ? Math.max(1, (firstAnchor?.month === cursorYm.month ? firstAnchor.day : 1) - (((new Date(cursorYm.year, cursorYm.month - 1, firstAnchor?.month === cursorYm.month ? firstAnchor.day : 1).getDay() + 6) % 7))) : 1;

  const shiftMonth = (delta: number) => {
    setCursorYm((cur) => {
      const next = new Date(cur.year, cur.month - 1 + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
  };

  const weekdays = isEn
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  const byDate = new Map<string, Row[]>();
  for (const ev of model.events) {
    const bucket = byDate.get(ev.parsed.key) ?? [];
    bucket.push(ev.row);
    byDate.set(ev.parsed.key, bucket);
  }

  return (
    <div
      {...rootWith(root, {
        className: cx(
          'overflow-hidden',
          insideCard ? 'rounded-xl' : 'rounded-[18px]',
          isDark
            ? 'bg-[#16181D] ring-1 ring-inset ring-white/[0.08]'
            : 'bg-white ring-1 ring-inset ring-slate-900/[0.06]',
        ),
      })}
    >
      <div
        className={cx(
          'flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3',
          isDark ? 'border-white/[0.07] bg-white/[0.02]' : 'border-slate-200/80 bg-slate-50/60',
        )}
      >
        <div className="flex items-center gap-2">
          <Calendar className={cx('h-4 w-4', isDark ? 'text-blue-400' : 'text-blue-600')} aria-hidden="true" />
          <span className={cx('text-[14px] font-semibold', isDark ? 'text-zinc-100' : 'text-slate-900')}>
            {String(p.title || t('业务排期日历', 'Schedule Calendar'))}
          </span>
          <span className={cx('ml-2 text-xs font-medium tabular-nums', isDark ? 'text-zinc-400' : 'text-slate-500')}>
            {cursorYm.year}-{String(cursorYm.month).padStart(2, '0')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className={cx('inline-flex rounded-lg border p-0.5 text-xs', isDark ? 'border-zinc-700 bg-zinc-900' : 'border-slate-200 bg-white')}>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={cx('px-2.5 py-1 rounded-md cursor-pointer', viewMode === 'month' ? 'bg-blue-600 text-white font-medium' : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-600')}
            >
              {t('月视图', 'Month')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={cx('px-2.5 py-1 rounded-md cursor-pointer', viewMode === 'week' ? 'bg-blue-600 text-white font-medium' : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-600')}
            >
              {t('周视图', 'Week')}
            </button>
          </div>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className={cx('rounded-md border p-1 cursor-pointer', isDark ? 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
              aria-label={t('上个月', 'Previous month')}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className={cx('rounded-md border p-1 cursor-pointer', isDark ? 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
              aria-label={t('下个月', 'Next month')}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className={cx('grid grid-cols-7 border-b text-[11px] font-medium', isDark ? 'border-white/[0.07] bg-white/[0.02] text-zinc-400' : 'border-slate-200 bg-slate-50 text-slate-500')}>
        {weekdays.map((w) => (
          <div key={w} className={cx('px-2.5 py-1.5 text-center border-r last:border-r-0', isDark ? 'border-white/[0.06]' : 'border-slate-200/70')}>
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {Array.from({ length: totalSlots }).map((_, idx) => {
          const dayNum = viewMode === 'week' ? startDay + idx : idx - mondayOffset + 1;
          const validDay = dayNum >= 1 && dayNum <= daysInMonth;
          const key = validDay
            ? `${cursorYm.year}-${String(cursorYm.month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
            : '';
          const dayEvents = validDay ? byDate.get(key) ?? [] : [];

          return (
            <div
              key={idx}
              className={cx(
                'border-r border-b p-1.5 min-w-0',
                isDark ? 'border-white/[0.05]' : 'border-slate-100',
                viewMode === 'week' ? 'min-h-[140px]' : 'min-h-[84px]',
                !validDay && (isDark ? 'bg-white/[0.015]' : 'bg-slate-50/50'),
              )}
            >
              {validDay && (
                <>
                  <div className={cx('text-[11px] font-medium tabular-nums px-1 mb-1', isDark ? 'text-zinc-400' : 'text-slate-500')}>{dayNum}</div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, viewMode === 'week' ? 6 : 3).map((evRow) => {
                      const label = String(evRow[model.titleKey] ?? evRow.id);
                      const isActive = Boolean(tableId && activeRowId === evRow.id);
                      const clickable = (Boolean(p.onEventClick) || autoSelectFirst) && !rt.isDesign;
                      return (
                        <button
                          key={evRow.id}
                          type="button"
                          data-row-id={evRow.id}
                          data-active-row={isActive ? '1' : undefined}
                          onClick={() => {
                            if (!clickable) return;
                            if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, evRow.id, fkSourceTableId);
                            if (p.onEventClick) void rt.run(p.onEventClick as PropValue, childRowScope(scope, evRow, tableId, fkSourceTableId));
                          }}
                          className={cx(
                            'block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium transition',
                            isActive
                              ? 'bg-blue-600 text-white'
                              : isDark
                              ? 'bg-blue-500/18 text-blue-300 hover:bg-blue-500/28'
                              : 'bg-blue-50 text-blue-700 hover:bg-blue-100',
                            clickable && 'cursor-pointer',
                          )}
                          title={label}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {dayEvents.length > (viewMode === 'week' ? 6 : 3) && (
                      <div className="px-1 text-[10px] text-slate-400">
                        +{dayEvents.length - (viewMode === 'week' ? 6 : 3)}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const COPILOT_TONES: Record<
  string,
  {
    lightBox: string;
    darkBox: string;
    lightBadge: string;
    darkBadge: string;
    icon: string;
    lightAction: string;
    darkAction: string;
  }
> = {
  indigo: {
    lightBox: 'ring-1 ring-inset ring-indigo-500/20 bg-gradient-to-br from-indigo-50/85 via-white to-blue-50/45 shadow-[0_6px_22px_-8px_rgba(79,70,229,0.12)]',
    darkBox: 'ring-1 ring-inset ring-indigo-400/25 bg-gradient-to-br from-indigo-950/70 via-[#16181D] to-[#14161B] shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)]',
    lightBadge: 'bg-indigo-100 text-indigo-700',
    darkBadge: 'bg-indigo-500/20 text-indigo-200 ring-1 ring-inset ring-indigo-400/30',
    icon: 'bg-indigo-600 text-white',
    lightAction: 'border-indigo-200/80 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50/70',
    darkAction: 'border-indigo-400/30 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25',
  },
  emerald: {
    lightBox: 'ring-1 ring-inset ring-emerald-500/20 bg-gradient-to-br from-emerald-50/85 via-white to-teal-50/45 shadow-[0_6px_22px_-8px_rgba(5,150,105,0.12)]',
    darkBox: 'ring-1 ring-inset ring-emerald-400/25 bg-gradient-to-br from-emerald-950/65 via-[#16181D] to-[#14161B] shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)]',
    lightBadge: 'bg-emerald-100 text-emerald-700',
    darkBadge: 'bg-emerald-500/20 text-emerald-200 ring-1 ring-inset ring-emerald-400/30',
    icon: 'bg-emerald-600 text-white',
    lightAction: 'border-emerald-200/80 bg-white text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50/70',
    darkAction: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25',
  },
  amber: {
    lightBox: 'ring-1 ring-inset ring-amber-500/22 bg-gradient-to-br from-amber-50/85 via-white to-orange-50/45 shadow-[0_6px_22px_-8px_rgba(217,119,6,0.12)]',
    darkBox: 'ring-1 ring-inset ring-amber-400/25 bg-gradient-to-br from-amber-950/60 via-[#16181D] to-[#14161B] shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)]',
    lightBadge: 'bg-amber-100 text-amber-800',
    darkBadge: 'bg-amber-500/20 text-amber-200 ring-1 ring-inset ring-amber-400/30',
    icon: 'bg-amber-500 text-white',
    lightAction: 'border-amber-200/80 bg-white text-amber-800 hover:border-amber-300 hover:bg-amber-50/70',
    darkAction: 'border-amber-400/30 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25',
  },
  rose: {
    lightBox: 'ring-1 ring-inset ring-rose-500/20 bg-gradient-to-br from-rose-50/85 via-white to-pink-50/45 shadow-[0_6px_22px_-8px_rgba(225,29,72,0.12)]',
    darkBox: 'ring-1 ring-inset ring-rose-400/25 bg-gradient-to-br from-rose-950/65 via-[#16181D] to-[#14161B] shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)]',
    lightBadge: 'bg-rose-100 text-rose-700',
    darkBadge: 'bg-rose-500/20 text-rose-200 ring-1 ring-inset ring-rose-400/30',
    icon: 'bg-rose-600 text-white',
    lightAction: 'border-rose-200/80 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50/70',
    darkAction: 'border-rose-400/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
  },
};

const AiCopilotCard: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr: t } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const rawTone = String(p.tone ?? 'indigo');
  const isDarkBrief = rawTone === 'dark_brief';
  const effectiveDark = isDark || isDarkBrief;
  const tone = COPILOT_TONES[rawTone] ?? COPILOT_TONES.indigo;
  const items = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  const primaryLabel = typeof p.primaryActionLabel === 'string' ? p.primaryActionLabel.trim() : '';
  const timestamp = typeof p.timestamp === 'string' ? p.timestamp.trim() : '';

  return (
    <section
      data-copilot-tone={rawTone}
      {...rootWith(root, {
        className: cx(
          'rounded-[20px] p-4 sm:p-5 space-y-3.5',
          isDarkBrief
            ? 'pf-mobile-brief-mesh text-[#F4F7F4] ring-1 ring-inset ring-emerald-400/25 shadow-[0_14px_34px_-12px_rgba(6,24,14,0.55)]'
            : isDark
            ? tone.darkBox
            : tone.lightBox,
        ),
        style: isDarkBrief ? { colorScheme: 'dark' } : undefined,
      })}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span
            className={cx(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-2xs',
              isDarkBrief
                ? 'bg-[#A3E635]/18 text-[#D9F99D] ring-1 ring-inset ring-[#A3E635]/35'
                : tone.icon,
            )}
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4
                className={cx(
                  'text-[14.5px] font-semibold tracking-tight',
                  isDarkBrief ? 'text-[#F4F7F4]' : effectiveDark ? 'text-zinc-100' : 'text-slate-900',
                )}
              >
                {String(p.title || t('AI 智能辅助审单', 'AI Copilot Insight'))}
              </h4>
              {Boolean(p.badge) && (
                <span
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold',
                    isDarkBrief
                      ? 'bg-[#A3E635]/18 text-[#D9F99D] ring-1 ring-inset ring-[#A3E635]/35'
                      : effectiveDark
                      ? tone.darkBadge
                      : tone.lightBadge,
                  )}
                >
                  {isDarkBrief && <span className="h-1.5 w-1.5 rounded-full bg-[#A3E635]" aria-hidden="true" />}
                  <span>{String(p.badge)}</span>
                </span>
              )}
              {timestamp && (
                <span className={cx('text-[11px] tabular-nums', isDarkBrief ? 'text-emerald-200/65' : effectiveDark ? 'text-zinc-400' : 'text-slate-400')}>
                  {timestamp}
                </span>
              )}
            </div>
            {Boolean(p.summary) && (
              <p
                className={cx(
                  'mt-1 text-[12.5px] leading-relaxed',
                  isDarkBrief ? 'text-emerald-50/85' : effectiveDark ? 'text-zinc-300' : 'text-slate-600',
                )}
              >
                {String(p.summary)}
              </p>
            )}
          </div>
        </div>
        {primaryLabel && (
          <button
            type="button"
            onClick={() => {
              if (!rt.isDesign && p.onPrimaryAction) void rt.run(p.onPrimaryAction as PropValue, scope);
            }}
            className={cx(
              'shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition cursor-pointer',
              isDarkBrief
                ? 'bg-[#A3E635] text-[#0B1911] hover:bg-[#BEF264]'
                : effectiveDark
                ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                : 'bg-slate-900 text-white hover:bg-slate-800',
            )}
          >
            {primaryLabel}
          </button>
        )}
      </div>

      {items.length > 0 && (
        <div className="grid gap-2">
          {items.map((item, idx) => (
            <div
              key={idx}
              className={cx(
                'flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 transition',
                isDarkBrief
                  ? 'bg-white/[0.06] ring-1 ring-inset ring-white/[0.1]'
                  : effectiveDark
                  ? 'bg-white/[0.04] ring-1 ring-inset ring-white/[0.08]'
                  : 'bg-white/92 ring-1 ring-inset ring-slate-900/[0.05] shadow-2xs',
              )}
            >
              <div className="min-w-0">
                <div
                  className={cx(
                    'text-[12.5px] font-semibold',
                    isDarkBrief ? 'text-[#F4F7F4]' : effectiveDark ? 'text-zinc-100' : 'text-slate-800',
                  )}
                >
                  {String(item.title ?? '')}
                </div>
                {Boolean(item.detail) && (
                  <div
                    className={cx(
                      'text-[11.5px] mt-0.5',
                      isDarkBrief ? 'text-emerald-100/70' : effectiveDark ? 'text-zinc-400' : 'text-slate-500',
                    )}
                  >
                    {String(item.detail)}
                  </div>
                )}
              </div>
              {Boolean(item.actionLabel) && (
                <button
                  type="button"
                  onClick={() => {
                    if (!rt.isDesign && item.onClick) void rt.run(item.onClick as PropValue, scope);
                  }}
                  className={cx(
                    'shrink-0 rounded-full border px-3 py-1 text-[11.5px] font-semibold transition cursor-pointer',
                    isDarkBrief
                      ? 'border-[#A3E635]/40 bg-[#A3E635]/15 text-[#D9F99D] hover:bg-[#A3E635]/25'
                      : effectiveDark
                      ? tone.darkAction
                      : tone.lightAction,
                  )}
                >
                  {String(item.actionLabel)}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const DESKTOP_PROGRESS_TONES: Record<string, { fill: string; stroke: string; badgeLight: string; badgeDark: string }> = {
  forest: { fill: 'bg-[#1B4332]', stroke: '#22C55E', badgeLight: 'bg-emerald-100/90 text-emerald-900', badgeDark: 'bg-emerald-500/20 text-emerald-200' },
  emerald: { fill: 'bg-emerald-600', stroke: '#10B981', badgeLight: 'bg-emerald-50 text-emerald-700', badgeDark: 'bg-emerald-500/18 text-emerald-300' },
  amber: { fill: 'bg-amber-500', stroke: '#F59E0B', badgeLight: 'bg-amber-50 text-amber-800', badgeDark: 'bg-amber-500/18 text-amber-300' },
  rose: { fill: 'bg-rose-500', stroke: '#F43F5E', badgeLight: 'bg-rose-50 text-rose-700', badgeDark: 'bg-rose-500/18 text-rose-300' },
  blue: { fill: 'bg-blue-600', stroke: '#3B82F6', badgeLight: 'bg-blue-50 text-blue-700', badgeDark: 'bg-blue-500/18 text-blue-300' },
  violet: { fill: 'bg-violet-600', stroke: '#8B5CF6', badgeLight: 'bg-violet-50 text-violet-700', badgeDark: 'bg-violet-500/18 text-violet-300' },
  obsidian: { fill: 'bg-[#181A1F]', stroke: '#94A3B8', badgeLight: 'bg-slate-200/80 text-slate-800', badgeDark: 'bg-white/12 text-zinc-200' },
};

const ProgressBoard: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { isEn, tr: t, td } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const insideCard = useInsideCardBody();
  const preview = useContext(PreviewDataContext);
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const schema = useMemo(() => tables.find((tb) => tb.id === tableId), [tables, tableId]);
  const rawRows = useDesktopBoundRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const bindingErrors = useMemo(
    () => collectionBindingErrors('ProgressBoard', p, tables),
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
    () => filterCardRows(scopedRows, p.filter, runtimeFilter),
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
        const parsedVal =
          valKey && Object.prototype.hasOwnProperty.call(row, valKey)
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

    return filterCardRows(projectedItems, p.filter, runtimeFilter).map((it, idx) => {
      const parsedVal = parseProgressMetric(it.value);
      const parsedTarget = it.target !== undefined ? parseProgressMetric(it.target) : null;
      const label = String(it.label ?? it.title ?? t(`分项 ${idx + 1}`, `Item ${idx + 1}`));
      const staticRecord: Row = {
        id: String(it.id ?? `prog-${idx}`),
        label,
        value: parsedVal.kind === 'valid' ? parsedVal.pct : '',
        subtitle: it.subtitle ? String(it.subtitle) : '',
        tone: typeof it.tone === 'string' ? it.tone : '',
      };
      return {
        id: String(it.id ?? idx),
        label,
        metricState: parsedVal.kind,
        value: parsedVal.kind === 'valid' ? parsedVal.pct : null,
        target: parsedTarget?.kind === 'valid' ? parsedTarget.pct : undefined,
        subtitle: it.subtitle ? String(it.subtitle) : undefined,
        tone: typeof it.tone === 'string' && DESKTOP_PROGRESS_TONES[it.tone] ? it.tone : idx % 2 === 0 ? 'forest' : 'emerald',
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
    t,
    td,
  ]);

  if (bindingErrors.length > 0) {
    return (
      <div
        {...rootWith(root, {
          className: cx(
            'rounded-2xl border p-3 text-xs',
            isDark
              ? 'border-amber-400/25 bg-amber-500/15 text-amber-200'
              : 'border-amber-200 bg-amber-50 text-amber-800',
          ),
        })}
        role="alert"
      >
        {td(bindingErrors[0])}
      </div>
    );
  }

  const variant = p.variant === 'gauge' ? 'gauge' : 'capsule';
  const gaugeCols = Math.min(4, Math.max(1, Math.round(Number(p.cols ?? 2))));

  const getEntryActivation = (entry: (typeof entries)[number]) => {
    const canonicalRow =
      tableId && entry.row ? resolveCanonicalRow(tableId, entry.row, preview?.rows) ?? entry.row : undefined;
    const itemChain = entry.onClick ?? (p.onItemClick as PropValue | undefined);
    const blocked = actionChainRequiresBoundRow(itemChain) && (!tableId || !canonicalRow);
    const clickable = Boolean(itemChain) && !blocked && !rt.isDesign;
    const activate = () => {
      if (!clickable || !itemChain) return;
      const itemScope =
        tableId && canonicalRow
          ? childRowScope(scope, canonicalRow, tableId, fkSourceTableId)
          : isolatedStaticItemScope(scope, entry.staticRecord);
      void rt.run(itemChain, itemScope);
    };
    return { clickable, activate };
  };

  const renderMetricReadout = (entry: (typeof entries)[number], cls: string) => {
    if (entry.metricState === 'missing') {
      return (
        <span data-missing-value="1" className={cx(cls, 'opacity-50')}>
          —
        </span>
      );
    }
    if (entry.metricState === 'invalid') {
      return (
        <span data-invalid-value="1" className={cx(cls, 'text-amber-500')}>
          {t('无效值', 'Invalid')}
        </span>
      );
    }
    return <span className={cls}>{entry.value ?? 0}%</span>;
  };

  const containerCls = insideCard
    ? 'space-y-3 min-w-0'
    : cx(
        'rounded-[20px] p-5 space-y-3.5 min-w-0',
        isDark
          ? 'bg-[#16181D] ring-1 ring-inset ring-white/[0.08] shadow-[0_8px_24px_-10px_rgba(0,0,0,0.65)]'
          : 'bg-white ring-1 ring-inset ring-slate-900/[0.06] shadow-[0_2px_14px_-4px_rgba(15,23,42,0.05)]',
      );

  const showHeader = Boolean(p.title || p.extra) && (!insideCard || Boolean(p.extra) || node.props.title !== undefined);

  return (
    <section {...rootWith(root, { className: containerCls })} data-progress-board={variant}>
      {showHeader && (
        <div className="flex items-center justify-between gap-2">
          {p.title && (
            <h3 className={cx('text-[14.5px] font-semibold tracking-tight', isDark ? 'text-zinc-100' : 'text-slate-900')}>
              {String(p.title)}
            </h3>
          )}
          {p.extra && (
            <button
              type="button"
              onClick={() => {
                if (!rt.isDesign && p.onExtraClick) void rt.run(p.onExtraClick as PropValue, scope);
              }}
              className={cx(
                'text-[12px] font-semibold inline-flex items-center gap-0.5 cursor-pointer',
                isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700',
              )}
            >
              <span>{String(p.extra)}</span>
              {Boolean(p.onExtraClick) && <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div
          className={cx(
            'rounded-2xl py-7 text-center text-[12.5px]',
            isDark ? 'bg-white/[0.03] text-zinc-500' : 'bg-slate-50/80 text-slate-400',
          )}
        >
          {String(p.emptyText || t('暂无进度数据', 'No progress data'))}
        </div>
      ) : variant === 'gauge' ? (
        <div className="space-y-3">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${Math.min(gaugeCols, Math.max(1, entries.length))}, minmax(0, 1fr))` }}
          >
            {entries.slice(0, gaugeCols).map((entry) => {
              const toneSpec = DESKTOP_PROGRESS_TONES[entry.tone] ?? DESKTOP_PROGRESS_TONES.forest;
              const radius = 38;
              const arcLen = Math.PI * radius;
              const dashOffset =
                entry.value === null ? arcLen : arcLen * (1 - Math.max(0, Math.min(100, entry.value)) / 100);
              const { clickable, activate } = getEntryActivation(entry);
              return (
                <div
                  key={entry.id}
                  data-row-id={entry.row?.id ?? entry.id}
                  onClick={clickable ? activate : undefined}
                  {...interactiveBoxProps(clickable, activate)}
                  className={cx(
                    'rounded-[18px] p-4 flex flex-col items-center text-center transition duration-150',
                    isDark
                      ? 'bg-white/[0.035] ring-1 ring-inset ring-white/[0.07]'
                      : 'bg-slate-50/75 ring-1 ring-inset ring-slate-900/[0.045]',
                    clickable && 'cursor-pointer hover:ring-blue-500/35 active:scale-[0.99]',
                  )}
                >
                  <div className="relative w-[112px] h-[64px] flex items-end justify-center">
                    <svg viewBox="0 0 100 58" className="w-full h-full overflow-visible" aria-hidden="true">
                      <path
                        d="M 12 50 A 38 38 0 0 1 88 50"
                        fill="none"
                        stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)'}
                        strokeWidth="9"
                        strokeLinecap="round"
                      />
                      {entry.value !== null && entry.value > 0 && (
                        <path
                          d="M 12 50 A 38 38 0 0 1 88 50"
                          fill="none"
                          stroke={toneSpec.stroke}
                          strokeWidth="9"
                          strokeLinecap="round"
                          strokeDasharray={arcLen}
                          strokeDashoffset={dashOffset}
                        />
                      )}
                    </svg>
                    {renderMetricReadout(
                      entry,
                      cx('absolute bottom-0.5 text-[19px] font-bold tracking-tight tabular-nums leading-none', isDark ? 'text-zinc-100' : 'text-slate-900'),
                    )}
                  </div>
                  <div className={cx('mt-2 text-[12.5px] font-semibold truncate max-w-full', isDark ? 'text-zinc-200' : 'text-slate-800')}>
                    {entry.label}
                  </div>
                  {(entry.target !== undefined || entry.subtitle) && (
                    <div className={cx('mt-0.5 text-[11px] tabular-nums truncate max-w-full', isDark ? 'text-zinc-400' : 'text-slate-500')}>
                      {entry.subtitle ?? t(`计划 ${entry.target}%`, `Target ${entry.target}%`)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {entries.length > gaugeCols && (
            <div className="space-y-2">
              {entries.slice(gaugeCols).map((entry) => {
                const toneSpec = DESKTOP_PROGRESS_TONES[entry.tone] ?? DESKTOP_PROGRESS_TONES.emerald;
                const { clickable, activate } = getEntryActivation(entry);
                return (
                  <div
                    key={entry.id}
                    data-row-id={entry.row?.id ?? entry.id}
                    onClick={clickable ? activate : undefined}
                    {...interactiveBoxProps(clickable, activate)}
                    className={cx(
                      'rounded-xl px-3.5 py-2.5 space-y-1.5 transition duration-150',
                      isDark
                        ? 'bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]'
                        : 'bg-slate-50/70 ring-1 ring-inset ring-slate-900/[0.04]',
                      clickable && 'cursor-pointer hover:ring-blue-500/35 active:scale-[0.99]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className={cx('font-medium truncate', isDark ? 'text-zinc-200' : 'text-slate-800')}>
                        {entry.label}
                      </span>
                      <span className={cx('font-semibold tabular-nums shrink-0', isDark ? 'text-zinc-300' : 'text-slate-600')}>
                        {entry.metricState === 'missing' ? (
                          <span data-missing-value="1">—</span>
                        ) : entry.metricState === 'invalid' ? (
                          <span data-invalid-value="1" className="text-amber-500">{t('无效值', 'Invalid')}</span>
                        ) : (
                          <>
                            {entry.value}%{entry.target !== undefined ? ` / ${entry.target}%` : ''}
                          </>
                        )}
                      </span>
                    </div>
                    <div className={cx('h-2 rounded-full overflow-hidden', isDark ? 'bg-white/10' : 'bg-slate-900/[0.07]')}>
                      {entry.value !== null && entry.value > 0 && (
                        <div
                          className="pf-capsule-fill h-full rounded-full"
                          style={{ width: `${entry.value}%`, backgroundColor: toneSpec.stroke }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map((entry) => {
            const toneSpec = DESKTOP_PROGRESS_TONES[entry.tone] ?? DESKTOP_PROGRESS_TONES.forest;
            const widthPct = entry.value === null ? 0 : Math.max(0, Math.min(100, entry.value));
            const { clickable, activate } = getEntryActivation(entry);
            const filledDarkText = widthPct >= 35;
            return (
              <div
                key={entry.id}
                data-row-id={entry.row?.id ?? entry.id}
                onClick={clickable ? activate : undefined}
                {...interactiveBoxProps(clickable, activate)}
                className={cx(
                  'relative h-[44px] rounded-[14px] overflow-hidden flex items-center justify-between px-4 select-none transition duration-150',
                  isDark ? 'bg-white/[0.06] ring-1 ring-inset ring-white/[0.06]' : 'bg-slate-900/[0.05]',
                  clickable && 'cursor-pointer hover:ring-1 hover:ring-blue-500/35 active:scale-[0.995]',
                )}
              >
                {entry.value !== null && widthPct > 0 && (
                  <div
                    aria-hidden="true"
                    className={cx('pf-capsule-fill absolute inset-y-0 left-0 rounded-[14px]', toneSpec.fill)}
                    style={{ width: `${widthPct}%` }}
                  />
                )}
                {entry.target !== undefined && entry.target > 0 && entry.target < 100 && (
                  <span
                    aria-hidden="true"
                    title={t(`目标 ${entry.target}%`, `Target ${entry.target}%`)}
                    className={cx('absolute top-2 bottom-2 w-0.5 rounded-full z-[1]', isDark ? 'bg-white/45' : 'bg-slate-900/30')}
                    style={{ left: `${entry.target}%` }}
                  />
                )}
                <div className="relative z-[2] flex items-center gap-2 min-w-0">
                  <span
                    className={cx(
                      'text-[13px] font-semibold truncate',
                      filledDarkText ? 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.28)]' : isDark ? 'text-zinc-100' : 'text-slate-900',
                    )}
                  >
                    {entry.label}
                  </span>
                  {entry.subtitle && (
                    <span
                      className={cx(
                        'text-[11px] truncate hidden sm:inline',
                        filledDarkText ? 'text-white/80' : isDark ? 'text-zinc-400' : 'text-slate-500',
                      )}
                    >
                      · {entry.subtitle}
                    </span>
                  )}
                </div>
                <div className="relative z-[2] flex items-center gap-2 shrink-0">
                  {entry.target !== undefined && (
                    <span
                      className={cx(
                        'text-[11px] font-medium tabular-nums hidden sm:inline',
                        widthPct >= 88 ? 'text-white/80' : isDark ? 'text-zinc-400' : 'text-slate-500',
                      )}
                    >
                      {t(`目标 ${entry.target}%`, `Plan ${entry.target}%`)}
                    </span>
                  )}
                  {renderMetricReadout(
                    entry,
                    cx(
                      'text-[13.5px] font-bold tabular-nums',
                      widthPct >= 88 ? 'text-white' : isDark ? 'text-zinc-100' : 'text-slate-900',
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

const ActivityFeed: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { isEn, tr: t, td } = useI18n();
  const isDark = useCanvasTheme()?.effectiveMode === 'dark';
  const insideCard = useInsideCardBody();
  const preview = useContext(PreviewDataContext);
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const schema = useMemo(() => tables.find((tb) => tb.id === tableId), [tables, tableId]);
  const rawRows = useDesktopBoundRows(tableId);
  const { row: sourceRow, tableId: sourceTableId, fkSourceTableId } = useCollectionSourceRow(scope, rt.pageId, tableId, p.sourceForeignKey, tables);
  const bindingErrors = useMemo(
    () => collectionBindingErrors('ActivityFeed', p, tables),
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
    () => filterCardRows(scopedRows, p.filter, runtimeFilter),
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
          : /outflow|expense|claim|领用|出库|支出|扣减/i.test(typeStr)
          ? 'outflow'
          : 'neutral';
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

    return filterCardRows(projectedItems, p.filter, runtimeFilter).map((it, idx) => {
      const amt = it.amount !== undefined && it.amount !== null ? String(it.amount).trim() : '';
      const unsignedTone = it.tone === 'inflow' || it.tone === 'outflow' ? it.tone : 'neutral';
      const { amount, tone } = activityAmount(amt, unsignedTone, false);
      const title = String(it.title ?? t(`记录 ${idx + 1}`, `Activity ${idx + 1}`));
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
    t,
    td,
  ]);

  if (bindingErrors.length > 0) {
    return (
      <div
        {...rootWith(root, {
          className: cx(
            'rounded-2xl border p-3 text-xs',
            isDark
              ? 'border-amber-400/25 bg-amber-500/15 text-amber-200'
              : 'border-amber-200 bg-amber-50 text-amber-800',
          ),
        })}
        role="alert"
      >
        {td(bindingErrors[0])}
      </div>
    );
  }

  const containerCls = insideCard
    ? 'space-y-3 min-w-0'
    : cx(
        'rounded-[20px] p-5 space-y-3.5 min-w-0',
        isDark
          ? 'bg-[#16181D] ring-1 ring-inset ring-white/[0.08] shadow-[0_8px_24px_-10px_rgba(0,0,0,0.65)]'
          : 'bg-white ring-1 ring-inset ring-slate-900/[0.06] shadow-[0_2px_14px_-4px_rgba(15,23,42,0.05)]',
      );
  const showHeader = Boolean(p.title || p.extra) && (!insideCard || Boolean(p.extra) || node.props.title !== undefined);

  return (
    <section {...rootWith(root, { className: containerCls })} data-activity-feed="1">
      {showHeader && (
        <div className="flex items-center justify-between gap-2">
          {p.title && (
            <h3 className={cx('text-[14.5px] font-semibold tracking-tight', isDark ? 'text-zinc-100' : 'text-slate-900')}>
              {String(p.title)}
            </h3>
          )}
          {p.extra && (
            <button
              type="button"
              onClick={() => {
                if (!rt.isDesign && p.onExtraClick) void rt.run(p.onExtraClick as PropValue, scope);
              }}
              className={cx(
                'text-[12px] font-semibold inline-flex items-center gap-0.5 cursor-pointer',
                isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700',
              )}
            >
              <span>{String(p.extra)}</span>
              {Boolean(p.onExtraClick) && <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div
          className={cx(
            'rounded-2xl py-7 text-center text-[12.5px]',
            isDark ? 'bg-white/[0.03] text-zinc-500' : 'bg-slate-50/80 text-slate-400',
          )}
        >
          {String(p.emptyText || t('暂无流水记录', 'No activity records'))}
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
              (ra) => rt.isDesign || !matchesWhenCondition(guardTargetRecord, ra.hiddenWhenField, ra.hiddenWhenValue),
            );
            const isActive = Boolean(tableId && canonicalRow && activeRowId === canonicalRow.id);
            const DefaultIcon =
              entry.tone === 'inflow'
                ? ArrowDownLeft
                : entry.tone === 'outflow'
                ? ArrowUpRight
                : Wallet;
            const IconComp = entry.icon ? resolveSemanticIcon(entry.icon, DefaultIcon) : DefaultIcon;
            const iconBadgeCls =
              entry.tone === 'inflow'
                ? isDark
                  ? 'bg-emerald-500/18 text-emerald-300'
                  : 'bg-emerald-100/90 text-emerald-700'
                : entry.tone === 'outflow'
                ? isDark
                  ? 'bg-rose-500/18 text-rose-300'
                  : 'bg-rose-100/85 text-rose-700'
                : isDark
                ? 'bg-white/[0.07] text-zinc-300'
                : 'bg-slate-100 text-slate-600';
            const amountCls =
              entry.tone === 'inflow'
                ? isDark
                  ? 'text-emerald-400'
                  : 'text-emerald-600'
                : entry.tone === 'outflow'
                ? isDark
                  ? 'text-rose-300'
                  : 'text-slate-900'
                : isDark
                ? 'text-zinc-100'
                : 'text-slate-900';

            const rowActionChain = entry.onClick ?? (p.onItemClick as PropValue | undefined);
            const rowActionBlocked =
              actionChainRequiresBoundRow(rowActionChain) && (!tableId || !canonicalRow);

            const activateRow = () => {
              if (rt.isDesign) return;
              if (autoSelectFirst && tableId && canonicalRow) {
                rt.setActiveRow?.(tableId, canonicalRow.id, fkSourceTableId);
              }
              if (rowActionBlocked || !rowActionChain) return;
              void rt.run(rowActionChain, actionScope);
            };

            const clickable =
              !rt.isDesign &&
              ((Boolean(rowActionChain) && !rowActionBlocked) || Boolean(autoSelectFirst && tableId && canonicalRow));

            return (
              <div
                key={entry.id}
                data-row-id={canonicalRow?.id ?? entry.id}
                data-active-row={isActive ? '1' : undefined}
                data-activity-row-surface="1"
                onClick={clickable ? activateRow : undefined}
                {...interactiveBoxProps(clickable, activateRow)}
                className={cx(
                  'group relative rounded-[16px] px-3.5 py-3 flex items-center justify-between gap-3 transition duration-150',
                  isDark
                    ? cx(
                        'bg-white/[0.03] hover:bg-white/[0.055]',
                        isActive ? 'ring-2 ring-blue-400/70 bg-blue-500/10' : 'ring-1 ring-inset ring-white/[0.06]',
                      )
                    : cx(
                        'bg-slate-50/75 hover:bg-slate-100/75',
                        isActive ? 'ring-2 ring-blue-500/70 bg-blue-50/60' : 'ring-1 ring-inset ring-slate-900/[0.045]',
                      ),
                  clickable && 'cursor-pointer',
                )}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={cx('w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0', iconBadgeCls)}>
                    <IconComp className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className={cx('text-[13.5px] font-semibold truncate', isDark ? 'text-zinc-100' : 'text-slate-900')}>
                      {entry.title}
                    </div>
                    {entry.subtitle && (
                      <div className={cx('text-[11.5px] truncate mt-0.5', isDark ? 'text-zinc-400' : 'text-slate-500')}>
                        {entry.subtitle}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {entry.missingAmount ? (
                    <span
                      data-missing-value="1"
                      className={cx('text-[14.5px] font-semibold tabular-nums opacity-45', isDark ? 'text-zinc-400' : 'text-slate-400')}
                    >
                      —
                    </span>
                  ) : (
                    <SplitMetricText
                      value={entry.amount}
                      splitDecimal={splitDec}
                      className={cx('text-[15px] font-bold tracking-tight', amountCls)}
                    />
                  )}
                  {visibleActions.length > 0 && (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {visibleActions.map((act, ai) => {
                        const actChain = act.onClick as PropValue | undefined;
                        const missingBoundTarget =
                          actionChainRequiresBoundRow(actChain) && (!tableId || !canonicalRow);
                        const guardDisabled =
                          !rt.isDesign &&
                          matchesWhenCondition(guardTargetRecord, act.disabledWhenField, act.disabledWhenValue);
                        const actDisabled = guardDisabled || missingBoundTarget;
                        const reason =
                          guardDisabled && typeof act.disabledReason === 'string' && act.disabledReason.trim()
                            ? act.disabledReason.trim()
                            : missingBoundTarget
                            ? t('未绑定数据表记录，无法执行行操作', 'Row action requires a bound table record')
                            : undefined;
                        return (
                          <button
                            key={ai}
                            type="button"
                            disabled={actDisabled}
                            title={reason}
                            data-disabled-reason={reason}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!rt.isDesign && !actDisabled && actChain) {
                                void rt.run(actChain, actionScope);
                              }
                            }}
                            className={cx(
                              'rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition',
                              actDisabled
                                ? isDark
                                  ? 'bg-white/[0.04] text-zinc-600 cursor-not-allowed'
                                  : 'bg-slate-200/60 text-slate-400 cursor-not-allowed'
                                : act.danger
                                ? isDark
                                  ? 'bg-rose-500/18 text-rose-300 hover:bg-rose-500/28 cursor-pointer'
                                  : 'bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer'
                                : act.primary
                                ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                                : isDark
                                ? 'bg-white/[0.08] text-zinc-200 hover:bg-white/[0.14] cursor-pointer'
                                : 'bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer',
                            )}
                          >
                            {String(act.label ?? t('操作', 'Action'))}
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
    </section>
  );
};

export const MODERN_DESKTOP_COMPONENTS: Record<string, React.FC<CompProps>> = {
  NavMenu,
  CardGrid,
  Dropdown,
  Carousel,
  Icon,
  Repeater,
  Kanban,
  Calendar: CalendarView,
  AiCopilotCard,
  ProgressBoard,
  ActivityFeed,
};
