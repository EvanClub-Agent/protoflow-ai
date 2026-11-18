import React, { useState } from 'react';
import {
  Package,
  ChartNoAxesColumn, ChartLine, ChartArea, ChartPie, ScatterChart, Radar, Filter, Grid3X3, Workflow,
  WandSparkles,
  GitBranch,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  Layers,
  Database,
  Trash2,
  LayoutTemplate,
  Square,
  Columns3,
  RectangleVertical,
  AlignHorizontalSpaceAround,
  PanelsTopLeft,
  PanelTop,
  Minus,
  ListOrdered,
  Heading,
  ChevronsRight,
  ChevronsLeftRight,
  SlidersHorizontal,
  Table2,
  FileText,
  TrendingUp,
  Tag,
  GitCommitVertical,
  Type,
  Heading2,
  Inbox,
  ClipboardList,
  TextCursorInput,
  Hash,
  AlignLeft,
  ChevronDownSquare,
  Calendar,
  CalendarRange,
  CircleDot,
  CheckSquare,
  ToggleRight,
  Upload,
  SquareMousePointer,
  MousePointerClick,
  RectangleEllipsis,
  AppWindow,
  PanelRightOpen,
  Info,
  BadgeCheck,
  BookmarkPlus,
  Boxes,
  Code2,
  LayoutGrid,
  CircleUserRound,
  Gauge,
  Image,
  LoaderCircle,
  MessageCircle,
  MessageSquare,
  BadgeHelp,
  Clock,
  Star,
  Network,
  ListFilter,
  X,
  ChevronsUpDown,
  type LucideIcon,
} from 'lucide-react';
import {
  COMPONENTS,
  CATEGORY_LABELS,
  COMPONENT_MAP,
  MOBILE_COMPONENT_NAMES,
  OVERLAY_TYPES,
  PAGE_ROOT_TYPES,
  UNIVERSAL_COMPONENT_NAMES,
  FIELD_TYPES,
  type ComponentCategory,
  type ComponentMeta,
} from '../registry/meta';
import { MOBILE_PAGE_TEMPLATES, PAGE_TEMPLATES, type PageTemplateKind } from '../ai/templates';
import type { ProtoNode } from '../types';
import { isNode } from '../types';
import { findNode, nodeText } from '../dsl/tree';
import { useProtoStore } from '../../store/useProtoStore';
import {
  COMPOSITE_CATEGORY_LABELS,
  type CompositeCategory,
  type CustomCompositeBlock,
} from '../store/usePageStore';

export type LeftPaneTab = 'materials' | 'composites' | 'outline' | 'ai';

interface MaterialsAndOutlinePaneProps {
  root: ProtoNode;
  selectedPfId: string | null;
  hoveredPfId: string | null;
  activeOverlayId: string | null;
  compositeBlocks: CustomCompositeBlock[];
  requestedTab?: LeftPaneTab | null;
  onTabChange?: (tab: LeftPaneTab) => void;
  onSelectNode: (pfId: string) => void;
  onHoverNode: (pfId: string | null) => void;
  onSelectOverlay: (overlayId: string | null) => void;
  onInsertComponent: (meta: ComponentMeta) => void;
  onInsertCompositeBlock: (block: CustomCompositeBlock) => void;
  onDeleteCompositeBlock: (id: string) => void;
  onPromptSaveComposite: (pfId: string) => void;
  onDeleteNode: (pfId: string) => void;
  onApplyTemplate: (kind: PageTemplateKind, tableId: string) => void;
}

const CATEGORIES: ComponentCategory[] = [
  'layout',
  'navigation',
  'query',
  'data',
  'charts',
  'form',
  'action',
  'overlay',
];

/** Dedicated Lucide icon map for every component in COMPONENTS */
const ICON_MAP: Record<string, LucideIcon> = {
  ChartNoAxesColumn, ChartLine, ChartArea, ChartPie, ScatterChart, Radar, Filter, Grid3X3, Workflow,
  WandSparkles,
  LayoutGrid,
  CircleUserRound,
  Gauge,
  Image,
  LoaderCircle,
  MessageCircle,
  MessageSquare,
  BadgeHelp,
  Clock,
  Star,
  Network,
  ListFilter,

  LayoutTemplate,
  Square,
  Columns3,
  RectangleVertical,
  AlignHorizontalSpaceAround,
  PanelsTopLeft,
  PanelTop,
  Minus,
  ListOrdered,
  Heading,
  ChevronsRight,
  ChevronsLeftRight,
  SlidersHorizontal,
  Search,
  Table2,
  FileText,
  TrendingUp,
  Tag,
  GitCommitVertical,
  Type,
  Heading2,
  Inbox,
  ClipboardList,
  TextCursorInput,
  Hash,
  AlignLeft,
  ChevronDownSquare,
  Calendar,
  CalendarRange,
  CircleDot,
  CheckSquare,
  ToggleRight,
  Upload,
  SquareMousePointer,
  MousePointerClick,
  RectangleEllipsis,
  AppWindow,
  PanelRightOpen,
  Info,
  BadgeCheck,
};

