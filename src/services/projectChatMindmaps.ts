import { mindmapPath, type MindmapWorkspace } from '../proto/mindmaps';
import { tr } from '../i18n/runtime';

// Store the sent document, not a derived SVG or a pointer to mutable editor state.
export interface ChatMindmap {
  projectId: string;
  mindmapId: string;
  title: string;
  path: string;
  source: string;
}

export function captureChatMindmaps(projectId: string, workspace: MindmapWorkspace, ids: string[]): ChatMindmap[] {
  if (new Set(ids).size !== ids.length) throw new Error(tr('同一条消息不能重复添加同一张脑图', 'Cannot attach the same mindmap multiple times in one message'));
  return ids.map(id => {
    const node = workspace.nodes.find(item => item.id === id);
    if (!node || node.kind !== 'mindmap') throw new Error(tr('所选脑图已不存在，请移除后再发送', 'Selected mindmap no longer exists; remove it before sending'));
    if (!node.source.trim()) throw new Error(tr(`「${node.title}」还是空脑图，请先编辑或移除`, `"${node.title}" is empty; edit or remove it first`));
    return { projectId, mindmapId: node.id, title: node.title, path: mindmapPath(workspace, id), source: node.source };
  });
}

export function validChatMindmaps(maps: unknown, projectId: string): maps is ChatMindmap[] {
  if (!Array.isArray(maps) || !maps.length) return false;
  const ids = new Set<string>();
  for (const map of maps) {
    if (map?.projectId !== projectId || typeof map.mindmapId !== 'string' || !map.mindmapId.trim() || ids.has(map.mindmapId)
      || typeof map.title !== 'string' || !map.title.trim() || typeof map.path !== 'string' || !map.path.trim()
      || typeof map.source !== 'string' || !map.source.trim()) return false;
    ids.add(map.mindmapId);
  }
  return true;
}
