function conversationScope({ projectId, pageId, kind, mindmapId, threadId }) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('缺少项目 ID');
  if (kind === 'project') {
    if (pageId !== undefined || mindmapId !== undefined) throw new Error('项目会话不能包含页面或脑图 ID');
    if (threadId === undefined) return { projectId, kind }; // Original project conversation
    if (typeof threadId !== 'string' || !threadId.trim()) throw new Error('项目对话标识无效');
    return { projectId, kind, threadId };
  }
  if (threadId !== undefined) throw new Error('此会话不属于项目聊天');
  if (kind === 'mindmap') {
    if (pageId !== undefined) throw new Error('项目脑图会话不能包含菜单 ID');
    if (typeof mindmapId !== 'string' || !mindmapId.trim()) throw new Error('脑图会话缺少脑图菜单 ID');
    return { projectId, kind, mindmapId };
  }
  if (mindmapId !== undefined) throw new Error('页面会话不能包含脑图 ID');
  if (kind !== undefined) throw new Error('未知的 Hermes 会话类型');
  if (typeof pageId !== 'string' || !pageId.trim()) throw new Error('缺少菜单页面 ID，请重启桌面应用后重试');
  return { projectId, pageId };
}
function conversationKey(input) {
  const { projectId, pageId, kind, mindmapId, threadId } = conversationScope(input);
  if (kind === 'project') return JSON.stringify([projectId, 'project', threadId ?? null]);
  if (kind === 'mindmap') return JSON.stringify([projectId, 'mindmap', mindmapId]);
  return JSON.stringify([projectId, pageId]);
}
module.exports = { conversationScope, conversationKey };
