import React, { useState } from 'react';
import { OptionsPropEditor } from './OptionsPropEditor';
import { StructuredPropEditor } from './StructuredPropEditor';
import { FreeformInspector } from '../freeform/FreeformInspector';
import { TableInspector, TABLE_LAYOUT_PROPS } from '../table/TableInspector';
import { CELL_EDITORS, SAMPLE_COLUMNS, SAMPLE_FIELDS, lockedColumn } from '../table/model';
import { ChartInspector } from '../charts/ChartInspector';
import { isChartType } from '../charts/model';
import { FLOW_GRID_CONTAINERS, flowGridSpan, columnSpan, columnWidthLabel, trailingColumnSpace } from '../renderer/gridLayout';
import {
  Sliders,
  Zap,
  StickyNote,
  Code2,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  Plus,
  Sparkles,
  ExternalLink,
  Layers,
  Database,
  ChevronRight,
  RotateCcw,
  Table2,
  Columns3,
  BookmarkPlus,
  Bot,
} from 'lucide-react';
import type { PropValue, ProtoDoc, ProtoNode } from '../types';
import { isActionChain, isNode } from '../types';
import { COMPONENT_MAP, OVERLAY_TYPES, FIELD_TYPES } from '../registry/meta';
import { insertNode, nodeText, pathTo, setProp, walk } from '../dsl/tree';
import { printPageSource } from '../dsl/printer';
import { columnLabel, defaultDisplayColumns } from '../runtime/mock';
import { fieldTypeOf } from '../ai/templates';
import { useProtoStore } from '../../store/useProtoStore';
import { useHermesStore } from '../../store/useHermesStore';
import {
  runScanStickiesAndAstToDbWithHermes,
  runStickyCompileWithHermes,
  reportAiError,
} from '../../services/hermesBridge';
import { ActionChainEditor, type OverlayDescriptor } from './ActionChainEditor';

export interface OverlayBinding {
  pfId: string;
  prop: string;
  value: PropValue;
}

interface NodeInspectorPanelProps {
  pageId: string;
  doc: ProtoDoc;
  selectedNode: ProtoNode;
  overlays: OverlayDescriptor[];
  onSelectNode: (pfId: string) => void;
  onPropChange: (pfId: string, key: string, value: PropValue | undefined) => void;
  onCommitDoc?: (nextDoc: ProtoDoc) => void;
  onTextChange: (pfId: string, text: string) => void;
  onMoveNode: (pfId: string, dir: -1 | 1) => void;
  onDuplicateNode: (pfId: string) => void;
  onRemoveNode: (pfId: string) => void;
  onOpenOverlayDesigner: (overlayId: string) => void;
  onCreateOverlay: (type: 'Modal' | 'Drawer', id: string, title: string, binding: OverlayBinding) => void;
  onRunAiPrompt: (prompt: string) => void;
  onSaveAsComposite?: (pfId: string) => void;
  /** Rendered inside the shared right column (AI chat | inspector) */
  embedded?: boolean;
}

