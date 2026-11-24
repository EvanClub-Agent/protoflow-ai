import { validateRequirementRecords } from '../proto/database/requirementReview';
import { cachedProjectChatIndex, chatStorageKey as storageKey, chatTitle, newProjectChat, notifyChatPurged, projectChatScope, readProjectChatIndex, writeProjectChatIndex, type ProjectChatId, type ProjectChatIndex } from '../services/projectChatHistory';
import { validateProjectQuestions, type ProjectQuestion } from '../services/projectQuestions';
import type { AxureScope, RpTaskState } from '../proto/axure/task';
import { figmaSourcePagePattern, type FigmaScope, type FigmaTaskState } from '../proto/figma/task';
import type { ProjectChangeReview } from '../services/projectChangeReview';
import { create } from 'zustand';
import { useProtoStore } from './useProtoStore';
import { newId } from '../utils/identity';
import { conversationKey, type HermesChatConversation } from '../services/hermesConversation';
import type { HermesImageAttachment } from '../services/hermesClient';
import { MAX_CHAT_IMAGES, validImageReference, type ChatImageDraft } from '../services/chatImages';
import { validChatMindmaps, type ChatMindmap } from '../services/projectChatMindmaps';
import { tr } from '../i18n/runtime';
export type ChatRole = 'user' | 'assistant';
export type AiChatMessage = HermesChatConversation & {
  id: string;
  role: ChatRole;
  text: string;
  images?: HermesImageAttachment[];
  mindmaps?: ChatMindmap[];
  projectQuestions?: ProjectQuestion[];
  rpQuestionScope?: AxureScope;
  figmaQuestionScope?: FigmaScope;
  projectChangeReview?: ProjectChangeReview;
  requirementAudit?: import('../proto/database/requirementReview').RequirementAudit;
  projectReviewDecision?: 'applied' | 'discarded' | 'undone';
  targetLabel?: string;
  status: 'pending' | 'done' | 'error';
  engineBadge?: string;
  viaHermes?: boolean;
  changeId?: string;
  changedDoc?: boolean;
  createdPageId?: string;
  time: string;
  sessionId?: string;
  modelId?: string;
  diagnosticId?: string;
}
type NewChatMessage = AiChatMessage extends infer M ? M extends AiChatMessage ? Omit<M, 'id' | 'time'> : never : never;
export type RightPanelMode = 'chat' | 'inspector';
function imageReferences(images: HermesImageAttachment[], scope: HermesChatConversation) {
  if (!Array.isArray(images) || images.length > MAX_CHAT_IMAGES || images.some(image => !validImageReference(image, scope)))
    throw new Error(tr('聊天图片附件不属于当前会话或格式无效', 'Chat image attachment does not belong to this conversation or has an invalid format'));
  // Persist only references, even if an IPC record happens to include media data.
  const owner = scope.kind === 'project' ? projectChatScope(scope.projectId, scope.threadId ?? null) : {projectId: scope.projectId, pageId: scope.pageId};
  return images.map(({ id, name, mimeType, size }) => ({ ...owner, id, name, mimeType, size }));
}
function validMessage(m: any, scope: HermesChatConversation): m is AiChatMessage {
  if (m?.requirementAudit !== undefined) {
    const report = m.requirementAudit;
    if (!report || !Number.isInteger(report.uncovered) || report.uncovered < 0 ||
        ![report.lines, report.conflicts].every(items => Array.isArray(items) && items.every(line=>typeof line==='string'))) return false;
  }
  if (m?.mindmaps !== undefined && (scope.kind !== 'project' || m.role !== 'user' || !validChatMindmaps(m.mindmaps, scope.projectId))) return false;
  if (m?.projectChangeReview !== undefined) {
    const review = m.projectChangeReview;
    if (review?.requestedPage !== undefined && (!review.requestedPage || typeof review.requestedPage.pageId !== 'string' ||
      !review.requestedPage.pageId.trim() || !['mobile', 'desktop'].includes(review.requestedPage.platform))) return false;
    if (review?.requirementRecords !== undefined) {
      try { validateRequirementRecords(review.requirementRecords); } catch { return false; }
    }
    if (scope.kind !== 'project' || m.role !== 'assistant' || m.status !== 'done' ||
      !review || typeof review.baseDigest !== 'string' || !/^[a-f0-9]{64}$/.test(review.baseDigest) ||
      !Array.isArray(review.items) || !review.items.length || review.items.some((line: unknown) => typeof line !== 'string') ||
      !Array.isArray(review.operations) || (!review.operations.length && !review.requirementRecords?.length) || review.operations.some((op: any) =>
        !op || typeof op.tool !== 'string' || !op.args || typeof op.args !== 'object' || Array.isArray(op.args))) return false;
  }
  if (m?.projectQuestions !== undefined) {
    if (scope.kind !== 'project' || m.role !== 'assistant') return false;
    try { validateProjectQuestions(m.projectQuestions); } catch { return false; }
  }
  if (m?.rpQuestionScope !== undefined) {
    const target = m.rpQuestionScope;
    if (!m.projectQuestions || !target || !(target.kind === 'project' ||
      (target.kind === 'folder' && typeof target.folderId === 'string' && target.folderId.length > 0) ||
      (target.kind === 'page' && typeof target.pageId === 'string' && /^rp-page-[a-f0-9]{32}$/.test(target.pageId)))) return false;
  }
  if (m?.figmaQuestionScope !== undefined) {
    const target = m.figmaQuestionScope;
    if (!m.projectQuestions || !target || !(target.kind === 'project' ||
      (target.kind === 'folder' && typeof target.folderId === 'string' && target.folderId.length > 0) ||
      (target.kind === 'page' && typeof target.pageId === 'string' && figmaSourcePagePattern.test(target.pageId)))) return false;
  }
  return m && m.projectId === scope.projectId && m.pageId === scope.pageId && m.kind === scope.kind && m.threadId === scope.threadId &&
    typeof m.id === 'string' && m.id.length > 0 && typeof m.text === 'string' &&
    typeof m.time === 'string' && ['user', 'assistant'].includes(m.role) && ['pending', 'done', 'error'].includes(m.status) &&
    (m.images === undefined || (Array.isArray(m.images) && m.images.length <= MAX_CHAT_IMAGES && m.images.every((image: unknown) => validImageReference(image, scope))));
}
function persist(scope: HermesChatConversation, messages: AiChatMessage[]) {
  try { window.localStorage.setItem(storageKey(scope), JSON.stringify(scope.kind === 'project' ? messages : messages.slice(-120))); return null; }
  catch { return tr('聊天记录尚未保存到本机，请保持应用打开并重试。', 'Chat history has not been saved locally yet; keep the app open and retry.'); }
}
function read(scope: HermesChatConversation): { messages: AiChatMessage[]; error: string | null } {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    // V2 messages already have exact projectId + pageId. Split by those fields;
    // retain the original V2 archive and never assign unscoped history to a menu.
    const legacy = raw === null && scope.kind === undefined;
    const value: unknown = JSON.parse(legacy ? window.localStorage.getItem(`protoflow_ai_chat_v2:${encodeURIComponent(scope.projectId)}`) ?? '[]' : raw ?? '[]');
    if (!Array.isArray(value)) throw new Error(tr('聊天记录格式无效', 'Invalid chat history format'));
    if (!legacy && value.some(m => !validMessage(m, scope))) throw new Error(tr('聊天记录归属或格式无效', 'Invalid chat history scope or format'));
    const messages = value.filter(m => validMessage(m, scope)).map(m => m.status === 'pending'
      ? { ...m, status: 'error' as const, text: tr('应用重启，本次执行结果未确认，请检查当前菜单的内容后再继续。', 'App restarted before this run finished. Please inspect the current menu before continuing.') } : m);
    return { messages, error: legacy ? persist(scope, messages) : null };
  } catch { return { messages: [], error: tr('读取当前菜单的聊天记录失败，原记录未覆盖。', 'Failed to read chat history for this menu; existing data was preserved.') }; }
}
export interface ProjectDraft { text: string; images: ChatImageDraft[]; mindmapIds: string[]; rpTask?: RpTaskState; figmaTask?: FigmaTaskState }
type ProjectDrafts = Map<string, ProjectDraft>;
export interface PageChatDraft { text: string; images: ChatImageDraft[]; excludedNoteIds: string[] }
export const EMPTY_PAGE_CHAT_DRAFT: PageChatDraft = { text: '', images: [], excludedNoteIds: [] };

