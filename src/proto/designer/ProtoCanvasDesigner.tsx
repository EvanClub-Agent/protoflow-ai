import React, { useEffect, useMemo, useState } from 'react';
import {
  MousePointerClick,
  Play,
  Code2,
  Undo2,
  Redo2,
  Plus,
  Sparkles,
  Layers,
  CheckCircle2,
  AlertTriangle,
  X,
  ArrowRight,
  ExternalLink,
  RotateCcw,
  AppWindow,
  PanelRight,
  BookmarkPlus,
  Boxes,
  Trash2,
  Pin,
  ChevronDown,
  ChevronUp,
  Smartphone,
  Sun,
  Moon,
} from 'lucide-react';
import { useProtoStore } from '../../store/useProtoStore';
import { useResolvedTheme } from '../registry/AntdSurface';
import { MobileViewportShell } from '../mobile/MobileViewportShell';
import { resolveMobileAppearance, ToastStatusIcon, type MobileAppearance } from '../mobile/components';
import { MOBILE_DEVICE_LIST, resolvePagePlatform } from '../mobile/types';
import { useHermesStore } from '../../store/useHermesStore';
import { runCanvasAiWithHermes, runScanStickiesAndAstToDbWithHermes, runProjectAi, reportAiError } from '../../services/hermesBridge';
import {
  COMPOSITE_CATEGORY_LABELS,
  usePageStore,
  type CompositeCategory,
  type CustomCompositeBlock,
} from '../store/usePageStore';
import { parsePageSource } from '../dsl/parser';
import { sitemapCatalog } from '../sitemap';
import { printPageSource } from '../dsl/printer';
import {
  collectOverlays,
  duplicateNode,
  findNode,
  findParent,
  insertNode,
  moveNode,
  nodeText,
  reassignIds,
  removeNode,
  setProp,
  setText,
  walk,
} from '../dsl/tree';
import { COMPONENT_MAP, OVERLAY_TYPES, type ComponentMeta } from '../registry/meta';
import { generateFromTemplate, type PageTemplateKind } from '../ai/templates';
import {
  buildOverlayNode,
  collectActionCalls,
  parseSnippetNode,
  validatePageDoc,
} from '../ai/assistant';
import { RuntimeProvider, useRuntimeController } from '../runtime/runtime';
import type { Row } from '../runtime/mock';
import { DesignProvider, NodeView, ScopeProvider, StickyPinProvider, type DesignApi } from '../renderer/NodeView';
import { MaterialsAndOutlinePane, type LeftPaneTab } from './MaterialsAndOutlinePane';
import { NodeInspectorPanel, type OverlayBinding } from './NodeInspectorPanel';
import { FloatingPageChat } from './FloatingPageChat';
import { AiStreamingPreview } from './AiStreamingPreview';
import { useAiChatStore } from '../../store/useAiChatStore';
import { useAiPreviewStore } from '../../store/useAiPreviewStore';
import { conversationKey } from '../../services/hermesConversation';
import type { OverlayDescriptor } from './ActionChainEditor';
import { PageTableBindingBar } from '../../components/PageTableBindingBar';
import { ComponentStickyPin, renderStructuredRequirementText } from '../../components/ComponentStickyPin';
import type { ActionCall, ProtoDoc, ProtoNode } from '../types';

interface ProtoCanvasDesignerProps {
  pageId: string;
  onSwitchToLegacySandbox?: () => void;
}