export const NodeInspectorPanel: React.FC<NodeInspectorPanelProps> = ({
  pageId,
  doc,
  selectedNode,
  overlays,
  onSelectNode,
  onPropChange,
  onCommitDoc,
  onTextChange,
  onMoveNode,
  onDuplicateNode,
  onRemoveNode,
  onOpenOverlayDesigner,
  onCreateOverlay,
  onRunAiPrompt,
  onSaveAsComposite,
  embedded = false,
}) => {
  const [tab, setTab] = useState<'props' | 'events' | 'sticky' | 'ai'>(() => {
    if (typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.search).get('inspectorTab');
      if (t === 'props' || t === 'events' || t === 'sticky' || t === 'ai') return t;
    }
    return 'props';
  });
  const [newStickyText, setNewStickyText] = useState('');
  const [aiInput, setAiInput] = useState('');

  const {
    dbTables,
    stickyNotes,
    toggleStickyRule,
    deleteStickyRule,
    setSelectedTableId,
    setViewMode,
    setActivePopoverWidgetId,
  } = useProtoStore();
  const {
    status: hermesStatus,
    currentVersion: hermesVer,
    setModalOpen: setHermesModalOpen,
  } = useHermesStore();

  const meta = COMPONENT_MAP[selectedNode.type];
  const nodePath = pathTo(doc.root, selectedNode.pfId);
  const isRoot = selectedNode.pfId === doc.root.pfId;

  const textChild = nodeText(selectedNode);
  const hasTextEditor =
    Boolean(meta?.textChild) ||
    selectedNode.type === 'Button' ||
    selectedNode.type === 'Text' ||
    selectedNode.type === 'Title' ||
    selectedNode.type === 'Tag';

  const propSpecs = (meta?.props ?? []).filter(
    (p) =>
      !(selectedNode.type === 'Table' && TABLE_LAYOUT_PROPS.includes(p.name)) &&
      selectedNode.type !== 'Freeform' &&
      !isChartType(selectedNode.type) &&
      !(p.name === 'fields' && (selectedNode.type === 'Form' || selectedNode.type === 'QueryForm')) &&
      p.name !== 'rowActions' &&
      p.name !== 'columns' &&
      !(
        p.name === 'items' &&
        (selectedNode.type === 'Descriptions' || selectedNode.type === 'Timeline')
      )
  );
  const eventSpecs = meta?.events ?? [];

  const pageStickies = stickyNotes.filter((s) => s.pageId === pageId);
  const nodeStickies = pageStickies.filter((s) => s.targetWidgetId === selectedNode.pfId);

  // Extract rowActions if Table
  const rowActions = Array.isArray(selectedNode.props.rowActions)
    ? (selectedNode.props.rowActions as Record<string, PropValue>[])
    : [];

  const updateRowActions = (next: Record<string, PropValue>[]) => {
    onPropChange(selectedNode.pfId, 'rowActions', next);
  };

  // Extract columns if Table
  const columnItems = Array.isArray(selectedNode.props.columns)
    ? (selectedNode.props.columns as Record<string, PropValue>[])
    : [];

  // Extract fields if Form or QueryForm
  const fieldItems = Array.isArray(selectedNode.props.fields)
    ? (selectedNode.props.fields as Record<string, PropValue>[])
    : [];

  // Extract items if Descriptions or Timeline
  const descOrTimelineItems = Array.isArray(selectedNode.props.items)
    ? (selectedNode.props.items as Record<string, PropValue>[])
    : [];

  const referenceNodes = React.useMemo(() => {
    const nodes: ProtoNode[] = [];
    walk(doc.root, node => nodes.push(node));
    return nodes;
  }, [doc.root]);

  const ancestorTableId = React.useMemo(() => {
    for (let i = nodePath.length - 2; i >= 0; i--) {
      const anc = nodePath[i];
      if (typeof anc.props.table === 'string' && anc.props.table) {
        return anc.props.table;
      }
    }
    return undefined;
  }, [nodePath]);

  // Resolve bound table on this node or its nearest ancestor Form/Table/Descriptions (or via QueryForm.target)
  const boundTableId = React.useMemo(() => {
    if (typeof selectedNode.props.table === 'string' && selectedNode.props.table) {
      return selectedNode.props.table;
    }
    if (selectedNode.type === 'Table') return undefined;
    const targetSpec = meta?.props.find(prop => prop.name === 'target' && prop.kind === 'nodeRef');
    if (targetSpec && typeof selectedNode.props.target === 'string') {
      const target = referenceNodes.find(node => node.pfId === selectedNode.props.target);
      if (target && (!targetSpec.refTypes || targetSpec.refTypes.includes(target.type)) && typeof target.props.table === 'string') return target.props.table;
      return undefined;
    }
    return ancestorTableId;
  }, [selectedNode, ancestorTableId, meta, referenceNodes]);

  const boundTable = dbTables.find((t) => t.id === boundTableId);

  // Node-scoped TSX preview
  const nodeTsxPreview = React.useMemo(() => {
    try {
      const full = printPageSource({ header: [], root: selectedNode });
      return full
        .replace(/^export default function Page\(\) \{\n\s*return \(\n/, '')
        .replace(/\n\s*\);\n\}\n?$/, '');
    } catch {
      return `<${selectedNode.type} pfId="${selectedNode.pfId}" />`;
    }
  }, [selectedNode]);

  return (
    <aside
      className={
        embedded
          ? 'flex-1 min-h-0 w-full bg-white flex flex-col select-none'
          : 'w-[332px] shrink-0 border-l border-slate-200 bg-white flex flex-col h-full select-none'
      }
    >
      {/* Slim Header: Single-row Component Badge + Actions & Compact Tab Switcher */}
      <div className="px-2.5 py-1.5 border-b border-slate-200/80 bg-slate-50/50 space-y-1.5 shrink-0">
        {/* AST Path Breadcrumb (only shown when a child node inside Page is selected) */}
        {nodePath.length > 1 && (
          <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar whitespace-nowrap text-[10px] text-slate-500">
            {nodePath.map((n, idx) => (
              <React.Fragment key={n.pfId}>
                {idx > 0 && <ChevronRight className="w-2.5 h-2.5 text-slate-400 shrink-0" />}
                <button
                  type="button"
                  onClick={() => onSelectNode(n.pfId)}
                  className={`px-1 py-0.5 rounded font-mono cursor-pointer transition shrink-0 ${
                    n.pfId === selectedNode.pfId
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'hover:bg-slate-200/70 text-slate-600'
                  }`}
                >
                  {n.type}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Selected Node Title & Structural Operations in One Compact Line */}
        <div className="flex items-center justify-between gap-1.5 min-h-[24px]">
          <div
            className="flex items-center gap-1.5 min-w-0"
            title={`节点 ID: ${selectedNode.pfId}`}
          >
            <span className="text-xs font-semibold text-slate-900 truncate">
              {meta?.title ?? selectedNode.type}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200/80 shrink-0 leading-none">
              &lt;{selectedNode.type}&gt;
            </span>
          </div>

          {!isRoot && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => onMoveNode(selectedNode.pfId, -1)}
                className="p-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 cursor-pointer"
                title="上移节点"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => onMoveNode(selectedNode.pfId, 1)}
                className="p-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 cursor-pointer"
                title="下移节点"
              >
                <ArrowDown className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => onDuplicateNode(selectedNode.pfId)}
                className="p-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 cursor-pointer"
                title="复制节点"
              >
                <Copy className="w-3 h-3" />
              </button>
              {onSaveAsComposite && (
                <button
                  type="button"
                  onClick={() => onSaveAsComposite(selectedNode.pfId)}
                  className="px-1.5 py-0.5 rounded-md border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-[10px] font-semibold flex items-center gap-0.5 cursor-pointer"
                  title="将当前选中组件/区块沉淀为团队业务复合组件"
                >
                  <BookmarkPlus className="w-3 h-3" />
                  <span>沉淀</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onRemoveNode(selectedNode.pfId)}
                className="p-1 rounded-md border border-slate-200 bg-white hover:bg-red-50 text-slate-600 hover:text-red-600 cursor-pointer"
                title="删除节点"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* 4-Tab Switcher */}
        <div className="grid grid-cols-4 p-0.5 gap-0.5 bg-slate-100/90 rounded-lg border border-slate-200/80 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => setTab('props')}
            className={`py-0.5 px-1 rounded-md flex items-center justify-center gap-1 cursor-pointer transition ${
              tab === 'props'
                ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3 h-3 text-blue-600" />
            <span>属性</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('events')}
            className={`py-0.5 px-1 rounded-md flex items-center justify-center gap-1 cursor-pointer transition ${
              tab === 'events'
                ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3 h-3 text-amber-500" />
            <span>交互</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('sticky')}
            className={`py-0.5 px-1 rounded-md flex items-center justify-center gap-1 cursor-pointer transition ${
              tab === 'sticky'
                ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <StickyNote className="w-3 h-3 text-amber-600" />
            <span>
              便签(
              {nodeStickies.length > 0
                ? `${nodeStickies.length}/${pageStickies.length}`
                : pageStickies.length}
              )
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('ai')}
            className={`py-0.5 px-1 rounded-md flex items-center justify-center gap-1 cursor-pointer transition ${
              tab === 'ai'
                ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Code2 className="w-3 h-3 text-blue-600" />
            <span>AI/代码</span>
          </button>
        </div>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3 text-xs min-w-0">
        {/* TAB 1: PROPS */}
        {tab === 'props' && (
          <>
            {selectedNode.type === 'Freeform' && <FreeformInspector key={selectedNode.pfId} node={selectedNode} doc={doc} tables={dbTables} onCommit={onCommitDoc} onPropChange={onPropChange} onGenerate={onRunAiPrompt} enabled={hermesStatus === 'running'} onConnect={() => setHermesModalOpen(true)} />}
            {isChartType(selectedNode.type) && <ChartInspector key={selectedNode.pfId} node={selectedNode} doc={doc} tables={dbTables} onCommit={onCommitDoc} />}
            {selectedNode.type === 'Table' && onCommitDoc && <TableInspector key={JSON.stringify([selectedNode.pfId, boundTableId])} node={selectedNode} table={boundTable}
              onChange={patch => onCommitDoc(Object.entries(patch).reduce((next, [key, value]) => setProp(next, selectedNode.pfId, key, value), doc))} />}
            {/* Quick Layout & Width Card for Product Managers */}
            {!isRoot && (() => {
              const parentNode = nodePath.length >= 2 ? nodePath[nodePath.length - 2] : null;
              const inFlowGrid =
                !!parentNode &&
                FLOW_GRID_CONTAINERS.has(parentNode.type);
              const inFlexRow =
                !!parentNode &&
                (parentNode.type === 'Toolbar' ||
                  (parentNode.type === 'Space' && parentNode.props.direction !== 'vertical') ||
                  (parentNode.type === 'Flex' && parentNode.props.vertical !== true));
              const isFieldControl = FIELD_TYPES.has(selectedNode.type);
              const curWidth = typeof selectedNode.props.width === 'string' ? selectedNode.props.width : '';
              const effectiveSpan = flowGridSpan(selectedNode, parentNode, meta?.inline);
              const parentRow = nodePath.length >= 3 ? nodePath[nodePath.length - 3] : null;
              const columnSpace = trailingColumnSpace(parentRow, parentNode);

              if (!inFlowGrid && !inFlexRow && !['Card', 'Form', 'QueryForm'].includes(selectedNode.type)) {
                return null;
              }

              return (
                <div className="p-2.5 rounded-xl bg-indigo-50/45 border border-indigo-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-indigo-950">
                      快速排版与占宽
                    </span>
                    <span className="text-[10px] text-indigo-600/80">
                      支持画布左右拖拽并排
                    </span>
                  </div>

                  {inFlowGrid && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-slate-600">
                        {parentNode?.type === 'Col' ? '当前组件占所在列的宽度' : '当前组件占父容器的宽度（可并排多个组件）'}
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {(
                          [
                            { k: 'auto', label: '紧凑', span: 0 },
                            { k: '1/4', label: '1/4', span: 3 },
                            { k: '1/3', label: '1/3', span: 4 },
                            { k: '1/2', label: '1/2', span: 6 },
                            { k: '2/3', label: '2/3', span: 8 },
                            { k: 'full', label: parentNode?.type === 'Col' ? '填满本列' : '整行', span: 12 },
                          ] as const
                        ).map((opt) => {
                          const active =
                            curWidth === opt.k || (!curWidth && opt.span === effectiveSpan);
                          return (
                            <button
                              key={opt.k}
                              type="button"
                              onClick={() =>
                                onPropChange(
                                  selectedNode.pfId,
                                  'width',
                                  opt.k
                                )
                              }
                              className={`py-1 rounded-md text-[11px] font-medium border transition cursor-pointer ${
                                active
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                                  : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      {parentNode?.type === 'Col' && parentRow?.type === 'Row' && (
                        <div className="rounded-md bg-white/80 p-2 text-[10px] leading-relaxed text-slate-600 space-y-1">
                          <p>所在列占本行 {columnWidthLabel(columnSpan(parentNode))}。填满本列不会改变外层列宽。</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            <button type="button" className="text-indigo-700 underline cursor-pointer" onClick={() => onSelectNode(parentNode.pfId)}>调整所在列</button>
                            {columnSpace && effectiveSpan === 12 && <button type="button" className="text-indigo-700 underline cursor-pointer" onClick={() => onPropChange(parentNode.pfId, 'span', columnSpace.nextSpan)}>填满右侧</button>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {inFlexRow && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-600">工具栏内位置</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onPropChange(selectedNode.pfId, 'alignRight', undefined)}
                            className={`px-2 py-0.5 rounded-md text-[11px] border cursor-pointer transition ${
                              !selectedNode.props.alignRight
                                ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                            }`}
                          >
                            ↔ 紧挨左侧
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onPropChange(
                                selectedNode.pfId,
                                'alignRight',
                                !selectedNode.props.alignRight ? true : undefined
                              )
                            }
                            className={`px-2 py-0.5 rounded-md text-[11px] border cursor-pointer transition ${
                              selectedNode.props.alignRight
                                ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                            }`}
                          >
                            ⇥ 推至右侧
                          </button>
                        </div>
                      </div>
                      {isFieldControl && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-600">控件输入框宽度</span>
                          <div className="flex items-center gap-1">
                            {(
                              [
                                { k: 'sm', label: '窄 (112px)' },
                                { k: '', label: '标准 (160px)' },
                                { k: 'lg', label: '宽 (224px)' },
                              ] as const
                            ).map((cw) => {
                              const cur = String(selectedNode.props.controlWidth ?? '');
                              const active = cur === cw.k;
                              return (
                                <button
                                  key={cw.label}
                                  type="button"
                                  onClick={() =>
                                    onPropChange(selectedNode.pfId, 'controlWidth', cw.k || undefined)
                                  }
                                  className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                                    active
                                      ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
                                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                                  }`}
                                >
                                  {cw.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {['Card', 'Form', 'QueryForm'].includes(selectedNode.type) && (
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[10px] text-slate-600">容器内部默认列数</span>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4].map((c) => {
                          const curCols = Number(
                            selectedNode.props.cols ??
                              (selectedNode.type === 'Card' ? 1 : selectedNode.type === 'Form' ? 2 : 3)
                          );
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() => onPropChange(selectedNode.pfId, 'cols', c)}
                              className={`px-2 py-0.5 rounded-md text-[11px] border cursor-pointer transition ${
                                curCols === c
                                  ? 'bg-emerald-600 text-white border-emerald-600 font-semibold'
                                  : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                              }`}
                            >
                              {c}列
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* AntD Form / QueryForm Label Arrangement Quick Bar */}
                  {(selectedNode.type === 'Form' || selectedNode.type === 'QueryForm') && (
                    <div className="pt-1.5 border-t border-indigo-200/60 space-y-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-slate-600">标签排列 (layout)</span>
                        <div className="flex items-center gap-1">
                          {(
                            [
                              { k: 'horizontal', label: '水平居左' },
                              { k: 'vertical', label: '垂直居上' },
                              ...(selectedNode.type === 'Form'
                                ? ([{ k: 'inline', label: '行内紧凑' }] as const)
                                : []),
                            ] as const
                          ).map((ly) => {
                            const cur =
                              (selectedNode.props.layout as string) ||
                              (selectedNode.type === 'QueryForm'
                                ? 'horizontal'
                                : Number(selectedNode.props.cols ?? 2) >= 2
                                ? 'vertical'
                                : 'horizontal');
                            return (
                              <button
                                key={ly.k}
                                type="button"
                                onClick={() => onPropChange(selectedNode.pfId, 'layout', ly.k)}
                                className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                                  cur === ly.k
                                    ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                }`}
                              >
                                {ly.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-slate-600">标签对齐 & 冒号</span>
                        <div className="flex items-center gap-1">
                          {(
                            [
                              { k: 'left', label: '左对齐' },
                              { k: 'right', label: '右对齐' },
                            ] as const
                          ).map((al) => {
                            const cur =
                              (selectedNode.props.labelAlign as string) ||
                              (selectedNode.type === 'QueryForm' ? 'left' : 'right');
                            return (
                              <button
                                key={al.k}
                                type="button"
                                onClick={() => onPropChange(selectedNode.pfId, 'labelAlign', al.k)}
                                className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                                  cur === al.k
                                    ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                }`}
                              >
                                {al.label}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() =>
                              onPropChange(
                                selectedNode.pfId,
                                'colon',
                                !selectedNode.props.colon ? true : false
                              )
                            }
                            className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                              selectedNode.props.colon
                                ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                            }`}
                          >
                            冒号(:)
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Individual Field Label Layout Quick Bar */}
                  {isFieldControl && (
                    <div className="pt-1.5 border-t border-indigo-200/60 flex items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-600">标签位置</span>
                      <div className="flex items-center gap-1">
                        {(
                          [
                            { k: '', label: '默认' },
                            { k: 'horizontal', label: '居左' },
                            { k: 'vertical', label: '居上' },
                            { k: 'inline', label: '紧凑' },
                          ] as const
                        ).map((ly) => {
                          const cur = String(selectedNode.props.labelLayout ?? '');
                          return (
                            <button
                              key={ly.label}
                              type="button"
                              onClick={() =>
                                onPropChange(selectedNode.pfId, 'labelLayout', ly.k || undefined)
                              }
                              className={`px-1.5 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                                cur === ly.k
                                  ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                                  : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                              }`}
                            >
                              {ly.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* AntD Table Quick Appearance Bar (Striped / Bordered / Summary / Size) */}
                  {selectedNode.type === 'Table' && (
                    <div className="pt-1.5 border-t border-indigo-200/60 space-y-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-slate-600">表格视觉风格</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              onPropChange(
                                selectedNode.pfId,
                                'striped',
                                !selectedNode.props.striped ? true : undefined
                              )
                            }
                            className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                              selectedNode.props.striped
                                ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                            }`}
                          >
                            斑马纹
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onPropChange(
                                selectedNode.pfId,
                                'bordered',
                                !selectedNode.props.bordered ? true : undefined
                              )
                            }
                            className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                              selectedNode.props.bordered
                                ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                            }`}
                          >
                            网格边框
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onPropChange(
                                selectedNode.pfId,
                                'showSummary',
                                !selectedNode.props.showSummary ? true : undefined
                              )
                            }
                            className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                              selectedNode.props.showSummary
                                ? 'bg-amber-600 text-white border-amber-600 font-semibold'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
                            }`}
                          >
                            合计行
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-slate-600">行高密度 (size)</span>
                        <div className="flex items-center gap-1">
                          {(
                            [
                              { k: 'small', label: '紧凑 (small)' },
                              { k: 'middle', label: '标准 (middle)' },
                              { k: 'large', label: '宽松 (large)' },
                            ] as const
                          ).map((sz) => {
                            const cur = (selectedNode.props.size as string) || 'middle';
                            return (
                              <button
                                key={sz.k}
                                type="button"
                                onClick={() => onPropChange(selectedNode.pfId, 'size', sz.k)}
                                className={`px-1.5 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                                  cur === sz.k
                                    ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                }`}
                              >
                                {sz.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AntD Descriptions Quick Appearance Bar */}
                  {selectedNode.type === 'Descriptions' && (
                    <div className="pt-1.5 border-t border-indigo-200/60 flex items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-600">展示风格</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onPropChange(
                              selectedNode.pfId,
                              'bordered',
                              !selectedNode.props.bordered ? true : undefined
                            )
                          }
                          className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                            selectedNode.props.bordered
                              ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                          }`}
                        >
                          带边框表格态
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onPropChange(
                              selectedNode.pfId,
                              'layout',
                              selectedNode.props.layout === 'vertical' ? 'horizontal' : 'vertical'
                            )
                          }
                          className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition ${
                            selectedNode.props.layout === 'vertical'
                              ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                          }`}
                        >
                          {selectedNode.props.layout === 'vertical' ? '上下垂直' : '左右水平'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* If this is an Overlay node, show sub-page shortcut */}
            {OVERLAY_TYPES.has(selectedNode.type) && typeof selectedNode.props.id === 'string' && (
              <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200 flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-blue-900 text-xs">
                    弹层独立子页面 (#{selectedNode.props.id})
                  </div>
                  <div className="text-[10px] text-blue-700 mt-0.5">
                    可在顶部子页面导航直接进入该弹层画布拖入表单或表格
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenOverlayDesigner(selectedNode.props.id as string)}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium shrink-0 cursor-pointer"
                >
                  进入子画布
                </button>
              </div>
            )}

            {/* Text Child Editor */}
            {hasTextEditor && (
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-700">
                  显示文本 (Children Text)
                </label>
                <input
                  type="text"
                  value={textChild}
                  onChange={(e) => onTextChange(selectedNode.pfId, e.target.value)}
                  placeholder="输入按钮或文本内容..."
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-blue-600"
                />
              </div>
            )}

            {/* Dynamic Prop Controls */}
            {propSpecs.map((propMeta) => {
              const rawVal = selectedNode.props[propMeta.name];

              if (propMeta.kind === 'boolean') {
                const checked = Boolean(rawVal ?? propMeta.default);
                return (
                  <label
                    key={propMeta.name}
                    className="flex items-center justify-between py-1.5 px-2.5 rounded-lg border border-slate-200 bg-slate-50/50 cursor-pointer"
                  >
                    <div>
                      <div className="font-medium text-slate-800">{propMeta.label}</div>
                      <div className="text-[10px] font-mono text-slate-400">{propMeta.name}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        onPropChange(selectedNode.pfId, propMeta.name, e.target.checked)
                      }
                      className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                    />
                  </label>
                );
              }

              if (propMeta.kind === 'table') {
                const tblVal = typeof rawVal === 'string' ? rawVal : '';
                return (
                  <div key={propMeta.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                        <Database className="w-3 h-3 text-blue-600" />
                        <span>{propMeta.label}</span>
                      </label>
                      {boundTable && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTableId(boundTable.id);
                            setViewMode('db_designer');
                          }}
                          className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                        >
                          <span>打开表结构 ({boundTable.columns.length}列)</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                    <select
                      value={tblVal}
                      onChange={e => {
                        const nextTable = e.target.value || undefined;
                        if (selectedNode.type === 'Table' && selectedNode.props.cellMerges && onCommitDoc) {
                          // Record IDs are scoped to a physical table, even when two tables use identical values.
                          const next = setProp(doc, selectedNode.pfId, 'cellMerges', undefined);
                          onCommitDoc(setProp(next, selectedNode.pfId, 'table', nextTable));
                        } else onPropChange(selectedNode.pfId, propMeta.name, nextTable);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-600"
                    >
                      <option value="">-- 未绑定物理表 --</option>
                      {dbTables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.tableName} ({t.cnName})
                        </option>
                      ))}
                    </select>
                    {selectedNode.type === 'Table' && Array.isArray(selectedNode.props.cellMerges) && selectedNode.props.cellMerges.length > 0 && <p className="text-[10px] text-slate-500">切换绑定表会清除按记录指定的合并区域。</p>}

                  </div>
                );
              }

              if (propMeta.kind === 'overlay') {
                const ovVal = typeof rawVal === 'string' ? rawVal : '';
                return (
                  <div key={propMeta.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-slate-700">
                        {propMeta.label} ({propMeta.name})
                      </label>
                      {ovVal && (
                        <button
                          type="button"
                          onClick={() => onOpenOverlayDesigner(ovVal)}
                          className="text-[10px] text-blue-600 hover:underline cursor-pointer"
                        >
                          编辑该弹框 →
                        </button>
                      )}
                    </div>
                    <select
                      value={ovVal}
                      onChange={(e) =>
                        onPropChange(
                          selectedNode.pfId,
                          propMeta.name,
                          e.target.value || undefined
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-600"
                    >
                      <option value="">-- 选择关联弹层 --</option>
                      {overlays.map((o) => (
                        <option key={o.overlayId} value={o.overlayId}>
                          #{o.overlayId} · {o.title}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (propMeta.kind === 'nodeRef') {
                const strVal = typeof rawVal === 'string' ? rawVal : '';
                return (
                  <div key={propMeta.name} className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {propMeta.label}{' '}
                      <span className="font-mono text-[10px] text-slate-400">
                        ({propMeta.name})
                      </span>
                    </label>
                    <select
                      value={strVal}
                      onChange={(e) =>
                        onPropChange(
                          selectedNode.pfId,
                          propMeta.name,
                          e.target.value || undefined
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-600"
                    >
                      <option value="">-- 选择页面内目标组件 --</option>
                      {referenceNodes.filter(node => !propMeta.refTypes || propMeta.refTypes.includes(node.type)).map(node => {
                        const table = dbTables.find(t => t.id === node.props.table);
                        return <option key={node.pfId} value={node.pfId}>#{node.pfId} · {node.type}{table && ` (${table.tableName})`}</option>;
                      })}
                    </select>
                  </div>
                );
              }

              if (propMeta.kind === 'column') {
                const strVal = typeof rawVal === 'string' ? rawVal : '';
                const colTable =
                  selectedNode.type === 'MSheetPicker' && propMeta.name === 'name'
                    ? dbTables.find((t) => t.id === ancestorTableId)
                    : selectedNode.type === 'MSheetPicker' &&
                      (propMeta.name === 'labelField' || propMeta.name === 'valueField')
                    ? typeof selectedNode.props.table === 'string'
                      ? dbTables.find((t) => t.id === selectedNode.props.table)
                      : undefined
                    : boundTable;
                return (
                  <div key={propMeta.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        {propMeta.label}{' '}
                        <span className="font-mono text-[10px] text-slate-400">
                          ({propMeta.name})
                        </span>
                      </label>
                      {colTable && (
                        <span className="text-[10px] text-emerald-600 font-mono">
                          来自 {colTable.tableName}
                        </span>
                      )}
                    </div>
                    {colTable ? (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={strVal}
                          onChange={(e) => {
                            const colName = e.target.value;
                            onPropChange(
                              selectedNode.pfId,
                              propMeta.name,
                              colName || undefined
                            );
                            if (colName && propMeta.name === 'name') {
                              const col = colTable.columns.find((c) => c.name === colName);
                              if (col && !selectedNode.props.label) {
                                onPropChange(selectedNode.pfId, 'label', columnLabel(col));
                              }
                            }
                          }}
                          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-600"
                        >
                          <option value="">-- 从表字段选择或自定义 --</option>
                          {colTable.columns.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name} · {columnLabel(c)}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={strVal}
                          placeholder="自定义字段名"
                          onChange={(e) =>
                            onPropChange(
                              selectedNode.pfId,
                              propMeta.name,
                              e.target.value || undefined
                            )
                          }
                          className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-600"
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={strVal}
                        placeholder={propMeta.description || '输入字段名 (如 order_no)'}
                        onChange={(e) =>
                          onPropChange(
                            selectedNode.pfId,
                            propMeta.name,
                            e.target.value || undefined
                          )
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-600"
                      />
                    )}
                  </div>
                );
              }

              if (propMeta.name === 'options' && !['TreeSelect', 'Cascader'].includes(selectedNode.type)) {
                return <OptionsPropEditor key={`${selectedNode.pfId}:${JSON.stringify(rawVal)}`} value={rawVal}
                  stringsOnly={selectedNode.type === 'AutoComplete'}
                  onChange={(value) => onPropChange(selectedNode.pfId, propMeta.name, value)} />;
              }

              if (propMeta.kind === 'json' && propMeta.name !== 'filter') {
                return <StructuredPropEditor
                  key={`${selectedNode.pfId}:${propMeta.name}:${JSON.stringify(rawVal)}`}
                  label={propMeta.label} description={propMeta.description} value={rawVal}
                  optionsKind={propMeta.name === 'options' ? (['TreeSelect', 'Cascader'].includes(selectedNode.type) ? 'tree' : selectedNode.type === 'AutoComplete' ? 'autocomplete' : 'flat') : undefined}
                  onChange={(value) => onPropChange(selectedNode.pfId, propMeta.name, value)}
                />;
              }

              if (propMeta.kind === 'json') {
                const filterObj: Record<string, PropValue> =
                  rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal)
                    ? (rawVal as Record<string, PropValue>)
                    : {};
                const entries = Object.entries(filterObj);
                return (
                  <div key={propMeta.name} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        {propMeta.label}{' '}
                        <span className="font-mono text-[10px] text-slate-400">
                          ({propMeta.name})
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const defaultCol =
                            boundTable?.columns.find((c) =>
                              /status|state|type/i.test(c.name)
                            )?.name ||
                            boundTable?.columns[0]?.name ||
                            `filter_${entries.length + 1}`;
                          const next: Record<string, PropValue> = {
                            ...filterObj,
                            [defaultCol]: '',
                          };
                          onPropChange(selectedNode.pfId, propMeta.name, next);
                        }}
                        className="px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-medium flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>加过滤条件</span>
                      </button>
                    </div>
                    {entries.length === 0 ? (
                      <div className="text-[11px] text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-lg px-2.5 py-1.5">
                        未设置静态过滤（展示全部模拟行）
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {entries.map(([k, v], i) => (
                          <div key={i} className="flex items-center gap-1">
                            {boundTable ? (
                              <select
                                value={k}
                                onChange={(e) => {
                                  const newKey = e.target.value;
                                  if (!newKey) return;
                                  const next: Record<string, PropValue> = {};
                                  entries.forEach(([ek, ev], idx) => {
                                    next[idx === i ? newKey : ek] = ev;
                                  });
                                  onPropChange(selectedNode.pfId, propMeta.name, next);
                                }}
                                className="w-28 px-1.5 py-1 rounded border border-slate-200 bg-white font-mono text-[11px]"
                              >
                                <option value={k}>{k}</option>
                                {boundTable.columns
                                  .filter((c) => c.name !== k)
                                  .map((c) => (
                                    <option key={c.name} value={c.name}>
                                      {c.name} ({columnLabel(c)})
                                    </option>
                                  ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={k}
                                onChange={(e) => {
                                  const newKey = e.target.value;
                                  const next: Record<string, PropValue> = {};
                                  entries.forEach(([ek, ev], idx) => {
                                    next[idx === i ? newKey : ek] = ev;
                                  });
                                  onPropChange(selectedNode.pfId, propMeta.name, next);
                                }}
                                placeholder="字段名"
                                className="w-24 px-1.5 py-1 rounded border border-slate-200 bg-white font-mono text-[11px]"
                              />
                            )}
                            <span className="text-slate-400 text-xs">=</span>
                            <input
                              type="text"
                              value={String(v ?? '')}
                              onChange={(e) => {
                                const next: Record<string, PropValue> = {
                                  ...filterObj,
                                  [k]: e.target.value,
                                };
                                onPropChange(selectedNode.pfId, propMeta.name, next);
                              }}
                              placeholder="匹配值 (如 待验收)"
                              className="flex-1 min-w-0 px-1.5 py-1 rounded border border-slate-200 bg-white text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const next: Record<string, PropValue> = { ...filterObj };
                                delete next[k];
                                onPropChange(
                                  selectedNode.pfId,
                                  propMeta.name,
                                  Object.keys(next).length > 0 ? next : undefined
                                );
                              }}
                              className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              if (propMeta.kind === 'select' && propMeta.options) {
                const strVal = rawVal !== undefined ? String(rawVal) : '';
                return (
                  <div key={propMeta.name} className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {propMeta.label}{' '}
                      <span className="font-mono text-[10px] text-slate-400">
                        ({propMeta.name})
                      </span>
                    </label>
                    <select
                      value={strVal}
                      onChange={(e) => {
                        const v = e.target.value;
                        const num = Number(v);
                        onPropChange(
                          selectedNode.pfId,
                          propMeta.name,
                          !Number.isNaN(num) && v.trim() !== '' ? num : v || undefined
                        );
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-blue-600"
                    >
                      <option value="">默认</option>
                      {propMeta.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (propMeta.kind === 'number') {
                const numVal = typeof rawVal === 'number' ? rawVal : '';
                return (
                  <div key={propMeta.name} className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {propMeta.label}{' '}
                      <span className="font-mono text-[10px] text-slate-400">
                        ({propMeta.name})
                      </span>
                    </label>
                    <input
                      type="number"
                      value={numVal}
                      onChange={(e) =>
                        onPropChange(
                          selectedNode.pfId,
                          propMeta.name,
                          e.target.value === '' ? undefined : Number(e.target.value)
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                );
              }

              if (propMeta.kind === 'text') {
                const strVal = typeof rawVal === 'string' ? rawVal : '';
                return (
                  <div key={propMeta.name} className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {propMeta.label}{' '}
                      <span className="font-mono text-[10px] text-slate-400">
                        ({propMeta.name})
                      </span>
                    </label>
                    <textarea
                      rows={2}
                      value={strVal}
                      placeholder={propMeta.description}
                      onChange={(e) =>
                        onPropChange(
                          selectedNode.pfId,
                          propMeta.name,
                          e.target.value || undefined
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs focus:outline-none focus:border-blue-600"
                    />
                  </div>
                );
              }

              if (propMeta.kind === 'list') {
                if (propMeta.itemFields && propMeta.itemFields.length > 0) {
                  const objItems: Record<string, PropValue>[] = Array.isArray(rawVal)
                    ? rawVal.filter(
                        (x): x is Record<string, PropValue> =>
                          Boolean(x && typeof x === 'object' && !Array.isArray(x))
                      )
                    : [];
                  const itemFields = propMeta.itemFields;
                  const hasDataIndex = itemFields.some((f) => f.name === 'dataIndex');
                  const hasKey = itemFields.some((f) => f.name === 'key');
                  const hasRole = itemFields.some((f) => f.name === 'role');
                  const requiredKeys = new Set(
                    hasDataIndex
                      ? ['dataIndex', 'title']
                      : propMeta.name === 'rowActions'
                      ? ['label']
                      : ['title']
                  );

                  const updateObjItems = (next: Record<string, PropValue>[]) => {
                    onPropChange(
                      selectedNode.pfId,
                      propMeta.name,
                      next.length > 0 ? next : undefined
                    );
                  };

                  const setItemField = (
                    idx: number,
                    fieldName: string,
                    nextVal: PropValue | undefined,
                    extraPatch?: Record<string, PropValue>
                  ) => {
                    const next = objItems.map((item, i) => {
                      if (i !== idx) return item;
                      const copy: Record<string, PropValue> = {
                        ...item,
                        ...(extraPatch ?? {}),
                      };
                      const shouldOmit =
                        nextVal === undefined ||
                        (!requiredKeys.has(fieldName) && nextVal === '');
                      if (shouldOmit) {
                        delete copy[fieldName];
                      } else {
                        copy[fieldName] = nextVal;
                      }
                      return copy;
                    });
                    updateObjItems(next);
                  };

                  return (
                    <div key={propMeta.name} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          {propMeta.label}{' '}
                          <span className="font-mono text-[10px] text-slate-400">
                            ({propMeta.name})
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const n = objItems.length + 1;
                            let newItem: Record<string, PropValue>;
                            if (hasDataIndex) {
                              const used = new Set(
                                objItems
                                  .map((it) =>
                                    typeof it.dataIndex === 'string' ? it.dataIndex : ''
                                  )
                                  .filter(Boolean)
                              );
                              const nextCol =
                                boundTable?.columns.find((c) => !used.has(c.name)) ??
                                boundTable?.columns[0];
                              newItem = nextCol
                                ? { dataIndex: nextCol.name, title: columnLabel(nextCol) }
                                : { dataIndex: `field_${n}`, title: `字段 ${n}` };
                            } else {
                              newItem = {
                                ...(hasKey ? { key: `item_${n}` } : {}),
                                ...(hasRole
                                  ? { role: n % 2 === 1 ? 'user' : 'assistant' }
                                  : {}),
                                title: `新项目 ${n}`,
                              };
                            }
                            updateObjItems([...objItems, newItem]);
                          }}
                          className="px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-medium flex items-center gap-0.5 cursor-pointer"
                        >
                          <Plus className="w-2.5 h-2.5" />
                          <span>新增项</span>
                        </button>
                      </div>

                      {objItems.length === 0 ? (
                        <div className="text-[11px] text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-lg px-2.5 py-1.5">
                          未显式配置（将使用内置演示项或绑定表默认展示）
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {objItems.map((item, idx) => (
                            <div
                              key={idx}
                              className="p-2 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-1 pb-1 border-b border-slate-200/70">
                                <span className="text-[10px] font-mono font-semibold text-slate-500">
                                  #{idx + 1}
                                </span>
                                <div className="flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => {
                                      if (idx === 0) return;
                                      const next = [...objItems];
                                      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                      updateObjItems(next);
                                    }}
                                    className="px-1 py-0.5 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                                    title="上移"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === objItems.length - 1}
                                    onClick={() => {
                                      if (idx === objItems.length - 1) return;
                                      const next = [...objItems];
                                      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                      updateObjItems(next);
                                    }}
                                    className="px-1 py-0.5 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                                    title="下移"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateObjItems(objItems.filter((_, i) => i !== idx))
                                    }
                                    className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                                    title="删除此项"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                {itemFields.map((field) => {
                                  const fVal = item[field.name];

                                  if (field.kind === 'actions') {
                                    const chain = isActionChain(fVal) ? fVal : undefined;
                                    return (
                                      <ActionChainEditor
                                        key={field.name}
                                        label={`${field.label} (${field.name})`}
                                        eventName={field.name}
                                        value={chain}
                                        overlays={overlays}
                                        onChange={(nextChain) =>
                                          setItemField(idx, field.name, nextChain)
                                        }
                                        onCreateOverlayAndBind={(type, id, title, nextChain) =>
                                          onCreateOverlay(type, id, title, {
                                            pfId: selectedNode.pfId,
                                            prop: propMeta.name,
                                            value: objItems.map((it, i) =>
                                              i === idx
                                                ? { ...it, [field.name]: nextChain }
                                                : it
                                            ),
                                          })
                                        }
                                      />
                                    );
                                  }

                                  if (field.kind === 'boolean') {
                                    return (
                                      <label
                                        key={field.name}
                                        className="flex items-center justify-between gap-2 text-[11px] text-slate-700 cursor-pointer"
                                      >
                                        <span>
                                          {field.label}{' '}
                                          <span className="font-mono text-[10px] text-slate-400">
                                            ({field.name})
                                          </span>
                                        </span>
                                        <input
                                          type="checkbox"
                                          checked={Boolean(fVal)}
                                          onChange={(e) =>
                                            setItemField(
                                              idx,
                                              field.name,
                                              e.target.checked ? true : undefined
                                            )
                                          }
                                          className="accent-blue-600 cursor-pointer"
                                        />
                                      </label>
                                    );
                                  }

                                  if (field.kind === 'select' && field.options) {
                                    const sVal = typeof fVal === 'string' ? fVal : '';
                                    return (
                                      <div
                                        key={field.name}
                                        className="flex items-center gap-1.5"
                                      >
                                        <span className="w-16 shrink-0 text-[11px] text-slate-600 truncate">
                                          {field.label}
                                        </span>
                                        <select
                                          value={sVal}
                                          onChange={(e) =>
                                            setItemField(
                                              idx,
                                              field.name,
                                              e.target.value || undefined
                                            )
                                          }
                                          className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 bg-white text-xs text-slate-800"
                                        >
                                          <option value="">默认</option>
                                          {field.options.map((opt) => (
                                            <option key={opt} value={opt}>
                                              {opt}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    );
                                  }

                                  if (field.kind === 'column') {
                                    const sVal = typeof fVal === 'string' ? fVal : '';
                                    return (
                                      <div
                                        key={field.name}
                                        className="flex items-center gap-1.5"
                                      >
                                        <span className="w-16 shrink-0 text-[11px] text-slate-600 truncate">
                                          {field.label}
                                        </span>
                                        {boundTable ? (
                                          <select
                                            value={sVal}
                                            onChange={(e) => {
                                              const colName = e.target.value;
                                              if (!colName) return;
                                              const col = boundTable.columns.find(
                                                (c) => c.name === colName
                                              );
                                              const patch =
                                                field.name === 'dataIndex' && col
                                                  ? { title: columnLabel(col) }
                                                  : undefined;
                                              setItemField(idx, field.name, colName, patch);
                                            }}
                                            className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 bg-white font-mono text-xs text-slate-800"
                                          >
                                            {!boundTable.columns.some(
                                              (c) => c.name === sVal
                                            ) && sVal ? (
                                              <option value={sVal}>{sVal}</option>
                                            ) : null}
                                            {boundTable.columns.map((c) => (
                                              <option key={c.name} value={c.name}>
                                                {c.name} · {columnLabel(c)}
                                              </option>
                                            ))}
                                          </select>
                                        ) : (
                                          <input
                                            type="text"
                                            value={sVal}
                                            placeholder={field.name}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              if (!v && requiredKeys.has(field.name)) return;
                                              setItemField(idx, field.name, v || undefined);
                                            }}
                                            className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 bg-white font-mono text-xs text-slate-800"
                                          />
                                        )}
                                      </div>
                                    );
                                  }

                                  if (field.kind === 'number') {
                                    const nVal = typeof fVal === 'number' ? fVal : '';
                                    return (
                                      <div
                                        key={field.name}
                                        className="flex items-center gap-1.5"
                                      >
                                        <span className="w-16 shrink-0 text-[11px] text-slate-600 truncate">
                                          {field.label}
                                        </span>
                                        <input
                                          type="number"
                                          value={nVal}
                                          onChange={(e) =>
                                            setItemField(
                                              idx,
                                              field.name,
                                              e.target.value === ''
                                                ? undefined
                                                : Number(e.target.value)
                                            )
                                          }
                                          className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 bg-white text-xs text-slate-800"
                                        />
                                      </div>
                                    );
                                  }

                                  const sVal = typeof fVal === 'string' ? fVal : '';
                                  return (
                                    <div
                                      key={field.name}
                                      className="flex items-center gap-1.5"
                                    >
                                      <span className="w-16 shrink-0 text-[11px] text-slate-600 truncate">
                                        {field.label}
                                      </span>
                                      <input
                                        type="text"
                                        aria-label={`${propMeta.name}[${idx}].${field.name}`}
                                        value={sVal}
                                        placeholder={field.label}
                                        onChange={(e) => setItemField(idx, field.name, e.target.value)}
                                        className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 bg-white text-xs text-slate-800"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                const listArr: string[] = Array.isArray(rawVal)
                  ? rawVal.map((x) => String(x))
                  : typeof rawVal === 'string' && rawVal.trim()
                  ? rawVal.split(',').map((s) => s.trim())
                  : [];

                return (
                  <div key={propMeta.name} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        {propMeta.label}{' '}
                        <span className="font-mono text-[10px] text-slate-400">
                          ({propMeta.name})
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...listArr, `选项 ${listArr.length + 1}`];
                          onPropChange(selectedNode.pfId, propMeta.name, next);
                        }}
                        className="px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-medium flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>新增项</span>
                      </button>
                    </div>
                    {listArr.length > 0 && (
                      <div className="space-y-1">
                        {listArr.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-slate-400 w-4 text-right">
                              {idx + 1}.
                            </span>
                            <input
                              type="text"
                              value={item}
                              onChange={(e) => {
                                const next = listArr.map((v, i) =>
                                  i === idx ? e.target.value : v
                                );
                                onPropChange(selectedNode.pfId, propMeta.name, next);
                              }}
                              className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 bg-white text-xs"
                            />
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => {
                                if (idx === 0) return;
                                const next = [...listArr];
                                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                onPropChange(selectedNode.pfId, propMeta.name, next);
                              }}
                              className="px-1 py-0.5 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                              title="上移"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={idx === listArr.length - 1}
                              onClick={() => {
                                if (idx === listArr.length - 1) return;
                                const next = [...listArr];
                                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                onPropChange(selectedNode.pfId, propMeta.name, next);
                              }}
                              className="px-1 py-0.5 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                              title="下移"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const next = listArr.filter((_, i) => i !== idx);
                                onPropChange(
                                  selectedNode.pfId,
                                  propMeta.name,
                                  next.length > 0 ? next : undefined
                                );
                              }}
                              className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <input
                      type="text"
                      value={listArr.join(',')}
                      placeholder={propMeta.description || '也可直接用英文逗号分隔输入'}
                      onChange={(e) => {
                        const val = e.target.value;
                        onPropChange(
                          selectedNode.pfId,
                          propMeta.name,
                          val ? val.split(',').map((s) => s.trim()) : undefined
                        );
                      }}
                      className="w-full px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-[11px] focus:outline-none focus:bg-white focus:border-blue-600"
                    />
                  </div>
                );
              }

              // Default string editor
              const strVal = typeof rawVal === 'string' ? rawVal : '';

              return (
                <div key={propMeta.name} className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-700">
                    {propMeta.label}{' '}
                    <span className="font-mono text-[10px] text-slate-400">
                      ({propMeta.name})
                    </span>
                  </label>
                  <input
                    type="text"
                    value={strVal}
                    placeholder={propMeta.description}
                    onChange={(e) => {
                      const val = e.target.value;
                      onPropChange(selectedNode.pfId, propMeta.name, val || undefined);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-blue-600"
                  />
                </div>
              );
            })}

            {/* Visual Table columns[] editor */}
            {selectedNode.type === 'Table' && (() => {
              const autoCols: Record<string, PropValue>[] = boundTable
                ? defaultDisplayColumns(boundTable, 6).map((c) => {
                    const fType = fieldTypeOf(c);
                    return {
                      dataIndex: c.name,
                      title: columnLabel(c),
                      render:
                        fType === 'select'
                          ? 'tag'
                          : /amount|price|cost|total|fee/i.test(c.name)
                          ? 'money'
                          : /_no$|^code$/i.test(c.name)
                          ? 'link'
                          : fType === 'date'
                          ? 'date'
                          : 'text',
                    };
                  })
                : SAMPLE_COLUMNS;

              const effectiveCols: Record<string, PropValue>[] =
                columnItems.length > 0 ? columnItems : autoCols;
              const isAutoMode = columnItems.length === 0;

              return (
                <div className="pt-2.5 border-t border-slate-200 space-y-2 pb-6">
                  <div className="sticky -top-3 z-10 bg-white/95 backdrop-blur-xs py-1.5 border-b border-slate-100 space-y-1.5">
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-800">
                          表格列配置 (columns)
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            isAutoMode
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {isAutoMode
                            ? `自动推导 (${effectiveCols.length}列)`
                            : `自定义 (${columnItems.length}列)`}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        {boundTable && (
                          <button
                            type="button"
                            onClick={() => {
                              onPropChange(selectedNode.pfId, 'columns', autoCols);
                            }}
                            className="px-1.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-medium cursor-pointer"
                            title="从绑定的物理表一键导入默认列以便增删改"
                          >
                            从物理表导入列
                          </button>
                        )}
                        {!isAutoMode && (
                          <button
                            type="button"
                            onClick={() =>
                              onPropChange(selectedNode.pfId, 'columns', undefined)
                            }
                            className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] cursor-pointer"
                            title="清空自定义列，恢复按物理表自动推导"
                          >
                            恢复自动列
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const base = isAutoMode ? autoCols : columnItems;
                            const usedNames = new Set(
                              base.map((c) => String(c.dataIndex || ''))
                            );
                            const unusedCol = boundTable?.columns.find(
                              (c) => !usedNames.has(c.name)
                            );
                            const nextCol: Record<string, PropValue> = unusedCol
                              ? {
                                  dataIndex: unusedCol.name,
                                  title: columnLabel(unusedCol),
                                  render: 'text',
                                }
                              : {
                                  dataIndex: `col_${base.length + 1}`,
                                  title: `新列 ${base.length + 1}`,
                                  render: 'text',
                                };
                            onPropChange(selectedNode.pfId, 'columns', [...base, nextCol]);
                          }}
                          className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium flex items-center gap-0.5 cursor-pointer shadow-xs"
                        >
                          <Plus className="w-3 h-3" />
                          <span>新增列</span>
                        </button>
                      </div>
                    </div>

                    {/* Quick add column from bound physical table */}
                    {boundTable && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value=""
                          onChange={(e) => {
                            const colName = e.target.value;
                            if (!colName) return;
                            const col = boundTable.columns.find((c) => c.name === colName);
                            if (!col) return;
                            const base = isAutoMode ? autoCols : columnItems;
                            const fType = fieldTypeOf(col);
                            const renderKind =
                              fType === 'select'
                                ? 'tag'
                                : /amount|price|cost|total|fee/i.test(col.name)
                                ? 'money'
                                : /_no$|^code$/i.test(col.name)
                                ? 'link'
                                : fType === 'date'
                                ? 'date'
                                : 'text';
                            const newCol: Record<string, PropValue> = {
                              dataIndex: col.name,
                              title: columnLabel(col),
                              render: renderKind,
                            };
                            onPropChange(selectedNode.pfId, 'columns', [...base, newCol]);
                          }}
                          className="w-full px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50/50 text-emerald-900 text-[11px] focus:outline-none focus:border-emerald-500"
                        >
                          <option value="">
                            + 从物理表 [{boundTable.tableName}] 选择字段快速加列...
                          </option>
                          {boundTable.columns.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name} · {columnLabel(c)} ({c.dataType})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {!boundTable && <datalist id="pf-table-sample-fields">{SAMPLE_FIELDS.map(c => <option key={c.dataIndex} value={c.dataIndex}>{c.title}</option>)}</datalist>}
                  {/* Column list — uses full height of the inspector panel without nested max-height clipping */}
                  <div className="space-y-2">
                    {effectiveCols.map((col, idx) => {
                      const titleVal = typeof col.title === 'string' ? col.title : '';
                      const dataIndexVal =
                        typeof col.dataIndex === 'string' ? col.dataIndex : '';
                      const renderVal =
                        typeof col.render === 'string' ? col.render : 'text';
                      const widthVal =
                        typeof col.width === 'number' || typeof col.width === 'string'
                          ? String(col.width)
                          : '';

                      const updateCol = (patch: Record<string, PropValue | undefined>) => {
                        const base = isAutoMode ? autoCols : columnItems;
                        const next: Record<string, PropValue>[] = base.map((item, i) => {
                          if (i !== idx) return item;
                          const merged: Record<string, PropValue> = { ...item };
                          Object.entries(patch).forEach(([pk, pv]) => {
                            if (pv === undefined) delete merged[pk];
                            else merged[pk] = pv;
                          });
                          return merged;
                        });
                        onPropChange(selectedNode.pfId, 'columns', next);
                      };

                      return (
                        <div
                          key={idx}
                          className="p-2 rounded-lg border border-slate-200 bg-slate-50/80 space-y-1.5"
                        >
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-slate-400 w-4">
                              #{idx + 1}
                            </span>
                            <input
                              type="text"
                              value={titleVal}
                              onChange={(e) => updateCol({ title: e.target.value })}
                              placeholder="列标题 (如 物料名称)"
                              className="w-24 px-1.5 py-1 rounded border border-slate-200 bg-white text-xs font-medium text-slate-800"
                            />
                            {boundTable ? (
                              <select
                                value={dataIndexVal}
                                onChange={(e) => {
                                  const nextField = e.target.value;
                                  const matched = boundTable.columns.find(
                                    (c) => c.name === nextField
                                  );
                                  updateCol({
                                    dataIndex: nextField,
                                    title: matched ? columnLabel(matched) : titleVal,
                                  });
                                }}
                                className="flex-1 min-w-0 px-1.5 py-1 rounded border border-slate-200 bg-white font-mono text-[11px] text-slate-700"
                              >
                                <option value={dataIndexVal}>
                                  {dataIndexVal || '--选择字段--'}
                                </option>
                                {boundTable.columns
                                  .filter((c) => c.name !== dataIndexVal)
                                  .map((c) => (
                                    <option key={c.name} value={c.name}>
                                      {c.name} ({columnLabel(c)})
                                    </option>
                                  ))}
                              </select>
                            ) : (
                              <input
                                type="text" list="pf-table-sample-fields"
                                value={dataIndexVal}
                                onChange={(e) => updateCol({ dataIndex: e.target.value })}
                                placeholder="字段名 dataIndex"
                                className="flex-1 min-w-0 px-1.5 py-1 rounded border border-slate-200 bg-white font-mono text-[11px] text-slate-700"
                              />
                            )}
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => {
                                if (idx === 0) return;
                                const base = [...(isAutoMode ? autoCols : columnItems)];
                                [base[idx - 1], base[idx]] = [base[idx], base[idx - 1]];
                                onPropChange(selectedNode.pfId, 'columns', base);
                              }}
                              className="px-1 py-0.5 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                              title="左移/上移列"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={idx === effectiveCols.length - 1}
                              onClick={() => {
                                if (idx === effectiveCols.length - 1) return;
                                const base = [...(isAutoMode ? autoCols : columnItems)];
                                [base[idx], base[idx + 1]] = [base[idx + 1], base[idx]];
                                onPropChange(selectedNode.pfId, 'columns', base);
                              }}
                              className="px-1 py-0.5 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                              title="右移/下移列"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const base = isAutoMode ? autoCols : columnItems;
                                const next = base.filter((_, i) => i !== idx);
                                onPropChange(
                                  selectedNode.pfId,
                                  'columns',
                                  next.length > 0 ? next : undefined
                                );
                              }}
                              className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                              title="删除该列"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5 pl-4 flex-wrap">
                            <span className="text-[10px] text-slate-400 shrink-0">渲染:</span>
                            <select
                              value={renderVal}
                              onChange={(e) => updateCol({ render: e.target.value })}
                              className="flex-1 min-w-[96px] px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] text-slate-700"
                            >
                              <option value="text">普通文本 (text)</option>
                              <option value="tag">状态徽章 (tag)</option>
                              <option value="money">金额千分位 (money)</option>
                              <option value="link">超链接单号 (link)</option>
                              <option value="date">日期时间 (date)</option>
                            </select>
                            <select
                              value={typeof col.align === 'string' ? col.align : 'left'}
                              onChange={(e) =>
                                updateCol({
                                  align: e.target.value === 'left' ? undefined : e.target.value,
                                })
                              }
                              className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] text-slate-700"
                              title="列对齐方式"
                            >
                              <option value="left">居左</option>
                              <option value="center">居中</option>
                              <option value="right">居右</option>
                            </select>
                            <label className="inline-flex items-center gap-0.5 text-[10px] text-slate-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(col.sortable)}
                                onChange={(e) =>
                                  updateCol({ sortable: e.target.checked ? true : undefined })
                                }
                                className="w-3 h-3 rounded accent-blue-600"
                              />
                              <span>排序</span>
                            </label>
                            <input
                              type="text"
                              value={widthVal}
                              onChange={(e) =>
                                updateCol({
                                  width: e.target.value ? e.target.value : undefined,
                                })
                              }
                              placeholder="列宽自适应"
                              className="w-16 shrink-0 px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px] text-slate-700"
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pl-4 text-[11px] text-slate-600">
                            <label className="flex items-center gap-1"><input type="checkbox" checked={col.mergeRows === true} onChange={e => updateCol({ mergeRows: e.target.checked || undefined })} />合并相邻同值行</label>
                            <label className="flex items-center gap-1">单元格编辑器
                              <select value={typeof col.editor === 'string' ? col.editor : ''} disabled={!col.editor && Boolean(lockedColumn(dataIndexVal, selectedNode.props, boundTable))}
                                onChange={e => updateCol({ editor: e.target.value || undefined, editorOptions: undefined })}
                                className="rounded border border-slate-200 bg-white px-1 py-0.5">
                                <option value="">只读</option>{Object.entries(CELL_EDITORS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                              </select>
                            </label>
                          </div>
                          {col.editor === 'select' && <OptionsPropEditor key={JSON.stringify([dataIndexVal, col.editorOptions])} value={col.editorOptions}
                            onChange={options => updateCol({ editorOptions: options })} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Visual Form / QueryForm fields[] editor */}
            {(selectedNode.type === 'Form' || selectedNode.type === 'QueryForm') && (() => {
              const autoFields: Record<string, PropValue>[] = boundTable
                ? defaultDisplayColumns(
                    boundTable,
                    selectedNode.type === 'QueryForm' ? 4 : 6
                  ).map((c) => ({
                    name: c.name,
                    label: columnLabel(c),
                    type: fieldTypeOf(c),
                    ...(selectedNode.type === 'Form' ? { required: !c.nullable && !c.isPrimaryKey } : {}),
                  }))
                : [];
              const effectiveFields: Record<string, PropValue>[] =
                fieldItems.length > 0 ? fieldItems : autoFields;
              const isAutoFields = fieldItems.length === 0;

              return (
                <div className="pt-2.5 border-t border-slate-200 space-y-2 pb-6">
                  <div className="sticky -top-3 z-10 bg-white/95 backdrop-blur-xs py-1.5 border-b border-slate-100 space-y-1.5">
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-800">
                          表单字段配置 (fields)
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            isAutoFields
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {isAutoFields
                            ? `自动推导 (${effectiveFields.length}项)`
                            : `自定义 (${fieldItems.length}项)`}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        {boundTable && (
                          <button
                            type="button"
                            onClick={() => {
                              onPropChange(selectedNode.pfId, 'fields', autoFields);
                            }}
                            className="px-1.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-medium cursor-pointer"
                          >
                            从物理表导入字段
                          </button>
                        )}
                        {!isAutoFields && (
                          <button
                            type="button"
                            onClick={() =>
                              onPropChange(selectedNode.pfId, 'fields', undefined)
                            }
                            className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] cursor-pointer"
                          >
                            恢复自动
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const base = isAutoFields ? autoFields : fieldItems;
                            const next: Record<string, PropValue>[] = [
                              ...base,
                              {
                                name: `field_${base.length + 1}`,
                                label: `新字段 ${base.length + 1}`,
                                type: 'input',
                              },
                            ];
                            onPropChange(selectedNode.pfId, 'fields', next);
                          }}
                          className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium flex items-center gap-0.5 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>新增字段</span>
                        </button>
                      </div>
                    </div>

                    {boundTable && (
                      <select
                        value=""
                        onChange={(e) => {
                          const colName = e.target.value;
                          if (!colName) return;
                          const col = boundTable.columns.find((c) => c.name === colName);
                          if (!col) return;
                          const base = isAutoFields ? autoFields : fieldItems;
                          const newField: Record<string, PropValue> = {
                            name: col.name,
                            label: columnLabel(col),
                            type: fieldTypeOf(col),
                            ...(selectedNode.type === 'Form' ? { required: !col.nullable && !col.isPrimaryKey } : {}),
                          };
                          onPropChange(selectedNode.pfId, 'fields', [...base, newField]);
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50/50 text-emerald-900 text-[11px]"
                      >
                        <option value="">
                          + 从物理表 [{boundTable.tableName}] 选择字段加入表单...
                        </option>
                        {boundTable.columns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name} · {columnLabel(c)} ({c.dataType})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {effectiveFields.length > 0 && (
                    <div className="space-y-2">
                      {effectiveFields.map((f, idx) => {
                        const fType = typeof f.type === 'string' ? f.type : 'input';
                        const fSpan = typeof f.span === 'number' ? f.span : 1;
                        const fReq = Boolean(f.required);
                        const fOptions = Array.isArray(f.options)
                          ? (f.options as string[]).join(',')
                          : typeof f.options === 'string'
                          ? f.options
                          : '';
                        const fOverlay = typeof f.overlay === 'string' ? f.overlay : '';

                        const updateField = (patch: Record<string, PropValue | undefined>) => {
                          const base = isAutoFields ? autoFields : fieldItems;
                          const next: Record<string, PropValue>[] = base.map((item, i) => {
                            if (i !== idx) return item;
                            const merged: Record<string, PropValue> = { ...item };
                            Object.entries(patch).forEach(([pk, pv]) => {
                              if (pv === undefined) delete merged[pk];
                              else merged[pk] = pv;
                            });
                            return merged;
                          });
                          onPropChange(selectedNode.pfId, 'fields', next);
                        };

                        return (
                          <div
                            key={idx}
                            className="p-2 rounded-lg border border-slate-200 bg-slate-50/80 space-y-1.5"
                          >
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={typeof f.label === 'string' ? f.label : ''}
                                onChange={(e) => updateField({ label: e.target.value })}
                                placeholder="中文标签"
                                className="w-24 px-1.5 py-1 rounded border border-slate-200 bg-white text-xs font-medium"
                              />
                              <input
                                type="text"
                                value={typeof f.name === 'string' ? f.name : ''}
                                onChange={(e) => updateField({ name: e.target.value })}
                                placeholder="字段名"
                                className="flex-1 min-w-0 px-1.5 py-1 rounded border border-slate-200 bg-white font-mono text-[11px]"
                              />
                              <select
                                value={fType}
                                onChange={(e) => updateField({ type: e.target.value })}
                                className="px-1 py-1 rounded border border-slate-200 bg-white text-[11px]"
                              >
                                <option value="input">文本 (input)</option>
                                <option value="select">下拉 (select)</option>
                                <option value="date">日期 (date)</option>
                                <option value="dateRange">日期区间 (dateRange)</option>
                                <option value="number">数字 (number)</option>
                                <option value="textarea">多行 (textarea)</option>
                                <option value="picker">弹框选单 (picker)</option>
                                <option value="radio">单选 (radio)</option>
                                <option value="checkbox">多选 (checkbox)</option>
                                <option value="switch">开关 (switch)</option>
                                <option value="upload">上传附件 (upload)</option>
                              </select>
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => {
                                  if (idx === 0) return;
                                  const base = [...(isAutoFields ? autoFields : fieldItems)];
                                  [base[idx - 1], base[idx]] = [base[idx], base[idx - 1]];
                                  onPropChange(selectedNode.pfId, 'fields', base);
                                }}
                                className="px-1 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={idx === effectiveFields.length - 1}
                                onClick={() => {
                                  if (idx === effectiveFields.length - 1) return;
                                  const base = [...(isAutoFields ? autoFields : fieldItems)];
                                  [base[idx], base[idx + 1]] = [base[idx + 1], base[idx]];
                                  onPropChange(selectedNode.pfId, 'fields', base);
                                }}
                                className="px-1 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const base = isAutoFields ? autoFields : fieldItems;
                                  const next = base.filter((_, i) => i !== idx);
                                  onPropChange(
                                    selectedNode.pfId,
                                    'fields',
                                    next.length > 0 ? next : undefined
                                  );
                                }}
                                className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>

                            {selectedNode.type === 'Form' && (
                              <div className="flex items-center gap-2 text-[10px] text-slate-600 pl-1">
                                <label className="flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={fReq}
                                    onChange={(e) =>
                                      updateField({ required: e.target.checked })
                                    }
                                    className="rounded border-slate-300 text-blue-600"
                                  />
                                  <span>必填</span>
                                </label>
                                <span className="text-slate-400">|</span>
                                <span>跨列(span):</span>
                                <select
                                  value={String(fSpan)}
                                  onChange={(e) =>
                                    updateField({ span: Number(e.target.value) })
                                  }
                                  className="px-1 py-0.5 rounded border border-slate-200 bg-white text-[10px]"
                                >
                                  <option value="1">1列</option>
                                  <option value="2">2列</option>
                                  <option value="3">3列</option>
                                  <option value="4">4列 (整行)</option>
                                </select>
                              </div>
                            )}

                            {(fType === 'select' ||
                              fType === 'radio' ||
                              fType === 'checkbox') && (
                              <div className="flex items-center gap-1.5 pl-1">
                                <span className="text-[10px] text-slate-400 shrink-0">
                                  候选项:
                                </span>
                                <input
                                  type="text"
                                  value={fOptions}
                                  onChange={(e) =>
                                    updateField({
                                      options: e.target.value
                                        ? e.target.value.split(',').map((s) => s.trim())
                                        : undefined,
                                    })
                                  }
                                  placeholder="用逗号分隔，如 合格,让步接收,不合格"
                                  className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px]"
                                />
                              </div>
                            )}

                            {fType === 'picker' && (
                              <div className="flex items-center gap-1.5 pl-1">
                                <span className="text-[10px] text-slate-400 shrink-0">
                                  关联弹层:
                                </span>
                                <select
                                  value={fOverlay}
                                  onChange={(e) =>
                                    updateField({
                                      overlay: e.target.value || undefined,
                                    })
                                  }
                                  className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px]"
                                >
                                  <option value="">-- 选择点击调起的弹框/抽屉 --</option>
                                  {overlays.map((o) => (
                                    <option key={o.overlayId} value={o.overlayId}>
                                      #{o.overlayId} · {o.title}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Visual Descriptions items[] editor */}
            {selectedNode.type === 'Descriptions' && (() => {
              const autoItems: Record<string, PropValue>[] = boundTable
                ? defaultDisplayColumns(boundTable, 6).map((c) => ({
                    label: columnLabel(c),
                    field: c.name,
                  }))
                : [];
              const effectiveItems: Record<string, PropValue>[] =
                descOrTimelineItems.length > 0 ? descOrTimelineItems : autoItems;
              const isAutoDesc = descOrTimelineItems.length === 0;

              return (
                <div className="pt-2.5 border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span className="text-[11px] font-semibold text-slate-800">
                      描述项列表 ({isAutoDesc ? '自动推导' : `${descOrTimelineItems.length}项`})
                    </span>
                    <div className="flex items-center gap-1">
                      {boundTable && (
                        <button
                          type="button"
                          onClick={() =>
                            onPropChange(selectedNode.pfId, 'items', autoItems)
                          }
                          className="px-1.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-medium cursor-pointer"
                        >
                          从物理表导入
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const base = isAutoDesc ? autoItems : descOrTimelineItems;
                          onPropChange(selectedNode.pfId, 'items', [
                            ...base,
                            { label: `字段 ${base.length + 1}`, value: '示例内容' },
                          ]);
                        }}
                        className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>新增描述项</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 pb-4">
                    {effectiveItems.map((it, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg border border-slate-200 bg-slate-50/80 flex items-center gap-1"
                      >
                        <input
                          type="text"
                          value={typeof it.label === 'string' ? it.label : ''}
                          onChange={(e) => {
                            const base = isAutoDesc ? autoItems : descOrTimelineItems;
                            const next: Record<string, PropValue>[] = base.map((item, i) =>
                              i === idx ? { ...item, label: e.target.value } : item
                            );
                            onPropChange(selectedNode.pfId, 'items', next);
                          }}
                          placeholder="标签"
                          className="w-24 px-1.5 py-1 rounded border border-slate-200 bg-white text-xs"
                        />
                        {boundTable ? (
                          <select
                            value={typeof it.field === 'string' ? it.field : ''}
                            onChange={(e) => {
                              const fName = e.target.value;
                              const col = boundTable.columns.find((c) => c.name === fName);
                              const base = isAutoDesc ? autoItems : descOrTimelineItems;
                              const next: Record<string, PropValue>[] = base.map(
                                (item, i) => {
                                  if (i !== idx) return item;
                                  const copy: Record<string, PropValue> = {
                                    ...item,
                                    label: col ? columnLabel(col) : item.label,
                                  };
                                  if (fName) copy.field = fName;
                                  else delete copy.field;
                                  return copy;
                                }
                              );
                              onPropChange(selectedNode.pfId, 'items', next);
                            }}
                            className="w-28 px-1 py-1 rounded border border-slate-200 bg-white font-mono text-[11px]"
                          >
                            <option value="">--固定值--</option>
                            {boundTable.columns.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <input
                          type="text"
                          value={
                            typeof it.value === 'string'
                              ? it.value
                              : typeof it.field === 'string'
                              ? `{${it.field}}`
                              : ''
                          }
                          onChange={(e) => {
                            const base = isAutoDesc ? autoItems : descOrTimelineItems;
                            const next: Record<string, PropValue>[] = base.map((item, i) =>
                              i === idx ? { ...item, value: e.target.value } : item
                            );
                            onPropChange(selectedNode.pfId, 'items', next);
                          }}
                          placeholder="展示值"
                          className="flex-1 min-w-0 px-1.5 py-1 rounded border border-slate-200 bg-white text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const base = isAutoDesc ? autoItems : descOrTimelineItems;
                            const next = base.filter((_, i) => i !== idx);
                            onPropChange(
                              selectedNode.pfId,
                              'items',
                              next.length > 0 ? next : undefined
                            );
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Visual Timeline items[] editor */}
            {selectedNode.type === 'Timeline' && (() => {
              const defaultSteps: Record<string, PropValue>[] =
                descOrTimelineItems.length > 0
                  ? descOrTimelineItems
                  : [
                      { title: '发起申请', time: '2026-04-16 09:30', status: 'done' },
                      { title: '部门主管审批', time: '2026-04-16 14:15', status: 'current' },
                      { title: '归档入库', time: '待处理', status: 'wait' },
                    ];

              return (
                <div className="pt-2.5 border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-800">
                      时间线节点 ({defaultSteps.length}项)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onPropChange(selectedNode.pfId, 'items', [
                          ...defaultSteps,
                          {
                            title: `新节点 ${defaultSteps.length + 1}`,
                            time: '2026-04-16 16:00',
                            status: 'wait',
                          },
                        ]);
                      }}
                      className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>新增节点</span>
                    </button>
                  </div>
                  <div className="space-y-1.5 pb-4">
                    {defaultSteps.map((step, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg border border-slate-200 bg-slate-50/80 flex items-center gap-1"
                      >
                        <input
                          type="text"
                          value={typeof step.title === 'string' ? step.title : ''}
                          onChange={(e) => {
                            const next: Record<string, PropValue>[] = defaultSteps.map(
                              (item, i) =>
                                i === idx ? { ...item, title: e.target.value } : item
                            );
                            onPropChange(selectedNode.pfId, 'items', next);
                          }}
                          placeholder="节点标题"
                          className="flex-1 min-w-0 px-1.5 py-1 rounded border border-slate-200 bg-white text-xs"
                        />
                        <input
                          type="text"
                          value={typeof step.time === 'string' ? step.time : ''}
                          onChange={(e) => {
                            const next: Record<string, PropValue>[] = defaultSteps.map(
                              (item, i) =>
                                i === idx ? { ...item, time: e.target.value } : item
                            );
                            onPropChange(selectedNode.pfId, 'items', next);
                          }}
                          placeholder="时间/描述"
                          className="w-28 px-1.5 py-1 rounded border border-slate-200 bg-white text-[11px]"
                        />
                        <select
                          value={typeof step.status === 'string' ? step.status : 'done'}
                          onChange={(e) => {
                            const next: Record<string, PropValue>[] = defaultSteps.map(
                              (item, i) =>
                                i === idx ? { ...item, status: e.target.value } : item
                            );
                            onPropChange(selectedNode.pfId, 'items', next);
                          }}
                          className="px-1 py-1 rounded border border-slate-200 bg-white text-[11px]"
                        >
                          <option value="done">已完成</option>
                          <option value="current">进行中</option>
                          <option value="wait">待处理</option>
                          <option value="error">已驳回</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const next = defaultSteps.filter((_, i) => i !== idx);
                            onPropChange(
                              selectedNode.pfId,
                              'items',
                              next.length > 0 ? next : undefined
                            );
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Container quick child manager for Tabs / MPillTabs / Row / Toolbar / Space */}
            {onCommitDoc &&
              (selectedNode.type === 'Tabs' ||
                selectedNode.type === 'MPillTabs' ||
                selectedNode.type === 'Row' ||
                selectedNode.type === 'Toolbar' ||
                selectedNode.type === 'Space') && (() => {
                const nodeChildren = selectedNode.children.filter(
                  (ch): ch is ProtoNode => ch.kind === 'node'
                );

                return (
                  <div className="pt-2.5 border-t border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-800">
                        {selectedNode.type === 'Tabs'
                          ? `页签项管理 (${nodeChildren.length}个 Tab)`
                          : selectedNode.type === 'MPillTabs'
                          ? `胶囊项管理 (${nodeChildren.length}个 MTab)`
                          : selectedNode.type === 'Row'
                          ? `栅格列管理 (${nodeChildren.length}个 Col)`
                          : `内部按钮/子项 (${nodeChildren.length}个)`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const childIdx = nodeChildren.length + 1;
                          if (selectedNode.type === 'Tabs') {
                            const newTab: ProtoNode = {
                              kind: 'node',
                              type: 'Tab',
                              pfId: `${selectedNode.pfId}-tab-${Date.now().toString(36).slice(-3)}`,
                              props: {
                                key: `tab_${childIdx}`,
                                label: `新页签 ${childIdx}`,
                              },
                              children: [],
                            };
                            onCommitDoc(
                              insertNode(
                                doc,
                                selectedNode.pfId,
                                selectedNode.children.length,
                                newTab
                              )
                            );
                          } else if (selectedNode.type === 'MPillTabs') {
                            const newMTab: ProtoNode = {
                              kind: 'node',
                              type: 'MTab',
                              pfId: `${selectedNode.pfId}-mtab-${Date.now().toString(36).slice(-3)}`,
                              props: {
                                title: `新胶囊 ${childIdx}`,
                              },
                              children: [],
                            };
                            onCommitDoc(
                              insertNode(
                                doc,
                                selectedNode.pfId,
                                selectedNode.children.length,
                                newMTab
                              )
                            );
                          } else if (selectedNode.type === 'Row') {
                            const newCol: ProtoNode = {
                              kind: 'node',
                              type: 'Col',
                              pfId: `${selectedNode.pfId}-col-${Date.now().toString(36).slice(-3)}`,
                              props: { span: 12 },
                              children: [],
                            };
                            onCommitDoc(
                              insertNode(
                                doc,
                                selectedNode.pfId,
                                selectedNode.children.length,
                                newCol
                              )
                            );
                          } else {
                            const newBtn: ProtoNode = {
                              kind: 'node',
                              type: 'Button',
                              pfId: `${selectedNode.pfId}-btn-${Date.now().toString(36).slice(-3)}`,
                              props: {
                                label: `操作按钮 ${childIdx}`,
                                variant: childIdx === 1 ? 'primary' : 'default',
                              },
                              children: [],
                            };
                            onCommitDoc(
                              insertNode(
                                doc,
                                selectedNode.pfId,
                                selectedNode.children.length,
                                newBtn
                              )
                            );
                          }
                        }}
                        className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>
                          {selectedNode.type === 'Tabs'
                            ? '新增页签 (Tab)'
                            : selectedNode.type === 'MPillTabs'
                            ? '新增胶囊 (MTab)'
                            : selectedNode.type === 'Row'
                            ? '新增栅格列 (Col)'
                            : '新增按钮 (Button)'}
                        </span>
                      </button>
                    </div>

                    {selectedNode.type === 'Row' && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] text-slate-400">快速分栏预设:</span>
                        {[
                          { label: '两等分 (12:12)', spans: [12, 12] },
                          { label: '三等分 (8:8:8)', spans: [8, 8, 8] },
                          { label: '四等分 (6:6:6:6)', spans: [6, 6, 6, 6] },
                          { label: '左窄右宽 (8:16)', spans: [8, 16] },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              let nextDoc = doc;
                              preset.spans.forEach((sp, idx) => {
                                const existing = nodeChildren[idx];
                                if (existing) {
                                  nextDoc = setProp(nextDoc, existing.pfId, 'span', sp);
                                } else {
                                  nextDoc = insertNode(
                                    nextDoc,
                                    selectedNode.pfId,
                                    selectedNode.children.length + idx,
                                    {
                                      kind: 'node',
                                      type: 'Col',
                                      pfId: `${selectedNode.pfId}-col-${idx + 1}-${Date.now().toString(36).slice(-2)}`,
                                      props: { span: sp },
                                      children: [],
                                    }
                                  );
                                }
                              });
                              onCommitDoc(nextDoc);
                            }}
                            className="px-1.5 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[10px] text-slate-600 cursor-pointer"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {nodeChildren.length > 0 && (
                      <div className="space-y-1">
                        {nodeChildren.map((ch, idx) => (
                          <div
                            key={ch.pfId}
                            className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-1.5"
                          >
                            <span className="text-[10px] font-mono text-slate-400">
                              #{idx + 1}
                            </span>
                            {selectedNode.type === 'Tabs' && (
                              <>
                                <input
                                  type="text"
                                  value={
                                    typeof ch.props.label === 'string'
                                      ? ch.props.label
                                      : ''
                                  }
                                  onChange={(e) =>
                                    onPropChange(ch.pfId, 'label', e.target.value)
                                  }
                                  placeholder="页签名称"
                                  className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-xs"
                                />
                                <input
                                  type="text"
                                  value={
                                    typeof ch.props.key === 'string' ? ch.props.key : ''
                                  }
                                  onChange={(e) =>
                                    onPropChange(ch.pfId, 'key', e.target.value)
                                  }
                                  placeholder="key"
                                  className="w-20 px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px]"
                                />
                              </>
                            )}
                            {selectedNode.type === 'MPillTabs' && (
                              <>
                                <input
                                  type="text"
                                  value={
                                    typeof ch.props.title === 'string'
                                      ? ch.props.title
                                      : ''
                                  }
                                  onChange={(e) =>
                                    onPropChange(ch.pfId, 'title', e.target.value)
                                  }
                                  placeholder="胶囊标题"
                                  className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-xs"
                                />
                                <input
                                  type="number"
                                  min={0}
                                  value={
                                    typeof ch.props.badge === 'number'
                                      ? ch.props.badge
                                      : ''
                                  }
                                  onChange={(e) =>
                                    onPropChange(
                                      ch.pfId,
                                      'badge',
                                      e.target.value === ''
                                        ? undefined
                                        : Math.max(0, Number(e.target.value))
                                    )
                                  }
                                  placeholder="角标"
                                  className="w-16 px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px]"
                                />
                              </>
                            )}
                            {selectedNode.type === 'Row' && (
                              <>
                                <span className="text-xs text-slate-700 font-mono flex-1 truncate">
                                  {ch.pfId}
                                </span>
                                <span className="text-[10px] text-slate-400">跨度:</span>
                                <select
                                  value={String(ch.props.span || 12)}
                                  onChange={(e) =>
                                    onPropChange(ch.pfId, 'span', Number(e.target.value))
                                  }
                                  className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[11px]"
                                >
                                  <option value="6">6 (1/4)</option>
                                  <option value="8">8 (1/3)</option>
                                  <option value="12">12 (1/2)</option>
                                  <option value="16">16 (2/3)</option>
                                  <option value="18">18 (3/4)</option>
                                  <option value="24">24 (整行)</option>
                                </select>
                              </>
                            )}
                            {(selectedNode.type === 'Toolbar' ||
                              selectedNode.type === 'Space') && (
                              <>
                                <input
                                  type="text"
                                  value={
                                    typeof ch.props.label === 'string'
                                      ? ch.props.label
                                      : ch.type
                                  }
                                  onChange={(e) =>
                                    onPropChange(ch.pfId, 'label', e.target.value)
                                  }
                                  className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-xs"
                                />
                                {ch.type === 'Button' && (
                                  <select
                                    value={
                                      typeof ch.props.variant === 'string'
                                        ? ch.props.variant
                                        : 'default'
                                    }
                                    onChange={(e) =>
                                      onPropChange(ch.pfId, 'variant', e.target.value)
                                    }
                                    className="px-1 py-0.5 rounded border border-slate-200 bg-white text-[10px]"
                                  >
                                    <option value="primary">主按钮</option>
                                    <option value="default">次按钮</option>
                                    <option value="dashed">虚线</option>
                                    <option value="danger">危险</option>
                                    <option value="ghost">幽灵</option>
                                  </select>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
          </>
        )}

        {/* TAB 2: EVENTS & ACTIONS */}
        {tab === 'events' && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
              配置组件事件触发的交互动作链（如点击按钮打开弹框 <code className="font-mono text-blue-600">openModal</code>、在弹框中继续打开抽屉 <code className="font-mono text-blue-600">openDrawer</code> 或回填选单数据 <code className="font-mono text-blue-600">returnSelection</code>）。
            </div>

            {eventSpecs.map((ev) => {
              const raw = selectedNode.props[ev.name];
              const chain = isActionChain(raw) ? raw : undefined;

              return (
                <ActionChainEditor
                  key={ev.name}
                  label={ev.label}
                  eventName={ev.name}
                  value={chain}
                  overlays={overlays}
                  onChange={(next) => onPropChange(selectedNode.pfId, ev.name, next)}
                  onCreateOverlayAndBind={(type, id, title, value) =>
                    onCreateOverlay(type, id, title, { pfId: selectedNode.pfId, prop: ev.name, value })}
                />
              );
            })}

            {/* Row actions for tables and mobile task cards */}
            {(selectedNode.type === 'Table' || selectedNode.type === 'MTaskList') && (
              <div className="space-y-2.5 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      行操作按钮 (rowActions)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      每一行右侧的操作按钮，可打开详情抽屉、编辑弹框或嵌套子页面
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, PropValue>[] = [
                        ...rowActions,
                        {
                          label: '新操作',
                        },
                      ];
                      updateRowActions(next);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3 h-3" />
                    <span>新增行按钮</span>
                  </button>
                </div>

                {rowActions.map((ra, idx) => {
                  const lbl = typeof ra.label === 'string' ? ra.label : `按钮${idx + 1}`;
                  const danger = Boolean(ra.danger);
                  const primary = Boolean(ra.primary);
                  const chain = isActionChain(ra.onClick) ? ra.onClick : undefined;

                  return (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl border border-slate-200 bg-white space-y-2 shadow-2xs min-w-0 overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <input
                          type="text"
                          value={lbl}
                          onChange={(e) => {
                            const next = rowActions.map((item, i) =>
                              i === idx ? { ...item, label: e.target.value } : item
                            );
                            updateRowActions(next);
                          }}
                          className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-600"
                          placeholder="按钮文字"
                        />
                        {selectedNode.type === 'MTaskList' && (
                          <label className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={primary}
                              onChange={(e) => {
                                const next = rowActions.map((item, i) =>
                                  i === idx ? { ...item, primary: e.target.checked } : item
                                );
                                updateRowActions(next);
                              }}
                              className="accent-blue-600"
                            />
                            <span>主色胶囊</span>
                          </label>
                        )}
                        <label className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={danger}
                            onChange={(e) => {
                              const next = rowActions.map((item, i) =>
                                i === idx ? { ...item, danger: e.target.checked } : item
                              );
                              updateRowActions(next);
                            }}
                            className="accent-red-600"
                          />
                          <span>危险红字</span>
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            updateRowActions(rowActions.filter((_, i) => i !== idx))
                          }
                          className="p-1 text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                          title="删除该行操作按钮"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <ActionChainEditor
                        label={`行按钮「${lbl}」动作`}
                        eventName="onClick"
                        value={chain}
                        overlays={overlays}
                        onChange={(nextChain) => {
                          const next = rowActions.map((item, i) => {
                            if (i !== idx) return item;
                            const copy = { ...item };
                            if (nextChain) copy.onClick = nextChain;
                            else delete copy.onClick;
                            return copy;
                          });
                          updateRowActions(next);
                        }}
                        onCreateOverlayAndBind={(type, id, title, chain) =>
                          onCreateOverlay(type, id, title, {
                            pfId: selectedNode.pfId, prop: 'rowActions',
                            value: rowActions.map((item, i) => i === idx ? { ...item, onClick: chain } : item),
                          })}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {eventSpecs.length === 0 &&
              selectedNode.type !== 'Table' &&
              selectedNode.type !== 'MTaskList' && (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-slate-400">
                  {doc.root.type === 'MobilePage' ? (
                    <>
                      当前组件 &lt;{selectedNode.type}&gt; 无直接点击事件，您可在其中放入 &lt;MButton&gt; 或 &lt;MTaskList&gt; 配置交互。
                    </>
                  ) : (
                    <>
                      当前组件 &lt;{selectedNode.type}&gt; 无直接点击事件，您可在其中放入 &lt;Button&gt; 或 &lt;Table&gt; 配置交互。
                    </>
                  )}
                </div>
              )}
          </div>
        )}

        {/* TAB 3: STICKY NOTES */}
        {tab === 'sticky' && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-xl bg-amber-50/80 border border-amber-200 text-[11px] text-amber-900 leading-relaxed space-y-1.5">
              <div>
                为当前选中控件 <code className="font-mono font-semibold">{selectedNode.pfId}</code> 挂载业务规则便签，或点击画布上的黄色 <strong className="font-semibold">📌 便签</strong> 标签直接批注。
              </div>
              <button
                type="button"
                onClick={() => {
                  void runScanStickiesAndAstToDbWithHermes().catch(reportAiError);
                  setViewMode('db_designer');
                }}
                className="w-full py-1 px-2.5 rounded-lg bg-white hover:bg-amber-100/70 text-amber-900 border border-amber-300 font-medium flex items-center justify-center gap-1.5 cursor-pointer text-[11px]"
              >
                <Sparkles className="w-3 h-3 text-amber-600" />
                <span>AI 扫描便签与画布推导表字段 →</span>
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newStickyText.trim()) return;
                try { await runStickyCompileWithHermes({
                  pageId,
                  widgetId: selectedNode.pfId,
                  text: newStickyText.trim(),
                });
                setNewStickyText(''); } catch (error) { reportAiError(error); }
              }}
              className="space-y-2"
            >
              <textarea
                rows={2}
                value={newStickyText}
                onChange={(e) => setNewStickyText(e.target.value)}
                placeholder={`为当前选中组件【${meta?.title ?? selectedNode.type} (${selectedNode.pfId})】新增需求便签...`}
                className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                className="w-full py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>挂载便签到此组件 ({selectedNode.pfId})</span>
              </button>
            </form>

            {/* Current Component Stickies */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span>当前组件便签 ({nodeStickies.length})</span>
                <span className="font-mono text-[10px] text-slate-400">{selectedNode.pfId}</span>
              </div>
              {nodeStickies.length === 0 ? (
                <div className="p-2.5 rounded-xl border border-dashed border-slate-200 text-center text-[11px] text-slate-400">
                  当前选中组件暂未挂载便签（可点击下方本页便签快速定位对应组件）
                </div>
              ) : (
                nodeStickies.map((st) => (
                  <div
                    key={st.id}
                    className="p-2.5 rounded-xl border border-amber-300 bg-amber-50/70 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-900">
                        便签 #{st.index} · 当前组件
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleStickyRule(st.id)}
                          className="text-[10px] text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          {st.active ? '已生效' : '已停用'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteStickyRule(st.id)}
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-[13px] font-medium text-slate-900 leading-6">
                      {st.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* All Page Stickies Directory */}
            {pageStickies.length > 0 && (
              <div className="pt-2 border-t border-slate-200 space-y-2">
                <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                  <span>本页全部需求便签 ({pageStickies.length})</span>
                  <span className="text-[10px] text-slate-400">点击定位画布控件</span>
                </div>
                {pageStickies.map((st) => {
                  const isCurrent = st.targetWidgetId === selectedNode.pfId;
                  return (
                    <div
                      key={st.id}
                      onClick={() => {
                        onSelectNode(st.targetWidgetId);
                        setActivePopoverWidgetId(st.targetWidgetId);
                      }}
                      className={`p-3 rounded-xl border transition cursor-pointer space-y-1.5 ${
                        isCurrent
                          ? 'border-blue-500 bg-blue-50/40 ring-1 ring-blue-500/20'
                          : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/30'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 shrink-0">
                            #{st.index}
                          </span>
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {st.targetWidgetName}
                          </span>
                        </div>
                        <span className="text-[10px] font-semibold text-blue-600 shrink-0">
                          定位 →
                        </span>
                      </div>
                      <div className="text-xs text-slate-800 leading-relaxed">
                        {st.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: AI SCOPED PATCH & NODE TSX */}
        {tab === 'ai' && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  <span>AI 局部 AST 微调</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHermesModalOpen(true, 'overview')}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border cursor-pointer flex items-center gap-1 ${
                    hermesStatus === 'running'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                  }`}
                >
                  <Bot className="w-3 h-3" />
                  <span>
                    {hermesStatus === 'running'
                      ? `Hermes ${hermesVer}`
                      : '启用 Hermes'}
                  </span>
                </button>
              </div>
              <textarea
                rows={3}
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="例如：插入单据标准三栏表头；或给表格增加【AI风控审批】行按钮并自动创建审批弹框..."
                className="w-full p-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:border-blue-600"
              />
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onRunAiPrompt('插入单据标准三栏表头');
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer font-medium"
                >
                  + 插入单据三栏表头 (业务块)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRunAiPrompt('给表格增加AI风控审批行操作并生成审批弹框');
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 cursor-pointer"
                >
                  + 审批行按钮与弹框
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRunAiPrompt('增加Excel批量导入弹框，并在弹框内嵌套校验异常抽屉');
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 cursor-pointer"
                >
                  + 批量导入弹框→异常抽屉
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRunAiPrompt('新增一个业务流转日志抽屉');
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 cursor-pointer"
                >
                  + 业务详情抽屉
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!aiInput.trim()) return;
                  onRunAiPrompt(aiInput.trim());
                  setAiInput('');
                }}
                className={`w-full py-1.5 px-3 rounded-lg text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                  hermesStatus === 'running'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {hermesStatus === 'running'
                    ? `由 Hermes (${hermesVer}) 执行改写`
                    : '执行 AI 局部改写'}
                </span>
              </button>
            </div>

            {/* Live TSX Snippet of the selected node */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-blue-600" />
                  <span>当前节点受约束 TSX 源码</span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">AST 双向同步</span>
              </div>
              <pre className="p-2.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-72">
                {nodeTsxPreview}
              </pre>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
