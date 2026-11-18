import { buildSitemap, type SitemapLayout } from './sitemap';
import type { SitemapItem } from '../store/useProtoStore';

/** The historical mindmap node kind identifies a saved diagram document.
 * Its Mermaid syntax/type is determined by the source, not this storage discriminator. */
export type MindmapNode = { id: string; title: string; parentId: string | null } & (
  { kind: 'folder'; source?: never } | { kind: 'mindmap'; source: string }
);
/** Page references use pageId, never the rendered sitemap node ID. */
export type MindmapPageRef = { kind: 'page'; pageId: string } | { kind: 'folder'; folderId: string };
export interface MindmapLink { page: MindmapPageRef; targetNodeId: string }
export interface MindmapWorkspace { nodes: MindmapNode[]; links: MindmapLink[] }
export const emptyMindmaps = (): MindmapWorkspace => ({ nodes: [], links: [] });
export const pageRefKey = (ref: MindmapPageRef) => JSON.stringify(ref.kind === 'page' ? ['page', ref.pageId] : ['folder', ref.folderId]);
export const flattenSitemap = (items: SitemapItem[]): SitemapItem[] => items.flatMap(item => [item, ...flattenSitemap(item.children === undefined ? [] : item.children)]);

export function validateMindmaps(value: unknown, layout: SitemapLayout): asserts value is MindmapWorkspace {
  if (!value || typeof value !== 'object') throw new Error('脑图目录数据无效');
  const data = value as MindmapWorkspace;
  if (!Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error('脑图目录必须包含 nodes 和 links 数组');
  if (data.nodes.length > 2000) throw new Error('脑图目录节点过多');
  const byId = new Map<string, MindmapNode>();
  const siblingNames = new Set<string>();
  for (const node of data.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id.trim() || byId.has(node.id)) throw new Error('脑图节点 ID 缺失或重复');
    if (typeof node.title !== 'string' || !node.title.trim() || node.title !== node.title.trim() || node.title.length > 60) throw new Error('脑图名称需为 1–60 个字符，首尾不能有空格');
    if (node.parentId !== null && (typeof node.parentId !== 'string' || !node.parentId.trim())) throw new Error('脑图上级目录 ID 无效');
    if (node.kind !== 'folder' && node.kind !== 'mindmap') throw new Error('脑图节点类型无效');
    // Invalid Mermaid is an editable draft; preserve its exact source.
    if (node.kind === 'mindmap' ? typeof node.source !== 'string' : node.source !== undefined) throw new Error('只有脑图菜单可以保存源码，且 source 必须是字符串');
    const name = JSON.stringify([node.parentId, node.title]);
    if (siblingNames.has(name)) throw new Error('同一目录下已存在同名脑图或目录');
    siblingNames.add(name); byId.set(node.id, node);
  }
  for (const node of data.nodes) {
    const seen = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (seen.has(parentId) || seen.size > 40) throw new Error('脑图目录不能循环嵌套或超过 40 层');
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent || parent.kind !== 'folder') throw new Error('脑图上级目录不存在或不是目录');
      parentId = parent.parentId;
    }
  }
  const sitemap = flattenSitemap(buildSitemap(layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase));
  const pages = new Set(sitemap.filter(item => item.type === 'page' && item.pageId !== undefined).map(item => item.pageId));
  const folders = new Set(sitemap.filter(item => item.type === 'folder').map(item => item.id));
  const links = new Set<string>();
  for (const link of data.links) {
    if (!link || !byId.has(link.targetNodeId) || !link.page) throw new Error('脑图关联的目标不存在');
    const ref = link.page;
    if (ref.kind === 'page') {
      if (!pages.has(ref.pageId) || 'folderId' in ref) throw new Error('脑图关联的页面 ID 无效');
    } else if (ref.kind === 'folder') {
      if (!folders.has(ref.folderId) || 'pageId' in ref) throw new Error('脑图关联的页面目录 ID 无效');
    } else throw new Error('脑图关联来源类型无效');
    const key = JSON.stringify([pageRefKey(ref), link.targetNodeId]);
    if (links.has(key)) throw new Error('脑图关联重复');
    links.add(key);
  }
}

export function mindmapPath(data: MindmapWorkspace, id: string): string {
  const node = data.nodes.find(item => item.id === id);
  if (!node) throw new Error('脑图节点不存在');
  return node.parentId === null ? node.title : `${mindmapPath(data, node.parentId)} / ${node.title}`;
}
export function mindmapDescendants(data: MindmapWorkspace, id: string): Set<string> {
  if (!data.nodes.some(node => node.id === id)) throw new Error('脑图节点不存在');
  const result = new Set([id]);
  const visit = (parentId: string) => { for (const node of data.nodes.filter(item => item.parentId === parentId)) { result.add(node.id); visit(node.id); } };
  visit(id); return result;
}

/** Directory links apply to descendant maps, and page folders expand to their current pages. */
export function mindmapContext(data: MindmapWorkspace, mindmapId: string, layout: SitemapLayout) {
  const document = data.nodes.find(node => node.id === mindmapId);
  if (!document || document.kind !== 'mindmap') throw new Error('请选择一个有效的脑图菜单');
  const targetIds = new Set([mindmapId]);
  let parentId = document.parentId;
  while (parentId !== null) {
    targetIds.add(parentId);
    const parent = data.nodes.find(node => node.id === parentId);
    if (!parent || parent.kind !== 'folder') throw new Error('脑图上级目录不存在');
    parentId = parent.parentId;
  }
  const links = data.links.filter(link => targetIds.has(link.targetNodeId));
  const tree = flattenSitemap(buildSitemap(layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase));
  const pageIds = new Set<string>();
  for (const { page } of links) {
    if (page.kind === 'page') pageIds.add(page.pageId);
    else {
      const folder = tree.find(node => node.type === 'folder' && node.id === page.folderId);
      if (!folder) throw new Error('脑图关联的页面目录不存在');
      for (const item of flattenSitemap([folder])) if (item.type === 'page' && item.pageId !== undefined) pageIds.add(item.pageId);
    }
  }
  return { mindmapId, title: document.title, path: mindmapPath(data, mindmapId), source: document.source, links, relatedPageIds: [...pageIds] };
}