interface CategoryVisualTheme {
  shortLabel: string;
  catIcon: LucideIcon;
  regionClass: string;
  headerBgClass: string;
  headerTextClass: string;
  dotClass: string;
  iconBoxClass: string;
  countBadgeClass: string;
}

const CATEGORY_THEMES: Record<ComponentCategory, CategoryVisualTheme> = {
  layout: {
    shortLabel: '布局',
    catIcon: Columns3,
    regionClass: 'bg-slate-50/70 border-slate-200/90',
    headerBgClass: 'bg-white border-b border-slate-200/80',
    headerTextClass: 'text-slate-800',
    dotClass: 'bg-blue-600',
    iconBoxClass: 'bg-blue-50 text-blue-600 border-blue-200/80',
    countBadgeClass: 'bg-blue-50 text-blue-700 border-blue-200/80',
  },
  navigation: {
    shortLabel: '导航',
    catIcon: Heading,
    regionClass: 'bg-slate-50/70 border-slate-200/90',
    headerBgClass: 'bg-white border-b border-slate-200/80',
    headerTextClass: 'text-slate-800',
    dotClass: 'bg-sky-500',
    iconBoxClass: 'bg-sky-50 text-sky-600 border-sky-200/80',
    countBadgeClass: 'bg-sky-50 text-sky-700 border-sky-200/80',
  },
  query: {
    shortLabel: '查询',
    catIcon: SlidersHorizontal,
    regionClass: 'bg-slate-50/70 border-slate-200/90',
    headerBgClass: 'bg-white border-b border-slate-200/80',
    headerTextClass: 'text-slate-800',
    dotClass: 'bg-violet-500',
    iconBoxClass: 'bg-violet-50 text-violet-600 border-violet-200/80',
    countBadgeClass: 'bg-violet-50 text-violet-700 border-violet-200/80',
  },
  data: {
    shortLabel: '数据',
    catIcon: Table2,
    regionClass: 'bg-slate-50/70 border-slate-200/90',
    headerBgClass: 'bg-white border-b border-slate-200/80',
    headerTextClass: 'text-slate-800',
    dotClass: 'bg-emerald-500',
    iconBoxClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    countBadgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200/80',
  },
  charts: {
    shortLabel: '图表',
    catIcon: ChartNoAxesColumn,
    regionClass: 'bg-slate-50/70 border-slate-200/90',
    headerBgClass: 'bg-white border-b border-slate-200/80',
    headerTextClass: 'text-slate-800',
    dotClass: 'bg-cyan-500',
    iconBoxClass: 'bg-cyan-50 text-cyan-700 border-cyan-200/80',
    countBadgeClass: 'bg-cyan-50 text-cyan-800 border-cyan-200/80',
  },
  form: {
    shortLabel: '表单',
    catIcon: ClipboardList,
    regionClass: 'bg-slate-50/70 border-slate-200/90',
    headerBgClass: 'bg-white border-b border-slate-200/80',
    headerTextClass: 'text-slate-800',
    dotClass: 'bg-amber-500',
    iconBoxClass: 'bg-amber-50 text-amber-700 border-amber-200/80',
    countBadgeClass: 'bg-amber-50 text-amber-800 border-amber-200/80',
  },
  action: {
    shortLabel: '操作',
    catIcon: MousePointerClick,
    regionClass: 'bg-slate-50/70 border-slate-200/90',
    headerBgClass: 'bg-white border-b border-slate-200/80',
    headerTextClass: 'text-slate-800',
    dotClass: 'bg-rose-500',
    iconBoxClass: 'bg-rose-50 text-rose-600 border-rose-200/80',
    countBadgeClass: 'bg-rose-50 text-rose-700 border-rose-200/80',
  },
  overlay: {
    shortLabel: '弹层',
    catIcon: AppWindow,
    regionClass: 'bg-slate-50/70 border-slate-200/90',
    headerBgClass: 'bg-white border-b border-slate-200/80',
    headerTextClass: 'text-slate-800',
    dotClass: 'bg-purple-500',
    iconBoxClass: 'bg-purple-50 text-purple-600 border-purple-200/80',
    countBadgeClass: 'bg-purple-50 text-purple-700 border-purple-200/80',
  },
};

