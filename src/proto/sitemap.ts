import type { SitemapItem } from '../store/useProtoStore';
import type { DesignerPage } from './store/usePageStore';

export interface DesignerFolder {
  id: string;
  title: string;
  /** null means a top-level directory, never a guessed built-in parent. */
  parentFolderId: string | null;
}
/** Only built-in placements are overridden here. Custom objects retain their
 * authoritative parent fields in designerFolders/designerPages. */
export interface SitemapOverrides {
  folderParents: Record<string, string | null>;
  pageFolders: Record<string, string>;
  /** V5 archives predating deletion omit this field: no template nodes deleted. */
  deletedNodeIds?: string[];
}
export const emptySitemapOverrides = (): SitemapOverrides => ({ folderParents: {}, pageFolders: {} });
export interface FolderOption extends DesignerFolder { path: string; deprecated: boolean }
export type SitemapMoveTarget = { kind: 'folder'; id: string } | { kind: 'page'; id: string };
export interface SitemapLayout { sitemapBase: SitemapItem[]; designerFolders: DesignerFolder[]; designerPages: DesignerPage[]; sitemapOverrides: SitemapOverrides }

/** The template menu belongs to the project, not the editor application. */
export function sitemapCatalog(base: SitemapItem[]) {
  const builtinFolders = new Map<string, DesignerFolder & { deprecated: boolean }>();
  const builtinPages = new Map<string, { item: SitemapItem; folderId: string }>();
  const builtinNodes = new Map<string, SitemapItem>();
  const pageIds = new Set<string>();
  function collect(items: SitemapItem[], parentFolderId: string | null, deprecated = false, depth = 0) {
    if (!Array.isArray(items) || depth > 40) throw new Error('工程菜单模板结构或层级无效');
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || builtinNodes.has(item.id) || typeof item.title !== 'string' || !item.title.trim()) throw new Error('工程菜单模板标识或名称无效');
      if (item.deprecated !== undefined && typeof item.deprecated !== 'boolean') throw new Error('工程菜单归档状态无效');
      builtinNodes.set(item.id, item);
      if (builtinNodes.size > 2000) throw new Error('工程菜单模板节点过多');
      const archived = deprecated || item.deprecated === true;
      if (item.type === 'folder') {
        if (item.pageId !== undefined || !Array.isArray(item.children)) throw new Error('工程菜单目录格式无效');
        builtinFolders.set(item.id, { id: item.id, title: item.title, parentFolderId, deprecated: archived });
        collect(item.children, item.id, archived, depth + 1);
      } else if (item.type === 'page' || item.type === 'doc') {
        if (item.children !== undefined) throw new Error('页面或文档不能包含子目录');
        if (item.pageId === undefined && item.type === 'page' && archived) continue;
        if (typeof item.pageId !== 'string' || !item.pageId.trim() || pageIds.has(item.pageId)) throw new Error('工程菜单页面标识缺失或重复');
        pageIds.add(item.pageId);
        if (item.type === 'page') {
          if (parentFolderId === null) throw new Error('工程菜单页面缺少所属目录');
          builtinPages.set(item.pageId, { item, folderId: parentFolderId });
        }
      } else throw new Error('工程菜单节点类型无效');
    }
  }
  collect(base, null);
  return { builtinFolders, builtinPages, builtinNodes };
}
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export function validateSitemapOverrides(value: unknown, base: SitemapItem[]): asserts value is SitemapOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('菜单位置配置无效');
  const { builtinFolders, builtinPages, builtinNodes } = sitemapCatalog(base);
  const placements = value as Record<string, unknown>;
  if (placements.deletedNodeIds !== undefined) {
    if (!Array.isArray(placements.deletedNodeIds) || placements.deletedNodeIds.some(id => typeof id !== 'string' || !builtinNodes.has(id)) || new Set(placements.deletedNodeIds).size !== placements.deletedNodeIds.length) throw new Error('已删除菜单的标识无效');
  }
  for (const key of ['folderParents', 'pageFolders']) {
    const entries = placements[key];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('菜单位置配置缺少明确的目录或页面映射');
    for (const [id, parent] of Object.entries(entries)) {
      if (key === 'folderParents' ? !builtinFolders.has(id) : !builtinPages.has(id)) throw new Error('菜单位置配置引用未知的模板节点');
      if (!(key === 'folderParents' && parent === null) && (typeof parent !== 'string' || !parent)) throw new Error('目标菜单目录 ID 无效');
    }
  }
}
function allFolders(folders: DesignerFolder[], overrides: SitemapOverrides, base: SitemapItem[]) {
  const { builtinFolders } = sitemapCatalog(base);
  return new Map<string, DesignerFolder>([
    ...[...builtinFolders.values()].map(folder => [folder.id, { ...folder, parentFolderId: has(overrides.folderParents, folder.id) ? overrides.folderParents[folder.id] : folder.parentFolderId }] as const),
    ...folders.map(folder => [folder.id, folder] as const),
  ]);
}

