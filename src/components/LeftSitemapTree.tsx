import { MindmapLinksModal } from './MindmapLinksModal';
import { NoteLinksModal } from './NoteLinksModal';
import { pageRefKey, type MindmapPageRef } from '../proto/mindmaps';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Network,
  BookOpenText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderInput,
  Undo2,
  FileText,
  LayoutGrid,
  ChevronRight,
  ChevronDown,
  Database,
  EyeOff,
  Eye,
  Table2,
  Plus,
  Layers,
  X,
  Sparkles,
  Bot,
  Trash2,
  Smartphone,
  Monitor,
} from 'lucide-react';
import { useProtoStore, SitemapItem } from '../store/useProtoStore';
import { useHermesStore } from '../store/useHermesStore';
import { usePageStore } from '../proto/store/usePageStore';
import { MOBILE_PAGE_TEMPLATES, PAGE_TEMPLATES, type PageTemplateKind } from '../proto/ai/templates';
import { resolvePagePlatform, type PagePlatform } from '../proto/mobile/types';
import { createPageFromTemplate, runProjectAi } from '../services/hermesBridge';
import { discussProject } from '../services/projectWorkflow';
import { buildSitemap, folderOptions, prepareSitemapMove, sitemapItemLocation, type SitemapLayout, type SitemapMoveTarget } from '../proto/sitemap';
import { newId } from '../utils/identity';
import { NewFolderModal } from './NewFolderModal';
import { MoveSitemapModal } from './MoveSitemapModal';
import { DeleteConfirmation } from './DeleteConfirmation';
import { captureProjectPayload } from '../services/projectStorage';
import { deleteMenu, prepareMenuDeletion, type MenuDeletionPlan } from '../services/menuDeletion';
import { useI18n } from '../i18n';

const TEMPLATE_EN_FALLBACK: Record<string, { title: string; description: string }> = {
  list: { title: 'Standard CRUD List', description: 'Search filters, data table, pagination, and modal form' },
  form: { title: 'Structured Form', description: 'Multi-section form with validation and submit actions' },
  detail: { title: 'Detail & Approval', description: 'Header summary, status timeline, and detail tabs' },
  master_detail: { title: 'Master-Detail Order', description: '3-column document header with editable line items' },
  dashboard: { title: 'Analytics Dashboard', description: 'KPI cards, trend charts, and operational summary' },
  kanban: { title: 'Kanban Board', description: 'Multi-stage workflow columns with draggable cards' },
  blank: { title: 'Blank Canvas', description: 'Empty page ready for freeform layout or AI generation' },
  mobile_explore: { title: 'Mobile Explore Feed', description: 'Search bar, category pills, cards, and bottom tab bar' },
  mobile_workspace: { title: 'Mobile B2B Workspace', description: 'Approval tasks, quick actions, and KPI overview' },
  mobile_detail: { title: 'Mobile Detail & Action', description: 'Hero card, specs section, and sticky bottom action bar' },
  mobile_form: { title: 'Mobile Form Sheet', description: 'Touch-friendly inputs, pickers, and submit bar' },
  mobile_chat: { title: 'Mobile AI Assistant', description: 'Conversational stream, prompt chips, and composer' },
  mobile_profile: { title: 'Mobile Profile Center', description: 'User header, stats row, and settings menu list' },
  mobile_blank: { title: 'Blank Mobile Page', description: 'Empty mobile viewport ready for custom design' },
};

function currentLayout(): SitemapLayout {
  const { sitemapBase, designerFolders, designerPages, sitemapOverrides } = usePageStore.getState();
  return { sitemapBase, designerFolders, designerPages, sitemapOverrides };
}
function sameLayout(a: SitemapLayout, b: SitemapLayout) {
  return a.sitemapBase === b.sitemapBase && a.designerFolders === b.designerFolders && a.designerPages === b.designerPages && a.sitemapOverrides === b.sitemapOverrides;
}

export const SITEMAP_WIDTH_STORAGE_KEY = 'protoflow.leftSitemapWidth.v1';
export const DEFAULT_SITEMAP_WIDTH = 304;
export const MIN_SITEMAP_WIDTH = 232;
export const MAX_SITEMAP_WIDTH = 520;

function clampSitemapWidth(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_SITEMAP_WIDTH;
  const viewportCap =
    typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 560
      ? Math.max(MIN_SITEMAP_WIDTH, Math.min(MAX_SITEMAP_WIDTH, Math.floor(window.innerWidth * 0.45)))
      : MAX_SITEMAP_WIDTH;
  return Math.round(Math.min(viewportCap, Math.max(MIN_SITEMAP_WIDTH, raw)));
}

function readStoredSitemapWidth(): number {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : globalThis.localStorage;
    if (!storage) return DEFAULT_SITEMAP_WIDTH;
    const raw = storage.getItem(SITEMAP_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_SITEMAP_WIDTH;
    return clampSitemapWidth(Number(raw));
  } catch {
    return DEFAULT_SITEMAP_WIDTH;
  }
}

function persistSitemapWidth(width: number): void {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : globalThis.localStorage;
    if (storage) {
      storage.setItem(SITEMAP_WIDTH_STORAGE_KEY, String(Math.round(width)));
    }
  } catch {
    /* Ignore restricted storage environments. */
  }
}

function syncTruncatedLabelMetrics(el: HTMLElement): void {
  const hiddenWidth = Math.max(0, Math.ceil(el.scrollWidth - el.clientWidth));
  el.classList.toggle('truncated', hiddenWidth > 0);
  if (hiddenWidth > 0) {
    el.style.setProperty('--scroll-width', String(hiddenWidth));
  } else {
    el.style.removeProperty('--scroll-width');
  }
}

export const LeftSitemapTree: React.FC = () => {
  const projectId = useProtoStore(state => state.currentProjectMeta.projectId);
  return <ProjectSitemap key={projectId} />;
};

