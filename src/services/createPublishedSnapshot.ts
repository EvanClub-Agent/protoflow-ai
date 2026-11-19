import type { PublishedMenuItem } from './publishedSitemap';
import { buildSitemap } from '../proto/sitemap';
import { useProtoStore, type SitemapItem } from '../store/useProtoStore';
import { usePageStore, type DesignerPage } from '../proto/store/usePageStore';
import { parsePageSource } from '../proto/dsl/parser';
import { validatePublishedSnapshot, type PublishedSnapshot } from './publishedSnapshot';
import { walk } from '../proto/dsl/tree';
import { pageContractErrors } from '../proto/ai/pageContract';
import { printPageSource } from '../proto/dsl/printer';
import { isChartType } from '../proto/charts/model';
import { publishableNotes } from './publishedNotes';

type PublishablePageState = Pick<ReturnType<typeof usePageStore.getState>, 'pageSources' | 'designerPages' | 'designerFolders' | 'sitemapBase' | 'sitemapOverrides'>;
export function publishablePages(pages: PublishablePageState = usePageStore.getState()): DesignerPage[] {
  const metadata = new Map<string, DesignerPage>();
  const visit = (items: SitemapItem[], parent: string) => {
    for (const item of items) {
      if (item.type === 'page' && item.pageId) metadata.set(item.pageId, { pageId: item.pageId, title: item.title, folderId: parent });
      if (item.children) visit(item.children, item.id);
    }
  };
  visit(buildSitemap(pages.designerFolders, pages.designerPages, pages.sitemapOverrides, pages.sitemapBase), '');
  // User-created page metadata is authoritative for its exact pageId.
  for (const page of pages.designerPages) metadata.set(page.pageId, page);
  return Object.keys(pages.pageSources).map(pageId => {
    const page = metadata.get(pageId);
    if (!page) throw new Error(`页面 ${pageId} 缺少目录信息，请先修复工程页面目录`);
    return page;
  });
}

/** Preserve the entire designer tree, including empty and archived directories,
 * documentation entries and unfinished pages, with an explicit public DTO. */
export function publishableSitemap(): PublishedMenuItem[] {
  const state = usePageStore.getState();
  const copy = (items: SitemapItem[]): PublishedMenuItem[] => items.map(item => {
    const base = { id: item.id, title: item.title, deprecated: item.deprecated === true };
    if (item.type === 'folder') return { ...base, type: 'folder', children: copy(item.children ?? []) };
    if (item.pageId === undefined && !(item.type === 'page' && item.deprecated)) throw new Error(`菜单“${item.title}”缺少页面标识`);
    return { ...base, type: item.type, pageId: item.pageId === undefined ? null : item.pageId };
  });
  return copy(buildSitemap(state.designerFolders, state.designerPages, state.sitemapOverrides, state.sitemapBase));
}

export function createPublishedSnapshot(entryPageId: string): PublishedSnapshot {
  const project = useProtoStore.getState(), pages = usePageStore.getState();
  const snapshot: PublishedSnapshot = {
    formatVersion: 5, projectId: project.currentProjectMeta.projectId, title: project.currentProjectMeta.projectName, entryPageId,
    pages: publishablePages().map(page => {
      const result = parsePageSource(pages.pageSources[page.pageId]);
      if (!result.doc || result.issues.some(i => i.level === 'error')) throw new Error(`页面“${page.title}”有代码错误，修复后才能发布`);
      if (result.doc.root.type === 'MobilePage') {
        const issues = pageContractErrors(printPageSource(result.doc), project.dbTables, { tableRows: pages.tableRows });
        if (issues.length) throw new Error(`页面“${page.title}”不能发布：${issues.join('；')}`);
      }
      walk(result.doc.root, node => {
        if (isChartType(node.type) && node.props.source === 'table' && typeof node.props.table === 'string' && !Object.hasOwn(pages.tableRows, node.props.table)) {
          throw new Error(`图表 ${node.pfId} 的数据表尚无已保存的预览数据，请先准备数据后再发布`);
        }
      });
      return { pageId: page.pageId, title: page.title, folderId: page.folderId, doc: result.doc };
    }),
    sitemap: publishableSitemap(),
    // Format 5 preserves column-level isUnique and table-level uniqueConstraints so remote
    // MCP consumers can generate accurate DDL, while internal AI modeling notes stay local.
    tables: project.dbTables.map(({ id, tableName, cnName, domain, description, uniqueConstraints, columns, sharedByMenus }) => ({
      id, tableName, cnName, domain, description, sharedByMenus,
      ...(uniqueConstraints && uniqueConstraints.length ? { uniqueConstraints } : {}),
      columns: columns.map(column => ({ ...column })),
    })),
    // Materialize the same data used by local preview, including not-yet-visited
    // tables, so the viewer never generates a different sample on first access.
    tableRows: pages.snapshotPreviewRows(),
    // Publish only the explicit reader-facing note fields on published canvases.
    // compiledRule is internal editor/AI data and is not part of the share DTO.
    stickyNotes: project.stickyNotes.filter(note => Object.prototype.hasOwnProperty.call(pages.pageSources, note.pageId))
      .map(({ id, pageId, targetWidgetId, targetWidgetName, index, text, active }) => ({ id, pageId, targetWidgetId, targetWidgetName, index, text, active })),
  };
  const shared = publishableNotes(new Set(snapshot.pages.map(page => page.pageId)));
  if (shared.notes.length) Object.assign(snapshot, { notes: shared.notes, noteAssets: shared.noteAssets });
  validatePublishedSnapshot(snapshot);
  return structuredClone(snapshot);
}
