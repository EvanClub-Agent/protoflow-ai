import { tr } from '../i18n/runtime';
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

function validateMindmapTree(data: MindmapWorkspace) {
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
  return byId;
}

export function validateMindmaps(value: unknown, layout: SitemapLayout): asserts value is MindmapWorkspace {
  if (!value || typeof value !== 'object') throw new Error('脑图目录数据无效');
  const data = value as MindmapWorkspace;
  if (!Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error('脑图目录必须包含 nodes 和 links 数组');
  const byId = validateMindmapTree(data);
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
  return mindmapContextResolver(data, layout)(mindmapId);
}

export function mindmapContextResolver(data: MindmapWorkspace, layout: SitemapLayout) {
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  const tree = flattenSitemap(buildSitemap(layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase));
  return (mindmapId: string) => {
    const document = byId.get(mindmapId);
    if (!document || document.kind !== 'mindmap') throw new Error('请选择一个有效的脑图菜单');
    const targetIds = new Set([mindmapId]);
    let parentId = document.parentId;
    while (parentId !== null) {
      targetIds.add(parentId);
      const parent = byId.get(parentId);
      if (!parent || parent.kind !== 'folder') throw new Error('脑图上级目录不存在');
      parentId = parent.parentId;
    }
    const links = data.links.filter(link => targetIds.has(link.targetNodeId));
    const pageIds = new Set<string>();
    for (const { page } of links) {
      if (page.kind === 'page') pageIds.add(page.pageId);
      else {
        const folder = tree.find(node => node.type === 'folder' && node.id === page.folderId);
        if (!folder) throw new Error('脑图关联的页面目录不存在');
        for (const item of flattenSitemap([folder])) if (item.type === 'page' && item.pageId !== undefined) pageIds.add(item.pageId);
      }
    }
    return { mindmapId, title: document.title, parentId: document.parentId, path: mindmapPath(data, mindmapId), source: document.source, links, relatedPageIds: [...pageIds] };
  };
}

export function firstSelectableMindmapId(data: MindmapWorkspace | undefined | null): string | null {
  if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) return null;
  return data.nodes.find((n) => n.kind === 'mindmap')?.id ?? data.nodes[0].id;
}

export function resolveMindmapSelection(before: MindmapWorkspace, after: MindmapWorkspace, selectedId: string | null): string | null {
  const selected = after.nodes.find(node => node.id === selectedId);
  if (!selected) return firstSelectableMindmapId(after);
  if (selected.kind === 'folder' && !before.nodes.some(node => node.kind === 'mindmap')) {
    const firstDocument = after.nodes.find(node => node.kind === 'mindmap');
    if (firstDocument) return firstDocument.id;
  }
  return selected.id;
}

export function resolveDocumentParentId(value: unknown, existing: { parentId: string | null } | undefined, field: string): string | null {
  if (value === undefined) return existing ? existing.parentId : null;
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(tr(`${field} 必须是非空字符串或 null`, `${field} must be a non-empty string or null`));
  return value.trim();
}

function linkedIds(value: unknown, field: 'linkedPageIds' | 'linkedFolderIds'): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(tr(`${field} 必须是数组`, `${field} must be an array`));
  const ids = value.map((id, index) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error(tr(`${field}[${index}] 必须是非空字符串`, `${field}[${index}] must be a non-empty string`));
    }
    return id.trim();
  });
  return [...new Set(ids)];
}

/** Notes and mindmaps use the same page/folder reference contract. */
export function buildLinksForTarget(targetNodeId: string, linkedPageIds: unknown, linkedFolderIds: unknown): MindmapLink[] {
  return [
    ...linkedIds(linkedPageIds, 'linkedPageIds').map(pageId => ({ page: { kind: 'page' as const, pageId }, targetNodeId })),
    ...linkedIds(linkedFolderIds, 'linkedFolderIds').map(folderId => ({ page: { kind: 'folder' as const, folderId }, targetNodeId })),
  ];
}

