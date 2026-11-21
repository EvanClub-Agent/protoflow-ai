import { isAxureMaterial } from '../axure/metadata';
import React, { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, BookmarkPlus, Copy, CornerLeftUp, Trash2 } from 'lucide-react';
import type { PropValue, ProtoNode } from '../types';
import { isActionChain, isNode, isRawExpr } from '../types';
import { COMPONENT_MAP, OVERLAY_TYPES, FIELD_TYPES, PAGE_ROOT_TYPES } from '../registry/meta';
import { isChartType } from '../charts/model';
import { REGISTRY, type CompProps, type RootAttrs } from '../registry/components';
import { interpolate, usesLiteralLayoutContent, useRuntime, type Scope } from '../runtime/runtime';
import type { ComponentStickyPinProps } from '../../components/ComponentStickyPin';
import { FLOW_GRID_CONTAINERS, flowGridSpan, columnSpan, columnWidthLabel, trailingColumnSpace } from './gridLayout';

// The editor injects its editable pins. Public rendering has no AI/editor imports.
const StickyPinContext = createContext<React.ComponentType<ComponentStickyPinProps>>(() => null);
export const StickyPinProvider = StickyPinContext.Provider;
// Read-only viewers may annotate exact page/node identities without enabling
// designer controls or importing the editable pin and its Hermes dependencies.
const NodeAnnotationContext = createContext<((node: ProtoNode, pageId: string) => React.ReactNode) | null>(null);
export const NodeAnnotationProvider = NodeAnnotationContext.Provider;

export type DropPos = 'before' | 'after' | 'left' | 'right' | 'inside';

/** Design-time interaction hooks provided by the page designer. */
export interface DesignApi {
  selectedId: string | null;
  hoverId: string | null;
  drop: { id: string; pos: DropPos } | null;
  stickyCounts: Record<string, number>;
  select: (pfId: string) => void;
  hover: (pfId: string | null) => void;
  setDrop: (d: DesignApi['drop']) => void;
  onDrop: (targetPfId: string, pos: DropPos, e: React.DragEvent) => void;
  onDragStartNode: (pfId: string, e: React.DragEvent) => void;
  onUpdateProp?: (pfId: string, propName: string, value: PropValue | undefined) => void;
  onBatchContainerCols?: (containerPfId: string, cols: number) => void;
  onMoveStep?: (pfId: string, delta: -1 | 1) => void;
  onDuplicate?: (pfId: string) => void;
  onDelete?: (pfId: string) => void;
  onSelectParent?: (pfId: string) => void;
  onSaveAsComposite?: (pfId: string) => void;
}

const DesignCtx = createContext<DesignApi | null>(null);
export const DesignProvider = DesignCtx.Provider;

const ScopeCtx = createContext<Scope>({});
export const ScopeProvider = ScopeCtx.Provider;

const ParentNodeCtx = createContext<{ node: ProtoNode; parent: ProtoNode | null } | null>(null);

const FLEX_ROW_CONTAINERS = new Set(['Toolbar', 'Space', 'Flex']);
const FIELD_CONTROL_TYPES = FIELD_TYPES;

/** Interpolate {{…}} in string props (recursively), leave actions / raw untouched. */
function resolveProps(props: Record<string, PropValue>, scope: Scope, vars: Record<string, unknown>) {
  const res = (v: PropValue): unknown => {
    if (typeof v === 'string') return interpolate(v, scope, vars);
    if (v === null || typeof v !== 'object') return v;
    if (isActionChain(v) || isRawExpr(v)) return v;
    if (Array.isArray(v)) return v.map(res);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, res(x)]));
  };
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, res(v)])) as Record<string, any>;
}

export interface RenderOptions {
  /** Render overlay nodes as static frames (design mode editing an overlay) */
  staticOverlay?: boolean;
}