export function validateDesignerFolders(value: unknown, overrides: SitemapOverrides, base: SitemapItem[]): asserts value is DesignerFolder[] {
  validateSitemapOverrides(overrides, base);
  const { builtinNodes, builtinPages } = sitemapCatalog(base);
  if (!Array.isArray(value)) throw new Error('菜单目录必须是数组');
  const ids = new Set<string>();
  for (const folder of value) {
    if (!folder || typeof folder !== 'object' || Array.isArray(folder) || typeof folder.id !== 'string' || !folder.id.trim()) throw new Error('菜单目录 ID 无效');
    if (builtinNodes.has(folder.id) || ids.has(folder.id)) throw new Error('菜单目录 ID 重复');
    ids.add(folder.id);
    if (typeof folder.title !== 'string' || !folder.title.trim() || folder.title !== folder.title.trim() || folder.title.length > 60) throw new Error('目录名称需为 1–60 个字符，首尾不能有空格');
    if (folder.parentFolderId !== null && (typeof folder.parentFolderId !== 'string' || !folder.parentFolderId)) throw new Error('上级目录 ID 无效');
  }
  const byId = allFolders(value, overrides, base);
  const deleted = new Set(overrides.deletedNodeIds);
  const names = new Map<string | null, Set<string>>();
  for (const folder of byId.values()) {
    if (!deleted.has(folder.id)) {
      if (!names.has(folder.parentFolderId)) names.set(folder.parentFolderId, new Set());
      const siblings = names.get(folder.parentFolderId)!;
      if (siblings.has(folder.title)) throw new Error('同一目录下已存在同名目录，请换一个名称');
      siblings.add(folder.title);
    }
    const ancestors = new Set([folder.id]);
    let parent = folder.parentFolderId;
    while (parent !== null) {
      if (ancestors.has(parent)) throw new Error('不能把目录移动到自身或自己的子目录中');
      ancestors.add(parent);
      if (ancestors.size > 40) throw new Error('菜单目录层级过深');
      const item = byId.get(parent);
      if (!item) throw new Error('上级菜单目录不存在');
      if (!deleted.has(folder.id) && deleted.has(parent)) throw new Error('上级菜单目录已删除');
      parent = item.parentFolderId;
    }
  }
  for (const [pageId, parent] of Object.entries(overrides.pageFolders)) {
    if (deleted.has(builtinPages.get(pageId)!.item.id)) continue;
    if (!byId.has(parent) || deleted.has(parent)) throw new Error('页面目标菜单目录不存在');
  }
}

export function folderOptions(folders: DesignerFolder[], overrides: SitemapOverrides, base: SitemapItem[]): FolderOption[] {
  validateDesignerFolders(folders, overrides, base);
  const { builtinFolders } = sitemapCatalog(base);
  const all = allFolders(folders, overrides, base);
  const result = new Map<string, FolderOption>();
  const resolve = (id: string): FolderOption => {
    const ready = result.get(id);
    if (ready) return ready;
    const folder = all.get(id)!; // Graph validity was checked above.
    const parent = folder.parentFolderId === null ? null : resolve(folder.parentFolderId);
    const option = { ...folder, path: parent ? `${parent.path} / ${folder.title}` : folder.title, deprecated: builtinFolders.get(id)?.deprecated === true || parent?.deprecated === true };
    result.set(id, option); return option;
  };
  all.forEach(folder => resolve(folder.id));
  const deleted = new Set(overrides.deletedNodeIds);
  return [...result.values()].filter(folder => !deleted.has(folder.id));
}