export const ProtoCanvasDesigner: React.FC<ProtoCanvasDesignerProps> = ({
  pageId,
  onSwitchToLegacySandbox,
}) => {
  const {
    dbTables,
    stickyNotes,
    showAllComponentPins,
    setActivePopoverWidgetId,
    deleteStickyRule,
    setViewMode,
    isWebPlayerMode,
    leftActivityView,
    setLeftActivityView,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    currentProjectMeta,
  } = useProtoStore();
  const previewKey = conversationKey({ projectId: currentProjectMeta.projectId, pageId });
  const hasAiPreview = useAiPreviewStore(s => Boolean(s.runs[previewKey]?.latestPageId));
  const hasAiGeneration = useAiPreviewStore(s => Boolean(s.runs[previewKey]));
  const isPageAiRunning = useHermesStore(s => Boolean(
    s.runningProjects[currentProjectMeta.projectId] &&
    s.runningPageByProject[currentProjectMeta.projectId] === pageId
  ));
  // Preview sessions identify content generation, including the wait for its first block.
  // Local send state alone can outlive the selected page and also includes read-only work.
  const isAiGenerating = !isWebPlayerMode && hasAiGeneration && isPageAiRunning;
  const {
    pageSources,
    designerPages,
    sitemapBase,
    setPageSource,
    undo,
    redo,
    history,
    resetRows,
    compositeBlocks,
    saveCompositeBlock,
    deleteCompositeBlock,
    mobileDevice,
    setMobileDevice,
  } = usePageStore();

  // Missing sources are an integrity error, not permission to invent a table binding.
  const rawSource = pageSources[pageId] ?? '';

  // Match the directory: a designer page can replace its built-in menu entry.
  const pageEntry = useMemo(() => designerPages.find(page => page.pageId === pageId), [designerPages, pageId]);
  const menuTitle = useMemo(() => pageEntry?.title
    ?? sitemapCatalog(sitemapBase).builtinPages.get(pageId)?.item.title, [pageEntry, sitemapBase, pageId]);
  const parseResult = useMemo(() => parsePageSource(rawSource), [rawSource]);
  const fallbackPlatform = resolvePagePlatform(pageEntry, rawSource);
  const doc: ProtoDoc = useMemo(
    () =>
      parseResult.doc ?? {
        header: fallbackPlatform === 'mobile' ? [`// @protoflow page: ${pageId}`, '// @protoflow platform: mobile'] : [`// @protoflow page: ${pageId}`],
        root: {
          kind: 'node',
          pfId: 'pf_root',
          type: fallbackPlatform === 'mobile' ? 'MobilePage' : 'Page',
          props: { title: pageId },
          children: [],
        },
      },
    [parseResult.doc, pageId, fallbackPlatform]
  );
  const isMobilePage = doc.root.type === 'MobilePage';
  const workspaceTheme = useResolvedTheme();
  const [mobilePreviewAppearance, setMobilePreviewAppearance] = useState<MobileAppearance | null>(null);
  useEffect(() => {
    setMobilePreviewAppearance(null);
  }, [workspaceTheme]);
  const effectiveMobileAppearance = resolveMobileAppearance(
    doc.root.props.appearance,
    workspaceTheme,
    mobilePreviewAppearance,
  );
  const [mobileFramed, setMobileFramed] = useState(true);
  const [mobileExpandHeight, setMobileExpandHeight] = useState(false);

  // Designer state
  const [mode, setMode] = useState<'design' | 'preview' | 'code'>(
    isWebPlayerMode ? 'preview' : 'design'
  );
  const [activeOverlayId, setActiveOverlayId] = useState<string | null>(null);
  const [selectedPfId, setSelectedPfId] = useState<string | null>(null);
  const [hoveredPfId, setHoveredPfId] = useState<string | null>(null);
  const [stickyLedgerCollapsed, setStickyLedgerCollapsed] = useState(false);
  const [dropTarget, setDropTarget] = useState<DesignApi['drop']>(null);
  const [requestedLeftTab, setRequestedLeftTab] = useState<LeftPaneTab | null>(() => {
    if (typeof window !== 'undefined') {
      const lt = new URLSearchParams(window.location.search).get('leftTab') as LeftPaneTab | null;
      if (lt === 'materials' || lt === 'composites' || lt === 'outline' || lt === 'ai') return lt;
    }
    return null;
  });

  useEffect(() => {
    if (requestedLeftTab) {
      setLeftActivityView(requestedLeftTab);
    }
  }, [requestedLeftTab, setLeftActivityView]);

  const activeMaterialsTab: LeftPaneTab =
    leftActivityView === 'materials' ||
    leftActivityView === 'composites' ||
    leftActivityView === 'outline' ||
    leftActivityView === 'ai'
      ? leftActivityView
      : requestedLeftTab ?? 'materials';
  const showMaterialsPane =
    !leftSidebarCollapsed &&
    (leftActivityView === 'materials' ||
      leftActivityView === 'composites' ||
      leftActivityView === 'outline' ||
      leftActivityView === 'ai');
  const [saveCompositeModal, setSaveCompositeModal] = useState<{
    pfId: string;
    title: string;
    category: CompositeCategory;
    description: string;
  } | null>(null);
  const [aiBannerMsg, setAiBannerMsg] = useState<string | null>(null);
  const [aiEngineBadge, setAiEngineBadge] = useState<string | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [codeDraft, setCodeDraft] = useState(rawSource);
  const hermesStatus = useHermesStore(s => s.status);
  const setHermesModalOpen = useHermesStore(s => s.setModalOpen);

  useEffect(() => {
    setCodeDraft(rawSource);
  }, [rawSource]);

  useEffect(() => {
    if (isWebPlayerMode) {
      setMode('preview');
    }
  }, [isWebPlayerMode]);

  // Reset sub-page selection when switching pages
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlOverlay = params.get('overlay');
    const urlSelect = params.get('select');
    const urlMode = params.get('designMode') as 'design' | 'preview' | 'code' | null;
    if (urlMode === 'design' || urlMode === 'preview' || urlMode === 'code') {
      setMode(urlMode);
    }
    if (urlOverlay) {
      const ids = urlOverlay.split(',').map((s) => s.trim()).filter(Boolean);
      setActiveOverlayId(ids[ids.length - 1] ?? null);
      if (urlMode === 'preview') {
        const timer = setTimeout(() => {
          runtime.reset();
          ids.forEach((id) => runtime.openOverlay(id));
        }, 60);
        return () => clearTimeout(timer);
      }
    } else {
      setActiveOverlayId(null);
      let resolvedSelect = doc.root.pfId;
      if (urlSelect) {
        if (findNode(doc.root, urlSelect)) {
          resolvedSelect = urlSelect;
        } else {
          walk(doc.root, (n) => {
            if (resolvedSelect === doc.root.pfId && (n.type === urlSelect || n.props.id === urlSelect)) {
              resolvedSelect = n.pfId;
            }
          });
        }
      }
      setSelectedPfId(resolvedSelect);
      const urlPin = params.get('pin');
      if (urlPin) {
        const targetPin = urlPin === '1' ? resolvedSelect : urlPin;
        setTimeout(() => setActivePopoverWidgetId(targetPin), 80);
      }
      if (params.get('saveComposite') === '1') {
        const targetId =
          resolvedSelect !== doc.root.pfId
            ? resolvedSelect
            : doc.root.children.find((c): c is ProtoNode => typeof c === 'object' && c.kind === 'node' && c.type === 'Card')?.pfId;
        if (targetId) {
          setTimeout(() => openSaveCompositeModal(targetId), 60);
        }
      }

    }
  }, [pageId, doc.root.pfId]);

  const isDesign = mode === 'design';
  const runtime = useRuntimeController(doc, pageId, isDesign);

  const overlays: OverlayDescriptor[] = useMemo(() => {
    const nodes = collectOverlays(doc.root, OVERLAY_TYPES);
    return nodes.map((n) => ({
      pfId: n.pfId,
      overlayId: typeof n.props.id === 'string' ? n.props.id : n.pfId,
      title:
        typeof n.props.title === 'string'
          ? n.props.title
          : `${n.type} (${typeof n.props.id === 'string' ? n.props.id : n.pfId})`,
      type: n.type,
      node: n,
    }));
  }, [doc.root]);

  const activeOverlay = useMemo(
    () => overlays.find((o) => o.overlayId === activeOverlayId) ?? null,
    [overlays, activeOverlayId]
  );

  const selectedNode = useMemo(() => {
    if (selectedPfId) {
      const found = findNode(doc.root, selectedPfId);
      if (found) return found;
    }
    if (activeOverlay) return activeOverlay.node;
    return doc.root;
  }, [doc.root, selectedPfId, activeOverlay]);

  // Human readable label of the selected node (null = whole page) — used as AI chat context
  const selectedTargetLabel = useMemo(() => {
    if (!selectedNode || selectedNode.pfId === doc.root.pfId) return null;
    const meta = COMPONENT_MAP[selectedNode.type];
    const text =
      (typeof selectedNode.props.title === 'string' && selectedNode.props.title) ||
      (typeof selectedNode.props.label === 'string' && selectedNode.props.label) ||
      nodeText(selectedNode) ||
      '';
    return `<${selectedNode.type}> ${text || meta?.title || ''}`.trim();
  }, [selectedNode, doc.root.pfId]);

  // Validation diagnostics
  const validationIssues = useMemo(
    () => validatePageDoc(doc, dbTables),
    [doc, dbTables]
  );

  // Sticky note counts per pfId
  const stickyCountByPfId = useMemo(() => {
    const map: Record<string, number> = {};
    stickyNotes
      .filter((s) => s.pageId === pageId && s.active)
      .forEach((s) => {
        map[s.targetWidgetId] = (map[s.targetWidgetId] ?? 0) + 1;
      });
    return map;
  }, [stickyNotes, pageId]);

  const commitDoc = (nextDoc: ProtoDoc) => {
    const nextSource = printPageSource(nextDoc);
    setPageSource(pageId, nextSource);
  };

  // Create a new node from ComponentMeta
  const buildNodeFromMeta = (meta: ComponentMeta): ProtoNode => {
    const parsed = parseSnippetNode(meta.snippet);
    const suffix = Date.now().toString(36).slice(-4);
    if (parsed) {
      const clone: ProtoNode = {
        ...parsed,
        pfId: `pf_${meta.name.toLowerCase()}_${suffix}`,
        props: { ...parsed.props },
      };
      if (OVERLAY_TYPES.has(meta.name)) {
        const prefix = meta.name === 'Modal' ? 'm' : 'd';
        clone.props.id = `${prefix}-${suffix}`;
      }
      return clone;
    }
    return {
      kind: 'node',
      pfId: `pf_${meta.name.toLowerCase()}_${suffix}`,
      type: meta.name,
      props: {},
      children: [],
    };
  };

  const handleInsertComponent = (meta: ComponentMeta) => {
    const newNode = buildNodeFromMeta(meta);
    if (OVERLAY_TYPES.has(meta.name)) {
      const nextDoc = insertNode(doc, doc.root.pfId, -1, newNode);
      commitDoc(nextDoc);
      const ovId = typeof newNode.props.id === 'string' ? newNode.props.id : null;
      if (ovId) setActiveOverlayId(ovId);
      setSelectedPfId(newNode.pfId);
      return;
    }

    // Determine target container: selected node (if container), or active overlay, or Page root
    let targetContainerId = doc.root.pfId;
    if (activeOverlay) {
      targetContainerId = activeOverlay.node.pfId;
    }
    if (selectedNode) {
      const selMeta = COMPONENT_MAP[selectedNode.type];
      if (selMeta?.container) {
        targetContainerId = selectedNode.pfId;
      } else {
        const parentInfo = findParent(doc.root, selectedNode.pfId);
        if (parentInfo) {
          const nextDoc = insertNode(
            doc,
            parentInfo.parent.pfId,
            parentInfo.index + 1,
            newNode
          );
          commitDoc(nextDoc);
          setSelectedPfId(newNode.pfId);
          return;
        }
      }
    }

    const nextDoc = insertNode(doc, targetContainerId, -1, newNode);
    commitDoc(nextDoc);
    setSelectedPfId(newNode.pfId);
  };

  const buildNodeFromComposite = (block: CustomCompositeBlock): ProtoNode | null => {
    const parsed = parseSnippetNode(block.tsxSnippet);
    if (!parsed) return null;
    const cloned = reassignIds(parsed);
    if (OVERLAY_TYPES.has(cloned.type)) {
      const suffix = Date.now().toString(36).slice(-4);
      const prefix = cloned.type === 'Modal' ? 'm' : 'd';
      cloned.props = { ...cloned.props, id: `${prefix}-${suffix}` };
    }
    return cloned;
  };

  const handleInsertCompositeBlock = (block: CustomCompositeBlock) => {
    const newNode = buildNodeFromComposite(block);
    if (!newNode) return;
    if (OVERLAY_TYPES.has(newNode.type)) {
      const nextDoc = insertNode(doc, doc.root.pfId, -1, newNode);
      commitDoc(nextDoc);
      const ovId = typeof newNode.props.id === 'string' ? newNode.props.id : null;
      if (ovId) setActiveOverlayId(ovId);
      setSelectedPfId(newNode.pfId);
      setAiBannerMsg(`已从业务组件库插入弹层模板「${block.title}」`);
      return;
    }

    let targetContainerId = activeOverlay ? activeOverlay.node.pfId : doc.root.pfId;
    if (selectedNode && selectedNode.pfId !== doc.root.pfId) {
      const selMeta = COMPONENT_MAP[selectedNode.type];
      // If inserting a full Card/QueryForm and another Card is selected, insert right after the selected Card
      if (
        (newNode.type === 'Card' || newNode.type === 'QueryForm') &&
        (selectedNode.type === 'Card' || selectedNode.type === 'QueryForm')
      ) {
        const parentInfo = findParent(doc.root, selectedNode.pfId);
        if (parentInfo) {
          const nextDoc = insertNode(doc, parentInfo.parent.pfId, parentInfo.index + 1, newNode);
          commitDoc(nextDoc);
          setSelectedPfId(newNode.pfId);
          setAiBannerMsg(`已将业务复合组件「${block.title}」插入画布`);
          return;
        }
      }
      if (selMeta?.container) {
        targetContainerId = selectedNode.pfId;
      } else {
        const parentInfo = findParent(doc.root, selectedNode.pfId);
        if (parentInfo) {
          const nextDoc = insertNode(doc, parentInfo.parent.pfId, parentInfo.index + 1, newNode);
          commitDoc(nextDoc);
          setSelectedPfId(newNode.pfId);
          setAiBannerMsg(`已将业务复合组件「${block.title}」插入画布`);
          return;
        }
      }
    }

    const nextDoc = insertNode(doc, targetContainerId, -1, newNode);
    commitDoc(nextDoc);
    setSelectedPfId(newNode.pfId);
    setAiBannerMsg(`已将业务复合组件「${block.title}」插入画布`);
  };

  const openSaveCompositeModal = (pfId: string) => {
    const target = findNode(doc.root, pfId);
    if (!target || target.pfId === doc.root.pfId) return;
    const meta = COMPONENT_MAP[target.type];
    const rawLabel =
      (typeof target.props.title === 'string' && target.props.title) ||
      (typeof target.props.label === 'string' && target.props.label) ||
      nodeText(target) ||
      meta?.title ||
      target.type;

    let defaultCat: CompositeCategory = 'header';
    if (target.type === 'QueryForm' || target.type === 'SearchInput') defaultCat = 'query';
    else if (target.type === 'Table') defaultCat = 'table';
    else if (OVERLAY_TYPES.has(target.type)) defaultCat = 'overlay';
    else if (target.type === 'Form') defaultCat = 'form';
    else if (String(rawLabel).includes('审') || String(rawLabel).includes('核')) defaultCat = 'approval';
    else if (target.children.some((c) => typeof c === 'object' && c.kind === 'node' && c.type === 'Table')) {
      defaultCat = 'table';
    }

    let childCount = 0;
    walk(target, () => {
      childCount += 1;
    });
    childCount = Math.max(1, childCount - 1);

    setSaveCompositeModal({
      pfId: target.pfId,
      title: `${rawLabel}（复用业务块）`,
      category: defaultCat,
      description: `基于 <${target.type}> 封装的业务复合组件，内含 ${childCount} 个子控件，支持跨模块页面一键拖入复用`,
    });
  };

  const FLOW_GRID_TYPES = new Set(['Page', 'Card', 'Tab', 'Modal', 'Drawer', 'Col', 'Form', 'CollapsePanel']);

  const resolveDropPlacement = (
    targetPfId: string,
    pos: 'before' | 'after' | 'left' | 'right' | 'inside'
  ): { parentPfId: string; index: number } => {
    if (pos === 'inside') {
      const targetNode = findNode(doc.root, targetPfId);
      // If dropping inside a <Toolbar> that wraps a single <Space>, drop directly into that <Space>
      // so the new item sits right beside the existing buttons instead of being pushed away by justify-between
      if (targetNode?.type === 'Toolbar') {
        const nodeKids = targetNode.children.filter((c): c is ProtoNode => typeof c === 'object' && c.kind === 'node');
        if (nodeKids.length === 1 && nodeKids[0].type === 'Space') {
          return { parentPfId: nodeKids[0].pfId, index: -1 };
        }
      }
      return { parentPfId: targetPfId, index: -1 };
    }
    const loc = findParent(doc.root, targetPfId);
    if (!loc) return { parentPfId: doc.root.pfId, index: -1 };
    const isBefore = pos === 'before' || pos === 'left';
    return {
      parentPfId: loc.parent.pfId,
      index: isBefore ? loc.index : loc.index + 1,
    };
  };

  /**
   * When dropping 'left' or 'right' of a target node inside a 12-column Flow Grid container,
   * automatically pair their widths ('1/2', '1/3', or '1/4') so they sit side-by-side on the same row.
   */
  const applySmartSideBySideLayout = (
    curDoc: ProtoDoc,
    parentPfId: string,
    targetPfId: string,
    droppedPfId: string,
    pos: 'before' | 'after' | 'left' | 'right' | 'inside'
  ): ProtoDoc => {
    const parentNode = findNode(curDoc.root, parentPfId);
    if (!parentNode || !FLOW_GRID_TYPES.has(parentNode.type)) return curDoc;

    if (pos === 'left' || pos === 'right') {
      const targetNode = findNode(curDoc.root, targetPfId);
      if (!targetNode) return curDoc;
      const curW = typeof targetNode.props.width === 'string' ? targetNode.props.width : '';
      let nextW: string = '1/2';
      if (curW === '1/2') {
        nextW = '1/3';
      } else if (curW === '1/3') {
        nextW = '1/4';
      } else if (curW === '1/4') {
        nextW = '1/4';
      }
      let nextDoc = setProp(curDoc, targetPfId, 'width', nextW);
      nextDoc = setProp(nextDoc, droppedPfId, 'width', nextW);
      // If upgrading a 2-column row ('1/2') to 3-column ('1/3'), also update the adjacent '1/2' sibling
      if (curW === '1/2' && nextW === '1/3') {
        const updatedParent = findNode(nextDoc.root, parentPfId);
        const siblings =
          updatedParent?.children.filter((c): c is ProtoNode => typeof c === 'object' && c.kind === 'node') ?? [];
        const tIdx = siblings.findIndex((s) => s.pfId === targetPfId);
        const prevSib = tIdx > 0 ? siblings[tIdx - 1] : null;
        const nextSib = tIdx >= 0 && tIdx + 1 < siblings.length ? siblings[tIdx + 1] : null;
        if (prevSib && prevSib.pfId !== droppedPfId && prevSib.props.width === '1/2') {
          nextDoc = setProp(nextDoc, prevSib.pfId, 'width', '1/3');
        } else if (nextSib && nextSib.pfId !== droppedPfId && nextSib.props.width === '1/2') {
          nextDoc = setProp(nextDoc, nextSib.pfId, 'width', '1/3');
        }
      }
      return nextDoc;
    }

    return curDoc;
  };

  const designApi: DesignApi = useMemo(
    () => ({
      selectedId: selectedPfId,
      hoverId: hoveredPfId,
      drop: dropTarget,
      stickyCounts: stickyCountByPfId,
      select: (pfId) => setSelectedPfId(pfId),
      hover: (pfId) => setHoveredPfId(pfId),
      setDrop: (d) => setDropTarget(d),
      onDragStartNode: (pfId, e) => {
        e.dataTransfer.setData('application/x-pf-move', pfId);
        e.dataTransfer.effectAllowed = 'move';
      },
      onDrop: (targetPfId, pos, e) => {
        const compositeId = e.dataTransfer.getData('application/x-pf-composite');
        const newType =
          e.dataTransfer.getData('application/x-pf-new') ||
          e.dataTransfer.getData('application/x-pf-new-type');
        const movePfId = e.dataTransfer.getData('application/x-pf-move');

        if (compositeId) {
          const block = compositeBlocks.find((b) => b.id === compositeId);
          if (!block) return;
          const newNode = buildNodeFromComposite(block);
          if (!newNode) return;
          if (OVERLAY_TYPES.has(newNode.type)) {
            const nextDoc = insertNode(doc, doc.root.pfId, -1, newNode);
            commitDoc(nextDoc);
            if (typeof newNode.props.id === 'string') {
              setActiveOverlayId(newNode.props.id);
            }
            setSelectedPfId(newNode.pfId);
            setAiBannerMsg(`已拖入业务弹层模板「${block.title}」`);
            return;
          }
          const { parentPfId, index } = resolveDropPlacement(targetPfId, pos);
          let nextDoc = insertNode(doc, parentPfId, index, newNode);
          nextDoc = applySmartSideBySideLayout(nextDoc, parentPfId, targetPfId, newNode.pfId, pos);
          commitDoc(nextDoc);
          setSelectedPfId(newNode.pfId);
          setAiBannerMsg(`已将团队业务复合组件「${block.title}」拖入画布`);
          return;
        }

        if (newType) {
          const meta = COMPONENT_MAP[newType];
          if (!meta) return;
          const newNode = buildNodeFromMeta(meta);
          if (OVERLAY_TYPES.has(meta.name)) {
            const nextDoc = insertNode(doc, doc.root.pfId, -1, newNode);
            commitDoc(nextDoc);
            if (typeof newNode.props.id === 'string') {
              setActiveOverlayId(newNode.props.id);
            }
            setSelectedPfId(newNode.pfId);
            return;
          }
          const { parentPfId, index } = resolveDropPlacement(targetPfId, pos);
          let nextDoc = insertNode(doc, parentPfId, index, newNode);
          nextDoc = applySmartSideBySideLayout(nextDoc, parentPfId, targetPfId, newNode.pfId, pos);
          commitDoc(nextDoc);
          setSelectedPfId(newNode.pfId);
        } else if (movePfId && movePfId !== targetPfId) {
          const { parentPfId, index } = resolveDropPlacement(targetPfId, pos);
          let nextDoc = moveNode(doc, movePfId, parentPfId, index);
          nextDoc = applySmartSideBySideLayout(nextDoc, parentPfId, targetPfId, movePfId, pos);
          commitDoc(nextDoc);
          setSelectedPfId(movePfId);
        }
      },
      onUpdateProp: (pfId, propName, val) => {
        commitDoc(setProp(doc, pfId, propName, val));
      },
      onBatchContainerCols: (containerPfId, cols) => {
        let nextDoc = setProp(doc, containerPfId, 'cols', cols);
        const containerNode = findNode(nextDoc.root, containerPfId);
        if (containerNode && (containerNode.type === 'Card' || containerNode.type === 'Form')) {
          const colWidth =
            cols === 4 ? '1/4' : cols === 3 ? '1/3' : cols === 2 ? '1/2' : 'full';
          for (const child of containerNode.children) {
            if (typeof child === 'object' && child.kind === 'node') {
              // Keep full-width blocks like Table / Toolbar / Divider full width inside Card
              if (
                containerNode.type === 'Card' &&
                ['Table', 'Toolbar', 'Divider', 'Tabs', 'Steps'].includes(child.type)
              ) {
                continue;
              }
              nextDoc = setProp(nextDoc, child.pfId, 'width', cols === 1 ? undefined : colWidth);
            }
          }
        }
        commitDoc(nextDoc);
      },
      onMoveStep: (pfId, delta) => {
        const loc = findParent(doc.root, pfId);
        if (!loc) return;
        const targetIndex = Math.max(
          0,
          Math.min(loc.parent.children.length, loc.index + (delta < 0 ? -1 : 2))
        );
        commitDoc(moveNode(doc, pfId, loc.parent.pfId, targetIndex));
      },
      onDuplicate: (pfId) => {
        const res = duplicateNode(doc, pfId);
        commitDoc(res.doc);
        if (res.newId) setSelectedPfId(res.newId);
      },
      onDelete: (pfId) => {
        if (pfId === doc.root.pfId) return;
        const parentInfo = findParent(doc.root, pfId);
        const nextDoc = removeNode(doc, pfId);
        commitDoc(nextDoc);
        setSelectedPfId(parentInfo?.parent.pfId ?? nextDoc.root.pfId);
      },
      onSelectParent: (pfId) => {
        const parentInfo = findParent(doc.root, pfId);
        if (parentInfo) setSelectedPfId(parentInfo.parent.pfId);
      },
      onSaveAsComposite: (pfId) => {
        openSaveCompositeModal(pfId);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedPfId, hoveredPfId, dropTarget, stickyCountByPfId, doc, compositeBlocks]
  );

  const handleCreateOverlay = (
    type: 'Modal' | 'Drawer',
    customId?: string,
    customTitle?: string,
    binding?: OverlayBinding
  ) => {
    const suffix = Date.now().toString(36).slice(-4);
    const actualType = isMobilePage
      ? type === 'Modal'
        ? 'MDialog'
        : 'MBottomSheet'
      : type;
    const id = customId || `${type === 'Modal' ? 'dlg' : isMobilePage ? 'sheet' : 'd'}-${suffix}`;
    const title =
      customTitle ||
      (actualType === 'MDialog'
        ? `确认提示 (${id})`
        : actualType === 'MBottomSheet'
        ? `半屏详情面板 (${id})`
        : type === 'Modal'
        ? `新建业务弹框 (${id})`
        : `新建业务抽屉 (${id})`);
    const defaultTable = dbTables[0]?.id;

    const overlayNode = buildOverlayNode(actualType, id, title, defaultTable);
    const nextDoc = insertNode(doc, doc.root.pfId, -1, overlayNode);
    commitDoc(binding ? setProp(nextDoc, binding.pfId, binding.prop, binding.value) : nextDoc);
    setActiveOverlayId(id);
    setSelectedPfId(overlayNode.pfId);
  };

  const handleRunAiPrompt = async (prompt: string, images?: import('../../services/hermesClient').HermesImageAttachment[], noteIds?: string[]) => {
    if (aiRunning) return false;
    setAiRunning(true);
    try {
      await runCanvasAiWithHermes({ prompt, images, noteIds, doc, selectedPfId, dbTables, pageId, compositeBlocks });
      return true;
    } catch (error) {
      setAiBannerMsg(error instanceof Error ? error.message : String(error));
      return false;
    } finally { setAiRunning(false); }
  };

  const handleApplyTemplate = (kind: PageTemplateKind, tableId: string) => {
    const tbl = dbTables.find((t) => t.id === tableId);
    if (tableId && !tbl) { setAiBannerMsg('所选物理表已不存在，请重新选择'); return; }
    const nextSrc = generateFromTemplate(kind, tbl, dbTables, {
      pageId,
      title: typeof doc.root.props.title === 'string' ? doc.root.props.title : pageId,
      platform: isMobilePage ? 'mobile' : 'desktop',
    });
    setPageSource(pageId, nextSrc);
    setActiveOverlayId(null);
    setAiBannerMsg(`已套用「${kind}」页面模板${tbl ? `并绑定物理表 ${tbl.tableName}` : ''}`);
  };

  // Analyze incoming triggers & outgoing nested overlays for the currently active overlay
  const overlayCallGraph = useMemo(() => {
    if (!activeOverlay) return { incoming: [] as string[], outgoing: [] as string[] };
    const incoming: string[] = [];
    const outgoing: string[] = [];

    walk(doc.root, (n) => {
      const calls: ActionCall[] = [];
      Object.values(n.props).forEach((v) => collectActionCalls(v, calls));
      calls.forEach((c) => {
        if (
          (c.name === 'openModal' || c.name === 'openDrawer') &&
          c.args[0] === activeOverlay.overlayId
        ) {
          const text =
            nodeText(n) ||
            (typeof n.props.title === 'string' ? n.props.title : n.type);
          incoming.push(`${n.type} (${text})`);
        }
      });
    });

    walk(activeOverlay.node, (n) => {
      const calls: ActionCall[] = [];
      Object.values(n.props).forEach((v) => collectActionCalls(v, calls));
      calls.forEach((c) => {
        if (
          (c.name === 'openModal' || c.name === 'openDrawer') &&
          typeof c.args[0] === 'string' &&
          c.args[0] !== activeOverlay.overlayId
        ) {
          if (!outgoing.includes(c.args[0])) outgoing.push(c.args[0]);
        }
      });
    });

    return { incoming, outgoing };
  }, [doc.root, activeOverlay]);

  const pageHistory = history[pageId] ?? { past: [], future: [] };

  const openOverlayInPreview = (ov: OverlayDescriptor) => {
    setMode('preview');
    runtime.openOverlay(ov.overlayId);
  };

  if (!Object.prototype.hasOwnProperty.call(pageSources, pageId)) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50/70 p-6">
        <div
          role="alert"
          className="flex max-w-md items-start gap-3.5 rounded-2xl border border-amber-200/90 bg-white p-5 text-sm text-amber-950 shadow-xs"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 border border-amber-200/80">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900">页面源码缺失</div>
            <p className="mt-1 text-xs leading-relaxed text-amber-900">
              页面 {pageId} 缺少源码。请恢复页面源码或重新导入完整工程。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <RuntimeProvider value={runtime}>
      <StickyPinProvider value={ComponentStickyPin}>
      <DesignProvider value={designApi}>
        <div className="flex h-full w-full overflow-x-auto overflow-y-hidden bg-white">
          {!isWebPlayerMode && showMaterialsPane && mode !== 'code' && (
            <MaterialsAndOutlinePane
              root={doc.root}
              selectedPfId={selectedPfId}
              hoveredPfId={hoveredPfId}
              activeOverlayId={activeOverlayId}
              compositeBlocks={compositeBlocks}
              requestedTab={activeMaterialsTab}
              onTabChange={(t) => {
                setRequestedLeftTab(t);
                setLeftActivityView(t);
              }}
              onSelectNode={(id) => setSelectedPfId(id)}
              onHoverNode={(id) => setHoveredPfId(id)}
              onSelectOverlay={(ovId) => setActiveOverlayId(ovId)}
              onInsertComponent={handleInsertComponent}
              onInsertCompositeBlock={handleInsertCompositeBlock}
              onDeleteCompositeBlock={(id) => deleteCompositeBlock(id)}
              onPromptSaveComposite={(pfId) => openSaveCompositeModal(pfId)}
              onDeleteNode={(pfId) => {
                commitDoc(removeNode(doc, pfId));
                if (selectedPfId === pfId) setSelectedPfId(doc.root.pfId);
              }}
              onApplyTemplate={handleApplyTemplate}
            />
          )}

          {/* Center Column: Unified Canvas Header + Scrollable Canvas Viewport */}
          <div className="relative flex-1 flex flex-col min-w-[min(100%,22rem)] h-full overflow-hidden bg-slate-100/70">
            {/* Unified IntelliJ IDEA-style Single-Line Canvas Toolbar */}
            <div className="bg-white border-b border-slate-200 shrink-0">
              <div className="px-2.5 h-9 flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {!isWebPlayerMode && (
                    <>
                      {/* 3-Mode Icon Segmented Switcher */}
                      <div className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200/90 shrink-0">
                        {(
                          [
                            {
                              id: 'design',
                              label: '设计画布',
                              icon: MousePointerClick,
                              onClick: () => setMode('design'),
                            },
                            {
                              id: 'preview',
                              label: '交互预览',
                              icon: Play,
                              onClick: () => {
                                if (activeOverlay) {
                                  openOverlayInPreview(activeOverlay);
                                } else {
                                  setMode('preview');
                                }
                              },
                            },
                            {
                              id: 'code',
                              label: 'TSX 源码',
                              icon: Code2,
                              onClick: () => setMode('code'),
                            },
                          ] as const
                        ).map((item) => {
                          const Icon = item.icon;
                          const isActive = mode === item.id;
                          return (
                            <div key={item.id} className="relative group flex items-center">
                              <button
                                type="button"
                                aria-label={item.label}
                                aria-pressed={isActive}
                                onClick={item.onClick}
                                className={`w-7 h-6 rounded-md flex items-center justify-center cursor-pointer transition ${
                                  isActive
                                    ? item.id === 'preview'
                                      ? 'bg-blue-600 text-white shadow-2xs'
                                      : 'bg-white text-blue-600 shadow-2xs'
                                    : 'text-slate-500 hover:text-slate-900'
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5" />
                              </button>
                              <div
                                role="tooltip"
                                className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full left-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
                              >
                                <span className="relative z-10 text-xs font-medium tracking-tight">
                                  {item.label}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Undo / Redo Icon Buttons */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <div className="relative group flex items-center">
                          <button
                            type="button"
                            aria-label="撤销"
                            onClick={() => undo(pageId)}
                            disabled={pageHistory.past.length === 0}
                            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer transition"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                          </button>
                          <div
                            role="tooltip"
                            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
                          >
                            <span className="relative z-10 text-xs font-medium tracking-tight">
                              撤销 ({pageHistory.past.length})
                            </span>
                          </div>
                        </div>

                        <div className="relative group flex items-center">
                          <button
                            type="button"
                            aria-label="重做"
                            onClick={() => redo(pageId)}
                            disabled={pageHistory.future.length === 0}
                            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer transition"
                          >
                            <Redo2 className="w-3.5 h-3.5" />
                          </button>
                          <div
                            role="tooltip"
                            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
                          >
                            <span className="relative z-10 text-xs font-medium tracking-tight">
                              重做 ({pageHistory.future.length})
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="h-3.5 w-px bg-slate-200 shrink-0" />
                    </>
                  )}

                  {/* Sub-Page & Overlay Tabs + IDEA-style Add Overlay Icon Buttons */}
                  <div className="flex items-center gap-1 min-w-0">
                    <div className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveOverlayId(null);
                          setSelectedPfId(doc.root.pfId);
                          if (mode === 'preview') runtime.reset();
                        }}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium flex items-center gap-1 cursor-pointer transition border shrink-0 ${
                          activeOverlayId === null
                            ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold'
                            : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200/80'
                        }`}
                      >
                        <Layers className="w-3 h-3 text-blue-600 shrink-0" />
                        <span>主页面</span>
                      </button>

                      {overlays.map((ov) => {
                        const isSelectedOverlay = activeOverlayId === ov.overlayId;
                        const isOpenInPreview =
                          mode === 'preview' && runtime.overlays.some((s) => s.id === ov.overlayId);
                        const isModal = ov.type === 'Modal';

                        return (
                          <button
                            key={ov.overlayId}
                            type="button"
                            onClick={() => {
                              setActiveOverlayId(ov.overlayId);
                              setSelectedPfId(ov.node.pfId);
                              if (mode === 'preview') {
                                openOverlayInPreview(ov);
                              }
                            }}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-medium flex items-center gap-1 cursor-pointer transition border shrink-0 ${
                              isSelectedOverlay || isOpenInPreview
                                ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold'
                                : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200/80'
                            }`}
                            title={`点击进入 ${ov.type}#${ov.overlayId}（${ov.title}）独立子画布设计`}
                          >
                            {isModal ? (
                              <AppWindow className="w-3 h-3 text-blue-600 shrink-0" />
                            ) : (
                              <PanelRight className="w-3 h-3 text-amber-600 shrink-0" />
                            )}
                            <span className="truncate max-w-[100px]">{ov.title}</span>
                          </button>
                        );
                      })}
                    </div>

                    {!isWebPlayerMode && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <div className="relative group flex items-center">
                          <button
                            type="button"
                            aria-label={isMobilePage ? '新建确认弹窗 (MDialog)' : '新建弹框子画布 (Modal)'}
                            onClick={() => handleCreateOverlay('Modal')}
                            className="relative w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-500 hover:text-blue-600 cursor-pointer transition"
                          >
                            <AppWindow className="w-3.5 h-3.5" />
                            <Plus className="w-2.5 h-2.5 absolute bottom-1 right-0.5 bg-white rounded-full text-blue-600" />
                          </button>
                          <div
                            role="tooltip"
                            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
                          >
                            <span className="relative z-10 text-xs font-medium tracking-tight">
                              {isMobilePage ? '新建毛玻璃确认弹窗 (MDialog)' : '新建弹框子画布 (Modal)'}
                            </span>
                          </div>
                        </div>

                        <div className="relative group flex items-center">
                          <button
                            type="button"
                            aria-label={isMobilePage ? '新建半屏抽屉 (MBottomSheet)' : '新建抽屉子画布 (Drawer)'}
                            onClick={() => handleCreateOverlay('Drawer')}
                            className="relative w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-500 hover:text-amber-600 cursor-pointer transition"
                          >
                            <PanelRight className="w-3.5 h-3.5" />
                            <Plus className="w-2.5 h-2.5 absolute bottom-1 right-0.5 bg-white rounded-full text-amber-600" />
                          </button>
                          <div
                            role="tooltip"
                            className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
                          >
                            <span className="relative z-10 text-xs font-medium tracking-tight">
                              {isMobilePage ? '新建丝滑半屏抽屉 (MBottomSheet)' : '新建抽屉子画布 (Drawer)'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Mobile Viewport Switcher (iPhone / Pro / Pro Max + Light/Dark + Shell Toggle) */}
                    {isMobilePage && (
                      <div className="flex items-center gap-1.5 pl-1.5 ml-1 border-l border-slate-200 shrink-0">
                        <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
                          {MOBILE_DEVICE_LIST.map((spec) => {
                            const active = mobileDevice === spec.id;
                            return (
                              <button
                                key={spec.id}
                                type="button"
                                onClick={() => setMobileDevice(spec.id)}
                                title={`${spec.label} (${spec.subtitle})`}
                                className={`px-2 py-0.5 rounded-md text-[10.5px] font-medium flex items-center gap-1 cursor-pointer transition ${
                                  active
                                    ? 'bg-white text-violet-700 font-semibold shadow-2xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                <Smartphone className="w-3 h-3 shrink-0" />
                                <span>{spec.shortLabel}</span>
                                <span className="text-[9.5px] opacity-65 font-mono">{spec.width}</span>
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setMobilePreviewAppearance(
                              effectiveMobileAppearance === 'dark' ? 'light' : 'dark',
                            )
                          }
                          title="切换移动端屏幕预览外观（浅色雾白 / Gemini 曜石深色，默认自动跟随工作区明暗主题）"
                          className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[10.5px] font-medium text-slate-700 inline-flex items-center gap-1 cursor-pointer transition"
                        >
                          {effectiveMobileAppearance === 'dark' ? (
                            <>
                              <Moon className="w-3 h-3 text-violet-600" />
                              <span>深色</span>
                            </>
                          ) : (
                            <>
                              <Sun className="w-3 h-3 text-amber-500" />
                              <span>浅色</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setMobileFramed((v) => !v)}
                          title="显示或隐藏 iPhone 真机钛金属外壳与灵动岛"
                          className={`px-2 py-1 rounded-lg border text-[10.5px] font-medium cursor-pointer transition ${
                            mobileFramed
                              ? 'bg-violet-50 text-violet-700 border-violet-200'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {mobileFramed ? '真机壳' : '极简框'}
                        </button>

                        {mode === 'design' && (
                          <button
                            type="button"
                            onClick={() => setMobileExpandHeight((v) => !v)}
                            title="展开整页长图以便一览全部移动端内容，或恢复真机固定屏幕滚动"
                            className={`px-2 py-1 rounded-lg border text-[10.5px] font-medium cursor-pointer transition ${
                              mobileExpandHeight
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {mobileExpandHeight ? '长页展开' : '定高滚屏'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Inline Database Binding Bar + AST Validation Icon */}
                {!isWebPlayerMode && (
                  <div className="flex items-center gap-1 shrink-0">
                    <PageTableBindingBar
                      pageId={pageId}
                      pageTitle={menuTitle ?? `页面 ID · ${pageId}`}
                    />

                    <div className="h-3.5 w-px bg-slate-200 mx-0.5" />

                    {validationIssues.length === 0 ? (
                      <div className="relative group flex items-center">
                        <span
                          aria-label="静态校验通过"
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-600"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </span>
                        <div
                          role="tooltip"
                          className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
                        >
                          <span className="relative z-10 text-xs font-medium tracking-tight">
                            静态校验通过
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="relative group flex items-center">
                        <button
                          type="button"
                          aria-label={`${validationIssues.length} 处契约待修复`}
                          onClick={() => {
                            void runProjectAi(`检查并修复当前页面的这些契约问题：${validationIssues.map(i=>i.message).join('；')}。查明真实表绑定与动作目标，不能用第一张表替换未知表。`,{pageId}).catch(reportAiError);
                          }}
                          className="relative w-7 h-7 rounded-lg flex items-center justify-center bg-amber-50 hover:bg-amber-100 text-amber-600 ring-1 ring-amber-200 cursor-pointer transition"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-amber-500 text-white text-[9px] font-semibold flex items-center justify-center leading-none">
                            {validationIssues.length}
                          </span>
                        </button>
                        <div
                          role="tooltip"
                          className="pointer-events-none opacity-0 -translate-y-0.5 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-150 ease-out absolute top-full right-0 mt-1.5 z-50 px-2.5 py-1 rounded-md bg-white border border-slate-200/90 text-slate-800 shadow-md whitespace-nowrap"
                        >
                          <span className="relative z-10 text-xs font-medium tracking-tight">
                            {validationIssues.length} 处契约待修复（点击 AI 自动修复）
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* AI Execution Banner if present */}
              {aiBannerMsg && (
                <div className="mx-3 my-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>{aiBannerMsg}</span>
                    {aiEngineBadge && (
                      <button
                        type="button"
                        onClick={() => setHermesModalOpen(true, 'overview')}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border cursor-pointer transition ${
                          hermesStatus === 'running'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-blue-400 hover:text-blue-700'
                        }`}
                        title="点击查看 Hermes Agent 实时 Tool Call 调用日志或管理引擎"
                      >
                        {aiEngineBadge}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAiBannerMsg(null);
                      setAiEngineBadge(null);
                    }}
                    className="text-blue-500 hover:text-blue-800 cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Live Preview Runtime Status Bar (always visible above overlay backdrop) */}
            {mode === 'preview' && (
              <div className="px-3.5 py-2 bg-blue-50 border-b border-blue-200 flex items-center justify-between gap-2 flex-wrap text-xs shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-semibold text-[11px]">
                    原型交互预览
                  </span>
                  <span className="text-blue-900">
                    数据保存在工程内，可能包含示例记录；未连接业务数据库。
                  </span>
                  {runtime.overlays.length > 0 && (
                    <span className="font-mono text-[11px] text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200">
                      当前弹层栈: 主页面 {runtime.overlays.map((o) => `→ #${o.id}`).join(' ')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      resetRows();
                      runtime.reset();
                    }}
                    className="px-2 py-1 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>重置测试数据</span>
                  </button>
                  {!isWebPlayerMode && (
                    <button
                      type="button"
                      onClick={() => {
                        runtime.reset();
                        setMode('design');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 text-blue-700 border border-blue-200 text-[11px] font-medium cursor-pointer"
                    >
                      返回设计画布
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Center Viewport: Design Canvas | Live Preview | Bidirectional TSX Code Editor */}
            <div
              style={mode === 'preview' && doc.root.children.some(c => c.kind === 'node' && c.type === 'AxureCanvas') ? { contain:'layout' } : undefined}
              data-ai-active={isAiGenerating ? '1' : undefined}
              className="pf-canvas-viewport-shell flex-1 min-h-0 m-1 rounded-[20px] border border-slate-200/90 bg-white shadow-2xs relative flex flex-col overflow-hidden"
            >
              {/* Apple Intelligence Iridescent 4-Edge Screen Aura around the Design Area */}
              {isAiGenerating && <div aria-hidden="true" className="pf-ai-viewport-aura" />}

              <div className="flex-1 min-h-0 flex flex-col relative z-10 overflow-hidden">
              {hasAiPreview && !isWebPlayerMode ? (
                <div className="flex-1 min-h-0 overflow-y-auto p-1 flex flex-col">
                  <AiStreamingPreview projectId={currentProjectMeta.projectId} pageId={pageId} />
                </div>
              ) : mode === 'code' ? (
                <div className="flex-1 min-h-0 p-1 flex flex-col">
                  <div className="pf-ai-aura-surface w-full bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col flex-1 min-h-0">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-2">
                        <Code2 className="w-4 h-4 text-blue-600" />
                        <span className="text-xs font-bold text-slate-900 font-mono">
                          pages/{pageId}.page.tsx
                        </span>
                        <span className="text-[11px] text-slate-500">
                          （代码为底，控件为表 — 直接修改下方受约束 TSX 代码将实时同步至可视化画布）
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {parsePageSource(codeDraft).issues.some((i) => i.level === 'error') ? (
                          <span className="text-[11px] text-red-600 font-mono">
                            语法错误: {parsePageSource(codeDraft).issues[0]?.message}
                          </span>
                        ) : (
                          <span className="text-[11px] text-emerald-700 font-medium">
                            ✓ Babel AST 解析正常
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const res = parsePageSource(codeDraft);
                            if (res.doc) {
                              const formatted = printPageSource(res.doc);
                              setCodeDraft(formatted);
                              setPageSource(pageId, formatted);
                              setMode('design');
                            }
                          }}
                          className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
                        >
                          格式化并返回画布
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={codeDraft}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCodeDraft(next);
                        const parsed = parsePageSource(next);
                        if (parsed.doc) {
                          setPageSource(pageId, next);
                        }
                      }}
                      spellCheck={false}
                      className="flex-1 w-full p-4 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed focus:outline-none resize-none"
                    />
                  </div>
                </div>
              ) : mode === 'design' && activeOverlay ? (
                /* ISOLATED SUB-PAGE DESIGNER FOR A MODAL OR DRAWER */
                <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-2">
                  {/* Sub-Page Call-Chain & Config Bar */}
                  <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2 shrink-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono text-xs font-semibold">
                          &lt;{activeOverlay.type} id=&quot;{activeOverlay.overlayId}&quot;&gt;
                        </span>
                        <input
                          type="text"
                          value={activeOverlay.title}
                          onChange={(e) =>
                            commitDoc(
                              setProp(doc, activeOverlay.node.pfId, 'title', e.target.value)
                            )
                          }
                          className="px-2.5 py-1 rounded-lg border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openOverlayInPreview(activeOverlay)}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1 cursor-pointer"
                        >
                          <Play className="w-3 h-3" />
                          <span>在交互模式中试运行此弹层</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveOverlayId(null)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs cursor-pointer"
                        >
                          返回主页面画布
                        </button>
                      </div>
                    </div>

                    {/* Call chain visualization: Incoming -> Current Overlay -> Outgoing Nested Overlays */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap text-[11px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-400">调起入口：</span>
                        {overlayCallGraph.incoming.length === 0 ? (
                          <span className="text-amber-600">暂未绑定触发按钮</span>
                        ) : (
                          overlayCallGraph.incoming.map((inc, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]"
                            >
                              {inc}
                            </span>
                          ))
                        )}
                        <ArrowRight className="w-3 h-3 text-slate-400" />
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                          当前 #{activeOverlay.overlayId}
                        </span>
                        {overlayCallGraph.outgoing.length > 0 && (
                          <>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span className="text-slate-400">可继续调起嵌套弹层：</span>
                            {overlayCallGraph.outgoing.map((outId) => (
                              <button
                                key={outId}
                                type="button"
                                onClick={() => setActiveOverlayId(outId)}
                                className="px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-mono text-[10px] cursor-pointer"
                              >
                                #{outId} →
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Isolated Paper Frame for the Modal or Drawer */}
                  {isMobilePage ? (
                    <div className="pf-mobile-canvas-stage flex-1 min-h-0 py-4 flex justify-center items-start rounded-2xl border border-slate-200/80 overflow-y-auto">
                      <MobileViewportShell
                        device={mobileDevice}
                        appearance={doc.root.props.appearance}
                        previewAppearance={mobilePreviewAppearance}
                        accent={doc.root.props.accent} surfaceBg={doc.root.props.surfaceBg}
                        framed={mobileFramed}
                        expandHeight={false}
                      >
                        <NodeView
                          node={activeOverlay.node}
                          options={{ staticOverlay: true }}
                        />
                      </MobileViewportShell>
                    </div>
                  ) : (
                    <div className="pf-paper pf-ai-aura-surface flex-[1_0_auto] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm p-5 min-h-[360px]">
                      <NodeView
                        node={activeOverlay.node}
                        options={{ staticOverlay: true }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                /* MAIN PAGE CANVAS + ADAPTIVE BOTTOM STICKY NOTES DOCK (Design or Live Preview) */
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {/* Upper Primary Canvas Region: takes all remaining height and stretches <Page> to 100%, while expanding freely when content exceeds viewport */}
                  {isMobilePage ? (
                    <div className="pf-mobile-canvas-stage flex-1 min-h-0 overflow-y-auto py-5 px-4 flex flex-col items-center">
                      <MobileViewportShell
                        device={mobileDevice}
                        appearance={doc.root.props.appearance}
                        previewAppearance={mobilePreviewAppearance}
                        accent={doc.root.props.accent} surfaceBg={doc.root.props.surfaceBg}
                        framed={mobileFramed}
                        expandHeight={mode === 'design' && mobileExpandHeight}
                        runtimeFeedback={
                          mode === 'preview'
                            ? {
                                toasts: runtime.toasts,
                                confirmState: runtime.confirmState,
                                onResolveConfirm: runtime.resolveConfirm,
                              }
                            : undefined
                        }
                        overlaySlot={
                          mode === 'preview' ? (
                            <>
                              {runtime.overlays.map((entry, stackIdx) => {
                                const target = overlays.find((o) => o.overlayId === entry.id);
                                if (!target) return null;
                                return (
                                  <ScopeProvider
                                    key={entry.key}
                                    value={{
                                      row: entry.params.row as Row | undefined,
                                      tableId: entry.params.tableId as string | undefined,
                                      params: entry.params,
                                      overlayIndex: stackIdx,
                                    }}
                                  >
                                    <NodeView node={target.node} live />
                                  </ScopeProvider>
                                );
                              })}
                            </>
                          ) : undefined
                        }
                      >
                        <NodeView node={doc.root} />
                      </MobileViewportShell>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto p-1 flex flex-col">
                      <div className="pf-paper pf-ai-aura-surface flex-[1_0_auto] flex flex-col rounded-[16px] border border-slate-200/85 bg-white relative overflow-visible">
                        <NodeView node={doc.root} />
                      </div>
                    </div>
                  )}

                  {/* Bottom Docked Sticky Notes Summary Ledger (compact height share + collapse/expand) */}
                  {showAllComponentPins &&
                    stickyNotes.some((s) => s.pageId === pageId) && (
                      <div className="pf-sticky-ledger-dock shrink-0 border-t border-amber-200/90 bg-amber-50/50 flex flex-col transition-all">
                        <div className="px-3 py-2 flex items-center justify-between gap-2.5 flex-wrap border-b border-amber-200/80 bg-amber-50/80">
                          <button
                            type="button"
                            onClick={() => setStickyLedgerCollapsed((prev) => !prev)}
                            className="flex items-center gap-2 min-w-0 text-left cursor-pointer group"
                            title={stickyLedgerCollapsed ? '点击展开本页需求便签' : '点击收起本页需求便签'}
                          >
                            <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200/80 text-xs font-bold flex items-center gap-1.5 shrink-0">
                              <Pin className="w-3.5 h-3.5 text-amber-700" />
                              <span>
                                本页需求便签 ({stickyNotes.filter((s) => s.pageId === pageId).length} 条)
                              </span>
                            </span>
                            <span className="text-xs text-slate-600 truncate group-hover:text-slate-900">
                              点击任意卡片可在画布上定位对应组件并查看或编辑需求
                            </span>
                          </button>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                void runScanStickiesAndAstToDbWithHermes().catch(reportAiError);
                                setViewMode('db_designer');
                              }}
                              className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>AI 从便签推导数据表字段</span>
                            </button>

                            <button
                              type="button"
                              aria-expanded={!stickyLedgerCollapsed}
                              onClick={() => setStickyLedgerCollapsed((prev) => !prev)}
                              className="px-2.5 py-1 rounded-lg border border-amber-200 bg-white hover:bg-amber-50 text-amber-800 text-xs font-medium inline-flex items-center gap-1 cursor-pointer transition shadow-2xs"
                              title={stickyLedgerCollapsed ? '展开便签区域' : '收起便签区域以扩大画布空间'}
                            >
                              {stickyLedgerCollapsed ? (
                                <>
                                  <ChevronUp className="w-3.5 h-3.5" />
                                  <span>展开便签</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                  <span>收起便签</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {!stickyLedgerCollapsed && (
                          <div className="max-h-[clamp(112px,22vh,200px)] overflow-y-auto px-3 py-2 grid grid-cols-1 gap-2">
                            {stickyNotes
                              .filter((s) => s.pageId === pageId)
                              .map((st) => {
                                const resolvedTitle = (() => {
                                  if (
                                    st.targetWidgetName &&
                                    st.targetWidgetName !== st.targetWidgetId
                                  ) {
                                    return st.targetWidgetName;
                                  }
                                  const n = findNode(doc.root, st.targetWidgetId);
                                  if (!n) return st.targetWidgetName || st.targetWidgetId;
                                  const typeTitle = COMPONENT_MAP[n.type]?.title ?? n.type;
                                  const label =
                                    nodeText(n).trim() ||
                                    (typeof n.props.label === 'string' ? n.props.label : '') ||
                                    (typeof n.props.title === 'string' ? n.props.title : '');
                                  return label ? `${typeTitle}：${label}` : typeTitle;
                                })();

                                return (
                                  <div
                                    key={st.id}
                                    onClick={() => {
                                      setSelectedPfId(st.targetWidgetId);
                                      setActivePopoverWidgetId(st.targetWidgetId);
                                    }}
                                    className="px-3 py-2.5 rounded-xl bg-white border border-amber-200/90 hover:border-blue-500 hover:shadow-sm transition cursor-pointer space-y-1.5 shadow-2xs"
                                  >
                                    <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-100">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-mono text-xs font-bold shrink-0">
                                          #{st.index}
                                        </span>
                                        <span className="text-xs font-bold text-slate-900 truncate">
                                          {resolvedTitle}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-xs text-blue-600 font-semibold">
                                          定位组件 →
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteStickyRule(st.id);
                                          }}
                                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                                          title="删除此条便签"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>

                                    {renderStructuredRequirementText(st.text)}
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    )}
                </div>
              )}
              </div>

              {/* LIVE PREVIEW STACKED OVERLAYS (Supports unlimited Modal -> Drawer -> Modal nesting!) */}
              {mode === 'preview' &&
                !isMobilePage &&
                runtime.overlays.map((entry, stackIdx) => {
                  const target = overlays.find((o) => o.overlayId === entry.id);
                  if (!target) return null;
                  return (
                    <ScopeProvider
                      key={entry.key}
                      value={{
                        row: entry.params.row as Row | undefined,
                        tableId: entry.params.tableId as string | undefined,
                        params: entry.params,
                        overlayIndex: stackIdx,
                      }}
                    >
                      <NodeView node={target.node} live />
                    </ScopeProvider>
                  );
                })}

              {/* Runtime Confirm Dialog */}
              {!(isMobilePage && mode === 'preview') && runtime.confirmState && (
                <div className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4">
                  <div className="pf-paper bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-sm font-bold text-slate-900">操作确认</div>
                        <div className="text-xs text-slate-600 mt-1 leading-relaxed">
                          {runtime.confirmState.message}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => runtime.resolveConfirm(false)}
                        className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs text-slate-700 cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => runtime.resolveConfirm(true)}
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
                      >
                        确认执行
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Runtime Toasts */}
              {!(isMobilePage && mode === 'preview') && runtime.toasts.length > 0 && (
                <div className="fixed bottom-5 right-5 z-[95] space-y-2 pointer-events-none">
                  {runtime.toasts.map((t) => (
                    <div
                      key={t.id}
                      className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-medium shadow-xl flex items-center gap-2"
                    >
                      <ToastStatusIcon type={t.type} size={16} />
                      <span>{t.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {!isWebPlayerMode && mode !== 'code' && (
              <FloatingPageChat
                pageId={pageId}
                pageTitle={menuTitle ?? `页面 ID · ${pageId}`}
                selectedLabel={selectedTargetLabel}
                running={aiRunning || isPageAiRunning}
                onSend={handleRunAiPrompt}
                onClearSelection={() => setSelectedPfId(activeOverlay ? activeOverlay.node.pfId : doc.root.pfId)}
              />
            )}
          </div>

          {/* Right Column: Dedicated Component Property Inspector */}
          {!isWebPlayerMode && !rightSidebarCollapsed && mode !== 'code' && (
            <div className="w-[320px] shrink-0 border-l border-slate-200 bg-white flex flex-col h-full min-h-0">
              <NodeInspectorPanel
                embedded
                pageId={pageId}
                doc={doc}
                selectedNode={selectedNode}
                overlays={overlays}
                onSelectNode={(id) => setSelectedPfId(id)}
                onPropChange={(pfId, key, val) => commitDoc(setProp(doc, pfId, key, val))}
                onCommitDoc={(nextDoc) => commitDoc(nextDoc)}
                onTextChange={(pfId, text) => commitDoc(setText(doc, pfId, text))}
                onMoveNode={(pfId, dir) => {
                  const loc = findParent(doc.root, pfId);
                  if (!loc) return;
                  const targetIdx = dir === -1 ? loc.index - 1 : loc.index + 2;
                  if (targetIdx < 0 || targetIdx > loc.parent.children.length) return;
                  commitDoc(moveNode(doc, pfId, loc.parent.pfId, targetIdx));
                }}
                onDuplicateNode={(pfId) => {
                  const res = duplicateNode(doc, pfId);
                  commitDoc(res.doc);
                  if (res.newId) setSelectedPfId(res.newId);
                }}
                onRemoveNode={(pfId) => {
                  commitDoc(removeNode(doc, pfId));
                  setSelectedPfId(doc.root.pfId);
                }}
                onOpenOverlayDesigner={(ovId) => {
                  setActiveOverlayId(ovId);
                  const ov = overlays.find((o) => o.overlayId === ovId);
                  if (ov) setSelectedPfId(ov.node.pfId);
                }}
                onCreateOverlay={handleCreateOverlay}
                onRunAiPrompt={prompt => {
                  useAiChatStore.getState().setPageChatOpen(true);
                  return handleRunAiPrompt(prompt);
                }}
                onSaveAsComposite={(pfId) => openSaveCompositeModal(pfId)}
              />
            </div>
          )}

          {/* Save as Custom Business Composite Component Modal */}
          {saveCompositeModal && (() => {
            const targetNode = findNode(doc.root, saveCompositeModal.pfId);
            if (!targetNode) return null;
            let count = 0;
            const childTypes: string[] = [];
            walk(targetNode, (n) => {
              count += 1;
              if (n.pfId !== targetNode.pfId && !childTypes.includes(n.type)) {
                childTypes.push(n.type);
              }
            });
            const subCount = Math.max(1, count - 1);

            return (
              <div
                className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4"
                onClick={() => setSaveCompositeModal(null)}
              >
                <div
                  className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 py-3.5 bg-violet-50 border-b border-violet-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-violet-600 text-white flex items-center justify-center">
                        <BookmarkPlus className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">
                          沉淀为团队业务复合组件
                        </div>
                        <div className="text-[11px] text-violet-700">
                          将当前排好版的组件/容器块保存至左侧「业务块」库，支持跨页面拖拽复用
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSaveCompositeModal(null)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 space-y-4 text-xs">
                    {/* Structural summary badge */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Boxes className="w-4 h-4 text-violet-600 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 truncate">
                            源根节点：&lt;{targetNode.type}&gt; ({targetNode.pfId})
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            共包含 {subCount} 个子控件
                            {childTypes.length > 0 ? `（含 ${childTypes.slice(0, 6).join(', ')}）` : ''}
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10px] shrink-0">
                        AST 完整保留
                      </span>
                    </div>

                    {/* Title input */}
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-700 block">
                        复合组件名称 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={saveCompositeModal.title}
                        onChange={(e) =>
                          setSaveCompositeModal({ ...saveCompositeModal, title: e.target.value })
                        }
                        placeholder="如：采购入库标准三栏表头、订单明细汇总表格区块..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-violet-600"
                      />
                    </div>

                    {/* Category pills */}
                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-700 block">
                        归属业务分类
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(Object.keys(COMPOSITE_CATEGORY_LABELS) as CompositeCategory[]).map((cat) => {
                          const active = saveCompositeModal.category === cat;
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() =>
                                setSaveCompositeModal({ ...saveCompositeModal, category: cat })
                              }
                              className={`py-1.5 px-2.5 rounded-lg border text-xs font-medium cursor-pointer transition ${
                                active
                                  ? 'bg-violet-600 text-white border-violet-600 font-semibold shadow-2xs'
                                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                              }`}
                            >
                              {COMPOSITE_CATEGORY_LABELS[cat]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Description textarea */}
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-700 block">
                        适用场景与复用说明
                      </label>
                      <textarea
                        rows={2}
                        value={saveCompositeModal.description}
                        onChange={(e) =>
                          setSaveCompositeModal({
                            ...saveCompositeModal,
                            description: e.target.value,
                          })
                        }
                        className="w-full p-2.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-violet-600"
                      />
                    </div>
                  </div>

                  <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSaveCompositeModal(null)}
                      className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs text-slate-700 cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const created = saveCompositeBlock({
                          title: saveCompositeModal.title,
                          category: saveCompositeModal.category,
                          description: saveCompositeModal.description,
                          node: targetNode,
                        });
                        setSaveCompositeModal(null);
                        setRequestedLeftTab('composites');
                        setLeftActivityView('composites');
                        setAiBannerMsg(
                          `★ 已将「${created.title}」沉淀至左侧【业务块】库（共 ${compositeBlocks.length + 1} 个可复用业务复合组件）`
                        );
                      }}
                      className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>确认沉淀至业务块库</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </DesignProvider>
      </StickyPinProvider>
    </RuntimeProvider>
  );
};