export const NodeView: React.FC<{ node: ProtoNode; options?: RenderOptions; live?: boolean }> = ({ node, options, live }) => {
  const ComponentStickyPin = useContext(StickyPinContext);
  const renderAnnotation = useContext(NodeAnnotationContext);
  const rt = useRuntime();
  const design = useContext(DesignCtx);
  const scope = useContext(ScopeCtx);
  const parentContext = useContext(ParentNodeCtx);
  const parentNode = parentContext?.node ?? null;
  const barRef = useRef<HTMLDivElement | null>(null);

  const isSelectedNode = design?.selectedId === node.pfId;
  const showQuickBar = !!(rt.isDesign && isSelectedNode && design?.onUpdateProp);

  useLayoutEffect(() => {
    const barEl = barRef.current;
    if (!barEl || !showQuickBar) return;
    barEl.style.transform = 'translate(0px, 0px)';
    const barRect = barEl.getBoundingClientRect();
    const paperEl = barEl.closest('.pf-paper, .pf-mobile-scope') ?? document.documentElement;
    const boundRect = paperEl.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (barRect.right > boundRect.right - 8) {
      dx = boundRect.right - 8 - barRect.right;
    }
    if (barRect.left + dx < boundRect.left + 8) {
      dx = boundRect.left + 8 - barRect.left;
    }
    if (barRect.top < boundRect.top + 4) {
      dy = boundRect.top + 4 - barRect.top;
    }
    if (dx !== 0 || dy !== 0) {
      barEl.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    }
  });

  if (rt.hidden[node.pfId]) return null;
  // Overlays are rendered by the overlay host (preview) or as the edited root (design)
  if (OVERLAY_TYPES.has(node.type) && !live && !options?.staticOverlay) return null;

  const Impl = REGISTRY[node.type];
  const meta = COMPONENT_MAP[node.type];
  const literalText = node.children
      .filter((c) => !isNode(c))
      .map((c) => (c as { value: string }).value)
      .join(' ');
  const frame = node.props.layoutFrame;
  // Previously imported positioned controls store Axure text and placeholders literally.
  const literalContent = usesLiteralLayoutContent(frame);
  const text = literalContent ? literalText : interpolate(literalText, scope, rt.vars);
  const kids = node.children.filter(isNode);
  const childOptions = options?.staticOverlay ? { ...options, staticOverlay: false } : options;
  const children = kids.map((k) => (
    <ParentNodeCtx.Provider key={k.pfId} value={{ node, parent: parentNode }}>
      <NodeView node={k} options={childOptions} />
    </ParentNodeCtx.Provider>
  ));

  const isRootFrame = PAGE_ROOT_TYPES.has(node.type) || !!options?.staticOverlay || !!live;
  const inFlowGrid = !isRootFrame && !!parentNode && FLOW_GRID_CONTAINERS.has(parentNode.type);
  const inFlexRow =
    !isRootFrame &&
    !!parentNode &&
    FLEX_ROW_CONTAINERS.has(parentNode.type) &&
    parentNode.props.direction !== 'vertical' && parentNode.props.vertical !== true;

  // Compute 12-column grid span when inside a Smart Flow Grid container
  const rawWidth = typeof node.props.width === 'string' ? node.props.width : '';
  const colSpan12 = inFlowGrid ? flowGridSpan(node, parentNode, meta?.inline) : 12;
  const owningColumn = node.type === 'Col' && parentNode?.type === 'Row' ? node : parentNode?.type === 'Col' ? parentNode : null;
  const owningRow = owningColumn === node ? parentNode : parentContext?.parent ?? null;
  const columnSpace = trailingColumnSpace(owningRow, owningColumn);

  const root: RootAttrs = { 'data-pf-id': node.pfId };
  if (design && rt.isDesign) {
    const isContainer = !!meta?.container;
    root['data-pf-sel'] = design.selectedId === node.pfId ? '1' : undefined;
    root['data-pf-hover'] = design.hoverId === node.pfId && design.selectedId !== node.pfId ? '1' : undefined;
    root['data-pf-drop'] = design.drop?.id === node.pfId ? design.drop.pos : undefined;
    root['data-pf-sticky'] = design.stickyCounts[node.pfId] ? String(design.stickyCounts[node.pfId]) : undefined;
    root.onClick = (e) => {
      e.stopPropagation();
      design.select(node.pfId);
    };
    root.onMouseOver = (e) => {
      e.stopPropagation();
      if (design.hoverId !== node.pfId) design.hover(node.pfId);
    };
    root.draggable = !isRootFrame;
    root.onDragStart = (e) => {
      e.stopPropagation();
      design.onDragStartNode(node.pfId, e);
    };
    root.onDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      let pos: DropPos;

      if (inFlexRow || meta?.inline) {
        // Inside Toolbar / Space or inline control: left vs right insertion
        if (isContainer) {
          const xEdge = Math.min(18, rect.width / 4);
          pos =
            e.clientX < rect.left + xEdge
              ? 'left'
              : e.clientX > rect.right - xEdge
              ? 'right'
              : 'inside';
        } else {
          pos = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
        }
      } else if (isContainer) {
        const yEdge = Math.min(12, rect.height / 4);
        const xEdge = Math.min(28, rect.width / 6);
        if (!isRootFrame && e.clientY < rect.top + yEdge) {
          pos = 'before';
        } else if (!isRootFrame && e.clientY > rect.bottom - yEdge) {
          pos = 'after';
        } else if (!isRootFrame && inFlowGrid && e.clientX < rect.left + xEdge) {
          pos = 'left';
        } else if (!isRootFrame && inFlowGrid && e.clientX > rect.right - xEdge) {
          pos = 'right';
        } else {
          pos = 'inside';
        }
      } else if (inFlowGrid) {
        // 4-way smart zone inside Flow Grid (Card, Form, Page, Modal, Drawer, Tab):
        // Left 24% -> 'left' (side-by-side left), Right 24% -> 'right' (side-by-side right),
        // Middle Top 50% -> 'before' (row above), Middle Bottom 50% -> 'after' (row below)
        const sideZone = Math.min(80, Math.max(28, rect.width * 0.24));
        if (e.clientX < rect.left + sideZone) {
          pos = 'left';
        } else if (e.clientX > rect.right - sideZone) {
          pos = 'right';
        } else {
          pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        }
      } else {
        pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      }

      if (design.drop?.id !== node.pfId || design.drop.pos !== pos) {
        design.setDrop({ id: node.pfId, pos });
      }
    };
    root.onDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const d = design.drop;
      design.setDrop(null);
      design.onDrop(node.pfId, d?.id === node.pfId ? d.pos : 'inside', e);
    };
  }

  if (!Impl) {
    return (
      <div {...root} className="my-1 p-2 rounded border border-dashed border-rose-300 bg-rose-50 text-[11px] text-rose-600 col-span-12">
        未知组件 &lt;{node.type}&gt;：组件库中没有该组件
      </div>
    );
  }

  // Freeform source/CSS/data and event placeholders are opaque values. They
  // must survive verbatim until the isolated runtime or event bridge reads them.
  const resolvedProps = isAxureMaterial(node.type) || literalContent || node.type === 'Freeform' || isChartType(node.type) ? { ...node.props } : resolveProps(node.props, scope, rt.vars);
  // When placed inside Toolbar / horizontal Space, or when width === 'auto', force compact inline mode on FieldControl
  if ((inFlexRow || rawWidth === 'auto') && FIELD_CONTROL_TYPES.has(node.type)) {
    resolvedProps.width = 'auto';
  }

  const innerRoot: RootAttrs = isRootFrame ? root : {};

  const props: CompProps = {
    node,
    p: resolvedProps,
    text,
    kids,
    children,
    root: innerRoot,
    rt,
    scope,
    live: !!live,
    staticOverlay: !!options?.staticOverlay,
    renderNode: (n, s) => (
      <ParentNodeCtx.Provider key={n.pfId} value={{ node, parent: parentNode }}>
        {s ? (
          <ScopeProvider value={{ ...scope, ...s }}>
            <NodeView node={n} options={childOptions} />
          </ScopeProvider>
        ) : (
          <NodeView node={n} options={childOptions} />
        )}
      </ParentNodeCtx.Provider>
    ),
    withScope: (s, el) => <ScopeProvider value={{ ...scope, ...s }}>{el}</ScopeProvider>,
  };

  // Root frames (Page or static Modal/Drawer frame) render directly
  if (isRootFrame) {
    const annotation = renderAnnotation?.(node, rt.pageId);
    return (
      <ParentNodeCtx.Provider value={{ node, parent: parentNode }}>
        <Impl {...props} children={annotation ? [annotation, ...children] : children} />
      </ParentNodeCtx.Provider>
    );
  }

  // Compute outer wrapper layout style & classes (stable across selection states -> zero layout shift!)
  const wrapperStyle: React.CSSProperties = {};
  if (parentNode?.type === 'Row' && node.type === 'Col') {
    const span24 = columnSpan(node);
    wrapperStyle.gridColumn = `span ${span24} / span ${span24}`;
  } else if (inFlowGrid) {
    wrapperStyle.gridColumn = `span ${colSpan12} / span ${colSpan12}`;
    if (rawWidth === 'auto') {
      wrapperStyle.justifySelf = 'start';
    }
  }

  const wrapperCls = [
    'relative',
    inFlexRow
      ? 'inline-flex items-center shrink-0 align-middle'
      : 'min-w-0',
    inFlexRow && node.props.alignRight ? 'ml-auto' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const stickyCount = design?.stickyCounts[node.pfId] ?? 0;
  const showStandaloneStickyPin = !showQuickBar && stickyCount > 0;
  const friendlyPinTitle = (() => {
    const typeTitle = meta?.title ?? node.type;
    const labelStr =
      text.trim() ||
      (typeof node.props.label === 'string' ? node.props.label : '') ||
      (typeof node.props.title === 'string' ? node.props.title : '');
    return labelStr ? `${typeTitle}: ${labelStr}` : typeTitle;
  })();

  const preferRightAnchor = Boolean(
    node.props.alignRight ||
      parentNode?.props.align === 'right' ||
      parentNode?.props.align === 'end'
  );

  return (
    <div {...root} className={wrapperCls} style={wrapperStyle}>
      {renderAnnotation?.(node, rt.pageId)}
      {/* Unified Floating Quick-Layout + Sticky Bar when Selected (Zero layout shift & auto edge-clamped!) */}
      {showQuickBar && design && (
        <div
          ref={barRef}
          data-pf-quickbar="1"
          className={`absolute -top-6 ${
            preferRightAnchor ? 'right-0' : 'left-0'
          } z-30 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-900/95 text-white text-[10px] shadow-md whitespace-nowrap select-none backdrop-blur-xs`}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-semibold text-blue-300 px-1">
            {meta?.title ?? node.type}
          </span>

          {parentNode && !PAGE_ROOT_TYPES.has(parentNode.type) && design.onSelectParent && (
            <button
              type="button"
              onClick={() => design.onSelectParent?.(node.pfId)}
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-700/80 transition cursor-pointer"
              title={`选中父容器 (${COMPONENT_MAP[parentNode.type]?.title ?? parentNode.type})`}
            >
              <CornerLeftUp className="w-2.5 h-2.5" />
              <span>{parentNode.type === 'Col' ? `所在列 ${columnWidthLabel(columnSpan(parentNode))}` : '父级'}</span>
            </button>
          )}

          {/* 1. Inside Toolbar / horizontal Space: Left vs Push-Right + Control Width */}
          {inFlexRow && (
            <>
              <span className="w-px h-3 bg-slate-700 mx-0.5" />
              <button
                type="button"
                onClick={() => design.onUpdateProp?.(node.pfId, 'alignRight', undefined)}
                className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                  !node.props.alignRight ? 'bg-blue-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                }`}
                title="紧挨左侧元素排列"
              >
                ↔ 紧挨
              </button>
              <button
                type="button"
                onClick={() => design.onUpdateProp?.(node.pfId, 'alignRight', !node.props.alignRight ? true : undefined)}
                className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                  node.props.alignRight ? 'bg-blue-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                }`}
                title="将此组件及后续组件推到工具栏最右侧"
              >
                ⇥ 靠右推
              </button>
              {FIELD_CONTROL_TYPES.has(node.type) && (
                <>
                  <span className="w-px h-3 bg-slate-700 mx-0.5" />
                  {(
                    [
                      { k: 'sm', label: '窄' },
                      { k: '', label: '中' },
                      { k: 'lg', label: '宽' },
                    ] as const
                  ).map((cw) => {
                    const cur = String(node.props.controlWidth ?? '');
                    const active = cur === cw.k;
                    return (
                      <button
                        key={cw.label}
                        type="button"
                        onClick={() =>
                          design.onUpdateProp?.(node.pfId, 'controlWidth', cw.k || undefined)
                        }
                        className={`px-1 py-0.5 rounded transition cursor-pointer ${
                          active ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                        }`}
                        title={`输入框宽度：${cw.label}`}
                      >
                        {cw.label}
                      </button>
                    );
                  })}
                </>
              )}
            </>
          )}

          {/* 2. Toolbar / Space Container Alignment Presets */}
          {(node.type === 'Toolbar' || node.type === 'Space') && (
            <>
              <span className="w-px h-3 bg-slate-700 mx-0.5" />
              {(
                [
                  { k: 'left', label: '靠左' },
                  { k: 'center', label: '居中' },
                  { k: 'right', label: '靠右' },
                  { k: 'between', label: '两端' },
                ] as const
              ).map((al) => {
                const cur = String(node.props.align ?? 'left');
                const active = cur === al.k || (al.k === 'right' && cur === 'end');
                return (
                  <button
                    key={al.k}
                    type="button"
                    onClick={() =>
                      design.onUpdateProp?.(
                        node.pfId,
                        'align',
                        node.type === 'Space' && al.k === 'right' ? 'end' : al.k
                      )
                    }
                    className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                      active ? 'bg-blue-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {al.label}
                  </button>
                );
              })}
            </>
          )}

          {/* 3. Card / Form / QueryForm Column Presets (1列/2列/3列/4列) + Form Label Layout */}
          {(node.type === 'Card' || node.type === 'Form' || node.type === 'QueryForm') && (
            <>
              <span className="w-px h-3 bg-slate-700 mx-0.5" />
              <span className="text-slate-400 px-0.5">内部列数:</span>
              {[1, 2, 3, 4].map((c) => {
                const curCols = Number(node.props.cols ?? (node.type === 'Card' ? 1 : node.type === 'Form' ? 2 : 3));
                const active = curCols === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      design.onBatchContainerCols
                        ? design.onBatchContainerCols(node.pfId, c)
                        : design.onUpdateProp?.(node.pfId, 'cols', c)
                    }
                    className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                      active ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                    }`}
                    title={`将容器内元素按每行 ${c} 列整齐排布`}
                  >
                    {c}列
                  </button>
                );
              })}
              {(node.type === 'Form' || node.type === 'QueryForm') && (
                <>
                  <span className="w-px h-3 bg-slate-700 mx-0.5" />
                  <span className="text-slate-400 px-0.5">标签:</span>
                  {(
                    [
                      { k: 'horizontal', label: '水平' },
                      { k: 'vertical', label: '垂直' },
                    ] as const
                  ).map((ly) => {
                    const cur =
                      (node.props.layout as string) ||
                      (node.type === 'QueryForm'
                        ? 'horizontal'
                        : Number(node.props.cols ?? 2) >= 2
                        ? 'vertical'
                        : 'horizontal');
                    return (
                      <button
                        key={ly.k}
                        type="button"
                        onClick={() => design.onUpdateProp?.(node.pfId, 'layout', ly.k)}
                        className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                          cur === ly.k ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                        }`}
                        title={`标签排列：${ly.label}`}
                      >
                        {ly.label}
                      </button>
                    );
                  })}
                </>
              )}
            </>
          )}

          {/* 3b. Table Quick Toggles (斑马纹 / 边框 / 合计) */}
          {node.type === 'Table' && (
            <>
              <span className="w-px h-3 bg-slate-700 mx-0.5" />
              <button
                type="button"
                onClick={() =>
                  design.onUpdateProp?.(node.pfId, 'striped', !node.props.striped ? true : undefined)
                }
                className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                  node.props.striped ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                }`}
                title="切换斑马纹隔行变色"
              >
                斑马纹
              </button>
              <button
                type="button"
                onClick={() =>
                  design.onUpdateProp?.(node.pfId, 'bordered', !node.props.bordered ? true : undefined)
                }
                className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                  node.props.bordered ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                }`}
                title="切换单元格纵向网格边框"
              >
                网格边框
              </button>
              <button
                type="button"
                onClick={() =>
                  design.onUpdateProp?.(
                    node.pfId,
                    'showSummary',
                    !node.props.showSummary ? true : undefined
                  )
                }
                className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                  node.props.showSummary ? 'bg-amber-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                }`}
                title="切换底部合计行"
              >
                合计行
              </button>
            </>
          )}

          {/* 4. 12-Column Flow Grid Item Width Pills (自适应 / 1/4 / 1/3 / 1/2 / 2/3 / 整行) */}
          {inFlowGrid && (
            <>
              <span className="w-px h-3 bg-slate-700 mx-0.5" />
              <span className="text-slate-400 px-0.5">{parentNode?.type === 'Col' ? '列内:' : '占宽:'}</span>
              {(
                [
                  ...(FIELD_CONTROL_TYPES.has(node.type) || meta?.inline
                    ? ([{ k: 'auto', label: '紧凑', span: 0 }] as const)
                    : []),
                  { k: '1/4', label: '1/4', span: 3 },
                  { k: '1/3', label: '1/3', span: 4 },
                  { k: '1/2', label: '1/2', span: 6 },
                  { k: '2/3', label: '2/3', span: 8 },
                  { k: 'full', label: '整行', span: 12 },
                ] as const
              ).map((opt) => {
                const active =
                  rawWidth === opt.k || (!rawWidth && opt.span === colSpan12);
                return (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() =>
                      design.onUpdateProp?.(node.pfId, 'width', opt.k)
                    }
                    className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                      active ? 'bg-blue-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                    }`}
                    title={`设置组件占${parentNode?.type === 'Col' ? '所在列' : '父容器'}的宽度：${opt.label}；不改变外层布局`}
                  >
                    {opt.k === 'full' && parentNode?.type === 'Col' ? '填满本列' : opt.label}
                  </button>
                );
              })}
            </>
          )}

          {/* 5. Col Span inside Row */}
          {parentNode?.type === 'Row' && node.type === 'Col' && (
            <>
              <span className="w-px h-3 bg-slate-700 mx-0.5" />
              {(
                [
                  { span: 6, label: '1/4' },
                  { span: 8, label: '1/3' },
                  { span: 12, label: '1/2' },
                  { span: 16, label: '2/3' },
                  { span: 24, label: '整行' },
                ] as const
              ).map((opt) => {
                const active = Number(node.props.span ?? 12) === opt.span;
                return (
                  <button
                    key={opt.span}
                    type="button"
                    onClick={() => design.onUpdateProp?.(node.pfId, 'span', opt.span)}
                    className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                      active ? 'bg-blue-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </>
          )}

          {/* 6. Move / Duplicate / Delete */}
          {owningColumn && columnSpace && (owningColumn === node || colSpan12 === 12) && (
            <button
              type="button"
              onClick={() => design.onUpdateProp?.(owningColumn.pfId, 'span', columnSpace.nextSpan)}
              className="px-1.5 py-0.5 rounded text-blue-200 hover:bg-slate-700 cursor-pointer"
              title={`扩展所在列，填满本行右侧空位；列宽调整为${columnWidthLabel(columnSpace.nextSpan)}，其他列保持不变`}
            >填满右侧</button>
          )}
          <span className="w-px h-3 bg-slate-700 mx-0.5" />
          <button
            type="button"
            onClick={() => design.onMoveStep?.(node.pfId, -1)}
            className="p-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer"
            title="向前/向上移动"
          >
            <ArrowLeft className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => design.onMoveStep?.(node.pfId, 1)}
            className="p-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer"
            title="向后/向下移动"
          >
            <ArrowRight className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => design.onDuplicate?.(node.pfId)}
            className="p-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer"
            title="复制组件"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => design.onSaveAsComposite?.(node.pfId)}
            className="px-1.5 py-0.5 rounded bg-violet-600/90 hover:bg-violet-500 text-white font-medium flex items-center gap-0.5 cursor-pointer transition"
            title="将当前组件/容器块沉淀为可复用的团队业务复合组件"
          >
            <BookmarkPlus className="w-3 h-3" />
            <span>沉淀</span>
          </button>
          <button
            type="button"
            onClick={() => design.onDelete?.(node.pfId)}
            className="p-0.5 rounded text-rose-300 hover:text-rose-100 hover:bg-rose-600/80 cursor-pointer"
            title="删除组件"
          >
            <Trash2 className="w-3 h-3" />
          </button>

          <span className="w-px h-3 bg-slate-700 mx-0.5" />
          <ComponentStickyPin
            widgetId={node.pfId}
            widgetTitle={friendlyPinTitle}
            pageId={rt.pageId}
            position="left"
          />
        </div>
      )}

      {/* Standalone Sticky Pin Badge for unselected nodes that have sticky notes */}
      {showStandaloneStickyPin && (
        <div
          className="absolute -top-2.5 right-1.5 z-20"
          onClick={(e) => e.stopPropagation()}
        >
          <ComponentStickyPin
            widgetId={node.pfId}
            widgetTitle={friendlyPinTitle}
            pageId={rt.pageId}
            position="left"
          />
        </div>
      )}

      <Impl {...props} />
    </div>
  );
};