export const MaterialsAndOutlinePane: React.FC<MaterialsAndOutlinePaneProps> = ({
  root,
  selectedPfId,
  hoveredPfId,
  activeOverlayId,
  compositeBlocks,
  requestedTab,
  onTabChange,
  onSelectNode,
  onHoverNode,
  onSelectOverlay,
  onInsertComponent,
  onInsertCompositeBlock,
  onDeleteCompositeBlock,
  onPromptSaveComposite,
  onDeleteNode,
  onApplyTemplate,
}) => {
  const [tab, setTabState] = useState<LeftPaneTab>('materials');
  const [query, setQuery] = useState('');
  const [activeCatFilter, setActiveCatFilter] = useState<ComponentCategory | 'all'>('all');
  const [materialViewMode, setMaterialViewMode] = useState<'grid' | 'list'>('grid');
  const [hoveredMaterial, setHoveredMaterial] = useState<ComponentMeta | null>(null);
  const [compositeCatFilter, setCompositeCatFilter] = useState<CompositeCategory | 'all'>('all');
  const [previewTsxBlockId, setPreviewTsxBlockId] = useState<string | null>(null);
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});
  const [collapsedTree, setCollapsedTree] = useState<Record<string, boolean>>({});
  const [selectedTplTable, setSelectedTplTable] = useState<string>('t_base_supplier');

  React.useEffect(() => {
    if (requestedTab) {
      setTabState(requestedTab);
    }
  }, [requestedTab]);

  const setTab = (next: LeftPaneTab) => {
    setTabState(next);
    onTabChange?.(next);
  };

  const selectedNodeObj = React.useMemo(
    () => (selectedPfId ? findNode(root, selectedPfId) : null),
    [root, selectedPfId]
  );

  const { dbTables } = useProtoStore();
  const isMobilePage = root.type === 'MobilePage';
  const platformComponents = React.useMemo(
    () =>
      COMPONENTS.filter(
        (c) =>
          !PAGE_ROOT_TYPES.has(c.name) &&
          (isMobilePage
            ? MOBILE_COMPONENT_NAMES.has(c.name) || UNIVERSAL_COMPONENT_NAMES.has(c.name)
            : !MOBILE_COMPONENT_NAMES.has(c.name)),
      ),
    [isMobilePage],
  );
  const platformComposites = React.useMemo(
    () =>
      compositeBlocks.filter((b) =>
        isMobilePage ? b.platform === 'mobile' : !b.platform || b.platform === 'desktop',
      ),
    [compositeBlocks, isMobilePage],
  );
  const visibleCategories = React.useMemo(
    () => CATEGORIES.filter((cat) => platformComponents.some((c) => c.category === cat)),
    [platformComponents],
  );
  const activeTemplates = isMobilePage ? MOBILE_PAGE_TEMPLATES : PAGE_TEMPLATES;

  const toggleCat = (cat: string) =>
    setCollapsedCats((s) => ({ ...s, [cat]: !s[cat] }));

  const toggleTreeNode = (pfId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedTree((s) => ({ ...s, [pfId]: !s[pfId] }));
  };

  const renderOutlineNode = (
    node: ProtoNode,
    depth = 0,
    enclosingOverlayId: string | null = null
  ): React.ReactNode => {
    const isOverlay = OVERLAY_TYPES.has(node.type);
    const currentOverlayId =
      isOverlay && typeof node.props.id === 'string'
        ? node.props.id
        : enclosingOverlayId;

    const elementChildren = node.children.filter(isNode);
    const textChild = nodeText(node);
    const isCollapsed = collapsedTree[node.pfId] ?? false;
    const isSelected = selectedPfId === node.pfId;
    const isHovered = hoveredPfId === node.pfId;

    const compMeta = COMPONENT_MAP[node.type];
    const NodeIcon = (compMeta && ICON_MAP[compMeta.icon]) || Square;
    const catTheme = compMeta ? CATEGORY_THEMES[compMeta.category] : CATEGORY_THEMES.layout;

    const labelHint =
      (typeof node.props.title === 'string' && node.props.title) ||
      (typeof node.props.label === 'string' && node.props.label) ||
      (textChild && textChild.slice(0, 14)) ||
      (typeof node.props.id === 'string' && `#${node.props.id}`) ||
      (typeof node.props.table === 'string' && node.props.table) ||
      '';

    return (
      <div key={node.pfId} className="select-none">
        <div
          onClick={() => {
            if (currentOverlayId !== activeOverlayId) {
              onSelectOverlay(currentOverlayId);
            }
            onSelectNode(node.pfId);
          }}
          onMouseEnter={() => onHoverNode(node.pfId)}
          onMouseLeave={() => onHoverNode(null)}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          className={`group flex items-center justify-between pr-2 py-1 text-xs cursor-pointer rounded-md transition ${
            isSelected
              ? 'bg-blue-50 text-blue-700 font-semibold'
              : isHovered
              ? 'bg-slate-100 text-slate-900'
              : 'text-slate-700 hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {elementChildren.length > 0 ? (
              <button
                type="button"
                onClick={(e) => toggleTreeNode(node.pfId, e)}
                className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}

            <span
              className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${catTheme.iconBoxClass}`}
            >
              <NodeIcon className="w-2.5 h-2.5" />
            </span>

            <span
              className={`font-mono text-[11px] px-1 py-0.2 rounded shrink-0 ${
                isOverlay
                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                  : isSelected
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {node.type}
            </span>

            {labelHint && (
              <span className="text-[11px] text-slate-500 truncate">
                {labelHint}
              </span>
            )}
          </div>

          {node.pfId !== root.pfId && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPromptSaveComposite(node.pfId);
                }}
                className="p-0.5 text-slate-400 hover:text-violet-600 cursor-pointer"
                title="将该组件/容器沉淀为业务复合组件"
              >
                <BookmarkPlus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteNode(node.pfId);
                }}
                className="p-0.5 text-slate-400 hover:text-red-600 cursor-pointer"
                title="删除该组件"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {!isCollapsed && elementChildren.length > 0 && (
          <div className="space-y-0.5">
            {elementChildren.map((child) =>
              renderOutlineNode(child, depth + 1, currentOverlayId)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="relative w-[280px] shrink-0 border-r border-slate-200 bg-white flex flex-col h-full select-none">
      {/* Floating MVP Component Spec Preview Popover (Anchored to Right of Sidebar) */}
      {tab === 'materials' && hoveredMaterial && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-full top-3 ml-2.5 w-[276px] z-50 rounded-2xl border border-slate-200/95 bg-white/98 backdrop-blur-md p-3.5 shadow-xl shadow-slate-900/10 space-y-2.5"
        >
          {(() => {
            const hTheme = CATEGORY_THEMES[hoveredMaterial.category];
            const HIcon = ICON_MAP[hoveredMaterial.icon] || Square;
            const bindsTable =
              FIELD_TYPES.has(hoveredMaterial.name) ||
              hoveredMaterial.props.some((p) => p.kind === 'table');
            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${hTheme.iconBoxClass}`}
                    >
                      <HIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 leading-tight">
                        {hoveredMaterial.title}
                      </div>
                      <div className="text-[11px] font-mono text-blue-600 mt-0.5">
                        {hoveredMaterial.name === 'Freeform' ? 'AI 定制' : hoveredMaterial.category === 'charts' ? '可配置数据图表' : `<${hoveredMaterial.name}>`}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold border shrink-0 ${hTheme.countBadgeClass}`}
                  >
                    {CATEGORY_LABELS[hoveredMaterial.category]}
                  </span>
                </div>

                {/* Capability Badges */}
                <div className="flex items-center gap-1 flex-wrap">
                  {hoveredMaterial.container && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200/70 text-[10px] font-medium">
                      可嵌套子组件
                    </span>
                  )}
                  {OVERLAY_TYPES.has(hoveredMaterial.name) && (
                    <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200/70 text-[10px] font-medium">
                      独立子画布
                    </span>
                  )}
                  {bindsTable && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-[10px] font-medium">
                      支持数据表/字段绑定
                    </span>
                  )}
                  {hoveredMaterial.parents?.length ? (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/70 text-[10px] font-medium">
                      需置于 &lt;{hoveredMaterial.parents.join(' / ')}&gt; 内
                    </span>
                  ) : null}
                </div>

                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {hoveredMaterial.description}
                </p>

                {hoveredMaterial.name !== 'Freeform' && hoveredMaterial.props.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      核心可配属性 ({hoveredMaterial.props.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {hoveredMaterial.props.slice(0, 6).map((prop) => (
                        <span
                          key={prop.name}
                          className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium"
                        >
                          {prop.label.replace(/\(.*\)/, '')}
                        </span>
                      ))}
                      {hoveredMaterial.props.length > 6 && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 text-[10px]">
                          +{hoveredMaterial.props.length - 6} 项
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {hoveredMaterial.name === 'Freeform' ? <p className="rounded-lg bg-indigo-50 p-2 text-[11px] text-indigo-700">拖入画布后，描述想要的效果，交给 AI 完成。</p> : hoveredMaterial.category === 'charts' ? <p className="rounded-lg bg-cyan-50 p-2 text-[11px] text-cyan-800">拖入即可预览，在右侧选择数据、指标和配色，也可以让 AI 帮你配置。</p> : <div className="rounded-lg bg-slate-900 px-2.5 py-2 text-[10px] font-mono text-slate-100 overflow-hidden break-all leading-relaxed">
                  {hoveredMaterial.snippet}
                </div>}

                <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                  <span>点击直接插入画布</span>
                  <span>按住可拖拽至目标容器</span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Compact VS Code-style Panel Header */}
      <div className="px-2.5 py-2 border-b border-slate-200 bg-slate-50/60 space-y-1.5">
        <div className="flex items-center justify-between gap-2 min-h-[26px]">
          <div className="flex items-center gap-1.5 min-w-0">
            {tab === 'materials' && (
              <>
                <Package className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-xs font-semibold text-slate-800 truncate">物料组件库</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-600 text-[10px] font-mono">
                  {COMPONENTS.length - 1}
                </span>
              </>
            )}
            {tab === 'composites' && (
              <>
                <Boxes className="w-3.5 h-3.5 text-violet-600 shrink-0" />
                <span className="text-xs font-semibold text-slate-800 truncate">业务复合块</span>
                <span className="px-1.5 py-0.2 rounded-full bg-violet-100 text-violet-700 text-[10px] font-mono">
                  {platformComposites.length}
                </span>
              </>
            )}
            {tab === 'outline' && (
              <>
                <GitBranch className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-xs font-semibold text-slate-800 truncate">页面大纲树</span>
              </>
            )}
            {tab === 'ai' && (
              <>
                <LayoutTemplate className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-xs font-semibold text-slate-800 truncate">页面模板</span>
              </>
            )}
          </div>

          {tab === 'materials' && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const allCollapsed = CATEGORIES.every((c) => collapsedCats[c]);
                  const next: Record<string, boolean> = {};
                  for (const c of CATEGORIES) next[c] = !allCollapsed;
                  setCollapsedCats(next);
                }}
                title="展开 / 折叠全部分类"
                aria-label="展开或折叠全部分类"
                className="w-6 h-6 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center cursor-pointer transition"
              >
                <ChevronsUpDown className="w-3 h-3" />
              </button>
              <div className="flex items-center bg-slate-200/70 p-0.5 rounded-md border border-slate-200/90">
                <button
                  type="button"
                  onClick={() => setMaterialViewMode('grid')}
                  title="双列紧凑视图（完整展示组件名与标签）"
                  aria-label="双列紧凑视图"
                  className={`w-5 h-5 rounded flex items-center justify-center cursor-pointer transition ${
                    materialViewMode === 'grid'
                      ? 'bg-white text-blue-600 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <LayoutGrid className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setMaterialViewMode('list')}
                  title="单列详情视图（含组件说明与标签）"
                  aria-label="单列详情视图"
                  className={`w-5 h-5 rounded flex items-center justify-center cursor-pointer transition ${
                    materialViewMode === 'list'
                      ? 'bg-white text-blue-600 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <ListFilter className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {tab === 'materials' && (
          <>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索组件名 / JSX标签 / 用途..."
                className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg bg-white border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 transition"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="清空搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Category Quick Filter Pills with Color Dots */}
            <div className="flex items-center gap-1 flex-wrap pt-0.5">
              <button
                type="button"
                onClick={() => setActiveCatFilter('all')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium border cursor-pointer transition ${
                  activeCatFilter === 'all'
                    ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                    : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                全部
              </button>
              {visibleCategories.map((cat) => {
                const theme = CATEGORY_THEMES[cat];
                const isActive = activeCatFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() =>
                      setActiveCatFilter(isActive ? 'all' : cat)
                    }
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium border flex items-center gap-1 cursor-pointer transition ${
                      isActive
                        ? `${theme.countBadgeClass} font-semibold ring-1 ring-current/20`
                        : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${theme.dotClass}`} />
                    <span>{theme.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {tab === 'composites' && (
          <div className="space-y-1.5">
            {/* Quick CTA to save currently selected node as a composite block */}
            <button
              type="button"
              disabled={!selectedNodeObj || selectedNodeObj.pfId === root.pfId}
              onClick={() => {
                if (selectedNodeObj && selectedNodeObj.pfId !== root.pfId) {
                  onPromptSaveComposite(selectedNodeObj.pfId);
                }
              }}
              className="w-full py-1.5 px-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed transition shadow-2xs"
              title={
                selectedNodeObj && selectedNodeObj.pfId !== root.pfId
                  ? `将当前选中的 <${selectedNodeObj.type}> 沉淀为团队业务复合组件`
                  : '请先在画布上选中任意非 Page 根节点的组件或容器（如 Card、QueryForm、Table）'
              }
            >
              <BookmarkPlus className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {selectedNodeObj && selectedNodeObj.pfId !== root.pfId
                  ? `沉淀当前选中 <${selectedNodeObj.type}>`
                  : '先选中画布组件即可沉淀'}
              </span>
            </button>

            {/* Composite Category Filter Pills */}
            <div className="flex items-center gap-1 flex-wrap pt-0.5">
              <button
                type="button"
                onClick={() => setCompositeCatFilter('all')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium border cursor-pointer transition ${
                  compositeCatFilter === 'all'
                    ? 'bg-violet-600 text-white border-violet-600 font-semibold'
                    : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                全部({platformComposites.length})
              </button>
              {(Object.keys(COMPOSITE_CATEGORY_LABELS) as CompositeCategory[]).map((cat) => {
                const count = platformComposites.filter((b) => b.category === cat).length;
                if (count === 0) return null;
                const isActive = compositeCatFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCompositeCatFilter(isActive ? 'all' : cat)}
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium border cursor-pointer transition ${
                      isActive
                        ? 'bg-violet-100 text-violet-800 border-violet-300 font-semibold'
                        : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {COMPOSITE_CATEGORY_LABELS[cat]}({count})
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* TAB 1: COLOR-CODED MATERIALS PALETTE WITH ICONS */}
      {tab === 'materials' && (
        <div
          className="flex-1 overflow-y-auto p-2 space-y-2"
          onMouseLeave={() => setHoveredMaterial(null)}
        >
          {/* Quick-Access Team Composite Components Shelf inside Materials */}
          {activeCatFilter === 'all' && !query.trim() && platformComposites.length > 0 && (
            <div className="rounded-xl border border-violet-200/90 bg-violet-50/40 overflow-hidden">
              <div className="w-full flex items-center justify-between px-2.5 py-1.5 bg-white border-b border-violet-100 text-xs font-bold text-slate-800">
                <button
                  type="button"
                  onClick={() => toggleCat('__composites__')}
                  className="flex items-center gap-1.5 cursor-pointer"
                >
                  {collapsedCats['__composites__'] ? (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span className="w-4 h-4 rounded bg-violet-50 border border-violet-200/80 flex items-center justify-center text-violet-600">
                    <Boxes className="w-2.5 h-2.5" />
                  </span>
                  <span>{isMobilePage ? '移动端复合模板块' : '团队沉淀业务块'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('composites')}
                  className="text-[10px] font-semibold text-violet-600 hover:text-violet-800 cursor-pointer"
                >
                  全部({platformComposites.length}) →
                </button>
              </div>
              {!collapsedCats['__composites__'] && (
                <div className="p-1.5 space-y-1.5">
                  {platformComposites.slice(0, 3).map((blk) => (
                    <div
                      key={blk.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-pf-composite', blk.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => onInsertCompositeBlock(blk)}
                      onMouseEnter={() => setHoveredMaterial(null)}
                      className="group px-2.5 py-2 rounded-lg border border-slate-200/90 bg-white hover:border-violet-400 hover:shadow-xs transition cursor-grab active:cursor-grabbing flex items-start justify-between gap-2"
                      title={`${blk.title}：${blk.description}\n（按住直接拖拽到画布，或点击插入）`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-xs font-semibold text-slate-800 group-hover:text-violet-700 leading-snug break-words">
                          {blk.title}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-violet-50 text-violet-700 border border-violet-200/80 shrink-0">
                            {COMPOSITE_CATEGORY_LABELS[blk.category]}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            &lt;{blk.rootType}&gt; · {blk.childCount} 控件
                          </span>
                        </div>
                      </div>
                      <span className="w-5 h-5 rounded-md bg-slate-50 group-hover:bg-violet-600 text-slate-400 group-hover:text-white flex items-center justify-center shrink-0 transition mt-0.5">
                        <Plus className="w-3 h-3" />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {visibleCategories.filter(
            (cat) => activeCatFilter === 'all' || activeCatFilter === cat
          ).map((cat) => {
            const items = platformComponents.filter(
              (c) =>
                c.category === cat &&
                (!query.trim() ||
                  c.title.toLowerCase().includes(query.toLowerCase()) ||
                  c.name.toLowerCase().includes(query.toLowerCase()) ||
                  c.description.toLowerCase().includes(query.toLowerCase()))
            );
            if (items.length === 0) return null;

            const collapsed = !query.trim() && (collapsedCats[cat] ?? false);
            const theme = CATEGORY_THEMES[cat];
            const CatIcon = theme.catIcon;

            return (
              <div
                key={cat}
                className={`rounded-xl border overflow-hidden transition ${theme.regionClass}`}
              >
                {/* Clean IDE Category Section Header */}
                <button
                  type="button"
                  onClick={() => toggleCat(cat)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-bold cursor-pointer transition ${
                    collapsed ? 'bg-white' : theme.headerBgClass
                  } ${theme.headerTextClass}`}
                >
                  <span className="flex items-center gap-1.5">
                    {collapsed ? (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center ${theme.iconBoxClass}`}
                    >
                      <CatIcon className="w-2.5 h-2.5" />
                    </span>
                    <span>{CATEGORY_LABELS[cat]}</span>
                  </span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border ${theme.countBadgeClass}`}
                  >
                    {items.length}
                  </span>
                </button>

                {/* Material Cards: 2-Column Non-Truncating Grid OR 1-Column Detailed List */}
                {!collapsed && (
                  <div
                    className={
                      materialViewMode === 'grid'
                        ? 'p-1.5 grid grid-cols-2 gap-1.5'
                        : 'p-1.5 space-y-1.5'
                    }
                  >
                    {items.map((meta) => {
                      const ItemIcon = ICON_MAP[meta.icon] || Square;
                      const isOverlayComp = OVERLAY_TYPES.has(meta.name);

                      if (materialViewMode === 'list') {
                        return (
                          <div
                            key={meta.name}
                            draggable
                            onDragStart={(e) => {
                              setHoveredMaterial(null);
                              e.dataTransfer.setData('application/x-pf-new', meta.name);
                              e.dataTransfer.effectAllowed = 'copy';
                            }}
                            onClick={() => onInsertComponent(meta)}
                            onMouseEnter={() => setHoveredMaterial(meta)}
                            className="group px-2.5 py-2 rounded-lg border border-slate-200/90 bg-white hover:border-blue-500 hover:shadow-xs transition cursor-grab active:cursor-grabbing flex items-start gap-2.5 relative"
                          >
                            <div
                              className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 transition group-hover:scale-105 ${theme.iconBoxClass}`}
                            >
                              <ItemIcon className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-bold text-slate-800 group-hover:text-blue-700">
                                    {meta.title}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-400 group-hover:text-blue-600">
                                    {meta.name === 'Freeform' ? 'AI 定制' : meta.category === 'charts' ? '数据图表' : `<${meta.name}>`}
                                  </span>
                                  {isOverlayComp && (
                                    <span className="text-[9px] px-1 rounded bg-purple-50 text-purple-700 border border-purple-200">
                                      子画布
                                    </span>
                                  )}
                                  {!isOverlayComp && meta.container && (
                                    <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-600">
                                      容器
                                    </span>
                                  )}
                                </div>
                                <span className="w-4 h-4 rounded bg-slate-50 group-hover:bg-blue-600 text-slate-400 group-hover:text-white flex items-center justify-center shrink-0 transition">
                                  <Plus className="w-2.5 h-2.5" />
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 leading-snug mt-1 line-clamp-2">
                                {meta.description}
                              </p>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={meta.name}
                          draggable
                          onDragStart={(e) => {
                            setHoveredMaterial(null);
                            e.dataTransfer.setData('application/x-pf-new', meta.name);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                          onClick={() => onInsertComponent(meta)}
                          onMouseEnter={() => setHoveredMaterial(meta)}
                          className="group px-2 py-1.5 rounded-lg border border-slate-200/90 bg-white hover:border-blue-500 hover:bg-blue-50/20 hover:shadow-xs transition cursor-grab active:cursor-grabbing flex flex-col justify-between gap-1 relative"
                        >
                          {/* Hover Quick-Insert Floating Badge (Takes 0 layout width!) */}
                          <span className="opacity-0 group-hover:opacity-100 pointer-events-none absolute top-1.5 right-1.5 w-4 h-4 rounded bg-blue-600 text-white flex items-center justify-center shadow-2xs transition">
                            <Plus className="w-2.5 h-2.5" />
                          </span>

                          {/* Top Row: Compact Icon + Full Untruncated Chinese Title */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div
                              className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition group-hover:scale-105 ${theme.iconBoxClass}`}
                            >
                              <ItemIcon className="w-3 h-3" />
                            </div>
                            <span className="text-xs font-semibold text-slate-800 group-hover:text-blue-700 leading-tight break-words">
                              {meta.title}
                            </span>
                          </div>

                          {/* Bottom Row: Spans Full Card Width so <ComponentName> never truncates */}
                          <div className="flex items-center justify-between gap-1 pl-0.5">
                            <span className="text-[10px] font-mono text-slate-400 group-hover:text-blue-600/80 leading-none">
                              {meta.name === 'Freeform' ? 'AI 定制' : meta.category === 'charts' ? '数据图表' : `<${meta.name}>`}
                            </span>
                            {isOverlayComp ? (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200/80 leading-none shrink-0">
                                子画布
                              </span>
                            ) : meta.container ? (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 text-slate-500 leading-none shrink-0">
                                容器
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {query.trim() &&
            !platformComponents.some(
              (c) =>
                (activeCatFilter === 'all' || c.category === activeCatFilter) &&
                (c.title.toLowerCase().includes(query.toLowerCase()) ||
                  c.name.toLowerCase().includes(query.toLowerCase()) ||
                  c.description.toLowerCase().includes(query.toLowerCase()))
            ) && (
              <div className="py-10 px-4 text-center space-y-2">
                <Inbox className="w-7 h-7 text-slate-300 mx-auto" />
                <p className="text-xs font-medium text-slate-500">
                  未找到与「{query}」匹配的物料组件
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setActiveCatFilter('all');
                  }}
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-medium text-blue-600 cursor-pointer transition"
                >
                  重置筛选条件
                </button>
              </div>
            )}
        </div>
      )}

      {/* TAB 2: TEAM BUSINESS COMPOSITE BLOCKS LIBRARY */}
      {tab === 'composites' && (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
          <div className="px-2.5 py-1.5 rounded-lg bg-violet-50/70 border border-violet-200 text-[11px] text-violet-900 flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-violet-600 shrink-0" />
            <span>选中画布容器可一键沉淀至此，跨页拖拽复用</span>
          </div>

          {platformComposites
            .filter((b) => compositeCatFilter === 'all' || b.category === compositeCatFilter)
            .map((blk) => {
              const isShowingCode = previewTsxBlockId === blk.id;
              return (
                <div
                  key={blk.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-pf-composite', blk.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  className="rounded-xl border border-slate-200 bg-white hover:border-violet-400 shadow-2xs transition p-2.5 space-y-2 cursor-grab active:cursor-grabbing"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-800 border border-violet-200">
                          {COMPOSITE_CATEGORY_LABELS[blk.category]}
                        </span>
                        {!blk.isBuiltin ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                            ★ 团队自定义
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            官方预置
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-bold text-slate-900 mt-1">
                        {blk.title}
                      </div>
                    </div>

                    {!blk.isBuiltin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCompositeBlock(blk.id);
                        }}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0"
                        title="从复合组件库移除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-600 leading-relaxed">
                    {blk.description}
                  </div>

                  <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100">
                    <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500 whitespace-nowrap">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        &lt;{blk.rootType}&gt;
                      </span>
                      <span>· {blk.childCount} 控件</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewTsxBlockId(isShowingCode ? null : blk.id);
                        }}
                        className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[10px] text-slate-600 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Code2 className="w-3 h-3 shrink-0" />
                        <span>{isShowingCode ? '收起' : 'TSX'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInsertCompositeBlock(blk);
                        }}
                        className="px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold flex items-center gap-0.5 cursor-pointer whitespace-nowrap"
                      >
                        <Plus className="w-3 h-3 shrink-0" />
                        <span>插入画布</span>
                      </button>
                    </div>
                  </div>

                  {isShowingCode && (
                    <pre className="p-2 rounded-lg bg-slate-900 text-slate-100 font-mono text-[10px] max-h-40 overflow-y-auto whitespace-pre-wrap">
                      {blk.tsxSnippet}
                    </pre>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* TAB 3: AST OUTLINE TREE */}
      {tab === 'outline' && (
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {renderOutlineNode(root, 0, null)}
        </div>
      )}

      {/* TAB 4: PAGE TEMPLATES */}
      {tab === 'ai' && (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-3 text-xs">
          {/* Standard Page Templates */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-blue-600" />
              <span>从物理表一键套用页面模板</span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 flex items-center gap-1">
                <Database className="w-3 h-3" /> 选择驱动主表：
              </label>
              <select
                value={selectedTplTable}
                onChange={(e) => setSelectedTplTable(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-800"
              >
                {dbTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tableName} ({t.cnName.split(' ')[0]})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              {activeTemplates.map((tpl) => (
                <button
                  key={tpl.kind}
                  type="button"
                  onClick={() => onApplyTemplate(tpl.kind, selectedTplTable)}
                  className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-500 hover:bg-blue-50/40 transition cursor-pointer space-y-0.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 text-xs">
                      {tpl.title}
                    </span>
                    <span className="text-[10px] text-blue-600 font-medium">
                      应用模板 →
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 leading-relaxed">
                    {tpl.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
