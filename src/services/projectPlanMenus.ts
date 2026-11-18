import { folderOptions } from '../proto/sitemap';
import { printPageSource } from '../proto/dsl/printer';
import { parsePageSource } from '../proto/dsl/parser';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import type { HermesOperation } from './hermesClient';
import { plannedFolders, type ProjectPlan } from './projectPlan';

import type { ProjectMode } from '../proto/mobile/types';
import { pageRootType, plannedPagePlatform } from './projectPagePlatform';

export function pagePrototypeIssue(source: string) {
  if (!parsePageSource(source).doc?.root.children.some(child => child.kind === 'node')) return '页面只有空框架';
  if (source.includes('从左侧物料库拖入组件开始设计')) return '页面仍包含编辑器的起始占位提示';
  return '';
}

/** A full proposal can declare both future menus and data to be used by them. */
export function includesPlanAndSchema(operations: HermesOperation[]) {
  return operations.some(op => op.tool === 'protoflow_set_project_plan')
    && operations.some(op => op.tool === 'protoflow_upsert_db_table' || op.tool === 'protoflow_upsert_db_column');
}

/** The same menu scaffold is used for preflight, confirmation and resuming generation.
 * Only the plan declares pages. A table reference can never create one. */
export function planMenuOperations(state: ProjectStateSnapshot, plan: ProjectPlan, onlyPageId?: string, mode?: ProjectMode): HermesOperation[] {
  const folders = plannedFolders(state, plan);
  const available = folderOptions(folders, state.sitemapOverrides, state.sitemapBase);
  const current = new Set(folderOptions(state.designerFolders, state.sitemapOverrides, state.sitemapBase).map(f => f.id));
  const pages = onlyPageId === undefined ? plan.pages : plan.pages.filter(p => p.pageId === onlyPageId);
  const needed = new Set<string>();
  const byId = new Map(available.map(folder => [folder.id, folder]));
  for (const page of pages) {
    let parent: string | null = page.folderId;
    while (parent !== null && !needed.has(parent)) {
      needed.add(parent);
      parent = byId.get(parent)!.parentFolderId;
    }
  }
  // folderOptions returns parents before children, even for an unordered proposal.
  const operations: HermesOperation[] = available
    .filter(f => !current.has(f.id) && (onlyPageId === undefined || needed.has(f.id)))
    .map(({id, title, parentFolderId}) => ({tool:'protoflow_upsert_folder', args:{folder:{id, title, parentFolderId}}}));
  for (const page of pages) {
    const { pageId, title, folderId } = page;
    const type = pageRootType(plannedPagePlatform(state, pageId, page.platform, mode));
    const saved = state.pageSources[pageId];
    if (saved) {
      const root = parsePageSource(saved).doc?.root;
      // Resume an older mobile plan that only has the legacy empty desktop scaffold.
      if (type !== 'MobilePage' || root?.type !== 'Page' || root.pfId !== 'project-root' || root.children.length) continue;
    }
    operations.push({tool:'protoflow_apply_tsx_patch', args:{pageId, title, folderId,
      source:printPageSource({header:[], root:{kind:'node', type, pfId:'project-root', props:{title}, children:[]}})}});
  }
  return operations;
}