export function applyMindmapMutation(
  state: SitemapLayout & { mindmaps?: MindmapWorkspace },
  args: Record<string, unknown>,
  layout: SitemapLayout | 'validateMenuLinksAtCommit' = state,
): { action: 'upsert_mindmap' | 'upsert_folder' | 'delete'; id?: string; title?: string; linkCount?: number; deletedIds?: string[] } {
  const action = typeof args.action === 'string' ? args.action.trim() : '';
  const current = state.mindmaps ? structuredClone(state.mindmaps) : emptyMindmaps();

  function commit() {
    if (layout === 'validateMenuLinksAtCommit') validateMindmapTree(current);
    else validateMindmaps(current, layout);
    state.mindmaps = current;
  }

  if (action === 'upsert_mindmap' || action === 'upsert_folder') {
    const id = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : '';
    const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : '';
    if (!id || !title) {
      throw new Error(tr('脑图操作需要非空的 id 和 title', 'Mindmap mutation requires non-empty id and title'));
    }
    const existing = current.nodes.find((item) => item.id === id);
    const expectedKind = action === 'upsert_mindmap' ? 'mindmap' : 'folder';
    if (existing && existing.kind !== expectedKind) {
      throw new Error(tr(`脑图节点 ID "${id}" 类型冲突（已存在 ${existing.kind}）`, `Mindmap ID "${id}" already exists with kind "${existing.kind}"`));
    }
    const parentId = resolveDocumentParentId(args.parentId, existing, 'parentId');

    let record: MindmapNode;
    if (action === 'upsert_mindmap') {
      const source = typeof args.source === 'string' ? args.source : '';
      if (!source.trim()) {
        throw new Error(tr('upsert_mindmap 需要提供非空的 Mermaid 图表源码 source', 'upsert_mindmap requires a non-empty Mermaid diagram source'));
      }
      record = { id, title, parentId, kind: 'mindmap', source };
    } else {
      record = { id, title, parentId, kind: 'folder' };
    }

    const idx = current.nodes.findIndex((item) => item.id === id);
    if (idx < 0) current.nodes.push(record);
    else current.nodes[idx] = record;

    if (args.linkedPageIds !== undefined || args.linkedFolderIds !== undefined) {
      current.links = [
        ...current.links.filter((l) => l.targetNodeId !== id),
        ...buildLinksForTarget(id, args.linkedPageIds, args.linkedFolderIds),
      ];
    }

    commit();
    return {
      action,
      id,
      title,
      linkCount: current.links.filter((l) => l.targetNodeId === id).length,
    };
  }

  if (action === 'delete') {
    const id = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : '';
    if (!id || !current.nodes.some((n) => n.id === id)) {
      throw new Error(tr(`找不到脑图或目录 "${id}"`, `Mindmap or folder "${id}" not found`));
    }
    const removedIds = mindmapDescendants(current, id);
    current.nodes = current.nodes.filter((n) => !removedIds.has(n.id));
    current.links = current.links.filter((l) => !removedIds.has(l.targetNodeId));
    commit();
    return { action, deletedIds: [...removedIds] };
  }

  throw new Error(tr(`不支持的脑图操作：${action}`, `Unsupported mindmap action: ${action}`));
}

export function auditProjectMindmaps(
  s: SitemapLayout & { pageSources: Record<string, string>; mindmaps?: MindmapWorkspace },
  filterPageId?: string | null,
): string[] {
  const pageIds = Object.keys(s.pageSources ?? {});
  if (pageIds.length === 0) return [];
  const mindmaps = s.mindmaps ?? emptyMindmaps();
  const docs = mindmaps.nodes.filter((n): n is Extract<MindmapNode, { kind: 'mindmap' }> => n.kind === 'mindmap');
  if (docs.length === 0) {
    return [
      tr(
        '项目已包含页面原型但尚未维护项目脑图（mindmaps 为空）；建议按模块目录补充全景功能脑图（mindmap）与核心业务流程/状态图并关联对应菜单或目录。',
        'Project has prototype pages but zero mindmaps; add module mindmap folders, a product panorama mindmap, and core workflow/state diagrams linked to folders or pages.',
      ),
    ];
  }
  const warnings: string[] = [];
  const resolve = mindmapContextResolver(mindmaps, s);
  for (const doc of docs) {
    const ctx = resolve(doc.id);
    if (filterPageId && !ctx.relatedPageIds.includes(filterPageId)) continue;
    if (!doc.source.trim()) {
      warnings.push(
        tr(
          `脑图「${ctx.path}」（${doc.id}）源码为空，请补充完整的 Mermaid 图表源码。`,
          `Mindmap "${ctx.path}" (${doc.id}) has empty Mermaid source.`,
        ),
      );
    }
    if (!filterPageId && ctx.links.length === 0) {
      warnings.push(
        tr(
          `脑图「${ctx.path}」（${doc.id}）尚未关联任何菜单目录或页面（可通过 linkedFolderIds 或 linkedPageIds 绑定）。`,
          `Mindmap "${ctx.path}" (${doc.id}) is not linked to any menu folder or page (bind via linkedFolderIds or linkedPageIds).`,
        ),
      );
    }
  }
  return warnings;
}
