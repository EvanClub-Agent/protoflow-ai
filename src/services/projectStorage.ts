import { emptyMindmaps } from '../proto/mindmaps';
import { emptyProjectNotes, migrateInlineNoteImages, pruneStaleNoteLinks, pruneUnusedNoteAssets } from '../proto/notes';
import { legacyBlankSitemap } from './legacyProjectSitemap';
import { migrateLegacyZeroStickyIndexes } from '../proto/stickyNoteIndex';
import { emptySitemapOverrides } from '../proto/sitemap';
import { SITEMAP_TREE, useProtoStore } from '../store/useProtoStore';
import { initialPages, usePageStore, type DesignerPage } from '../proto/store/usePageStore';
import { generateBlankPageSource } from '../proto/ai/templates';
import { createMobileStarterDataset } from '../proto/mobile/starter';
import { createCrmStarterDataset } from '../proto/starter/crmStarter';
import { decodePflowBinary, type PflowBinaryPayload, type PflowProjectMetadata, type ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import { object, validateProjectMeta, validateProjectPayload } from './projectValidation';
import { ProjectAutosave, type ProjectSaveBridge } from './projectAutosave';

const RECENT_KEY = 'protoflow_recent_projects_v2';
// Browser file inputs cannot reopen an arbitrary disk path. Keep the exact opened/saved
// snapshot for this session; after reload the user must select the file again.
const browserFiles = new Map<string, PflowBinaryPayload>();
let autosave: ProjectAutosave | null = null;
let applyingSnapshot = false;

interface PersistenceBridge extends ProjectSaveBridge {
  isElectron: boolean;
  readBinaryProject(input: { dirPath: string; fileName: string }): Promise<{ binaryBytes: Uint8Array }>;
  writeBinaryProject: ProjectSaveBridge['saveCurrentProject'];
  onSaveBeforeClose(listener: (requestId: string) => void): () => void;
  finishSaveBeforeClose(result: { requestId: string; ok: boolean; error?: string }): void;
  persistenceReady(): void;
}

/** Started once before React mounts, so StrictMode and changing screens cannot stop saving. */
export function startProjectPersistence(delay = 500) {
  const bridge = (window as unknown as { protoflowDesktop?: Partial<PersistenceBridge> }).protoflowDesktop;
  if (!bridge?.isElectron || autosave) return () => {};
  const controller = new ProjectAutosave({
    delay, capture: captureProjectPayload,
    write: async input => {
      if (bridge.saveCurrentProject) return bridge.saveCurrentProject(input);
      // A renderer hot update can run inside the still-open older desktop process.
      // Its established read/write bridge can save the same archive until restart;
      // verify the disk identity first, and never turn a missing file into a new one.
      if (!bridge.readBinaryProject || !bridge.writeBinaryProject) throw new Error('桌面保存接口不可用，请导出 .pflow 备份后重启应用');
      const disk = normalizeProjectPayload(decodePflowBinary((await bridge.readBinaryProject(input)).binaryBytes));
      if (disk.meta.projectId !== input.projectId) throw new Error('该路径的工程 ID 已变化，未覆盖任何文件');
      return bridge.writeBinaryProject(input);
    },
    onSaved: payload => {
      useProtoStore.setState({ currentProjectMeta: payload.meta });
      remember(payload);
    },
  });
  autosave = controller;
  const protoKeys = ['projectAgreements', 'databaseRequirements', 'projectPlan', 'activePageId', 'dbTables', 'stickyNotes', 'suppliers', 'purchaseOrderItems', 'acceptanceOrders', 'closedLoopIssues', 'widgets', 'draftAcceptanceHeader', 'draftAcceptanceLines', 'mindmaps', 'projectNotes'] as const;
  const pageKeys = ['pageSources', 'designerPages', 'designerFolders', 'sitemapBase', 'sitemapOverrides', 'tableRows'] as const;
  const stopProto = useProtoStore.subscribe((next, prev) => {
    if (!applyingSnapshot && protoKeys.some(key => next[key] !== prev[key])) controller.changed();
  });
  const stopPages = usePageStore.subscribe((next, prev) => {
    if (!applyingSnapshot && pageKeys.some(key => next[key] !== prev[key])) controller.changed();
  });
  const stopClose = bridge.onSaveBeforeClose?.(requestId => {
    void controller.flush().then(
      () => bridge.finishSaveBeforeClose?.({ requestId, ok: true }),
      error => bridge.finishSaveBeforeClose?.({ requestId, ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  });
  bridge.persistenceReady?.();
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!controller.dirty) return;
    event.preventDefault(); event.returnValue = '';
    void controller.flush().catch(() => {});
  };
  const saveKey = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); void controller.flush().catch(() => {});
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('keydown', saveKey);
  return () => {
    stopProto(); stopPages(); stopClose?.(); controller.dispose();
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('keydown', saveKey);
    if (autosave === controller) autosave = null;
  };
}

export async function flushProjectChanges() { await autosave?.flush(); }
export async function prepareProjectDeletion(projectId: string) { await autosave?.beforeDelete(projectId); }
export function finishProjectDeletion(projectId: string, deleted: boolean) { autosave?.afterDelete(projectId, deleted); }

const emptyDraft = (): ProjectStateSnapshot['draftAcceptanceHeader'] => ({
  acceptanceDate: '', acceptanceNo: '', inspector: '', inboundType: '购买',
  sourceType: '采购订单转入', deliveryPerson: '', supplierId: '', supplierContact: '',
  supplierPhone: '', invoiceType: '专票', taxRate: 0, remark: '',
});

export function createProjectPayload(meta: PflowProjectMetadata): PflowBinaryPayload {
  const initial = useProtoStore.getInitialState();
  if (meta.templateId === 'mobile_starter') {
    const mobileStarter = createMobileStarterDataset();
    const isHybrid = meta.projectMode === 'hybrid';
    const desktopPages = isHybrid ? initialPages(initial.dbTables) : { sources: {}, pages: [] };
    const dbTables = isHybrid ? [...initial.dbTables, ...mobileStarter.dbTables] : mobileStarter.dbTables;
    const pageSources = { ...desktopPages.sources, ...mobileStarter.pageSources };
    const designerPages = [...desktopPages.pages, ...mobileStarter.designerPages];
    const payload: PflowBinaryPayload = {
      schemaVersion: 7,
      meta: {
        ...meta,
        projectMode: meta.projectMode ?? 'mobile',
        pageCount: Object.keys(pageSources).length,
        tableCount: dbTables.length,
        stickyCount: isHybrid ? initial.stickyNotes.length : 0,
      },
      stateSnapshot: {
        projectPlan: null,
        projectAgreements: [],
        mindmaps: emptyMindmaps(),
        activePageId: mobileStarter.entryPageId,
        dbTables,
        stickyNotes: isHybrid ? initial.stickyNotes : [],
        suppliers: isHybrid ? initial.suppliers : [],
        purchaseOrderItems: isHybrid ? initial.purchaseOrderItems : [],
        acceptanceOrders: isHybrid ? initial.acceptanceOrders : [],
        closedLoopIssues: [],
        widgets: initial.widgets,
        draftAcceptanceHeader: isHybrid ? initial.draftAcceptanceHeader : emptyDraft(),
        draftAcceptanceLines: isHybrid ? initial.draftAcceptanceLines : [],
        pageSources,
        designerPages,
        designerFolders: mobileStarter.designerFolders,
        sitemapBase: isHybrid ? SITEMAP_TREE : [],
        sitemapOverrides: emptySitemapOverrides(),
        tableRows: mobileStarter.tableRows,
      },
    };
    validateProjectPayload(payload);
    return structuredClone(payload);
  }
  if (meta.templateId === 'crm_analytics') {
    const crm = createCrmStarterDataset();
    const payload: PflowBinaryPayload = {
      schemaVersion: 7,
      meta: {
        ...meta,
        projectMode: meta.projectMode ?? 'desktop',
        pageCount: Object.keys(crm.pageSources).length,
        tableCount: crm.dbTables.length,
        stickyCount: 0,
      },
      stateSnapshot: {
        projectPlan: null,
        projectAgreements: [],
        mindmaps: emptyMindmaps(),
        activePageId: crm.entryPageId,
        dbTables: crm.dbTables,
        stickyNotes: [],
        suppliers: [],
        purchaseOrderItems: [],
        acceptanceOrders: [],
        closedLoopIssues: [],
        widgets: initial.widgets,
        draftAcceptanceHeader: emptyDraft(),
        draftAcceptanceLines: [],
        pageSources: crm.pageSources,
        designerPages: crm.designerPages,
        designerFolders: crm.designerFolders,
        sitemapBase: [],
        sitemapOverrides: emptySitemapOverrides(),
        tableRows: crm.tableRows,
      },
    };
    validateProjectPayload(payload);
    return structuredClone(payload);
  }
  const blank = meta.templateId === 'blank_project';
  const dbTables = blank ? [] : initial.dbTables;
  const pages = blank ? { sources: {}, pages: [] } : initialPages(dbTables);
  const payload: PflowBinaryPayload = {
    schemaVersion: 7,
    meta: { ...meta, pageCount: Object.keys(pages.sources).length, tableCount: dbTables.length, stickyCount: blank ? 0 : initial.stickyNotes.length },
    stateSnapshot: {
      projectPlan: null,
      projectAgreements: [],
      mindmaps: emptyMindmaps(),
      activePageId: blank ? '' : initial.activePageId, dbTables,
      stickyNotes: blank ? [] : initial.stickyNotes,
      suppliers: blank ? [] : initial.suppliers,
      purchaseOrderItems: blank ? [] : initial.purchaseOrderItems,
      acceptanceOrders: blank ? [] : initial.acceptanceOrders,
      closedLoopIssues: [],
      widgets: initial.widgets,
      draftAcceptanceHeader: blank ? emptyDraft() : initial.draftAcceptanceHeader,
      draftAcceptanceLines: blank ? [] : initial.draftAcceptanceLines,
      pageSources: pages.sources, designerPages: pages.pages, designerFolders: [], sitemapBase: blank ? [] : SITEMAP_TREE, sitemapOverrides: emptySitemapOverrides(), tableRows: {},
    },
  };
  validateProjectPayload(payload);
  return structuredClone(payload);
}

export function captureProjectPayload(): PflowBinaryPayload {
  const s = useProtoStore.getState(), p = usePageStore.getState();
  if (s.isProjectClosed) throw new Error('当前项目已关闭，请新建或打开项目');
  return structuredClone({
    schemaVersion: 7,
    meta: { ...s.currentProjectMeta, updatedAt: new Date().toISOString(), pageCount: Object.keys(p.pageSources).length, tableCount: s.dbTables.length, stickyCount: s.stickyNotes.length },
    stateSnapshot: {
      ...(s.databaseRequirements.length ? {databaseRequirements:s.databaseRequirements} : {}),
      projectPlan: s.projectPlan,
      projectAgreements: s.projectAgreements,
      mindmaps: s.mindmaps,
      ...(s.projectNotes.nodes.length || s.projectNotes.links.length ? { projectNotes: pruneUnusedNoteAssets(pruneStaleNoteLinks(s.projectNotes, p)) } : {}),
      activePageId: s.activePageId, dbTables: s.dbTables, stickyNotes: s.stickyNotes,
      suppliers: s.suppliers, purchaseOrderItems: s.purchaseOrderItems, acceptanceOrders: s.acceptanceOrders,
      closedLoopIssues: s.closedLoopIssues, widgets: s.widgets,
      draftAcceptanceHeader: s.draftAcceptanceHeader, draftAcceptanceLines: s.draftAcceptanceLines,
      pageSources: p.pageSources, designerPages: p.designerPages, designerFolders: p.designerFolders, sitemapBase: p.sitemapBase, sitemapOverrides: p.sitemapOverrides, tableRows: p.tableRows,
    },
  });
}

export function normalizeProjectPayload(input: unknown): PflowBinaryPayload {
  object(input, '工程');
  const predatesMindmaps = input.schemaVersion === undefined || [1, 2, 3, 4, 5].includes(input.schemaVersion as number);
  if (predatesMindmaps) {
    validateProjectMeta(input.meta);
    object(input.stateSnapshot, 'stateSnapshot');
    if (Object.prototype.hasOwnProperty.call(input.stateSnapshot, 'mindmapSource')) throw new Error('旧版工程包含未知的脑图字段，请检查工程版本');
  }
  if (input.schemaVersion === undefined || [1, 2, 3, 4, 5, 6].includes(input.schemaVersion as number)) {
    object(input.stateSnapshot, 'stateSnapshot');
    if ('mindmaps' in input.stateSnapshot) throw new Error('旧版工程包含未知的脑图目录字段');
  }
  let payload: unknown = input;
  const legacy = input.schemaVersion === undefined || [1, 2, 3, 4].includes(input.schemaVersion as number);
  if (legacy) {
    validateProjectMeta(input.meta);
    object(input.stateSnapshot, 'stateSnapshot');
    if (Object.prototype.hasOwnProperty.call(input.stateSnapshot, 'sitemapBase')) throw new Error('旧版工程包含未知的菜单模板字段，请检查工程版本');
  }
  if (input.schemaVersion === undefined || input.schemaVersion === 1) {
    // V1 did not serialize canvas sources, directory, preview rows, widgets or drafts.
    // Rebuild only these absent fields from this archive's tables, never the active project.
    validateProjectMeta(input.meta);
    object(input.stateSnapshot, 'stateSnapshot');
    const old = input.stateSnapshot;
    const baseline = createProjectPayload({ ...input.meta, templateId: 'blank_project' });
    const candidate = {
      schemaVersion: 7, meta: input.meta,
      stateSnapshot: { ...old, mindmaps: emptyMindmaps(), widgets: baseline.stateSnapshot.widgets, draftAcceptanceHeader: emptyDraft(), draftAcceptanceLines: [], pageSources: {} as Record<string, string>, designerPages: [] as DesignerPage[], designerFolders: [], sitemapBase: SITEMAP_TREE, sitemapOverrides: emptySitemapOverrides(), tableRows: {} },
    };
    validateProjectPayload(candidate, { allowLegacyZeroStickyIndex: true });
    const pages = initialPages(candidate.stateSnapshot.dbTables);
    if (!pages.sources[candidate.stateSnapshot.activePageId] && !candidate.stateSnapshot.activePageId.startsWith('doc-')) {
      pages.sources[candidate.stateSnapshot.activePageId] = generateBlankPageSource({ pageId: candidate.stateSnapshot.activePageId, title: '旧版工程未保存的画布' });
      pages.pages.push({ pageId: candidate.stateSnapshot.activePageId, title: '旧版工程未保存的画布', folderId: 'folder-base-data' });
    }
    candidate.stateSnapshot.pageSources = pages.sources;
    candidate.stateSnapshot.designerPages = pages.pages;
    payload = candidate;
  } else if (input.schemaVersion === 2) {
    // V2 only supported the built-in directories and had no custom folder field.
    // Upgrade the archive itself; never inherit directories from the active project.
    object(input.stateSnapshot, 'stateSnapshot');
    if (['designerFolders', 'sitemapOverrides'].some(key => Object.prototype.hasOwnProperty.call(input.stateSnapshot, key))) throw new Error('V2 工程包含未知的菜单目录字段，请检查工程版本');
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...input.stateSnapshot, mindmaps: emptyMindmaps(), designerFolders: [], sitemapBase: SITEMAP_TREE, sitemapOverrides: emptySitemapOverrides() } };
  } else if (input.schemaVersion === 3) {
    // V3 saved custom directories, but built-in menu positions were fixed.
    object(input.stateSnapshot, 'stateSnapshot');
    if (Object.prototype.hasOwnProperty.call(input.stateSnapshot, 'sitemapOverrides')) throw new Error('V3 工程包含未知的菜单位置字段，请检查工程版本');
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...input.stateSnapshot, mindmaps: emptyMindmaps(), sitemapBase: SITEMAP_TREE, sitemapOverrides: emptySitemapOverrides() } };
  } else if (input.schemaVersion === 4) {
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...input.stateSnapshot as object, mindmaps: emptyMindmaps(), sitemapBase: SITEMAP_TREE } };
  } else if (input.schemaVersion === 5) {
    // V1–V5 never stored mindmaps. Upgrade only this archive; never use the active project's source.
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...input.stateSnapshot as object, mindmaps: emptyMindmaps() } };
  }
  if (input.schemaVersion === 6) {
    object(input.stateSnapshot, 'stateSnapshot');
    const { mindmapSource, ...state } = input.stateSnapshot;
    if (typeof mindmapSource !== 'string') throw new Error('V6 mindmapSource 必须是字符串');
    // V6 had exactly one map. Preserve even whitespace/unfinished drafts verbatim.
    payload = { ...input, schemaVersion: 7, stateSnapshot: { ...state, mindmaps: {
      nodes: mindmapSource === '' ? [] : [{ id: 'mindmap-legacy', title: '项目脑图', kind: 'mindmap', parentId: null, source: mindmapSource }], links: [],
    } } };
  }
  validateProjectPayload(payload, { allowLegacyZeroStickyIndex: true });
  const normalized = structuredClone(payload);
  migrateLegacyZeroStickyIndexes(normalized.stateSnapshot.stickyNotes);
  if (legacy && normalized.meta.templateId === 'blank_project') {
    normalized.stateSnapshot.sitemapBase = legacyBlankSitemap(normalized.stateSnapshot);
    validateProjectPayload(normalized);
  }
  return normalized;
}

