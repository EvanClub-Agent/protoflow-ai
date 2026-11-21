import { useProtoStore } from '../store/useProtoStore';
import { tr } from '../i18n/runtime';
import { usePageStore } from '../proto/store/usePageStore';
import { mindmapDescendants, pageRefKey, validateMindmaps, type MindmapNode, type MindmapPageRef, type MindmapWorkspace } from '../proto/mindmaps';
import { newId } from '../utils/identity';
import { useHermesStore } from '../store/useHermesStore';
import { pendingProjectAiTasks } from './hermesTaskLock';

function current(projectId: string) {
  const state = useProtoStore.getState();
  if (state.isProjectClosed || state.currentProjectMeta.projectId !== projectId) throw new Error(tr('当前项目已变化', 'Current project has changed'));
  return state;
}
function commit(projectId: string, mindmaps: MindmapWorkspace, selectedMindmapNodeId = current(projectId).selectedMindmapNodeId) {
  current(projectId);
  validateMindmaps(mindmaps, usePageStore.getState());
  if (selectedMindmapNodeId !== null && !mindmaps.nodes.some(node => node.id === selectedMindmapNodeId)) throw new Error(tr('选择的脑图节点不存在', 'Selected mindmap node does not exist'));
  useProtoStore.setState({ mindmaps, selectedMindmapNodeId });
}
export function createMindmapNode(projectId: string, kind: MindmapNode['kind'], title: string, parentId: string | null): string {
  const state = current(projectId), id = newId('mindmap');
  const node: MindmapNode = kind === 'folder' ? { id, kind, title: title.trim(), parentId } : { id, kind, title: title.trim(), parentId, source: '' };
  commit(projectId, { ...state.mindmaps, nodes: [...state.mindmaps.nodes, node] }, id);
  return id;
}
export function editMindmapNode(projectId: string, nodeId: string, title: string, parentId: string | null) {
  const { mindmaps } = current(projectId);
  if (!mindmaps.nodes.some(node => node.id === nodeId)) throw new Error(tr('脑图节点不存在', 'Mindmap node does not exist'));
  commit(projectId, { ...mindmaps, nodes: mindmaps.nodes.map(node => node.id === nodeId ? { ...node, title: title.trim(), parentId } : node) });
}
export function deleteMindmapNode(projectId: string, nodeId: string) {
  const state = current(projectId), removed = mindmapDescendants(state.mindmaps, nodeId);
  if (pendingProjectAiTasks.has(projectId) || useHermesStore.getState().runningProjects[projectId]) throw new Error(tr('请先停止当前项目的 AI 任务，再删除脑图', 'Stop the running AI task on this project before deleting the mindmap'));
  const parentId = state.mindmaps.nodes.find(node => node.id === nodeId)!.parentId;
  commit(projectId, { nodes: state.mindmaps.nodes.filter(node => !removed.has(node.id)), links: state.mindmaps.links.filter(link => !removed.has(link.targetNodeId)) }, state.selectedMindmapNodeId !== null && removed.has(state.selectedMindmapNodeId) ? parentId : state.selectedMindmapNodeId);
}
/** Multiple links per page/directory are allowed; update only the explicit source. */
export function setPageMindmapLinks(projectId: string, page: MindmapPageRef, targetNodeIds: string[]) {
  const { mindmaps } = current(projectId);
  const links = mindmaps.links.filter(link => pageRefKey(link.page) !== pageRefKey(page));
  commit(projectId, { ...mindmaps, links: [...links, ...targetNodeIds.map(targetNodeId => ({ page, targetNodeId }))] });
}
export function openMindmapNode(projectId: string, nodeId: string) {
  const state = current(projectId);
  if (!state.mindmaps.nodes.some(node => node.id === nodeId)) throw new Error(tr('脑图节点不存在', 'Mindmap node does not exist'));
  useProtoStore.setState({ selectedMindmapNodeId: nodeId, viewMode: 'mindmap' });
}
