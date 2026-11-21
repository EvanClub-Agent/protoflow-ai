import { validatePageEvidence, type PageDependency, type AcceptanceCase } from './projectDependencies';
import { tr } from '../i18n/runtime';
import { folderOptions, prepareSitemapMove, sitemapCatalog, sitemapItemLocation, validateDesignerFolders, type DesignerFolder, type SitemapLayout, type SitemapMoveTarget } from '../proto/sitemap';
import type { HermesOperation } from './hermesClient';

import type { PagePlatform, ProjectMode } from '../proto/mobile/types';
import { plannedPagePlatform, type RequestedPage } from './projectPagePlatform';

export interface ProjectPlan {
  summary: string;
  folders: DesignerFolder[];
  pages: { pageId: string; title: string; folderId: string; requirements: string; platform?: PagePlatform; dependencies?: PageDependency[]; acceptanceCases?: AcceptanceCase[] }[];
  revision?: {
    pageId: string;
    merge?: { sourcePageId: string; overlayId: string; presentation: 'drawer' | 'modal'; sourceTitle?: string; plannedOnly?: boolean };
  };
  approved: boolean;
  /** Host pauses the previous plan while considering further instructions. */
  discussionPending?: true;
  generatedPageIds: string[];
  /** Host diagnostic retained for restarting an interrupted, uncommitted page. */
  lastGenerationFailure?: {
    pageId: string;
    diagnostic: string;
    /** True when the interrupted page left an unconfirmed/conflicting draft that must be archived before regenerating. */
    needsArchiveRestart?: boolean;
  };
}
export function failureDiagnosticNeedsArchiveRestart(diagnostic: string): boolean {
  if (!diagnostic || /登录账号|原登录账号|其他账号或会话|signed-in account|original account|another account or session/i.test(diagnostic)) return false;
  return /存在执行结果不明的操作|保留旧草稿，重新生成|不可自动恢复|升级前的恢复基线|(?:模型|项目指令|物料契约|会话|Hermes 环境)已变化，未自动覆盖当前项目|uncertain execution outcome|Keep old draft and regenerate|cannot be recovered automatically|pre-upgrade recovery baseline|did not overwrite current project automatically/i.test(
    diagnostic,
  );
}
export function failureNeedsArchiveRestart(
  failure?: ProjectPlan['lastGenerationFailure'],
): boolean {
  if (!failure) return false;
  if (typeof failure.needsArchiveRestart === 'boolean') return failure.needsArchiveRestart;
  return failureDiagnosticNeedsArchiveRestart(failure.diagnostic);
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export function validateProjectPlan(value: unknown): asserts value is ProjectPlan {
  const p = value as ProjectPlan;
  if (p?.discussionPending !== undefined && p.discussionPending !== true) throw new Error(tr('无效的方案讨论状态', 'Invalid plan discussion status'));
  if (!p || !text(p.summary) || typeof p.approved !== 'boolean' || !Array.isArray(p.folders) || !Array.isArray(p.pages) || !p.pages.length || p.pages.length > 100 || !Array.isArray(p.generatedPageIds)) throw new Error(tr('项目方案缺少需求摘要、目录或页面清单', 'Project plan is missing summary, folders, or page list'));
  const ids = new Set<string>();
  for (const f of p.folders) {
    if (!f || !text(f.id) || !text(f.title) || (f.parentFolderId !== null && !text(f.parentFolderId)) || ids.has(f.id)) throw new Error(tr('项目方案目录标识、层级或名称无效', 'Invalid folder ID, hierarchy, or title in project plan'));
    ids.add(f.id);
  }
  const pages = new Set<string>();
  for (const page of p.pages) {
    if (!page || !text(page.pageId) || !text(page.title) || !text(page.requirements) || pages.has(page.pageId) || ids.has(page.pageId)) throw new Error(tr('项目方案页面标识、名称或需求无效', 'Invalid page ID, title, or requirements in project plan'));
    if (!text(page.folderId)) throw new Error(tr(`页面 ${page.pageId} 缺少 folderId。请引用已有目录或在 folders 中声明所属目录。`, `Page ${page.pageId} is missing folderId. Reference an existing folder or declare it in folders.`));
    if (page.platform !== undefined && page.platform !== 'mobile' && page.platform !== 'desktop') throw new Error(tr(`页面 ${page.pageId} 的 platform 无效`, `Invalid platform on page ${page.pageId}`));
    validatePageEvidence(page);
    pages.add(page.pageId);
  }
  if (
    p.lastGenerationFailure !== undefined &&
    (!p.lastGenerationFailure ||
      !pages.has(p.lastGenerationFailure.pageId) ||
      !text(p.lastGenerationFailure.diagnostic) ||
      (p.lastGenerationFailure.needsArchiveRestart !== undefined &&
        typeof p.lastGenerationFailure.needsArchiveRestart !== 'boolean'))
  ) {
    throw new Error(tr('页面生成诊断无效', 'Invalid page generation diagnostic'));
  }
  if (new Set(p.generatedPageIds).size !== p.generatedPageIds.length || p.generatedPageIds.some(id => !pages.has(id))) throw new Error(tr('项目方案生成记录无效', 'Invalid generatedPageIds in project plan'));
  if (p.revision !== undefined) {
    if (!p.revision || !pages.has(p.revision.pageId)) throw new Error(tr('局部调整的目标页面不存在', 'Target page for revision does not exist'));
    const merge = p.revision.merge;
    if (merge !== undefined && (!merge || !text(merge.sourcePageId) || pages.has(merge.sourcePageId)
      || (merge.plannedOnly !== undefined && typeof merge.plannedOnly !== 'boolean') || (merge.sourceTitle !== undefined && !text(merge.sourceTitle))
      || !text(merge.overlayId) || !['drawer', 'modal'].includes(merge.presentation))) {
      throw new Error(tr('合并方案必须明确原菜单、保留页面和弹层', 'Merge plan must specify source menu, target page, and overlay'));
    }
  }
}
export function plannedFolders(layout: SitemapLayout, plan: ProjectPlan) {
  const folders = [...layout.designerFolders];
  const existing = folderOptions(folders, layout.sitemapOverrides, layout.sitemapBase);
  for (const folder of plan.folders) {
    const old = existing.find(item => item.id === folder.id);
    if (old) {
      if (old.title !== folder.title || old.parentFolderId !== folder.parentFolderId || old.deprecated) throw new Error(tr(`已有目录 ${folder.id} 与方案不一致，请保留原标识和层级`, `Existing folder ${folder.id} mismatches the plan; preserve its original ID and hierarchy`));
    } else folders.push(folder);
  }
  validateDesignerFolders(folders, layout.sitemapOverrides, layout.sitemapBase);
  const available = folderOptions(folders, layout.sitemapOverrides, layout.sitemapBase);
  for (const page of plan.pages) {
    if (!available.some(folder => folder.id === page.folderId && !folder.deprecated)) throw new Error(tr(`页面 ${page.pageId} 所属目录不存在`, `Folder for page ${page.pageId} does not exist`));
    const builtin = sitemapCatalog(layout.sitemapBase).builtinPages.get(page.pageId);
    const old = layout.designerPages.find(item => item.pageId === page.pageId) ?? (builtin ? { title: builtin.item.title, folderId: sitemapItemLocation(layout, { kind:'page', id:page.pageId }).parentFolderId } : undefined);
    if (old && (old.folderId !== page.folderId || old.title !== page.title)) throw new Error(tr(`页面 ${page.pageId} 的目录或名称与已有页面不一致`, `Folder or title of page ${page.pageId} mismatches the existing page`));
  }
  const known = new Set([...plan.pages.map(p => p.pageId), ...layout.designerPages.map(p => p.pageId), ...sitemapCatalog(layout.sitemapBase).builtinPages.keys()]);
  if (plan.revision?.merge) known.delete(plan.revision.merge.sourcePageId);
  for (const page of plan.pages) for (const dependency of page.dependencies ?? []) {
    if (!known.has(dependency.sourcePageId)) throw new Error(tr(`页面 ${page.title} 引用了未知的上游页面 ${dependency.sourcePageId}`, `Page ${page.title} references unknown upstream page ${dependency.sourcePageId}`));
  }
  return folders;
}
// A full plan is a replacement draft. Keep independent edits in their original
// order. A single-page revision may carry merge intent and cannot be discarded.
export function finalProjectDraftOperations(operations: HermesOperation[]): HermesOperation[] {
  const fullPlan = 'protoflow_set_project_plan';
  const lastDraft = operations.map(op => op.tool).lastIndexOf(fullPlan);
  const revisions = operations.filter(op => op.tool === 'protoflow_revise_project_page');
  if (revisions.length > 1 || (revisions.length && lastDraft !== -1)) {
    throw new Error(tr('整套方案和单页修订需要分别确认。请在本轮完善同一份完整方案，或只提交一项单页修订。', 'Full plans and single-page revisions must be confirmed separately. Refine a single full plan or submit only one page revision.'));
  }
  return operations.filter((op, index) => op.tool !== fullPlan || index === lastDraft);
}
/** Shared by the native staging tool and the host transaction. */
export function applyStructureOperation(snapshot: SitemapLayout & { projectPlan?: ProjectPlan | null }, tool: string, args: Record<string, unknown>, confirmedPlan = snapshot.projectPlan, mode?: ProjectMode, requestedPage?: RequestedPage) {
  if (tool === 'protoflow_set_project_plan') {
    const draft = args.plan as ProjectPlan;
    if (!draft || !Array.isArray(draft.pages)) throw new Error(tr('项目方案缺少页面清单', 'Project plan is missing page list'));
    validateProjectPlan({ ...draft, approved: false, generatedPageIds: [] });
    if (requestedPage && !draft.pages.some(page => page.pageId === requestedPage.pageId))
      throw new Error(tr(`方案缺少用户新建的页面 ${requestedPage.pageId}`, `Plan is missing user-created page ${requestedPage.pageId}`));
    const pages = draft.pages.map(page => {
      const requested = requestedPage?.pageId === page.pageId ? requestedPage.platform : undefined;
      if (requested && page.platform && requested !== page.platform) throw new Error(tr(`页面 ${page.pageId} 必须使用用户选择的 ${requested} 平台`, `Page ${page.pageId} must use the user-selected ${requested} platform`));
      if (!requested && page.platform && mode && mode !== 'hybrid' && page.platform !== mode) {
        const previous = confirmedPlan?.pages.find(old => old.pageId === page.pageId);
        if (previous?.platform !== page.platform && plannedPagePlatform(snapshot, page.pageId, undefined, mode) !== page.platform)
          throw new Error(tr(`页面 ${page.pageId} 应使用项目默认平台 ${mode}，跨端新页请在新建页面时明确选择平台`, `Page ${page.pageId} should use the project default platform ${mode}; explicitly choose a platform when creating a cross-platform page`));
      }
      const platform = plannedPagePlatform(snapshot, page.pageId, requested ?? page.platform, mode);
      return mode || requested || page.platform ? { ...page, platform } : page;
    });
    const generatedPageIds = pages.filter(page => confirmedPlan?.generatedPageIds.includes(page?.pageId)
      && confirmedPlan.pages.some(old => old.pageId === page.pageId && old.title === page.title
        && plannedPagePlatform(snapshot, old.pageId, old.platform, mode) === plannedPagePlatform(snapshot, page.pageId, page.platform, mode)
        && old.folderId === page.folderId && old.requirements === page.requirements
        && JSON.stringify(old.dependencies) === JSON.stringify(page.dependencies) && JSON.stringify(old.acceptanceCases) === JSON.stringify(page.acceptanceCases))).map(page => page.pageId);
    const plan = { summary: draft.summary, folders: draft.folders, pages, approved: false, generatedPageIds };
    validateProjectPlan(plan);
    plannedFolders(snapshot, plan);
    snapshot.projectPlan = plan;
  } else if (tool === 'protoflow_revise_project_page') {
    const { pageId, requirements, merge } = args;
    if (!text(pageId) || !text(requirements)) throw new Error(tr('请指定目标页面与完整需求', 'Specify target page and complete requirements'));
    let previous = snapshot.projectPlan;
    if (!previous?.pages.some(page => page.pageId === pageId)) {
      const location = sitemapItemLocation(snapshot, {kind:'page',id:pageId});
      if (location.parentFolderId === null) throw new Error(tr('目标页面需要一个有效的所属目录', 'Target page requires a valid parent folder'));
      const page = {pageId, requirements, title:location.title, folderId:location.parentFolderId};
      previous = previous ? { ...previous, pages:[...previous.pages,page] } : {
        summary:tr(`调整「${location.title}」：${requirements}`, `Revise "${location.title}": ${requirements}`), folders:[], pages:[page], approved:false, generatedPageIds:[],
      };
    }
    const revision: ProjectPlan['revision'] = { pageId };
    const unfinishedMerge = previous.revision?.pageId === pageId && !previous.generatedPageIds.includes(pageId)
      ? previous.revision.merge : undefined;
    if (merge !== undefined) {
      const source = merge as NonNullable<typeof revision.merge>;
      const existingPage = snapshot.designerPages.find(page => page.pageId === source?.sourcePageId);
      const plannedPage = previous.pages.find(page => page.pageId === source?.sourcePageId);
      // A draft-only source was removed from the proposed page list when
      // the first merge draft was staged, but has never existed in the menu.
      const priorSource = unfinishedMerge?.plannedOnly && unfinishedMerge.sourcePageId === source?.sourcePageId && unfinishedMerge.sourceTitle
        ? {pageId:unfinishedMerge.sourcePageId, title:unfinishedMerge.sourceTitle} : undefined;
      const origin = existingPage ?? plannedPage ?? priorSource;
      if (!origin || !source || source.sourcePageId === pageId || sitemapCatalog(snapshot.sitemapBase).builtinPages.has(source.sourcePageId)) {
        throw new Error(tr('合并来源必须是与目标不同的已有自定义菜单或方案页面', 'Merge source must be a distinct existing custom menu or planned page'));
      }
      revision.merge = { sourcePageId: origin.pageId, sourceTitle: origin.title, overlayId: source.overlayId, presentation: source.presentation, plannedOnly: existingPage === undefined };
    } else if (unfinishedMerge) revision.merge = unfinishedMerge;
    const plan: ProjectPlan = {
      ...previous, approved: false, revision,
      pages: previous.pages.filter(page => page.pageId !== revision.merge?.sourcePageId)
        .map(page => page.pageId === pageId ? { ...page, requirements, ...(args.dependencies !== undefined ? {dependencies: args.dependencies as PageDependency[]} : {}), ...(args.acceptanceCases !== undefined ? {acceptanceCases: args.acceptanceCases as AcceptanceCase[]} : {}) } : page),
      generatedPageIds: previous.generatedPageIds.filter(id => id !== pageId && id !== revision.merge?.sourcePageId),
    };
    delete plan.discussionPending;
    delete plan.lastGenerationFailure;
    validateProjectPlan(plan);
    plannedFolders(snapshot, plan);
    snapshot.projectPlan = plan;
  } else if (tool === 'protoflow_move_sitemap_item') {
    const target = args.target as SitemapMoveTarget;
    const parent = args.parentFolderId;
    if (!target || !['page','folder'].includes(target.kind) || !text(target.id) || (parent !== null && !text(parent))) throw new Error(tr('移动菜单需要准确的类型、标识与目标目录', 'Moving sitemap item requires exact kind, ID, and target folder'));
    Object.assign(snapshot, prepareSitemapMove(snapshot, target, parent));
    const plan = snapshot.projectPlan;
    if (plan) {
      if (target.kind === 'page' && parent !== null) plan.pages = plan.pages.map(page => page.pageId === target.id ? {...page, folderId: parent} : page);
      if (target.kind === 'folder') plan.folders = plan.folders.map(folder => folder.id === target.id ? {...folder, parentFolderId:parent} : folder);
    }
  } else if (tool === 'protoflow_upsert_folder') {
    const f = args.folder as DesignerFolder;
    if (!f || !text(f.id) || !text(f.title) || (f.parentFolderId !== null && !text(f.parentFolderId))) throw new Error(tr('目录需要明确的 id、title、parentFolderId（顶层为 null）', 'Folder requires explicit id, title, and parentFolderId (null for root)'));
    const folders = snapshot.designerFolders.filter(item => item.id !== f.id).concat(f);
    validateDesignerFolders(folders, snapshot.sitemapOverrides, snapshot.sitemapBase);
    snapshot.designerFolders = folders;
    if (snapshot.projectPlan) snapshot.projectPlan.folders = snapshot.projectPlan.folders.map(old => old.id === f.id ? { ...f } : old);
  } else throw new Error(tr('未知结构操作', 'Unknown structure operation'));
}