function remember(payload: PflowBinaryPayload) {
  browserFiles.set(payload.meta.projectId, structuredClone(payload));
  const recentProjects = [payload.meta, ...useProtoStore.getState().recentProjects.filter(p => p.projectId !== payload.meta.projectId)].slice(0, 30);
  useProtoStore.setState({ recentProjects });
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects)); } catch { /* Recent metadata is optional; project bytes are saved separately. */ }
}

export function restoreRecentProjects() {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return;
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) return;
    const valid = items.filter(item => { try { validateProjectMeta(item); return true; } catch { return false; } }) as PflowProjectMetadata[];
    useProtoStore.setState({ recentProjects: valid });
  } catch { /* A broken recent list must not prevent opening an actual file. */ }
}

export function loadProjectFromBinaryPayload(input: unknown, overrideDir?: string, overrideFile?: string) {
  const payload = normalizeProjectPayload(input);
  if (overrideDir !== undefined) payload.meta.storageDir = overrideDir;
  if (overrideFile !== undefined) payload.meta.fileName = overrideFile;
  validateProjectPayload(payload);
  autosave?.assertCanReplace();
  applySnapshot(payload);
  autosave?.opened(payload);
  remember(payload);
}

/** Menu deletion/undo edits the current file; it must not reset the saved revision. */
export function applyProjectEditPayload(input: unknown) {
  const payload = normalizeProjectPayload(input);
  const current = useProtoStore.getState().currentProjectMeta;
  if (payload.meta.projectId !== current.projectId || payload.meta.storageDir !== current.storageDir || payload.meta.fileName !== current.fileName) throw new Error('当前工程已变化，无法应用修改');
  applySnapshot(payload);
  autosave?.changed();
}