interface AiChatStore {
  pageChatOpen: boolean;
  setPageChatOpen: (open: boolean) => void;
  pageChatWide: boolean;
  togglePageChatWidth: () => void;
  pageDrafts: Map<string, PageChatDraft>;
  updatePageDraft: (key: string, update: (draft: PageChatDraft) => PageChatDraft) => void;
  projectDrafts: ProjectDrafts;
  setProjectDrafts: (update: (drafts: ProjectDrafts) => ProjectDrafts) => void;
  projectIndexes: Record<string, ProjectChatIndex>;
  loadProjectIndex: (projectId: string) => ProjectChatIndex;
  newProjectChat: (projectId: string) => void;
  selectProjectChat: (projectId: string, id: ProjectChatId) => void;
  forgetProjectChat: (projectId: string, id: ProjectChatId) => void;
  conversation: HermesChatConversation | null;
  messages: AiChatMessage[];
  byConversation: Record<string, AiChatMessage[]>;
  storageErrors: Record<string, string | null>;
  rightPanelMode: RightPanelMode;
  switchConversation: (scope: HermesChatConversation | null) => void;
  setRightPanelMode: (mode: RightPanelMode) => void;
  addMessage: (message: NewChatMessage, options?: { beforeMessageId: string }) => string;
  updateMessage: (id: string, patch: Partial<AiChatMessage>, options?: { persist: boolean }) => void;
  clearMessages: (scope: HermesChatConversation) => void;
  retrySave: (scope: HermesChatConversation) => void;
}
export const useAiChatStore = create<AiChatStore>((set, get) => ({
  pageChatOpen: false,
  setPageChatOpen: pageChatOpen => set({ pageChatOpen }),
  pageChatWide: false,
  togglePageChatWidth: () => set(state => ({ pageChatWide: !state.pageChatWide })),
  pageDrafts: new Map(),
  updatePageDraft: (key, update) => set(state => {
    const previous = state.pageDrafts.get(key) ?? EMPTY_PAGE_CHAT_DRAFT;
    const next = update(previous);
    if (previous === next) return state;
    return { pageDrafts: new Map(state.pageDrafts).set(key, next) };
  }),
  projectDrafts: new Map(),
  setProjectDrafts: update => set(s => ({projectDrafts: update(s.projectDrafts)})),
  projectIndexes: {},
  loadProjectIndex: projectId => {
    const existing = cachedProjectChatIndex(get().projectIndexes, projectId);
    if (existing) return existing;
    const index = readProjectChatIndex(projectId);
    set(s => ({projectIndexes:{...s.projectIndexes,[projectId]:index}}));
    return index;
  },
  newProjectChat: projectId => {
    const previous = get().loadProjectIndex(projectId);
    const entry = newProjectChat();
    const index = {...previous, activeId:entry.id, entries:[entry,...previous.entries]};
    writeProjectChatIndex(index);
    set(s => ({projectIndexes:{...s.projectIndexes,[projectId]:index}}));
    get().switchConversation(projectChatScope(projectId,entry.id));
  },
  selectProjectChat: (projectId,id) => {
    const previous = get().loadProjectIndex(projectId);
    if (!previous.entries.some(entry => entry.id === id)) throw new Error(tr('项目会话已删除', 'Project thread was deleted'));
    const index = {...previous,activeId:id};
    writeProjectChatIndex(index);
    set(s => ({projectIndexes:{...s.projectIndexes,[projectId]:index}}));
    get().switchConversation(projectChatScope(projectId,id));
  },
  forgetProjectChat: (projectId,id) => {
    const previous = get().loadProjectIndex(projectId);
    const entries = previous.entries.filter(entry => entry.id !== id);
    if (entries.length === previous.entries.length) throw new Error(tr('项目中没有这条会话', 'Thread does not exist in this project'));
    if (!entries.length) entries.push(newProjectChat());
    const index = {...previous, entries, activeId:previous.activeId === id ? entries[0].id : previous.activeId};
    const scope = projectChatScope(projectId,id), key = conversationKey(scope);
    window.localStorage.removeItem(storageKey(scope));
    notifyChatPurged(projectId, key);
    writeProjectChatIndex(index);
    const { [key]:removed, ...byConversation } = get().byConversation;
    const { [key]:removedError, ...storageErrors } = get().storageErrors;
    const current = get().conversation;
    const projectDrafts = new Map(get().projectDrafts);
    projectDrafts.delete(key);
    set(s => ({byConversation, storageErrors, projectDrafts, projectIndexes:{...s.projectIndexes,[projectId]:index}}));
    if (current && conversationKey(current) === key) get().switchConversation(projectChatScope(projectId,index.activeId));
  },
  conversation: null, messages: [], byConversation: {}, storageErrors: {}, rightPanelMode: 'chat',
  switchConversation: scope => {
    if (scope?.kind === 'project') {
      const index = get().loadProjectIndex(scope.projectId);
      if (!index.entries.some(entry => entry.id === (scope.threadId ?? null))) throw new Error(tr('项目会话已删除', 'Project thread was deleted'));
    }
    set(s => {
      if (!scope) return { conversation: null, messages: [] };
      const key = conversationKey(scope);
      const cached = s.byConversation[key];
      const loaded = cached ? { messages: cached, error: s.storageErrors[key] } : read(scope);
      return { conversation: scope, messages: loaded.messages,
        byConversation: { ...s.byConversation, [key]: loaded.messages }, storageErrors: { ...s.storageErrors, [key]: loaded.error } };
    });
  },
  setRightPanelMode: rightPanelMode => set({ rightPanelMode }),
  addMessage: (message, options) => {
    const scope: HermesChatConversation = message.kind === 'project' ? projectChatScope(message.projectId, message.threadId ?? null) : { projectId: message.projectId, pageId: message.pageId }, key = conversationKey(scope);
    if (message.mindmaps !== undefined && (scope.kind !== 'project' || message.role !== 'user' || !validChatMindmaps(message.mindmaps, scope.projectId)))
      throw new Error(tr('脑图附件不属于此项目或内容无效', 'Mindmap attachment does not belong to this project or is invalid'));
    if (scope.kind === 'project') {
      const index = get().loadProjectIndex(scope.projectId);
      const entry = index.entries.find(item => item.id === (scope.threadId ?? null));
      if (!entry) throw new Error(tr('项目会话已删除，无法写入消息', 'Project thread was deleted; cannot append message'));
      if (message.role === 'user') {
        const updated = {...entry, title:entry.title || chatTitle(message.text), updatedAt:Date.now()};
        const next = {...index,entries:[updated,...index.entries.filter(item => item.id !== entry.id)]};
        writeProjectChatIndex(next);
        set(s => ({projectIndexes:{...s.projectIndexes,[scope.projectId]:next}}));
      }
    }
    const id = newId('msg');
    const images = message.images === undefined ? undefined : imageReferences(message.images, scope);
    set(s => {
      const loaded = s.byConversation[key] === undefined ? read(scope) : { messages: s.byConversation[key], error: s.storageErrors[key] };
      if (loaded.error) throw new Error(loaded.error);
      const messages = [...loaded.messages];
      const position = options === undefined ? messages.length : messages.findIndex(item => item.id === options.beforeMessageId);
      if (position < 0) throw new Error(tr('回答关联的聊天消息已不存在', 'Associated chat message no longer exists'));
      messages.splice(position, 0, { ...message, images, id, time: new Date().toTimeString().slice(0, 5) });
      const error = persist(scope, messages);
      return { byConversation: { ...s.byConversation, [key]: messages }, storageErrors: { ...s.storageErrors, [key]: error },
        ...(s.conversation && conversationKey(s.conversation) === key ? { messages } : {}) };
    });
    return id;
  },
  updateMessage: (id, patch, options) => set(s => {
    const byConversation = { ...s.byConversation }, storageErrors = { ...s.storageErrors };
    for (const [key, items] of Object.entries(byConversation)) {
      const message = items.find(m => m.id === id);
      if (!message) continue;
      if (patch.images !== undefined) patch = { ...patch, images: imageReferences(patch.images, message) };
      byConversation[key] = items.map(m => m.id === id ? { ...m, ...patch, id: m.id, projectId: m.projectId, pageId: m.pageId, kind: m.kind, threadId:m.threadId, mindmaps:m.mindmaps } as AiChatMessage : m);
      if (options?.persist !== false) storageErrors[key] = persist(message, byConversation[key]);
    }
    return { byConversation, storageErrors, messages: s.conversation ? byConversation[conversationKey(s.conversation)] : [] };
  }),
  clearMessages: scope => {
    const key = conversationKey(scope), error = persist(scope, []);
    if (error) throw new Error(error);
    set(s => ({ byConversation: { ...s.byConversation, [key]: [] }, storageErrors: { ...s.storageErrors, [key]: null },
      ...(s.conversation && conversationKey(s.conversation) === key ? { messages: [] } : {}) }));
  },
  retrySave: scope => {
    const key = conversationKey(scope), messages = get().byConversation[key];
    if (messages === undefined) return;
    const prevErr = get().storageErrors[key];
    if (prevErr?.startsWith('读取') || prevErr?.startsWith('Failed to read')) throw new Error(tr('原记录读取失败，不能用空白记录覆盖。', 'Original chat log failed to load; refusing to overwrite with an empty log.'));
    const error = persist(scope, messages);
    set(s => ({ storageErrors: { ...s.storageErrors, [key]: error } }));
  },
}));
function currentConversation() {
  const s = useProtoStore.getState();
  if (!s.isProjectClosed && s.viewMode === 'project_ai') {
    const id = s.currentProjectMeta.projectId;
    // ProjectAiView loads the index and reports storage errors. Never switch
    // to the legacy thread merely because the index is not loaded yet.
    const index = cachedProjectChatIndex(useAiChatStore.getState().projectIndexes, id);
    return index ? projectChatScope(id,index.activeId) : null;
  }
  return s.isProjectClosed || s.activePageId === '' ? null : { projectId: s.currentProjectMeta.projectId, pageId: s.activePageId };
}
if (typeof window !== 'undefined') useAiChatStore.getState().switchConversation(currentConversation());
useProtoStore.subscribe((next, previous) => {
  if ((next.isProjectClosed && !previous.isProjectClosed) || next.currentProjectMeta.projectId !== previous.currentProjectMeta.projectId)
    useAiChatStore.setState({ projectDrafts: new Map(), pageDrafts: new Map(), pageChatOpen: false, pageChatWide: false });
  if (next.viewMode !== previous.viewMode || next.currentProjectMeta.projectId !== previous.currentProjectMeta.projectId || next.activePageId !== previous.activePageId || next.isProjectClosed !== previous.isProjectClosed)
    useAiChatStore.getState().switchConversation(currentConversation());
});