const ProjectSitemap: React.FC = () => {
  const { isEn, tr, td } = useI18n();
  const {
    activePageId,
    currentProjectMeta,
    setActivePage,
    viewMode,
    setViewMode,
    leftSidebarTab,
    setLeftSidebarTab,
    dbTables,
    selectedTableId,
    setSelectedTableId,
    createNewTable,
    searchQuery,
    setSearchQuery,
    expandedFolders,
    toggleFolder,
    showDeprecatedNodes,
    setShowDeprecatedNodes,
    menuPulseBadges,
  } = useProtoStore();

  const { designerPages, designerFolders, sitemapBase, sitemapOverrides, pageSources, createDesignerPage, createDesignerFolder, moveSitemapItem } = usePageStore();
  const sitemap = useMemo(() => buildSitemap(designerFolders, designerPages, sitemapOverrides, sitemapBase), [sitemapBase, designerFolders, designerPages, sitemapOverrides]);
  const folders = useMemo(() => folderOptions(designerFolders, sitemapOverrides, sitemapBase), [designerFolders, sitemapOverrides, sitemapBase]);
  const {
    status: hermesStatus,
    currentVersion: hermesVer,
    setModalOpen: setHermesModalOpen,
  } = useHermesStore();

  const [showNewTableModal, setShowNewTableModal] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newCnName, setNewCnName] = useState('');
  const [newDomain, setNewDomain] = useState('');

  const [showNewPageModal, setShowNewPageModal] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState('');
  const [newPageFolderId, setNewPageFolderId] = useState<string | null>(() => { const first = folders.find(folder => !folder.deprecated); return first ? first.id : null; });
  const [newPagePlatform, setNewPagePlatform] = useState<PagePlatform>('desktop');
  const [newPageTemplate, setNewPageTemplate] = useState<PageTemplateKind>('list');
  const [newPageTableId, setNewPageTableId] = useState('t_base_supplier');
  const [newPageAiPrompt, setNewPageAiPrompt] = useState('');
  const [newPageError, setNewPageError] = useState('');
  const [creatingPage, setCreatingPage] = useState(false);
  const [folderDraft, setFolderDraft] = useState<{ parentId: string | null; forNewPage?: boolean } | null>(null);

  const [mindmapLinkPage, setMindmapLinkPage] = useState<MindmapPageRef | null>(null);
  const [noteLinkPage, setNoteLinkPage] = useState<MindmapPageRef | null>(null);
  const mindmapLinks = useProtoStore(state => state.mindmaps.links);
  const noteLinks = useProtoStore(state => state.projectNotes.links);
  const [moveTarget, setMoveTarget] = useState<SitemapMoveTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MenuDeletionPlan | null>(null);
  const [lastDelete, setLastDelete] = useState<ReturnType<typeof deleteMenu> | null>(null);
  const [drag, setDrag] = useState<{ target: SitemapMoveTarget; projectId: string } | null>(null);
  const [dropHover, setDropHover] = useState<{ id: string | null } | null>(null);
  const [moveError, setMoveError] = useState('');
  const [lastMove, setLastMove] = useState<{ before: SitemapLayout; after: SitemapLayout; parentId: string | null; message: string } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSitemapWidth());
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const resizeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const labelObserverRef = useRef<ResizeObserver | null>(null);
  const observedLabelsRef = useRef<Set<HTMLElement>>(new Set());

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement) {
          syncTruncatedLabelMetrics(entry.target);
        }
      }
    });
    labelObserverRef.current = observer;
    for (const el of observedLabelsRef.current) {
      observer.observe(el);
      syncTruncatedLabelMetrics(el);
    }
    return () => {
      observer.disconnect();
      labelObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    for (const el of Array.from(observedLabelsRef.current)) {
      if (!el.isConnected) {
        observedLabelsRef.current.delete(el);
        labelObserverRef.current?.unobserve(el);
        continue;
      }
      syncTruncatedLabelMetrics(el);
    }
  }, [sitemap, sidebarWidth, expandedFolders, searchQuery, showDeprecatedNodes]);

  const bindSitemapLabelRef = useCallback((node: HTMLSpanElement | null) => {
    if (!node || typeof HTMLElement === 'undefined' || !(node instanceof HTMLElement)) return;
    observedLabelsRef.current.add(node);
    labelObserverRef.current?.observe(node);
    syncTruncatedLabelMetrics(node);
  }, []);

  const applySidebarWidth = useCallback((next: number) => {
    const clamped = clampSitemapWidth(next);
    setSidebarWidth(clamped);
    persistSitemapWidth(clamped);
  }, []);

  useEffect(() => {
    if (!isResizingSidebar) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      const state = resizeDragRef.current;
      if (!state) return;
      applySidebarWidth(state.startWidth + (event.clientX - state.startX));
    };
    const stopResize = () => {
      resizeDragRef.current = null;
      setIsResizingSidebar(false);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [isResizingSidebar, applySidebarWidth]);
  const layout = useMemo(() => ({ sitemapBase, designerFolders, designerPages, sitemapOverrides }), [sitemapBase, designerFolders, designerPages, sitemapOverrides]);
  const dropTargets = useMemo(() => {
    const valid = new Set<string | null>();
    if (!drag) return valid;
    for (const parentId of [null, ...folders.map(folder => folder.id)]) {
      try { if (prepareSitemapMove(layout, drag.target, parentId) !== layout) valid.add(parentId); } catch { /* Invalid destinations are not drop targets. */ }
    }
    return valid;
  }, [drag, layout, folders]);

  const expandDirectory = (folderId: string | null) => {
    const state = usePageStore.getState();
    const byId = new Map(folderOptions(state.designerFolders, state.sitemapOverrides, state.sitemapBase).map(folder => [folder.id, folder]));
    useProtoStore.setState(state => {
      const expanded = { ...state.expandedFolders };
      let id: string | null = folderId;
      while (id !== null) { expanded[id] = true; id = byId.get(id)!.parentFolderId; }
      return { expandedFolders: expanded, searchQuery: '' };
    });
  };
  const moveItem = (target: SitemapMoveTarget, parentId: string | null, projectId = currentProjectMeta.projectId) => {
    const before = currentLayout();
    const location = sitemapItemLocation(before, target);
    moveSitemapItem(target, parentId, projectId);
    const after = currentLayout();
    if (!sameLayout(before, after)) {
      const destination = parentId === null ? tr('顶层目录', 'Top-level') : folderOptions(after.designerFolders, after.sitemapOverrides, after.sitemapBase).find(folder => folder.id === parentId)!.path;
      setLastMove({ before, after, parentId: location.parentFolderId, message: tr(`“${location.title}”已移至 ${destination}`, `Moved "${location.title}" to ${destination}`) });
      expandDirectory(parentId);
    }
    setMoveError(''); setMoveTarget(null);
  };
  const dropInto = (event: React.DragEvent, parentId: string | null) => {
    event.preventDefault(); event.stopPropagation();
    if (drag && dropTargets.has(parentId)) {
      try { moveItem(drag.target, parentId, drag.projectId); } catch (error) { setMoveError(error instanceof Error ? td(error.message) : tr('移动失败', 'Move failed')); }
    }
    setDrag(null); setDropHover(null);
  };
  const undoMove = () => {
    if (!lastMove || !sameLayout(currentLayout(), lastMove.after) || useProtoStore.getState().currentProjectMeta.projectId !== currentProjectMeta.projectId) return;
    usePageStore.setState(lastMove.before); expandDirectory(lastMove.parentId); setLastMove(null);
  };
  const showPageForm = (folderId: string) => {
    setNewPageFolderId(folderId); setNewPageError('');
    const activeDocSource = activePageId ? pageSources[activePageId] : undefined;
    const activePageObj = designerPages.find((p) => p.pageId === activePageId);
    const defaultPlatform: PagePlatform =
      currentProjectMeta.projectMode === 'mobile' ||
      resolvePagePlatform(activePageObj, activeDocSource) === 'mobile'
        ? 'mobile'
        : 'desktop';
    setNewPagePlatform(defaultPlatform);
    if (defaultPlatform === 'mobile') {
      setNewPageTemplate('mobile_explore');
      if (dbTables.length && !dbTables.some((table) => table.id === newPageTableId)) setNewPageTableId(dbTables[0].id);
    } else if (!dbTables.length) {
      setNewPageTemplate('blank'); setNewPageTableId('');
    } else {
      setNewPageTemplate('list');
      if (!dbTables.some(table => table.id === newPageTableId)) setNewPageTableId(dbTables[0].id);
    }
    setShowNewPageModal(true);
  };
  const openNewPage = (folderId?: string) => {
    if (folderId !== undefined) {
      if (!folders.some(folder => !folder.deprecated && folder.id === folderId)) { setMoveError(tr('所选目录已不存在或已归档', 'Selected folder no longer exists or is archived')); return; }
      showPageForm(folderId); return;
    }
    const available = folders.filter(folder => !folder.deprecated);
    if (!available.length) { setFolderDraft({ parentId: null, forNewPage: true }); return; }
    // The global New Page button opens a picker; keep its previous selection
    // when available, otherwise show the first selectable directory.
    showPageForm((available.find(folder => folder.id === newPageFolderId) ?? available[0]).id);
  };

  const handleCreateDesignerPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPageTitle.trim() || creatingPage) return;
    setCreatingPage(true); setNewPageError('');
    try {
      if (newPageFolderId === null) throw new Error(tr('请先选择页面所属目录', 'Please select a parent folder for this page'));
      if (newPageAiPrompt.trim()) {
        const requestedPage = { pageId: newId('page'), platform: newPagePlatform };
        const request = tr(
          `新建${newPagePlatform === 'mobile' ? '移动端 (MobilePage)' : 'PC管理端'}页面，标题：${newPageTitle.trim()}，页面 ID：${requestedPage.pageId}，目录 ID：${newPageFolderId}，模板：${newPageTemplate}。${newPageTemplate !== 'blank' && newPageTableId ? `数据表 ID：${newPageTableId}。` : ''}用户需求：${newPageAiPrompt.trim()}`,
          `Create a new ${newPagePlatform === 'mobile' ? 'Mobile (MobilePage)' : 'Desktop Admin'} page — Title: ${newPageTitle.trim()}, Page ID: ${requestedPage.pageId}, Folder ID: ${newPageFolderId}, Template: ${newPageTemplate}.${newPageTemplate !== 'blank' && newPageTableId ? ` Table ID: ${newPageTableId}.` : ''} Requirements: ${newPageAiPrompt.trim()}`
        );
        if (activePageId === '') {
          if (hermesStatus !== 'running') throw new Error(tr('请先连接 Hermes，再通过项目 AI 创建页面', 'Connect Hermes first before creating pages with Project AI'));
          setViewMode('project_ai');
          await discussProject(currentProjectMeta.projectId, request, [], [], {folderId:newPageFolderId}, requestedPage);
          setShowNewPageModal(false);
          return;
        }
        await runProjectAi(request, { requestedPage });
      } else {
        const pageId = newId('page');
        const source = createPageFromTemplate({pageId,title:newPageTitle.trim(),template:newPageTemplate,tableId:newPageTableId,dbTables,platform:newPagePlatform});
        createDesignerPage({pageId,title:newPageTitle.trim(),folderId:newPageFolderId,platform:newPagePlatform},source);
        setActivePage(pageId); setViewMode('single_page');
      }
      expandDirectory(newPageFolderId);
      setNewPageTitle(''); setNewPageAiPrompt(''); setShowNewPageModal(false);
    } catch (error) { setNewPageError(error instanceof Error ? td(error.message) : tr('创建页面失败', 'Failed to create page')); }
    finally { setCreatingPage(false); }
  };

  const handleCreateGlobalTable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTableName.trim() || !newCnName.trim() || !newDomain.trim()) return;
    createNewTable(newTableName.trim(), newCnName.trim(), newDomain.trim());
    setNewTableName('');
    setNewCnName('');
    setShowNewTableModal(false);
    setViewMode('db_designer');
  };

  // Render Page Sitemap Node (Tab 1)
  const renderPageNode = (item: SitemapItem, depth = 0) => {
    if (item.deprecated && !showDeprecatedNodes) return null;

    if (
      searchQuery.trim() &&
      item.type !== 'folder' &&
      !item.title.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return null;
    }

    const isFolder = item.type === 'folder';
    const target: SitemapMoveTarget | null = item.deprecated ? null : isFolder ? { kind: 'folder', id: item.id } : item.type === 'page' && item.pageId ? { kind: 'page', id: item.pageId } : null;
    const linkRef: MindmapPageRef | null = isFolder ? { kind: 'folder', folderId: item.id } : item.type === 'page' && item.pageId !== undefined ? { kind: 'page', pageId: item.pageId } : null;
    const mapCount = linkRef === null ? 0 : mindmapLinks.filter(link => pageRefKey(link.page) === pageRefKey(linkRef)).length;
    const noteCount = linkRef === null ? 0 : noteLinks.filter(link => pageRefKey(link.page) === pageRefKey(linkRef)).length;
    const canDrop = isFolder && dropTargets.has(item.id);
    const isExpanded = expandedFolders[item.id] ?? true;
    const isActive = item.pageId && item.pageId === activePageId && viewMode === 'single_page';
    const pulseBadge = item.pageId ? menuPulseBadges[item.pageId] : undefined;
    const activateItem = () => {
      if (isFolder) toggleFolder(item.id);
      else if (item.pageId) { setActivePage(item.pageId); setViewMode('single_page'); }
    };

    const boundTablesCount = item.pageId
      ? dbTables.filter((t) => t.sharedByMenus.some((m) => m.pageId === item.pageId)).length
      : 0;
    const isMobilePageItem =
      item.type === 'page' &&
      item.pageId !== undefined &&
      resolvePagePlatform(
        designerPages.find((p) => p.pageId === item.pageId),
        pageSources[item.pageId],
      ) === 'mobile';

    const hoverReserveClass = isFolder
      ? !item.deprecated
        ? 'group-hover:pr-[132px] group-focus-within:pr-[132px]'
        : 'group-hover:pr-[92px] group-focus-within:pr-[92px]'
      : 'group-hover:pr-[92px] group-focus-within:pr-[92px]';
    const hasLinkedDocs = noteCount > 0 || mapCount > 0;

    return (
      <div key={item.id} className="select-none">
        <div
          data-sitemap-id={item.id}
          onClick={event => {
            // Buttons already handle navigation or their own action. The remaining
            // row area (padding, indentation and badges) is also a navigation target.
            if (!(event.target as Element).closest('button')) activateItem();
          }}
          onDragEnter={event => {
            if (!canDrop) return;
            event.preventDefault(); event.stopPropagation(); setDropHover({ id: item.id });
          }}
          onDragOver={event => {
            if (!canDrop) return;
            event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
            setDropHover({ id: item.id });
          }}
          onDragLeave={() => setDropHover(current => current?.id === item.id ? null : current)}
          onDrop={event => dropInto(event, item.id)}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          className={`group relative flex items-center pr-2 py-1.5 text-xs cursor-pointer transition border-l-2 ${
            dropHover?.id === item.id && canDrop
              ? 'bg-blue-100 text-blue-800 border-blue-500 ring-1 ring-inset ring-blue-300'
              : isActive
              ? 'bg-blue-50/80 text-blue-700 border-blue-600 font-semibold'
              : item.deprecated
              ? 'text-slate-400 line-through border-transparent hover:bg-slate-50'
              : 'text-slate-700 border-transparent hover:bg-slate-100/80 hover:text-slate-900'
          }`}
        >
          <button
            type="button"
            draggable={target !== null}
            onDragStart={event => {
              if (!target) return;
              event.dataTransfer.setData('application/protoflow-sitemap', JSON.stringify({ target, projectId: currentProjectMeta.projectId }));
              event.dataTransfer.effectAllowed = 'move'; setDrag({ target, projectId: currentProjectMeta.projectId }); setMoveError('');
            }}
            onDragEnd={() => { setDrag(null); setDropHover(null); }}
            aria-expanded={isFolder ? isExpanded : undefined}
            aria-current={isActive ? 'page' : undefined}
            onClick={activateItem}
            className={`pf-sitemap-row-btn flex flex-1 items-center gap-1.5 min-w-0 text-left ${hoverReserveClass}`}
          >
            {isFolder ? (
              <>
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                {isExpanded ? (
                  <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />
                )}
              </>
            ) : item.type === 'doc' ? (
              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
            ) : isMobilePageItem ? (
              <Smartphone
                className={`w-3.5 h-3.5 shrink-0 ml-1 ${
                  isActive ? 'text-violet-600' : 'text-violet-500/80'
                }`}
              />
            ) : (
              <LayoutGrid
                className={`w-3.5 h-3.5 shrink-0 ml-1 ${
                  isActive ? 'text-blue-600' : 'text-slate-400'
                }`}
              />
            )}
            <span ref={bindSitemapLabelRef} className="pf-sitemap-label">
              <span>{item.title}</span>
            </span>
            {isMobilePageItem && (
              <span className="px-1 py-0.2 rounded text-[9px] font-semibold bg-violet-100 text-violet-700 shrink-0">
                {tr('移动', 'Mobile')}
              </span>
            )}
          </button>

          {/* Zero-width anchor so row management actions take 0px when idle and reveal cleanly to the left of status pills on hover / focus-within */}
          <div className="relative shrink-0 h-5 w-0">
            <div className="pf-sitemap-actions absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity">
              {linkRef && (
                <button
                  type="button"
                  aria-label={tr(`关联笔记：${item.title}`, `Link notes: ${item.title}`)}
                  title={noteCount ? tr(`已关联 ${noteCount} 篇笔记，点击管理或打开`, `${noteCount} linked note(s) — click to manage or open`) : tr('关联项目笔记或客户需求', 'Link project notes or requirements')}
                  onClick={() => setNoteLinkPage(linkRef)}
                  className={`flex items-center gap-0.5 rounded p-[3px] ${noteCount ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:bg-slate-200/70 hover:text-blue-600'}`}
                >
                  <BookOpenText size={12} />
                  {noteCount > 0 && <span className="text-[10px] tabular-nums leading-none">{noteCount}</span>}
                </button>
              )}
              {linkRef && (
                <button
                  type="button"
                  aria-label={tr(`关联脑图：${item.title}`, `Link mindmaps: ${item.title}`)}
                  title={mapCount ? tr(`已关联 ${mapCount} 个脑图节点，点击管理或打开`, `${mapCount} linked mindmap node(s) — click to manage or open`) : tr('关联脑图目录或菜单', 'Link mindmap folder or map')}
                  onClick={() => setMindmapLinkPage(linkRef)}
                  className={`flex items-center gap-0.5 rounded p-[3px] ${mapCount ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:bg-slate-200/70 hover:text-blue-600'}`}
                >
                  <Network size={12} />
                  {mapCount > 0 && <span className="text-[10px] tabular-nums leading-none">{mapCount}</span>}
                </button>
              )}
              {isFolder && !item.deprecated && (
                <>
                  <button
                    type="button"
                    aria-label={tr(`在${item.title}中新建页面`, `New page in ${item.title}`)}
                    title={tr('在此目录新建页面', 'New page in this folder')}
                    onClick={() => openNewPage(item.id)}
                    className="rounded p-[3px] text-slate-400 hover:bg-blue-100 hover:text-blue-600"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label={tr(`在${item.title}中新建子目录`, `New subfolder in ${item.title}`)}
                    title={tr('新建子目录', 'New subfolder')}
                    onClick={() => setFolderDraft({ parentId: item.id })}
                    className="rounded p-[3px] text-slate-400 hover:bg-amber-100 hover:text-amber-600"
                  >
                    <FolderPlus size={12} />
                  </button>
                </>
              )}
              {target && (
                <button
                  type="button"
                  aria-label={tr(`移动${item.title}`, `Move ${item.title}`)}
                  title={tr('移动到其他目录', 'Move to another folder')}
                  onClick={() => { setMoveTarget(target); setMoveError(''); }}
                  className="rounded p-[3px] text-slate-400 hover:bg-blue-100 hover:text-blue-600"
                >
                  <FolderInput size={12} />
                </button>
              )}
              <button
                type="button"
                aria-label={tr(`删除${item.title}`, `Delete ${item.title}`)}
                title={isFolder ? tr('删除目录及其内容', 'Delete folder and its contents') : tr('删除菜单', 'Delete menu item')}
                onClick={() => {
                  try { setDeleteTarget(prepareMenuDeletion(captureProjectPayload(), item.id)); setMoveError(''); }
                  catch (e) { setMoveError(e instanceof Error ? td(e.message) : tr('无法删除菜单', 'Unable to delete menu item')); }
                }}
                className="rounded p-[3px] text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {(hasLinkedDocs || (pulseBadge && pulseBadge > 0) || boundTablesCount > 0) && (
            <div className="flex items-center gap-1 shrink-0 ml-1">
              {hasLinkedDocs && (
                <span
                  aria-hidden="true"
                  title={tr(`已关联 ${noteCount} 篇笔记 · ${mapCount} 个脑图节点`, `${noteCount} note(s) · ${mapCount} mindmap(s)`)}
                  className="w-1.5 h-1.5 rounded-full bg-blue-500/75 shrink-0 group-hover:opacity-0 group-focus-within:opacity-0 transition-opacity"
                />
              )}
              {pulseBadge && pulseBadge > 0 && (
                <span
                  className="px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-blue-600 text-white tabular-nums"
                  title={tr('共表数据发生了更新', 'Shared table data updated')}
                >
                  +{pulseBadge}
                </span>
              )}
              {boundTablesCount > 0 && (
                <span
                  className={`px-1 py-0.2 rounded text-[10px] font-mono tabular-nums border ${
                    isActive
                      ? 'bg-blue-100/80 text-blue-700 border-blue-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                  title={tr(`该菜单已关联 ${boundTablesCount} 张数据库表`, `Linked to ${boundTablesCount} database table(s)`)}
                >
                  {tr(`${boundTablesCount}表`, `${boundTablesCount}T`)}
                </span>
              )}
            </div>
          )}
        </div>

        {isFolder && isExpanded && item.children && (
          <div className="mt-0.5">
            {item.children.map((child) => renderPageNode(child, depth + 1))}
            {item.children.length === 0 && <p style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }} className="py-1.5 text-[11px] text-slate-400">{tr('暂无页面，可点击 + 添加', 'No pages yet — click + to add')}</p>}
          </div>
        )}
      </div>
    );
  };

  const domains = [...new Set(dbTables.map(t => t.domain))];

  return (
    <aside
      style={{ width: `${sidebarWidth}px`, maxWidth: '45vw' }}
      className="relative shrink-0 border-r border-slate-200 bg-white flex flex-col h-full select-none"
    >
      {/* Compact VS Code-style Panel Header + Search */}
      <div className="px-2.5 py-2 border-b border-slate-200 bg-slate-50/60 space-y-1.5">
        <div className="flex items-center justify-between gap-2 min-h-[26px]">
          <div className="flex items-center gap-1.5 min-w-0">
            {leftSidebarTab === 'pages' ? (
              <>
                <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-xs font-semibold text-slate-800 truncate">{tr('页面目录', 'Pages')}</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-600 text-[10px] font-mono tabular-nums shrink-0">
                  {Object.keys(pageSources).length}
                </span>
              </>
            ) : (
              <>
                <Database className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-xs font-semibold text-slate-800 truncate">{tr('数据库表', 'Tables')}</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-600 text-[10px] font-mono tabular-nums shrink-0">
                  {dbTables.length}
                </span>
              </>
            )}
          </div>

          {leftSidebarTab === 'pages' ? (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setFolderDraft({ parentId: null })}
                className="flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer transition shadow-2xs whitespace-nowrap"
              >
                <FolderPlus size={12} className="text-slate-500" />{tr('新建目录', 'New Folder')}
              </button>
              <button
                type="button"
                onClick={() => openNewPage()}
                className="flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 cursor-pointer transition shadow-2xs whitespace-nowrap"
              >
                <Plus size={12} />{tr('新建页', 'New Page')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewTableModal(true)}
              className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer shrink-0 shadow-2xs transition whitespace-nowrap"
              title={tr('新建物理表', 'New Database Table')}
            >
              <Plus className="w-3 h-3" />
              <span>{tr('新建表', 'New Table')}</span>
            </button>
          )}
        </div>

        {/* Search Input + Secondary Filter */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label={leftSidebarTab === 'pages' ? tr('搜索页面菜单', 'Search pages') : tr('搜索表名或注释', 'Search tables or comments')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                leftSidebarTab === 'pages' ? tr('搜索页面菜单...', 'Search pages...') : tr('搜索表名或注释...', 'Search tables or comments...')
              }
              className="w-full pl-8 pr-2.5 py-1 text-xs rounded-lg bg-white border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
          </div>

          {leftSidebarTab === 'pages' && (
            <button
              type="button"
              onClick={() => setShowDeprecatedNodes(!showDeprecatedNodes)}
              className="p-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 text-[10px] flex items-center gap-1 cursor-pointer shrink-0"
              aria-label={showDeprecatedNodes ? tr('隐藏作废节点', 'Hide deprecated items') : tr('显示作废节点', 'Show deprecated items')}
              title={showDeprecatedNodes ? tr('隐藏作废节点', 'Hide deprecated items') : tr('显示作废节点', 'Show deprecated items')}
            >
              {showDeprecatedNodes ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {leftSidebarTab === 'pages' && <div className="flex shrink-0 items-center border-b border-slate-100 px-2 py-1.5 text-[10px] leading-4 text-slate-500">
        {drag?.target.kind === 'folder' && dropTargets.has(null)
          ? <div data-sitemap-root-drop onDragEnter={event => { event.preventDefault(); setDropHover({ id: null }); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropHover({ id: null }); }} onDragLeave={() => setDropHover(null)} onDrop={event => dropInto(event, null)} className={`w-full rounded-md border border-dashed py-1.5 text-center text-xs ${dropHover?.id === null ? 'border-blue-500 bg-blue-100 text-blue-800' : 'border-blue-300 bg-blue-50 text-blue-600'}`}>{tr('拖到这里移至顶层', 'Drop here to move to top level')}</div>
          : <span className="px-1 truncate">{tr('拖入目录调整层级 · 悬停行显示操作 · 右侧边线可拉宽', 'Drag to reorder · Hover row for actions · Drag edge to resize')}</span>}
      </div>}
      {leftSidebarTab === 'pages' && lastMove && sameLayout(layout, lastMove.after) && <div role="status" className="flex items-start gap-2 border-b border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-800"><span className="min-w-0 flex-1 break-words">{lastMove.message}</span><button type="button" onClick={undoMove} className="flex shrink-0 items-center gap-0.5 text-blue-600 hover:underline"><Undo2 size={12} />{tr('撤销', 'Undo')}</button></div>}
      {moveError && <p role="alert" className="px-3 py-2 text-xs text-rose-600">{moveError}</p>}
      {lastDelete?.canUndo() && <div role="status" className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"><span>{tr('菜单内容已删除', 'Menu item deleted')}</span><button type="button" onClick={() => {
        try { lastDelete.undo(); setLastDelete(null); } catch (e) { setMoveError(e instanceof Error ? td(e.message) : tr('无法撤销', 'Unable to undo')); }
      }} className="flex items-center gap-1 font-medium"><Undo2 size={12} />{tr('撤销删除', 'Undo Delete')}</button></div>}
      {/* TAB 1 CONTENT: MODULE PAGES SITEMAP TREE */}
      {leftSidebarTab === 'pages' && (
        <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5">
          {sitemap.map((node) => renderPageNode(node, 0))}
        </div>
      )}

      {/* TAB 2 CONTENT: PROJECT DATABASE SCHEMA DIRECTORY TREE */}
      {leftSidebarTab === 'tables' && (
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
          {domains.map((domain) => {
            const domainTables = dbTables.filter(
              (t) =>
                t.domain === domain &&
                (!searchQuery.trim() ||
                  t.tableName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  t.cnName.toLowerCase().includes(searchQuery.toLowerCase()))
            );

            if (domainTables.length === 0) return null;
            return (
              <div key={domain} className="space-y-1.5">
                <div className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                    {domain}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">{domainTables.length}</span>
                </div>

                <div className="space-y-1.5">
                  {domainTables.map((tbl) => {
                    const isSelected =
                      tbl.id === selectedTableId && viewMode === 'db_designer';
                    return (
                      <div
                        key={tbl.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/protoflow-table-id', tbl.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => {
                          setSelectedTableId(tbl.id);
                          setViewMode('db_designer');
                        }}
                        className={`p-2 rounded-lg border transition cursor-grab active:cursor-grabbing space-y-1 ${
                          isSelected
                            ? 'bg-blue-50/70 border-blue-500 ring-1 ring-blue-500/20 shadow-2xs'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                        }`}
                        title={tr(`${tbl.tableName} · 点击选中定位，或拖拽到画布指定位置`, `${tbl.tableName} · Click to locate, or drag onto canvas`)}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Table2
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isSelected ? 'text-blue-600' : 'text-slate-500'
                              }`}
                            />
                            <span
                              className={`font-mono font-semibold text-xs truncate ${
                                isSelected ? 'text-blue-700' : 'text-slate-900'
                              }`}
                            >
                              {tbl.tableName}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                            {tr(`${tbl.columns.length}字段`, `${tbl.columns.length} cols`)}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-600 truncate pl-5">
                          {tbl.cnName}
                        </div>

                        {/* Shared By Menus quick pills */}
                        <div className="pl-5 pt-0.5 flex items-center gap-1 flex-wrap">
                          <span className="text-[10px] tabular-nums px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                            {tr(`${tbl.sharedByMenus.length} 处菜单引用`, `${tbl.sharedByMenus.length} menu refs`)}
                          </span>
                          {tbl.sharedByMenus.slice(0, 2).map((m, idx) => (
                            <button
                              key={`${m.pageId}-${idx}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActivePage(m.pageId);
                                setViewMode('single_page');
                              }}
                              className="text-[10px] px-1.5 py-0.2 rounded bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 transition cursor-pointer truncate max-w-[160px]"
                              title={tr(`点击跳转到关联页面：${m.menuTitle}`, `Jump to linked page: ${m.menuTitle}`)}
                            >
                              {m.menuTitle.split('→')[1]?.trim() || m.menuTitle}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="p-2.5 border-t border-slate-200 bg-slate-50/70 text-[11px]">
        {leftSidebarTab === 'pages' ? (
          <button
            type="button"
            onClick={() => openNewPage()}
            className="w-full py-1.5 px-3 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs transition"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">{tr('新建模块页面 (模板 / AI生成)', 'New Page (Template / AI)')}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowNewTableModal(true)}
            className="w-full py-1.5 px-3 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs transition"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">{tr('新建全局物理表', 'New Database Table')}</span>
          </button>
        )}
      </div>

      {moveTarget && <MoveSitemapModal layout={layout} target={moveTarget} onClose={() => setMoveTarget(null)} onMove={parentId => moveItem(moveTarget, parentId)} />}
      {mindmapLinkPage && <MindmapLinksModal projectId={currentProjectMeta.projectId} page={mindmapLinkPage} onClose={() => setMindmapLinkPage(null)} />}
      {noteLinkPage && <NoteLinksModal projectId={currentProjectMeta.projectId} page={noteLinkPage} onClose={() => setNoteLinkPage(null)} />}
      {deleteTarget && <DeleteConfirmation title={deleteTarget.kind === 'folder' ? tr('删除目录', 'Delete Folder') : tr('删除菜单', 'Delete Menu Item')} onClose={() => setDeleteTarget(null)} onConfirm={() => {
        setLastDelete(deleteMenu(deleteTarget)); setLastMove(null);
      }}>
        <p>{tr('确认删除 ', 'Delete ')}<strong className="text-slate-900">{deleteTarget.title}</strong>{tr('？', '?')}</p>
        {deleteTarget.kind === 'folder' && <p>{tr(`将同时删除其中的 ${deleteTarget.pageCount} 个页面 / 文档，以及 ${Math.max(0, deleteTarget.folderCount - 1)} 个子目录。`, `This will also delete ${deleteTarget.pageCount} page(s)/doc(s) and ${Math.max(0, deleteTarget.folderCount - 1)} subfolder(s) inside.`)}</p>}
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs">{tr(`同时清理 ${deleteTarget.stickyCount} 条便签、${deleteTarget.bindingCount} 项菜单数据表关联，以及 ${deleteTarget.linkCount} 处页面跳转。相关脑图关联也会清理，脑图内容、共用数据表及表内数据会保留。`, `Also removes ${deleteTarget.stickyCount} spec pin(s), ${deleteTarget.bindingCount} table binding(s), and ${deleteTarget.linkCount} page link(s). Mindmap links are cleaned up while mindmap content, shared tables, and table rows are preserved.`)}</p>
        <p className="text-xs text-slate-500">{tr('删除后可立即撤销。保存项目后，删除结果会写入本地工程；已发布版本需重新发布才会更新。', 'You can undo immediately after deleting. Changes persist once saved; published shares update on next republish.')}</p>
      </DeleteConfirmation>}
      {folderDraft && <NewFolderModal folders={folders} initialParentId={folderDraft.parentId} onClose={() => setFolderDraft(null)} onCreate={(title, parentId) => {
        const folder = createDesignerFolder(title, parentId);
        expandDirectory(folder.id); setNewPageFolderId(folder.id); setFolderDraft(null);
        if (folderDraft.forNewPage) showPageForm(folder.id);
      }} />}

      {/* Modal: Create New Prototype Page */}
      {showNewPageModal && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div role="dialog" aria-modal="true" aria-label={tr('新建页面', 'New Page')} className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-semibold text-slate-900">
                  {tr('新建页面', 'New Page')}
                </span>
              </div>
              <button
                type="button"
                disabled={creatingPage}
                aria-label={tr('关闭新建页面', 'Close new page dialog')}
                onClick={() => setShowNewPageModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDesignerPage} className="p-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {tr('所属模块菜单目录', 'Parent Folder')}
                </label>
                <select
                  aria-label={tr('所属模块菜单目录', 'Parent Folder')}
                  value={newPageFolderId === null ? '' : newPageFolderId}
                  onChange={(e) => setNewPageFolderId(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-600"
                >
                  {folders.filter(folder => !folder.deprecated).map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {tr('页面终端形态 (不同终端自动隔离物料库与画布视口)', 'Target Platform (isolates component palette and viewport)')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNewPagePlatform('desktop');
                      setNewPageTemplate(dbTables.length ? 'list' : 'blank');
                    }}
                    className={`px-3 py-2 rounded-lg border text-left flex items-center gap-2 cursor-pointer transition min-w-0 ${
                      newPagePlatform === 'desktop'
                        ? 'bg-blue-50/80 border-blue-600 text-blue-800 font-semibold'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Monitor className="w-4 h-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate">{tr('PC 管理端页面', 'Desktop Page')}</div>
                      <div className="text-[10px] font-normal opacity-75 truncate">{tr('宽屏栅格 · 查询与表格', 'Widescreen · Filters & Tables')}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewPagePlatform('mobile');
                      setNewPageTemplate('mobile_explore');
                    }}
                    className={`px-3 py-2 rounded-lg border text-left flex items-center gap-2 cursor-pointer transition min-w-0 ${
                      newPagePlatform === 'mobile'
                        ? 'bg-violet-50/80 border-violet-600 text-violet-800 font-semibold'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Smartphone className="w-4 h-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate">{tr('移动端页面', 'Mobile Page')}</div>
                      <div className="text-[10px] font-normal opacity-75 truncate">{tr('Gemini 现代风 · iPhone 视口', 'Modern UI · iPhone Viewport')}</div>
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {tr('页面菜单名称', 'Page Title')}
                </label>
                <input
                  aria-label={tr('页面菜单名称', 'Page Title')}
                  type="text"
                  required
                  value={newPageTitle}
                  onChange={(e) => setNewPageTitle(e.target.value)}
                  placeholder={newPagePlatform === 'mobile' ? tr('例如：商品探索首页 / 移动采购审批', 'e.g., Product Explore / Mobile Approval') : tr('例如：采购退货单管理 / 供应商绩效考评', 'e.g., Purchase Returns / Supplier Review')}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {tr('选择页面交互模板', 'Page Template')}
                </label>
                <select
                  aria-label={tr('页面交互模板', 'Page Template')}
                  value={newPageTemplate}
                  onChange={(e) => setNewPageTemplate(e.target.value as PageTemplateKind)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-600"
                >
                  {(newPagePlatform === 'mobile' ? MOBILE_PAGE_TEMPLATES : PAGE_TEMPLATES).map((tpl) => {
                    const tplAny = tpl as { kind: string; title: string; description: string; titleEn?: string; descriptionEn?: string };
                    const tplTitle = isEn ? (tplAny.titleEn || TEMPLATE_EN_FALLBACK[tpl.kind]?.title || td(tpl.title)) : tpl.title;
                    const tplDesc = isEn ? (tplAny.descriptionEn || TEMPLATE_EN_FALLBACK[tpl.kind]?.description || td(tpl.description)) : tpl.description;
                    return (
                      <option key={tpl.kind} value={tpl.kind}>
                        {tplTitle} — {tplDesc}
                      </option>
                    );
                  })}
                </select>
              </div>

              {newPageTemplate !== 'blank' && dbTables.length > 0 && (
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    {tr('绑定驱动物理表 (自动生成查询条件、表格列与弹框表单)', 'Bound Database Table (auto-generates filters, columns & modal form)')}
                  </label>
                  <select
                    aria-label={tr('页面数据表', 'Page Database Table')}
                    value={newPageTableId}
                    onChange={(e) => setNewPageTableId(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 font-mono focus:outline-none focus:border-blue-600"
                  >
                    {dbTables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tableName} ({t.cnName})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-slate-700 font-medium min-w-0 truncate">
                    {tr('附加 AI 定制指令 (可选 · 自动拼装业务块或弹层)', 'Custom AI Prompt (optional · assembles blocks or modals)')}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewPageModal(false);
                      setHermesModalOpen(true, 'overview');
                    }}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border cursor-pointer flex items-center gap-1 shrink-0 whitespace-nowrap ${
                      hermesStatus === 'running'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    <Bot className="w-3 h-3" />
                    <span>
                      {hermesStatus === 'running'
                        ? tr(`Hermes ${hermesVer} 已接管`, `Hermes ${hermesVer} Ready`)
                        : tr('连接 Hermes 后启用 AI', 'Connect Hermes for AI')}
                    </span>
                  </button>
                </div>
                <input
                  type="text"
                  value={newPageAiPrompt}
                  onChange={(e) => setNewPageAiPrompt(e.target.value)}
                  placeholder={tr('如：插入单据标准三栏表头，或增加Excel批量导入弹框与异常抽屉...', 'e.g., Add a 3-column order header, or include an Excel import modal...')}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-600"
                />
              </div>

              {newPageError && <p role="alert" className="text-xs text-rose-600">{newPageError}</p>}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={creatingPage}
                  onClick={() => setShowNewPageModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {tr('取消', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creatingPage}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer"
                >
                  {creatingPage ? tr('正在创建…', 'Creating…') : tr('创建并打开页面', 'Create & Open Page')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Global Table from Left Sidebar */}
      {showNewTableModal && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div role="dialog" aria-modal="true" aria-label={tr('新建全局数据库物理表', 'New Global Database Table')} className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-semibold text-slate-900">
                  {tr('新建全局数据库物理表', 'New Global Database Table')}
                </span>
              </div>
              <button
                type="button"
                aria-label={tr('关闭新建物理表窗口', 'Close new table dialog')}
                onClick={() => setShowNewTableModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGlobalTable} className="p-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {tr('所属业务域 (Domain)', 'Business Domain')}
                </label>
                <input aria-label={tr('所属业务域', 'Business Domain')} list="table-domains-global" required maxLength={80} value={newDomain}
                  onChange={e => setNewDomain(e.target.value)} placeholder={tr('选择现有业务域或输入名称', 'Choose an existing domain or enter a name')}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-600" />
                <datalist id="table-domains-global">{domains.map(domain => <option key={domain} value={domain} />)}</datalist>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {tr('物理表名 (英文)', 'Physical Table Name')}
                </label>
                <input
                  aria-label={tr('物理表名 (英文)', 'Physical Table Name')}
                  type="text"
                  required
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder={tr('例如：t_base_warehouse', 'e.g., t_base_warehouse')}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 font-mono focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {tr('表中文注释', 'Table Display Name / Comment')}
                </label>
                <input
                  aria-label={tr('表中文注释', 'Table Display Name / Comment')}
                  type="text"
                  required
                  value={newCnName}
                  onChange={(e) => setNewCnName(e.target.value)}
                  placeholder={tr('例如：电商云仓主数据表', 'e.g., Cloud Warehouse Master')}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewTableModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {tr('取消', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer"
                >
                  {tr('创建并打开表设计器', 'Create & Open Schema Designer')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Right-edge resize sash: drag to widen/narrow for long menu names, double-click or Enter to reset */}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={tr('拖拽调整页面目录宽度', 'Resize sitemap sidebar')}
        aria-valuenow={sidebarWidth}
        aria-valuemin={MIN_SITEMAP_WIDTH}
        aria-valuemax={MAX_SITEMAP_WIDTH}
        title={tr('拖拽调整目录宽度（双击恢复默认宽度）', 'Drag to resize (double-click to reset)')}
        onPointerDown={(event) => {
          event.preventDefault();
          resizeDragRef.current = { startX: event.clientX, startWidth: sidebarWidth };
          setIsResizingSidebar(true);
        }}
        onDoubleClick={() => applySidebarWidth(DEFAULT_SITEMAP_WIDTH)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            applySidebarWidth(sidebarWidth + 16);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            applySidebarWidth(sidebarWidth - 16);
          } else if (event.key === 'Home') {
            event.preventDefault();
            applySidebarWidth(MIN_SITEMAP_WIDTH);
          } else if (event.key === 'End') {
            event.preventDefault();
            applySidebarWidth(MAX_SITEMAP_WIDTH);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            applySidebarWidth(DEFAULT_SITEMAP_WIDTH);
          }
        }}
        className={`absolute top-0 -right-1 bottom-0 w-2 z-20 cursor-col-resize focus:outline-none group/sash ${
          isResizingSidebar ? 'bg-blue-500/35' : 'hover:bg-blue-500/20 focus-visible:bg-blue-500/30'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] transition-opacity ${
            isResizingSidebar
              ? 'bg-blue-600 opacity-100'
              : 'bg-blue-500 opacity-0 group-hover/sash:opacity-100 group-focus-visible/sash:opacity-100'
          }`}
        />
      </div>
    </aside>
  );
};