function applySnapshot(payload: PflowBinaryPayload) {
  const { pageSources, designerPages, designerFolders, sitemapBase, sitemapOverrides, tableRows, ...state } = payload.stateSnapshot;
  // Validation is complete before replacing either store. Clear transient state too.
  applyingSnapshot = true;
  try {
    usePageStore.setState({ pageSources, designerPages, designerFolders, sitemapBase, sitemapOverrides, tableRows, history: {} });
    useProtoStore.setState({
      ...state,
      navigationSource: null,
      projectAgreements: state.projectAgreements ?? [],
      databaseRequirements: state.databaseRequirements ?? [],
      projectPlan: state.projectPlan === undefined ? null : state.projectPlan,
      selectedMindmapNodeId: state.mindmaps.nodes.length ? state.mindmaps.nodes[0].id : null,
      projectNotes: state.projectNotes ? migrateInlineNoteImages(state.projectNotes) : emptyProjectNotes(),
      selectedNoteNodeId: state.projectNotes?.nodes.length ? (state.projectNotes.nodes.find(n => n.kind === 'note')?.id ?? state.projectNotes.nodes[0].id) : null,
      dockedNoteId: null,
      currentProjectMeta: payload.meta, isProjectClosed: false, isWelcomeScreenOpen: false, viewMode: 'single_page',
      ...(state.activePageId === '' ? { leftActivityView: 'pages', leftSidebarTab: 'pages', leftSidebarCollapsed: false } : {}),
      selectedTableId: state.dbTables.length ? state.dbTables[0].id : '',
      selectedWidgetId: '', activePopoverWidgetId: null, isImportModalOpen: false,
      isBundleModalOpen: false, isWebPublishModalOpen: false, isWebPlayerMode: false,
      uiState: 'normal', searchQuery: '', expandedFolders: {}, menuPulseBadges: {}, flowLogs: [],
    });
  } finally { applyingSnapshot = false; }
}

