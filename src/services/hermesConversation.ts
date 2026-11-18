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
  if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('对话缺少项目 ID');
  if (kind === 'project') {
    if (pageId !== undefined || mindmapId !== undefined) throw new Error('项目会话不能借用页面或脑图 ID');
    if (threadId !== undefined && (typeof threadId !== 'string' || !threadId.trim())) throw new Error('项目对话标识无效');
    return JSON.stringify([projectId, 'project', threadId ?? null]);
  }
  if (threadId !== undefined) throw new Error('此会话不属于项目聊天');
  if (kind === 'mindmap') {
    if (pageId !== undefined) throw new Error('项目脑图会话不能包含菜单 ID');
    if (typeof mindmapId !== 'string' || !mindmapId.trim()) throw new Error('脑图会话缺少脑图菜单 ID');
    return JSON.stringify([projectId, 'mindmap', mindmapId]);
  }
  if (mindmapId !== undefined) throw new Error('页面会话不能包含脑图 ID');
  if (kind !== undefined) throw new Error('未知的 Hermes 会话类型');
  if (typeof pageId !== 'string' || !pageId.trim()) throw new Error('请先选择一个菜单，再使用 AI 对话');
  return JSON.stringify([projectId, pageId]);
}
