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
import { useSourceRow } from '../runtime/sourceRow';
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
  const { tr: t, td } = useI18n();
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
      const filtered = filterCardRows(synthesized, p.filter, query);
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
  }, [tableId, boundTable, tables, p, rawRows, sourceRow, sourceTableId, query, t]);

  useEffect(() => {
    rt.setPageNo(node.pfId, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tableId, node.pfId]);

  if ('error' in model) {
    return (
      <div {...rootWith(root, { className: 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800' })} role="alert">
        {td(model.error)}
      </div>
    );
  }

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
          const clickable = Boolean(p.onItemClick) && !rt.isDesign;
          const triggerCard = () => {
            if (clickable) void rt.run(p.onItemClick as PropValue, { ...scope, row: card.row, tableId });
          };
          return (
            <article
              key={card.id}
              onClick={triggerCard}
              className={cx(
                'group flex flex-col overflow-clip rounded-xl border border-slate-200 bg-white transition hover:border-blue-300 hover:shadow-sm min-w-0',
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
                        {rowActions.map((act, aIdx) => (
                          <button
                            key={aIdx}
                            type="button"
                            onClick={() => {
                              if (!rt.isDesign && act.onClick) {
                                void rt.run(act.onClick as PropValue, { ...scope, row: card.row, tableId });
                              }
                            }}
                            className={cx(
                              'rounded-md px-2 py-1 text-xs font-medium transition cursor-pointer',
                              act.danger
                                ? 'text-rose-600 hover:bg-rose-50'
                                : 'text-blue-600 hover:bg-blue-50',
                            )}
                          >
                            {String(act.label ?? t('操作', 'Action'))}
                          </button>
                        ))}
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

export const MODERN_DESKTOP_COMPONENTS: Record<string, React.FC<CompProps>> = {
  NavMenu,
  CardGrid,
  Dropdown,
  Carousel,
  Icon,
};
