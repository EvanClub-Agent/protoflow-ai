import { reviewPageDependencies } from './projectDependencies';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import { projectPageCatalog } from './projectAnalysis';
import { diagramRelations } from '../proto/database/relations';
import { buildSitemap } from '../proto/sitemap';
import { pagePrototypeIssue } from './projectPlanMenus';
import { buildGeneratingTargetStatus } from './dependencyFootprint';
import { parsePageSource } from '../proto/dsl/parser';
import { walk } from '../proto/dsl/tree';
import { isActionChain, type PropValue } from '../proto/types';

/** Only host-applied records belong here. A proposed record lives in the change review. */
export interface ProjectAgreement {
  id: string;
  kind: 'requirement' | 'field_constraint' | 'design';
  title: string;
  text: string;
  /** Empty means project-wide; otherwise exact menu page IDs. */
  pageIds: string[];
}

export function validateProjectAgreements(value: unknown): asserts value is ProjectAgreement[] {
  if (!Array.isArray(value)) throw new Error('项目约定必须是数组');
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['id','kind','title','text','pageIds'].includes(key)) ||
      !['requirement', 'field_constraint', 'design'].includes(row.kind) ||
      ['id', 'title', 'text'].some(key => typeof row[key] !== 'string' || !row[key].trim()) ||
      !Array.isArray(row.pageIds) || row.pageIds.some((id: unknown) => typeof id !== 'string' || !id.trim()) ||
      new Set(row.pageIds).size !== row.pageIds.length || ids.has(row.id)) throw new Error('项目约定的标识、类型、正文或页面范围无效');
    if (row.title.length > 160 || row.text.length > 12000) throw new Error('项目约定过长，请按独立规则拆分');
    ids.add(row.id);
  }
}

export function applyProjectAgreement(snapshot: Pick<ProjectStateSnapshot, 'projectAgreements' | 'designerPages' | 'designerFolders' | 'sitemapBase' | 'sitemapOverrides' | 'pageSources' | 'projectPlan'>,
  agreement: unknown) {
  validateProjectAgreements([agreement]);
  const record = agreement as ProjectAgreement;
  const known = new Set(projectPageCatalog(snapshot).map(page => page.pageId));
  for (const page of snapshot.projectPlan?.pages ?? []) known.add(page.pageId);
  if (record.pageIds.some(id => !known.has(id))) throw new Error('项目约定引用了不存在的页面，请使用准确的 pageId');
  const records = snapshot.projectAgreements ?? []; // V7 archives predating project agreements.
  snapshot.projectAgreements = records.some(row => row.id === record.id)
    ? records.map(row => row.id === record.id ? structuredClone(record) : row)
    : [...records, structuredClone(record)];
}

