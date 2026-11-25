import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import DropdownAntd from 'antd/es/dropdown';
import {
  AlertTriangle,
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
import { PreviewDataContext, useMaterialTables } from '../runtime/PreviewData';
import { usePageStore } from '../store/usePageStore';
import { useProtoStore } from '../../store/useProtoStore';
import { matchesStaticRowFilter, rowsForSource, sourceForeignKeyErrors } from '../table/model';
import { declaredColumnOptions } from '../database/enumContract';
import { childRowScope } from '../runtime/runtime';
import { useAutoSelectFirstRow, useSourceRow } from '../runtime/sourceRow';
import { matchesWhenCondition, resolveKanbanStatusColumn } from '../runtime/pokaYoke';
import { applyUIStackRows, useUIStackState } from '../runtime/uiStackLens';
import type { Row } from '../runtime/mock';
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

const NavMenu: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr: t } = useI18n();
  const mode = p.mode === 'horizontal' ? 'horizontal' : 'inline';
  const dark = p.theme === 'dark';
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
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const boundTable = useMemo(() => tables.find((tb) => tb.id === tableId), [tables, tableId]);
  const rawRows = useDesktopBoundRows(tableId);
  const { row: sourceRow, tableId: sourceTableId } = useSourceRow(scope, rt.pageId, p.sourceForeignKey !== undefined);
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
      <div {...rootWith(root, { className: 'rounded-xl border border-slate-200 bg-white py-10 text-center text-slate-400' })}>
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
            if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, card.id);
            if (p.onItemClick) void rt.run(p.onItemClick as PropValue, childRowScope(scope, card.row, tableId));
          };
          return (
            <article
              key={card.id}
              data-row-id={card.id}
              data-active-row={isActiveCard ? '1' : undefined}
              onClick={triggerCard}
              className={cx(
                'group flex flex-col overflow-clip rounded-xl border bg-white transition hover:border-blue-300 hover:shadow-sm min-w-0',
                isActiveCard ? 'border-blue-500 ring-2 ring-blue-500/15' : 'border-slate-200',
                clickable && 'cursor-pointer',
              )}
            >
              {p.showCover !== false && (
                card.image ? (
                  <img
                    src={card.image}
                    alt={card.title}
                    className="block w-full object-cover bg-slate-100"
                    style={{ aspectRatio: '16 / 9' }}
                  />
                ) : (
                  <div
                    className={cx('flex items-center justify-between bg-gradient-to-br px-4', COVER_TONES[idx % COVER_TONES.length])}
                    style={{ aspectRatio: '16 / 7' }}
                  >
                    <Sparkles className="h-6 w-6 opacity-80" aria-hidden="true" />
                    {card.tag && (
                      <span className="rounded-full bg-white/85 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 shadow-2xs">
                        {card.tag}
                      </span>
                    )}
                  </div>
                )
              )}
              <div className="flex flex-1 flex-col justify-between gap-3 p-4 min-w-0">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="truncate text-sm font-semibold text-slate-900">{card.title}</h4>
                    {(p.showCover === false || card.image) && card.tag && (
                      <span className="shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                        {card.tag}
                      </span>
                    )}
                  </div>
                  {card.subtitle && (
                    <p
                      className="text-xs text-slate-500 leading-relaxed"
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'clip' }}
                    >
                      {card.subtitle}
                    </p>
                  )}
                </div>
                {(card.price || rowActions.length > 0) && (
                  <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                    <span className="text-sm font-bold text-blue-600 tabular-nums">{card.price}</span>
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
                                  void rt.run(act.onClick as PropValue, childRowScope(scope, card.row, tableId));
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
  const { row: sourceRow, tableId: sourceTableId } = useSourceRow(scope, rt.pageId, p.sourceForeignKey !== undefined);
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
                if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, row.id);
                if (p.onItemClick) void rt.run(p.onItemClick as PropValue, childRowScope(scope, row, tableId));
              }}
              className={cx(
                'min-w-0 rounded-xl transition',
                clickable && 'cursor-pointer',
                isActive && 'ring-2 ring-blue-500/60 rounded-xl',
                rt.isDesign && idx > 0 && 'opacity-90',
              )}
            >
              {kids.map((k) => renderFn(k, { row, tableId }))}
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
  const uiState = useUIStackState();
  const preview = useContext(PreviewDataContext);
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const boundTable = useMemo(() => tables.find((tb) => tb.id === tableId), [tables, tableId]);
  const rawRows = useDesktopBoundRows(tableId);
  const { row: sourceRow, tableId: sourceTableId } = useSourceRow(scope, rt.pageId, p.sourceForeignKey !== undefined);
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
              className="flex flex-col rounded-xl border border-slate-200/90 bg-slate-50/80 p-2.5 min-h-[240px]"
            >
              <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cx('h-2 w-2 rounded-full shrink-0', KANBAN_LANE_DOTS[laneIdx % KANBAN_LANE_DOTS.length])} />
                  <span className="text-[13px] font-semibold text-slate-800 truncate">{td(lane)}</span>
                </div>
                <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
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

                  return (
                    <article
                      key={row.id}
                      data-row-id={row.id}
                      data-active-row={isActive ? '1' : undefined}
                      draggable={canMutate}
                      onDragStart={() => setDragRowId(row.id)}
                      onDragEnd={() => setDragRowId(null)}
                      onClick={() => {
                        if (!clickable) return;
                        if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, row.id);
                        if (p.onCardClick) void rt.run(p.onCardClick as PropValue, childRowScope(scope, row, tableId));
                      }}
                      className={cx(
                        'rounded-lg border bg-white p-3 shadow-2xs transition hover:border-blue-300 hover:shadow-xs',
                        isActive ? 'border-blue-500 ring-2 ring-blue-500/15' : 'border-slate-200/90',
                        clickable && 'cursor-pointer',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[13px] font-medium text-slate-900 leading-snug">{titleText}</div>
                        {tagText && (
                          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                            {td(tagText)}
                          </span>
                        )}
                      </div>
                      {subText && <div className="mt-1 text-[11.5px] text-slate-500 truncate">{subText}</div>}
                      {(metricText || canMutate || rowActions.length > 0) && (
                        <div className="mt-2.5 flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                          <span className="text-[12px] font-semibold tabular-nums text-slate-800">{metricText}</span>
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
                                    if (!rt.isDesign && !actDisabled) void rt.run(act.onClick as PropValue, childRowScope(scope, row, tableId));
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
  const uiState = useUIStackState();
  const tables = useMaterialTables();
  const tableId = typeof p.table === 'string' && p.table ? p.table : undefined;
  const boundTable = useMemo(() => tables.find((tb) => tb.id === tableId), [tables, tableId]);
  const rawRows = useDesktopBoundRows(tableId);
  const { row: sourceRow, tableId: sourceTableId } = useSourceRow(scope, rt.pageId, p.sourceForeignKey !== undefined);
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
    <div {...rootWith(root, { className: 'rounded-xl border border-slate-200 bg-white overflow-hidden' })}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 bg-slate-50/60">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-blue-600" aria-hidden="true" />
          <span className="text-[14px] font-semibold text-slate-900">
            {String(p.title || t('业务排期日历', 'Schedule Calendar'))}
          </span>
          <span className="ml-2 text-xs font-medium tabular-nums text-slate-500">
            {cursorYm.year}-{String(cursorYm.month).padStart(2, '0')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={cx('px-2.5 py-1 rounded-md cursor-pointer', viewMode === 'month' ? 'bg-blue-600 text-white font-medium' : 'text-slate-600')}
            >
              {t('月视图', 'Month')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={cx('px-2.5 py-1 rounded-md cursor-pointer', viewMode === 'week' ? 'bg-blue-600 text-white font-medium' : 'text-slate-600')}
            >
              {t('周视图', 'Week')}
            </button>
          </div>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-md border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 cursor-pointer"
              aria-label={t('上个月', 'Previous month')}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-md border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 cursor-pointer"
              aria-label={t('下个月', 'Next month')}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
        {weekdays.map((w) => (
          <div key={w} className="px-2.5 py-1.5 text-center border-r last:border-r-0 border-slate-200/70">
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
                'border-r border-b border-slate-100 p-1.5 min-w-0',
                viewMode === 'week' ? 'min-h-[140px]' : 'min-h-[84px]',
                !validDay && 'bg-slate-50/50',
              )}
            >
              {validDay && (
                <>
                  <div className="text-[11px] font-medium tabular-nums text-slate-500 px-1 mb-1">{dayNum}</div>
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
                            if (autoSelectFirst && tableId) rt.setActiveRow?.(tableId, evRow.id);
                            if (p.onEventClick) void rt.run(p.onEventClick as PropValue, childRowScope(scope, evRow, tableId));
                          }}
                          className={cx(
                            'block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium transition',
                            isActive
                              ? 'bg-blue-600 text-white'
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

const COPILOT_TONES: Record<string, { box: string; badge: string; icon: string }> = {
  indigo: {
    box: 'border-indigo-200/80 bg-gradient-to-br from-indigo-50/70 via-white to-blue-50/40',
    badge: 'bg-indigo-100 text-indigo-700',
    icon: 'bg-indigo-600 text-white',
  },
  emerald: {
    box: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40',
    badge: 'bg-emerald-100 text-emerald-700',
    icon: 'bg-emerald-600 text-white',
  },
  amber: {
    box: 'border-amber-200/80 bg-gradient-to-br from-amber-50/70 via-white to-orange-50/40',
    badge: 'bg-amber-100 text-amber-800',
    icon: 'bg-amber-500 text-white',
  },
  rose: {
    box: 'border-rose-200/80 bg-gradient-to-br from-rose-50/70 via-white to-pink-50/40',
    badge: 'bg-rose-100 text-rose-700',
    icon: 'bg-rose-600 text-white',
  },
};

const AiCopilotCard: React.FC<CompProps> = ({ p, root, rt, scope }) => {
  const { tr: t } = useI18n();
  const tone = COPILOT_TONES[String(p.tone ?? 'indigo')] ?? COPILOT_TONES.indigo;
  const items = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  const primaryLabel = typeof p.primaryActionLabel === 'string' ? p.primaryActionLabel.trim() : '';

  return (
    <section
      {...rootWith(root, {
        className: cx('rounded-xl border p-4 space-y-3 shadow-2xs', tone.box),
      })}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className={cx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-2xs', tone.icon)}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-[14px] font-semibold text-slate-900">
                {String(p.title || t('AI 智能辅助审单', 'AI Copilot Insight'))}
              </h4>
              {Boolean(p.badge) && (
                <span className={cx('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', tone.badge)}>
                  {String(p.badge)}
                </span>
              )}
            </div>
            {Boolean(p.summary) && (
              <p className="mt-1 text-[12.5px] text-slate-600 leading-relaxed">{String(p.summary)}</p>
            )}
          </div>
        </div>
        {primaryLabel && (
          <button
            type="button"
            onClick={() => {
              if (!rt.isDesign && p.onPrimaryAction) void rt.run(p.onPrimaryAction as PropValue, scope);
            }}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer"
          >
            {primaryLabel}
          </button>
        )}
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/80 bg-white/90 px-3 py-2 shadow-2xs"
            >
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-slate-800">{String(item.title ?? '')}</div>
                {Boolean(item.detail) && (
                  <div className="text-[11.5px] text-slate-500 mt-0.5">{String(item.detail)}</div>
                )}
              </div>
              {Boolean(item.actionLabel) && (
                <button
                  type="button"
                  onClick={() => {
                    if (!rt.isDesign && item.onClick) void rt.run(item.onClick as PropValue, scope);
                  }}
                  className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] font-medium text-blue-600 hover:border-blue-300 hover:bg-blue-50 cursor-pointer"
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
};
