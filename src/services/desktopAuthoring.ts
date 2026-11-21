import { create } from 'zustand';
import { stringify } from 'lossless-json';
import { getLocale, tr } from '../i18n/runtime';
import { parsePageSource } from '../proto/dsl/parser';
import { MOBILE_DEVICE_SPECS } from '../proto/mobile/types';
import type { PreviewSnapshot } from '../capture/snapshot';
import { newId } from '../utils/identity';
import type { AuthoringWorkspace } from '../mcp/authoringTypes';
import { parseStdioPayload } from '../mcp/wire';
import { usePageStore } from '../proto/store/usePageStore';
import { useAccountStore } from '../store/useAccountStore';
import { useHermesStore } from '../store/useHermesStore';
import { useProtoStore } from '../store/useProtoStore';
import { pendingProjectAiTasks } from './hermesTaskLock';
import { applyLiveProjectEdit, captureProjectPayload, desktopFileSession, desktopProjectRevision, flushProjectChanges } from './projectStorage';
import { canUndoProjectChange, recordProjectUndo } from './projectUndo';

export type SkillClient = 'codex' | 'antigravity' | 'claude';
type ProjectTarget = { projectId: string; storageDir: string; fileName: string };
type Session = ProjectTarget & { sessionId: string; opened: string };
type LiveRequest = { sessionId: string; id: string; body: string; deadline: number };
interface LiveApi {
  open(input: ProjectTarget & { sessionId: string }): Promise<{ connectionPath: string; projectPath: string }>;
  capture(input: { sessionId: string; requestId: string; snapshot: PreviewSnapshot }): Promise<{ data: string; width: number; height: number }>;
  close(sessionId: string): Promise<void>;
  onRequest(listener: (request: LiveRequest) => void): () => void;
  reply(result: { sessionId: string; id: string; body?: string | null; failed?: boolean }): void;
  installSkill(client: SkillClient): Promise<string>;
}
export function desktopAuthoringApi() {
  return typeof window === 'undefined' ? undefined :
    (window as Window & { protoflowDesktop?: { liveAuthoring?: LiveApi } }).protoflowDesktop?.liveAuthoring;
}

type ChangeNotice = { id: string; projectId: string; opened: string; summary: string };
export const useDesktopAuthoring = create<{
  connectionPath: string | null;
  notice: ChangeNotice | null;
  writing: boolean;
}>(() => ({ connectionPath: null, notice: null, writing: false }));

let session: Session | null = null;
let projectPath: string | null = null;
type CanvasSelection = { projectId: string; pageId: string; source: string; pfId: string };
let selection: CanvasSelection | null = null;
export function publishCanvasSelection(next: CanvasSelection | null) {
  selection = next;
  return () => { if (selection === next) selection = null; };
}

function projectOpen(target: Session) {
  const state = useProtoStore.getState(), meta = state.currentProjectMeta;
  const access = useAccountStore.getState().status;
  return (access === 'local' || access === 'authenticated') && !state.isWelcomeScreenOpen && !state.isProjectClosed &&
    !state.isWebPlayerMode && meta.projectId === target.projectId && meta.fileName === target.fileName &&
    meta.storageDir === target.storageDir && desktopFileSession() === target.opened;
}

export async function disableDesktopAuthoring() {
  const previous = session;
  session = null;
  projectPath = null;
  useDesktopAuthoring.setState({ connectionPath: null });
  if (previous) await desktopAuthoringApi()?.close(previous.sessionId);
}

export async function enableDesktopAuthoring() {
  const api = desktopAuthoringApi();
  const opened = desktopFileSession();
  if (!api || !opened) throw new Error(tr('请在桌面端打开工程文件', 'Open a project file in Alex Desktop'));
  const { projectId, storageDir, fileName } = useProtoStore.getState().currentProjectMeta;
  const target = { projectId, storageDir, fileName, sessionId: newId('mcp-session'), opened };
  if (!projectOpen(target)) throw new Error(tr('当前工程不可编辑', 'Current project is unavailable for editing'));
  session = target;
  try {
    const result = await api.open({ projectId, storageDir, fileName, sessionId: target.sessionId });
    if (session !== target || !projectOpen(target)) throw new Error(tr('当前工程已切换', 'Current project changed'));
    projectPath = result.projectPath;
    useDesktopAuthoring.setState({ connectionPath: result.connectionPath });
  } catch (error) {
    if (session === target) await disableDesktopAuthoring();
    else await api.close(target.sessionId);
    throw error;
  }
}

