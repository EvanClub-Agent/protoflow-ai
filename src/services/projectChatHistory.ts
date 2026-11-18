import { newId } from '../utils/identity';
import { conversationKey, type HermesChatConversation, type HermesProjectConversation } from './hermesConversation';

// null denotes exactly the original project chat, whose transcript and Hermes
// session already exist under the pre-history keys. Never reuse it after deletion.
export type ProjectChatId = string | null;
export interface ProjectChatEntry {
  id: ProjectChatId;
  title: string;
  updatedAt: number | null;
}
export interface ProjectChatIndex {
  projectId: string;
  activeId: ProjectChatId;
  entries: ProjectChatEntry[];
}
export function cachedProjectChatIndex(indexes: Record<string, ProjectChatIndex>, projectId: string): ProjectChatIndex | undefined {
  return Object.hasOwn(indexes, projectId) ? indexes[projectId] : undefined;
}
export function projectChatScope(projectId: string, id: ProjectChatId): HermesProjectConversation {
  return id === null ? { projectId, kind: 'project' } : { projectId, kind: 'project', threadId: id };
}
export const chatStorageKey = (scope: HermesChatConversation) => `protoflow_ai_chat_v3:${encodeURIComponent(conversationKey(scope))}`;
export const turnMetricsStorageKey = (scopeOrKey: HermesChatConversation | string) =>
  `protoflow_ai_turn_metrics_v1:${encodeURIComponent(typeof scopeOrKey === 'string' ? scopeOrKey : conversationKey(scopeOrKey))}`;
export const batchMetricsStorageKey = (projectId: string) =>
  `protoflow_ai_batch_metrics_v1:${encodeURIComponent(projectId)}`;
const chatPurgeHooks = new Set<(projectId: string, key: string) => void>();
export function registerChatPurgeHook(hook: (projectId: string, key: string) => void) {
  chatPurgeHooks.add(hook);
  return () => {
    chatPurgeHooks.delete(hook);
  };
}
export function purgePersistedConversationMetrics(projectId: string, key: string) {
  try {
    globalThis.window?.localStorage?.removeItem(turnMetricsStorageKey(key));
  } catch {}
  try {
    const storageKey = batchMetricsStorageKey(projectId);
    const raw = globalThis.window?.localStorage?.getItem(storageKey);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const remaining = parsed.filter(
          item => !(item && typeof item === 'object' && (item as { conversationKey?: unknown }).conversationKey === key),
        );
        if (remaining.length) {
          globalThis.window?.localStorage?.setItem(storageKey, JSON.stringify(remaining));
        } else {
          globalThis.window?.localStorage?.removeItem(storageKey);
        }
      }
    }
  } catch {}
}
export function notifyChatPurged(projectId: string, key: string) {
  purgePersistedConversationMetrics(projectId, key);
  for (const hook of chatPurgeHooks) {
    try {
      hook(projectId, key);
    } catch {}
  }
}
const indexKey = (projectId: string) => `protoflow_project_chats_v1:${encodeURIComponent(projectId)}`;
export const chatTitle = (text: string) => Array.from(text.trim().replace(/\s+/g, ' ')).slice(0, 42).join('');
export function newProjectChat(): ProjectChatEntry {
  return {id:newId('chat'), title:'', updatedAt:Date.now()};
}
export function readProjectChatIndex(projectId: string): ProjectChatIndex {
  const raw = window.localStorage.getItem(indexKey(projectId));
  if (raw === null) {
    const transcript = window.localStorage.getItem(chatStorageKey(projectChatScope(projectId, null)));
    const history = transcript === null ? [] : JSON.parse(transcript);
    if (!Array.isArray(history)) throw new Error('原项目对话记录格式无效');
    const first = history.find(m => m?.projectId === projectId && m.kind === 'project' && m.threadId === undefined && m.role === 'user' && typeof m.text === 'string');
    return {projectId, activeId:null, entries:[{id:null, title:first ? chatTitle(first.text) : '', updatedAt:null}]};
  }
  const saved: ProjectChatIndex = JSON.parse(raw);
  if (!saved || saved.projectId !== projectId || !Array.isArray(saved.entries) || !saved.entries.length ||
    saved.entries.some(e => !e || (e.id !== null && (typeof e.id !== 'string' || !e.id.trim())) || typeof e.title !== 'string' || (e.updatedAt !== null && !Number.isFinite(e.updatedAt))) ||
    new Set(saved.entries.map(e => e.id)).size !== saved.entries.length || !saved.entries.some(e => e.id === saved.activeId))
    throw new Error('项目会话列表损坏，无法读取');
  return saved;
}
export function writeProjectChatIndex(index: ProjectChatIndex) {
  window.localStorage.setItem(indexKey(index.projectId), JSON.stringify(index));
}