export function buildSitemap(folders: DesignerFolder[], pages: DesignerPage[], overrides: SitemapOverrides, base: SitemapItem[]): SitemapItem[] {
  const options = folderOptions(folders, overrides, base);
  const { builtinNodes } = sitemapCatalog(base);
  const byId = new Map(options.map(folder => [folder.id, { ...builtinNodes.get(folder.id), id: folder.id, title: folder.title, type: 'folder', deprecated: folder.deprecated, children: [] } as SitemapItem]));
  const parents = new Map(options.map(folder => [folder.id, folder.parentFolderId]));
  const tree: SitemapItem[] = [];
  const append = (node: SitemapItem, parent: string | null) => {
    if (parent === null) tree.push(node);
    else {
      const folder = byId.get(parent);
      if (!folder) throw new Error(`菜单“${node.title}”引用的目录不存在`);
      folder.children!.push(node);
    }
  };
  const pageIds = new Set(pages.map(page => page.pageId));
  const deleted = new Set(overrides.deletedNodeIds);
  const visit = (items: SitemapItem[], parent: string | null) => {
    for (const item of items) {
      if (item.type === 'folder') {
        if (!deleted.has(item.id)) append(byId.get(item.id)!, parents.get(item.id)!);
        if (item.children) visit(item.children, item.id);
      } else if (!deleted.has(item.id) && (!item.pageId || !pageIds.has(item.pageId))) {
        append({ ...item }, item.pageId && has(overrides.pageFolders, item.pageId) ? overrides.pageFolders[item.pageId] : parent);
      }
    }
  };
  visit(base, null);
  for (const folder of folders) append(byId.get(folder.id)!, folder.parentFolderId);
  for (const page of pages) append({ id: `node-${page.pageId}`, type: 'page', pageId: page.pageId, title: page.title }, page.folderId);
  return tree;
}

/** Only menu pages can own a database binding (not documents, folders or overlays). */
export function menuPageIds(layout: SitemapLayout) {
  const ids = new Set<string>();
  const visit = (items: SitemapItem[]) => {
    for (const item of items) {
      if (item.type === 'page' && item.pageId !== undefined) ids.add(item.pageId);
      if (item.children) visit(item.children);
    }
  };
  visit(buildSitemap(layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase));
  return ids;
}

export function sitemapItemLocation(layout: SitemapLayout, target: SitemapMoveTarget): { title: string; parentFolderId: string | null } {
  if (target.kind === 'folder') {
    const folder = folderOptions(layout.designerFolders, layout.sitemapOverrides, layout.sitemapBase).find(item => item.id === target.id);
    if (!folder || folder.deprecated) throw new Error('要移动的目录不存在或已归档');
    return folder;
  }
  const page = layout.designerPages.find(item => item.pageId === target.id);
  if (page) return { title: page.title, parentFolderId: page.folderId };
  const builtin = sitemapCatalog(layout.sitemapBase).builtinPages.get(target.id);
  if (!builtin || builtin.item.deprecated || layout.sitemapOverrides.deletedNodeIds?.includes(builtin.item.id)) throw new Error('要移动的页面不存在');
  return { title: builtin.item.title, parentFolderId: has(layout.sitemapOverrides.pageFolders, target.id) ? layout.sitemapOverrides.pageFolders[target.id] : builtin.folderId };
}

/** Compute the complete move before updating any state. IDs, sources, rows,
 * notes and links are untouched; moving a folder carries its whole subtree. */
export function prepareSitemapMove(layout: SitemapLayout, target: SitemapMoveTarget, parentFolderId: string | null): SitemapLayout {
  const current = sitemapItemLocation(layout, target);
  const folders = folderOptions(layout.designerFolders, layout.sitemapOverrides, layout.sitemapBase);
  if (parentFolderId !== null && !folders.some(folder => folder.id === parentFolderId && !folder.deprecated)) throw new Error('目标目录不存在或已归档');
  if (target.kind === 'page' && parentFolderId === null) throw new Error('请选择页面所属的菜单目录');
  if (current.parentFolderId === parentFolderId) return layout;
  const next: SitemapLayout = { ...layout };
  if (target.kind === 'folder') {
    if (sitemapCatalog(layout.sitemapBase).builtinFolders.has(target.id)) next.sitemapOverrides = { ...layout.sitemapOverrides, folderParents: { ...layout.sitemapOverrides.folderParents, [target.id]: parentFolderId } };
    else next.designerFolders = layout.designerFolders.map(folder => folder.id === target.id ? { ...folder, parentFolderId } : folder);
  } else if (layout.designerPages.some(page => page.pageId === target.id)) {
    next.designerPages = layout.designerPages.map(page => page.pageId === target.id ? { ...page, folderId: parentFolderId! } : page);
  } else {
    next.sitemapOverrides = { ...layout.sitemapOverrides, pageFolders: { ...layout.sitemapOverrides.pageFolders, [target.id]: parentFolderId! } };
  }
  validateDesignerFolders(next.designerFolders, next.sitemapOverrides, next.sitemapBase);
  return next;
}