function desktopWorkspace(target: Session, filePath: string, request: LiveRequest): AuthoringWorkspace {
  const revision = () => {
    const value = desktopProjectRevision();
    if (!value || session !== target || !projectOpen(target) || Date.now() >= request.deadline) {
      throw new Error(tr('桌面连接已过期，请重新读取当前工程', 'Desktop connection expired. Read the active project again.'));
    }
    return value;
  };
  const unsupported = async (): Promise<never> => {
    throw new Error(tr('实时连接绑定到当前工程，请在 Alex 中打开或新建其他工程', 'Open or create other projects in Alex. This connection is bound to the active project.'));
  };
  return {
    mode: 'readwrite', transport: 'desktop_bridge', canWrite: true,
    hasActiveProject: () => projectOpen(target),
    listProjects: unsupported, createProject: unsupported, switchProject: unsupported,
    async getContext() {
      const { currentProjectMeta: meta, activePageId, viewMode } = useProtoStore.getState();
      const selected = viewMode === 'single_page' && selection?.projectId === meta.projectId &&
        selection.pageId === activePageId && selection.source === usePageStore.getState().pageSources[activePageId] ? selection.pfId : null;
      return { transport: 'desktop_bridge', projectPath: filePath, workspaceDir: meta.storageDir,
        projectId: meta.projectId, projectName: meta.projectName, projectMode: meta.projectMode ?? 'desktop',
        revision: revision(), activePageId: activePageId || null, selectedPfId: selected, viewMode };
    },
    async capturePreview({ pageId: requested, scope, waitMs }) {
      const captured = revision();
      const state = useProtoStore.getState(), pages = usePageStore.getState();
      const pageId = requested === undefined ? state.activePageId : requested;
      if (!Object.hasOwn(pages.pageSources, pageId)) throw new Error('No canvas source for pageId: ' + pageId);
      const parsed = parsePageSource(pages.pageSources[pageId]);
      if (!parsed.doc || parsed.issues.length) throw new Error('Cannot render page: ' + pageId);
      const { doc } = parsed;
      if (doc.root.type !== 'Page' && doc.root.type !== 'MobilePage') throw new Error('Unknown page root: ' + doc.root.type);
      const platform = doc.root.type === 'MobilePage' ? 'mobile' : 'desktop';
      const bounds = document.querySelector('.pf-canvas-viewport-shell')?.getBoundingClientRect();
      const device = MOBILE_DEVICE_SPECS[pages.mobileDevice];
      const width = Math.min(2560, Math.max(platform === 'mobile' ? device.width + 64 : 1, Math.round(bounds?.width || 1280)));
      const height = Math.min(2160, Math.max(platform === 'mobile' ? device.height + 64 : 1, Math.round(bounds?.height || 800)));
      const { dbTables, suppliers, purchaseOrderItems, acceptanceOrders, draftAcceptanceHeader, draftAcceptanceLines, widgets } = state;
      const snapshot: PreviewSnapshot = { pageId, revision: captured, scope, waitMs, platform, doc, width, height,
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', locale: getLocale(), device: pages.mobileDevice,
        meta: state.currentProjectMeta, state: { dbTables, tableRows: pages.tableRows, suppliers, purchaseOrderItems, acceptanceOrders, draftAcceptanceHeader, draftAcceptanceLines, widgets } };
      const image = await desktopAuthoringApi()!.capture({ sessionId: target.sessionId, requestId: request.id, snapshot });
      if (revision() !== captured) throw new Error('Project changed during preview capture. Read the current revision and retry.');
      return { ...image, pageId, platform, scope, revision: captured };
    },
    async load() {
      return { sourceKind: 'local', sourceLabel: filePath, revision: revision(), payload: captureProjectPayload(), uniqueConstraintsComplete: true };
    },
    async mutate(mutator, options) {
      const current = revision();
      if (options?.expectedRevision !== undefined && options.expectedRevision !== current) {
        throw new Error(tr('工程版本冲突，请重新读取后再试', 'Revision conflict. Read the project again.'));
      }
      const { projectId } = target;
      if (pendingProjectAiTasks.has(projectId) || useHermesStore.getState().runningProjects[projectId]) {
        throw new Error(tr('当前工程有 AI 任务正在执行，请稍后重试', 'An AI task is running in this project. Retry after it finishes.'));
      }
      const previous = useDesktopAuthoring.getState().notice;
      const continuesHistory = previous?.projectId === projectId && canUndoProjectChange(previous.id);
      pendingProjectAiTasks.add(projectId);
      useDesktopAuthoring.setState({ writing: true });
      try {
        // Drain older captures before applying metadata, then check again across each await.
        await flushProjectChanges();
        const assertCurrent = () => {
          if (revision() !== current) throw new Error(tr('工程版本冲突，请重新读取后再试', 'Revision conflict. Read the project again.'));
        };
        assertCurrent();
        const before = captureProjectPayload(), draft = structuredClone(before);
        const result = await mutator(draft, before);
        assertCurrent();
        const history = usePageStore.getState().history;
        const changed = applyLiveProjectEdit(before, draft);
        const committed = desktopProjectRevision()!;
        if (changed) {
          const id = newId('mcp-edit');
          let undoRevision = committed;
          const notice = { id, projectId, opened: target.opened, summary: options?.summary ?? 'edit' };
          recordProjectUndo(id, {
            projectId,
            canUndo: () => projectOpen(target) && desktopProjectRevision() === undoRevision &&
              !pendingProjectAiTasks.has(projectId) && !useHermesStore.getState().runningProjects[projectId],
            undo: () => {
              applyLiveProjectEdit(draft, before);
              usePageStore.setState({ history });
              useDesktopAuthoring.setState({ notice: null });
            },
            restored: () => {
              undoRevision = desktopProjectRevision()!;
              useDesktopAuthoring.setState({ notice });
            },
          }, continuesHistory);
          useDesktopAuthoring.setState({ notice });
          try { await flushProjectChanges(); }
          catch (error) {
            throw new Error(tr('修改已应用到桌面，保存失败；请在 Alex 中重试保存。', 'Edit applied to the desktop, but save failed. Retry saving in Alex. ') + String(error));
          }
        }
        return { revision: committed, filePath, changed, result };
      } finally {
        pendingProjectAiTasks.delete(projectId);
        useDesktopAuthoring.setState({ writing: false });
      }
    },
  };
}

