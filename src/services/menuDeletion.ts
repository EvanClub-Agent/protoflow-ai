import { buildSitemap, sitemapCatalog } from '../proto/sitemap';
import { parsePageSource } from '../proto/dsl/parser';
import { printPageSource } from '../proto/dsl/printer';
import { walk } from '../proto/dsl/tree';
import { isActionChain, type PropValue } from '../proto/types';
import { usePageStore } from '../proto/store/usePageStore';
import { useProtoStore, type SitemapItem } from '../store/useProtoStore';
import { captureProjectPayload, applyProjectEditPayload } from './projectStorage';
import { validateProjectPayload } from './projectValidation';
import type { PflowBinaryPayload } from '../utils/pflowBinaryCodec';

function flatten(items: SitemapItem[]): SitemapItem[] {
  return items.flatMap(item => [item, ...flatten(item.children || [])]);
}
const revision = (p: PflowBinaryPayload) => JSON.stringify([p.meta.projectId, p.stateSnapshot]);
export function prepareMenuDeletion(base: PflowBinaryPayload, nodeId: string) {
  const next = structuredClone(base), s = next.stateSnapshot;
  const tree = buildSitemap(s.designerFolders, s.designerPages, s.sitemapOverrides, s.sitemapBase);
  const target = flatten(tree).find(item => item.id === nodeId);
  if (!target) throw new Error('要删除的菜单或目录已不存在');
  // Use the displayed hierarchy, including moves. A child moved out of this
  // directory must survive even if it was originally in the template subtree.
  const removed = flatten([target]);
  const nodeIds = new Set(removed.map(item => item.id));
  const pageIds = new Set(removed.flatMap(item => item.pageId === undefined ? [] : [item.pageId]));
  const folderIds = new Set(removed.filter(item => item.type === 'folder').map(item => item.id));
  const { builtinNodes } = sitemapCatalog(s.sitemapBase);
  const deleted = new Set(s.sitemapOverrides.deletedNodeIds);
  for (const node of builtinNodes.values()) {
    if (nodeIds.has(node.id) || (node.pageId !== undefined && pageIds.has(node.pageId))) deleted.add(node.id);
  }
  s.sitemapOverrides = {
    deletedNodeIds: [...deleted],
    folderParents: Object.fromEntries(Object.entries(s.sitemapOverrides.folderParents).filter(([id]) => !deleted.has(id))),
    pageFolders: Object.fromEntries(Object.entries(s.sitemapOverrides.pageFolders).filter(([id]) => !pageIds.has(id))),
  };
  s.mindmaps.links = s.mindmaps.links.filter(link => link.page.kind === 'page' ? !pageIds.has(link.page.pageId) : !folderIds.has(link.page.folderId));
  if (s.projectNotes) {
    s.projectNotes.links = s.projectNotes.links.filter(link => link.page.kind === 'page' ? !pageIds.has(link.page.pageId) : !folderIds.has(link.page.folderId));
    if (!s.projectNotes.nodes.length && !s.projectNotes.links.length) delete s.projectNotes;
  }
  s.designerFolders = s.designerFolders.filter(folder => !folderIds.has(folder.id));
  s.designerPages = s.designerPages.filter(page => !pageIds.has(page.pageId));
  s.pageSources = Object.fromEntries(Object.entries(s.pageSources).filter(([id]) => !pageIds.has(id)));
  const stickyCount = s.stickyNotes.filter(note => pageIds.has(note.pageId)).length;
  s.stickyNotes = s.stickyNotes.filter(note => !pageIds.has(note.pageId));
  s.closedLoopIssues = s.closedLoopIssues.filter(issue => !pageIds.has(issue.pageId));
  // Canvas components live in pageSources. widgets holds the legacy sandbox's
  // fixed configuration registry (also used by its inspector), not menu entries.
  let bindingCount = 0, linkCount = 0;
  s.dbTables = s.dbTables.map(table => {
    const sharedByMenus = table.sharedByMenus.filter(menu => !pageIds.has(menu.pageId));
    bindingCount += table.sharedByMenus.length - sharedByMenus.length;
    return { ...table, sharedByMenus };
  });
  const changedSources: string[] = [];
  for (const [id, source] of Object.entries(s.pageSources)) {
    const parsed = parsePageSource(source);
    if (!parsed.doc || parsed.issues.length) throw new Error(`页面 ${id} 的源码无法解析，请修复后再删除相关菜单`);
    let changed = false;
    const removeLinks = (value: PropValue): PropValue => {
      if (isActionChain(value)) {
        const calls = value.calls.filter(call => {
          const remove = call.name === 'navigate' && typeof call.args[0] === 'string' && pageIds.has(call.args[0]);
          if (remove) { linkCount++; changed = true; }
          return !remove;
        });
        return { ...value, calls };
      }
      if (Array.isArray(value)) return value.map(removeLinks);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, removeLinks(v)])) as PropValue;
      return value;
    };
    walk(parsed.doc.root, node => {
      node.props = Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key, removeLinks(value)]));
    });
    if (changed) { s.pageSources[id] = printPageSource(parsed.doc); changedSources.push(id); }
  }
  const remaining = flatten(buildSitemap(s.designerFolders, s.designerPages, s.sitemapOverrides, s.sitemapBase));
  if (pageIds.has(s.activePageId)) {
    const selectable = remaining.filter(item => item.pageId !== undefined);
    const first = selectable.find(item => !item.deprecated) || selectable[0];
    // Empty selection is an explicit state when the last page/doc is deleted.
    s.activePageId = first === undefined ? '' : first.pageId!;
  }
  next.meta = { ...next.meta, pageCount: Object.keys(s.pageSources).length, stickyCount: s.stickyNotes.length };
  validateProjectPayload(next);
  return {
    projectId: base.meta.projectId, before: base, next, revision: revision(base),
    title: target.title, kind: target.type, pageIds: [...pageIds], changedSources,
    pageCount: removed.filter(item => item.type !== 'folder').length,
    folderCount: folderIds.size, stickyCount, bindingCount, linkCount,
  };
}
export type MenuDeletionPlan = ReturnType<typeof prepareMenuDeletion>;
export function deleteMenu(plan: MenuDeletionPlan) {
  if (revision(captureProjectPayload()) !== plan.revision) throw new Error('项目内容已变化，请关闭弹窗后重新选择删除');
  const history = usePageStore.getState().history;
  applyProjectEditPayload(plan.next);
  const cleared = new Set([...plan.pageIds, ...plan.changedSources]);
  usePageStore.setState({ history: Object.fromEntries(Object.entries(history).filter(([id]) => !cleared.has(id))) });
  const after = revision(captureProjectPayload());
  return {
    canUndo: () => !useProtoStore.getState().isProjectClosed && revision(captureProjectPayload()) === after,
    undo: () => {
      if (useProtoStore.getState().isProjectClosed || revision(captureProjectPayload()) !== after) throw new Error('项目内容已变化，不能再撤销这次删除');
      applyProjectEditPayload(plan.before);
      usePageStore.setState({ history });
    },
  };
}
