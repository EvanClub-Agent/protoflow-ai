import { SITEMAP_TREE, type SitemapItem } from '../store/useProtoStore';
import { folderOptions, sitemapCatalog } from '../proto/sitemap';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';

/** V1–V4 injected the business sample into every blank project. Keep only
 * template nodes referenced by saved designs, authored directory placements,
 * notes or table links. Never delete/rename a saved page or change its ID. */
export function legacyBlankSitemap(state: ProjectStateSnapshot): SitemapItem[] {
  const { builtinPages } = sitemapCatalog(SITEMAP_TREE);
  const pageIds = new Set(Object.keys(state.pageSources));
  state.designerPages.forEach(page => pageIds.add(page.pageId));
  state.stickyNotes.forEach(note => pageIds.add(note.pageId));
  state.dbTables.forEach(table => table.sharedByMenus.forEach(menu => pageIds.add(menu.pageId)));
  Object.keys(state.sitemapOverrides.pageFolders).forEach(id => pageIds.add(id));
  const folders = new Map(folderOptions(state.designerFolders, state.sitemapOverrides, SITEMAP_TREE).map(folder => [folder.id, folder]));
  const neededFolders = new Set<string>();
  const retainAncestors = (id: string | null) => {
    while (id !== null && !neededFolders.has(id)) {
      neededFolders.add(id);
      const folder = folders.get(id);
      if (!folder) throw new Error('旧版工程引用不存在的菜单目录');
      id = folder.parentFolderId;
    }
  };
  state.designerFolders.forEach(folder => retainAncestors(folder.id));
  state.designerPages.forEach(page => retainAncestors(page.folderId));
  Object.keys(state.sitemapOverrides.folderParents).forEach(retainAncestors);
  const customPageIds = new Set(state.designerPages.map(page => page.pageId));
  for (const pageId of pageIds) {
    const builtin = builtinPages.get(pageId);
    // Base nodes still declare their original containing folder; the override
    // supplies their current placement. Retain both contracts during migration.
    if (builtin) retainAncestors(builtin.folderId);
    if (builtin && !customPageIds.has(pageId)) retainAncestors(Object.prototype.hasOwnProperty.call(state.sitemapOverrides.pageFolders, pageId) ? state.sitemapOverrides.pageFolders[pageId] : builtin.folderId);
  }
  // Even when a custom page shadows a built-in page, its explicit override must
  // retain its declared target so the saved contract remains valid.
  Object.values(state.sitemapOverrides.pageFolders).forEach(retainAncestors);
  const prune = (items: SitemapItem[]): SitemapItem[] => items.flatMap(item => {
    if (item.type === 'folder') return neededFolders.has(item.id) ? [{ ...item, children: prune(item.children!) }] : [];
    return item.pageId !== undefined && pageIds.has(item.pageId) ? [{ ...item }] : [];
  });
  return prune(SITEMAP_TREE);
}