export function startDesktopAuthoring() {
  const api = desktopAuthoringApi();
  if (!api) return () => {};
  const checkProject = () => {
    const { notice } = useDesktopAuthoring.getState();
    if (notice && notice.opened !== desktopFileSession()) useDesktopAuthoring.setState({ notice: null });
    if (session && !projectOpen(session)) void disableDesktopAuthoring().catch(console.error);
  };
  const stopStore = useProtoStore.subscribe(checkProject);
  const stopAccount = useAccountStore.subscribe(checkProject);
  let queue = Promise.resolve();
  const stopRequests = api.onRequest(request => {
    const target = session, file = projectPath;
    queue = queue.then(async () => {
      if (!target || !file || request.sessionId !== target.sessionId || target !== session || !projectOpen(target) || Date.now() >= request.deadline) {
        throw new Error('Desktop request expired');
      }
      const { handleSpecMcpPayload } = await import('../mcp/protocol');
      const workspace = desktopWorkspace(target, file, request);
      const response = await handleSpecMcpPayload(workspace, parseStdioPayload(request.body));
      api.reply({ id: request.id, sessionId: request.sessionId, body: response === null ? null : stringify(response) });
    }).catch(() => api.reply({ id: request.id, sessionId: request.sessionId, failed: true }));
  });
  return () => { stopRequests(); stopStore(); stopAccount(); void disableDesktopAuthoring().catch(console.error); };
}