/** Deterministic facts from the project, never an LLM summary of a conversation. */
export function projectExecutionBrief(
  snapshot: ProjectStateSnapshot,
  focus: { pageId?: string; folderId?: string } = {},
  options?: { generatingTargetPageId?: string },
) {
  if (!focus || typeof focus !== 'object' || Object.keys(focus).some(key => !['pageId', 'folderId'].includes(key)) ||
    Object.values(focus).some(value => typeof value !== 'string' || !value.trim())) throw new Error('资料范围必须使用明确的页面或目录标识');
  if (focus.pageId !== undefined && focus.folderId !== undefined) throw new Error('请选择页面或目录范围');
  const catalog = projectPageCatalog(snapshot);
  const byPage = new Map(catalog.map(page => [page.pageId, page]));
  const plan = snapshot.projectPlan;
  const approvedPlan = plan?.approved ? plan : null;
  if (focus.pageId !== undefined && !byPage.has(focus.pageId) && !plan?.pages.some(page => page.pageId === focus.pageId)) throw new Error('未知页面范围');
  const selected = new Set<string>();
  if (focus.pageId !== undefined) selected.add(focus.pageId);
  if (focus.folderId !== undefined) {
    // Catalog paths are display strings, not identities. Walk the actual sitemap IDs.
    const roots = snapshot.sitemapBase;
    const folderIds = new Set(snapshot.designerFolders.map(folder => folder.id));
    const visit = (items: typeof roots) => items.forEach(item => { if (item.type === 'folder') { folderIds.add(item.id); visit(item.children ?? []); } });
    visit(roots);
    if (!folderIds.has(focus.folderId)) throw new Error('未知目录范围');
    // Use structural parent/child IDs, never a title or path-prefix comparison.
    const tree = buildSitemap(snapshot.designerFolders, snapshot.designerPages, snapshot.sitemapOverrides, snapshot.sitemapBase);
    const select = (items: typeof tree, inside = false) => items.forEach(item => {
      if (item.type === 'folder') select(item.children ?? [], inside || item.id === focus.folderId);
      else if (inside && item.pageId !== undefined) selected.add(item.pageId);
    });
    select(tree);
  }
  const tables = snapshot.dbTables;
  const sourceTables = new Set<string>(), navigation = new Set<string>();
  for (const pageId of selected) {
    const source = snapshot.pageSources[pageId];
    if (source === undefined) continue; // Planned pages may not yet have source.
    const doc = parsePageSource(source).doc;
    if (!doc) continue; // The normal source validator reports malformed saved pages.
    const actions = (value: PropValue) => {
      if (isActionChain(value)) {
        for (const call of value.calls) if (call.name === 'navigate' && typeof call.args[0] === 'string') navigation.add(call.args[0]);
      } else if (Array.isArray(value)) value.forEach(actions);
      else if (value && typeof value === 'object') Object.values(value).forEach(actions);
    };
    walk(doc.root, node => {
      if (typeof node.props.table === 'string') sourceTables.add(node.props.table);
      Object.values(node.props).forEach(actions);
    });
  }
  const declaredUpstream = new Set<string>();
  for (const page of plan?.pages ?? []) if (selected.has(page.pageId)) {
    for (const dependency of page.dependencies ?? []) {
      declaredUpstream.add(dependency.sourcePageId);
      if (dependency.kind !== 'pending') sourceTables.add(dependency.sourceTableId);
      if (dependency.kind === 'foreignKey') sourceTables.add(dependency.tableId);
    }
  }
  const directTables = tables.filter(table => sourceTables.has(table.id) || table.sharedByMenus.some(binding => selected.has(binding.pageId)));
  const tableIds = new Set(directTables.map(table => table.id));
  // Resolve physical references through the existing schema contract before using internal IDs.
  const relations = diagramRelations(tables);
  const directIds = new Set(tableIds);
  for (const relation of relations.relations) {
    if (directIds.has(relation.fromTableId)) tableIds.add(relation.toTableId);
    if (directIds.has(relation.toTableId)) tableIds.add(relation.fromTableId);
  }
  const relatedPageIds = new Set([...declaredUpstream, ...navigation, ...tables.filter(table => tableIds.has(table.id)).flatMap(table => table.sharedByMenus.map(binding => binding.pageId))]);
  const merge = approvedPlan?.revision?.merge;
  if (merge && selected.has(approvedPlan!.revision!.pageId)) relatedPageIds.add(merge.sourcePageId);
  const focused = focus.pageId !== undefined || focus.folderId !== undefined;
  const evidence = reviewPageDependencies(snapshot);
  const completed = (approvedPlan?.pages ?? []).filter(page => approvedPlan!.generatedPageIds.includes(page.pageId) &&
    Object.prototype.hasOwnProperty.call(snapshot.pageSources, page.pageId) && !pagePrototypeIssue(snapshot.pageSources[page.pageId])).map(page => page.pageId);
  const generatingTargetPageId = options?.generatingTargetPageId;
  return {
    version: 1,
    scope: focus,
    agreementCatalog: (snapshot.projectAgreements ?? []).map(({id,kind,title,pageIds}) => ({id,kind,title,pageIds})),
    agreements: (snapshot.projectAgreements ?? []).filter(row => !row.pageIds.length || row.pageIds.some(id => selected.has(id))),
    plan: approvedPlan
      ? generatingTargetPageId
        ? {
            summary: approvedPlan.summary,
            discussionPending: approvedPlan.discussionPending === true,
            ...(approvedPlan.revision !== undefined ? { revision: approvedPlan.revision } : {}),
            pages: focused
              ? approvedPlan.pages.filter(page => selected.has(page.pageId))
              : approvedPlan.pages.map(({ pageId, title, folderId }) => ({ pageId, title, folderId, requirementsAvailable: true })),
            targetStatus: buildGeneratingTargetStatus(snapshot, generatingTargetPageId),
          }
        : {
            summary: approvedPlan.summary,
            discussionPending: approvedPlan.discussionPending === true,
            pages: focused
              ? approvedPlan.pages.filter(page => selected.has(page.pageId))
              : approvedPlan.pages.map(({ pageId, title, folderId }) => ({ pageId, title, folderId, requirementsAvailable: true })),
            lastGenerationFailure: approvedPlan.lastGenerationFailure,
            progress: {
              total: approvedPlan.pages.length,
              generatedPageIds: completed,
              remainingPageIds: approvedPlan.pages.filter(page => !completed.includes(page.pageId)).map(page => page.pageId),
            },
          }
      : null,
    pageCatalog: catalog.filter(page => !focused || selected.has(page.pageId)),
    relatedPages: catalog.filter(page => relatedPageIds.has(page.pageId) && !selected.has(page.pageId)),
    tableCatalog: tables.map(table => ({ id: table.id, tableName: table.tableName, cnName: table.cnName, ...(table.modeling ? {entity:table.modeling.entity,grain:table.modeling.grain} : {}),
      pageIds: table.sharedByMenus.map(binding => binding.pageId) })),
    dependencyReview: {
      links: evidence.links.filter(link => !focused || selected.has(link.pageId) || selected.has(link.sourcePageId)),
      sampleCharts: evidence.sampleCharts.filter(item => !focused || selected.has(item.pageId)),
      cases: evidence.cases.filter(item => !focused || selected.has(item.pageId)),
      undeclaredPageIds: evidence.undeclaredPageIds.filter(id => !focused || selected.has(id)),
    },
    relationIssues: relations.issues,
    tables: focused ? tables.filter(table => tableIds.has(table.id)) : [],
    requirementCatalog: snapshot.stickyNotes.filter(note => note.active && (!focused || selected.has(note.pageId))).map(({id,pageId,targetWidgetId})=>({id,pageId,targetWidgetId})),
    requirements: focused ? snapshot.stickyNotes.filter(note => note.active && selected.has(note.pageId)) : [],
    recovery: 'After compaction or uncertainty, read this tool again. Project facts override historical drafts. Read exact page source, table schemas and linked notes as needed; progress means saved prototype, not business acceptance.',
  };
}

