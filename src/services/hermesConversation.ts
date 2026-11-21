import { tr } from '../i18n/runtime';

export interface HermesConversation {
  projectId: string;
  kind?: never;
  threadId?: never;
  mindmapId?: never;
  /** The stable menu page ID, never a folder ID, title or Modal/Drawer ID. */
  pageId: string;
}

/** Each mindmap document has its own session and never borrows a page ID. */
export interface HermesMindmapConversation {
  projectId: string;
  kind: 'mindmap';
  threadId?: never;
  mindmapId: string;
  pageId?: never;
}
export interface HermesProjectConversation {
  projectId: string;
  kind: 'project';
  /** Absent only for the original, pre-history project conversation. */
  threadId?: string;
  pageId?: never;
  mindmapId?: never;
}
export type HermesChatConversation = HermesConversation | HermesProjectConversation;
export type HermesTaskScope = HermesChatConversation | HermesMindmapConversation;

export function conversationKey({ projectId, pageId, kind, mindmapId, threadId }: HermesTaskScope): string {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new Error(tr('对话缺少项目 ID', 'Conversation is missing project ID'));
  if (kind === 'project') {
    if (pageId !== undefined || mindmapId !== undefined) throw new Error(tr('项目会话不能借用页面或脑图 ID', 'Project conversation cannot include pageId or mindmapId'));
    if (threadId !== undefined && (typeof threadId !== 'string' || !threadId.trim())) throw new Error(tr('项目对话标识无效', 'Invalid project threadId'));
    return JSON.stringify([projectId, 'project', threadId ?? null]);
  }
  if (threadId !== undefined) throw new Error(tr('此会话不属于项目聊天', 'This conversation is not a project chat'));
  if (kind === 'mindmap') {
    if (pageId !== undefined) throw new Error(tr('项目脑图会话不能包含菜单 ID', 'Mindmap conversation cannot include pageId'));
    if (typeof mindmapId !== 'string' || !mindmapId.trim()) throw new Error(tr('脑图会话缺少脑图菜单 ID', 'Mindmap conversation is missing mindmapId'));
    return JSON.stringify([projectId, 'mindmap', mindmapId]);
  }
  if (mindmapId !== undefined) throw new Error(tr('页面会话不能包含脑图 ID', 'Page conversation cannot include mindmapId'));
  if (kind !== undefined) throw new Error(tr('未知的 Hermes 会话类型', 'Unknown Hermes conversation kind'));
  if (typeof pageId !== 'string' || !pageId.trim()) throw new Error(tr('请先选择一个菜单，再使用 AI 对话', 'Select a menu page before starting AI chat'));
  return JSON.stringify([projectId, pageId]);
}