export async function readRecentProject(projectId: string): Promise<PflowBinaryPayload> {
  const meta = useProtoStore.getState().recentProjects.find(p => p.projectId === projectId);
  if (!meta) throw new Error('最近项目记录不存在，请重新选择工程文件');
  const desktop = (window as unknown as { protoflowDesktop?: { readBinaryProject?: (p: { dirPath: string; fileName: string }) => Promise<{ binaryBytes: Uint8Array }> } }).protoflowDesktop;
  let payload: PflowBinaryPayload;
  if (desktop?.readBinaryProject) {
    const result = await desktop.readBinaryProject({ dirPath: meta.storageDir, fileName: meta.fileName });
    payload = normalizeProjectPayload(decodePflowBinary(result.binaryBytes));
  } else {
    const cached = browserFiles.get(projectId);
    if (!cached) throw new Error('浏览器需要重新授权文件访问，请使用“打开本地项目”选择该工程');
    payload = structuredClone(cached);
  }
  if (payload.meta.projectId !== projectId) throw new Error('该路径的工程 ID 已变化，请重新打开文件');
  payload.meta.storageDir = meta.storageDir;
  payload.meta.fileName = meta.fileName;
  return payload;
}

export async function openRecentProject(projectId: string) {
  await flushProjectChanges();
  loadProjectFromBinaryPayload(await readRecentProject(projectId));
}

/** Remove only the specified record after the native archive deletion succeeds. */
export function forgetDeletedProject(projectId: string) {
  const state = useProtoStore.getState();
  const recentProjects = state.recentProjects.filter(project => project.projectId !== projectId);
  browserFiles.delete(projectId);
  useProtoStore.setState({ recentProjects, ...(state.currentProjectMeta.projectId === projectId ? {
    isProjectClosed: true, isWelcomeScreenOpen: true,
  } : {}) });
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects)); return ''; }
  catch { return '工程文件已移到废纸篓，但项目列表保存失败；重新启动后可能需要再次清理记录。'; }
}
