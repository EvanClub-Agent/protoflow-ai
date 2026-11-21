import { preparePreviewScenario } from '../proto/database/previewScenario';
import { generationEvidenceIssues, regressedPageDependencies } from './projectDependencies';
import { mergeRequirementRecords, reviewRequirementRecords, type RequirementRecord } from '../proto/database/requirementReview';
import { reviewDatabaseChanges } from '../proto/database/designReview';
import { finishMenuMerge } from './projectMenuMerge';
import { migrateNotePageLinks, noteAiContext } from '../proto/notes';
import { applyProjectAgreement } from './projectKnowledge';
import { applyStructureOperation } from './projectPlan';
import { includesPlanAndSchema, pagePrototypeIssue, planMenuOperations } from './projectPlanMenus';
import {
  useProtoStore,
  type DBTableSchema,
} from "../store/useProtoStore";
import { tableRowsForProjectRevision, usePageStore } from "../proto/store/usePageStore";
import { buildSitemap, folderOptions, menuPageIds } from "../proto/sitemap";
import { captureProjectPayload } from "./projectStorage";
import { projectPageCatalog } from './projectAnalysis';
import { validateProjectPayload } from "./projectValidation";
import { parsePageSource } from "../proto/dsl/parser";
import { printPageSource } from "../proto/dsl/printer";
import { findNode, walk } from "../proto/dsl/tree";
import { validateMaterialSource } from '../proto/registry/materialContract';
import { pageContractErrors } from '../proto/ai/pageContract';
export { pageContractErrors } from '../proto/ai/pageContract';
import {
  isNode,
  type ProtoNode,
} from "../proto/types";
import type { HermesOperation } from "./hermesClient";
import type { PflowBinaryPayload } from "../utils/pflowBinaryCodec";
import { checkAiPagePlatform, type RequestedPage } from './projectPagePlatform';
import { OVERLAY_TYPES } from '../proto/registry/meta';
import { verifyDependencyFootprint, type DependencyFootprintV3 } from './dependencyFootprint';
import { reshapeAxurePage } from '../proto/axure/optimization';

export function projectContext(requestedPage?: RequestedPage, payloadOverride?: PflowBinaryPayload) {
  const p = payloadOverride ?? captureProjectPayload();
  const s = p.stateSnapshot;
  const liveNotes = payloadOverride
    ? (useProtoStore.getState().projectNotes ?? s.projectNotes ?? { nodes: [], links: [] })
    : (s.projectNotes ?? { nodes: [], links: [] });
  const notes = noteAiContext(liveNotes, s);
  return {
    projectId: p.meta.projectId,
    projectName: p.meta.projectName,
    projectMode: p.meta.projectMode,
    ...(requestedPage && { requestedPage }),
    mindmaps: s.mindmaps,
    /** Compact catalog of PM notes; full Markdown is read through protoflow_get_project_notes. */
    projectNotes: notes.catalog,
    projectNoteDocuments: notes.documents,
    pageCatalog: projectPageCatalog(s),
    tableRows: s.tableRows,
    pageSources: s.pageSources,
    designerPages: s.designerPages,
    designerFolders: s.designerFolders,
    sitemapBase: s.sitemapBase,
    sitemapOverrides: s.sitemapOverrides,
    sitemap: buildSitemap(s.designerFolders, s.designerPages, s.sitemapOverrides, s.sitemapBase),
    folders: folderOptions(s.designerFolders, s.sitemapOverrides, s.sitemapBase).filter(folder => !folder.deprecated),
    projectPlan: s.projectPlan === undefined ? null : s.projectPlan,
    projectAgreements: s.projectAgreements ?? [],
    databaseRequirements: s.databaseRequirements,
    dbTables: s.dbTables,
    stickyNotes: s.stickyNotes,
    closedLoopIssues: s.closedLoopIssues,
    compositeBlocks: usePageStore.getState().compositeBlocks,
    contracts: {
      sticky: {
        id: "stable ID",
        pageId: "exact page ID",
        targetWidgetId: "exact pfId",
        targetWidgetName: "display label",
        index: 1,
        text: "requirement",
        compiledRule:
          "declarative requirement; no invented executable functions",
        active: true,
      },
      auditIssue: {
        id: "stable ID",
        scope: "module | project",
        pageId: "exact page ID",
        moduleTitle: "module",
        category: "原型组件 ↔ 数据库表脱节",
        severity: "critical | warning",
        title: "finding",
        brokenChainDesc: "evidence with page/pfId/field",
        targetWidgetId: "exact pfId",
        targetWidgetName: "label",
        targetTableId: "exact table ID, or empty string '' when no table is involved",
        aiQuestion: "question",
        options: [
          {
            id: "stable option ID",
            label: "fix",
            description: "explanation",
            stickyPatchText: "requirement change",
            dbPatchSummary: "schema change",
          },
        ],
        status: "open | resolved",
      },
      tableDomains: [...new Set(s.dbTables.map(t => t.domain))],
      folderIds: folderOptions(s.designerFolders, s.sitemapOverrides, s.sitemapBase).filter(folder => !folder.deprecated).map(folder => folder.id),
    },
  };
}
export const projectRevision = () => {
  // Notes are reference input that the PM keeps editing while AI runs; AI never writes them,
  // so note edits must not invalidate an AI result.
  // Opening a menu lazily seeds its preview tables. Keep those rows in the AI
  // snapshot and saved project, but do not mistake initialization for a user edit.
  const { projectNotes: _notes, projectNoteDocuments: _documents, tableRows: _rows, ...context } = projectContext();
  return JSON.stringify({
    context,
    tableRows: tableRowsForProjectRevision(),
    widgets: useProtoStore.getState().widgets,
  });
};

/** A durable recovery baseline must not depend on the in-memory preview-row WeakMap.
 * Keep projectRevision's live-turn fence separate: opening a preview during a turn
 * is still not an authored edit. Recovery compares the saved inputs across restarts. */
export function projectRecoveryRevision(payload: PflowBinaryPayload) {
  const { projectNotes: _notes, projectNoteDocuments: _documents, tableRows, ...context } = projectContext(undefined, payload);
  if (context.projectPlan) {
    const { lastGenerationFailure: _failure, ...plan } = context.projectPlan;
    context.projectPlan = plan;
  }
  return JSON.stringify({ context, tableRows, widgets: payload.stateSnapshot.widgets, projectNotes: payload.stateSnapshot.projectNotes });
}
function enforceScope(before: string, after: string, selectedId: string) {
  const old = parsePageSource(before).doc,
    newDoc = parsePageSource(after).doc;
  if (!old || !newDoc) throw new Error("无法校验局部修改范围");
  const selected = findNode(old.root, selectedId);
  if (!selected) throw new Error("选中组件已不存在");
  const allowed = new Set<string>();
  walk(selected, (n) => allowed.add(n.pfId));
  const ids = new Set<string>();
  walk(old.root, (n) => ids.add(n.pfId));
  walk(old.root, (n) => {
    if (allowed.has(n.pfId)) return;
    const updated = findNode(newDoc.root, n.pfId);
    if (updated)
      for (const child of updated.children) {
        if (
          isNode(child) &&
          !ids.has(child.pfId) &&
          !(
            n.pfId === old.root.pfId && OVERLAY_TYPES.has(child.type)
          )
        )
          throw new Error(`AI 在选中范围外新增组件：${child.pfId}`);
      }
    const shape = (node: ProtoNode) => ({
      type: node.type,
      props: node.props,
      children: node.children
        .filter((c) => !isNode(c) || ids.has(c.pfId))
        .map((c) => (isNode(c) ? c.pfId : c.value)),
    });
    if (!updated || JSON.stringify(shape(n)) !== JSON.stringify(shape(updated)))
      throw new Error(`AI 修改超出选中组件范围：${n.pfId}`);
  });
}
export type AuditRequest =
  | { kind: 'scan'; scope: 'project' }
  | { kind: 'scan'; scope: 'page'; pageId: string }
  | { kind: 'repair'; issueId: string };

interface ProjectChangeScope {
  pageId: string;
  selectedPfId: string | null;
  audit?: AuditRequest;
}

export function prepareProjectChanges(
  base: PflowBinaryPayload,
  operations: HermesOperation[],
  scope?: ProjectChangeScope,
  mergeTargetId?: string,
  reviewConversationEdits = false,
  requirementRecords: RequirementRecord[] = [],
  requestedPage?: RequestedPage,
) {
  const next = structuredClone(base);
  const s = next.stateSnapshot;
  const changedPages = new Set<string>();
  const explicitChangedPages = new Set<string>();
  const explicitStickyPages = new Set<string>();
  const scenarioTableIds = new Set<string>();
  const auditedIds = new Set<string>();
  const audit = scope?.audit;
  if (audit) {
    if (operations.filter(op => op.tool === 'protoflow_run_closed_loop_audit').length !== 1)
      throw new Error('本次巡检或修复必须返回一份实际巡检结果，未应用修改');
    if (audit.kind === 'scan' && operations.some(op => op.tool !== 'protoflow_run_closed_loop_audit'))
      throw new Error('巡检只允许更新问题记录，不能修改页面或业务契约');
    if (audit.kind === 'repair' && !s.closedLoopIssues.some(issue => issue.id === audit.issueId))
      throw new Error('待修复的问题记录不存在');
  }
  // Expand the *explicit* full plan on this private candidate when reviewing
  // data together with it. Neither the live store nor generation progress is
  // changed by preflight. Confirmation replays this same transaction.
  const withPlanMenus = reviewConversationEdits && includesPlanAndSchema(operations);
  const applyOperation = (op: HermesOperation, internalScaffold = false) => {
    // Later operations (e.g. a column after a table upsert) may edit the
    // candidate. Keep the original journal intact for display and replay.
    const a = structuredClone(op.args);
    if (!a || typeof a !== "object") throw new Error("无效项目工具参数");
    if (op.tool === 'protoflow_add_preview_scenario') {
      if (scope) throw new Error('演示场景只能在项目对话或项目生成中写入');
      const added = preparePreviewScenario(s.dbTables, s.tableRows, a.datasets);
      Object.keys(added).forEach(id => scenarioTableIds.add(id));
      s.tableRows = { ...s.tableRows, ...added };
    } else if (op.tool === 'protoflow_remove_project_agreement') {
      if (scope || typeof a.id !== 'string' || !s.projectAgreements?.some(record => record.id === a.id)) throw new Error('项目约定不存在或不允许在页面会话中移除');
      s.projectAgreements = s.projectAgreements.filter(record => record.id !== a.id);
    } else if (op.tool === 'protoflow_upsert_project_agreement') {
      if (scope) throw new Error('项目约定只能在项目对话中修改');
      applyProjectAgreement(s, a.agreement);
    } else if (['protoflow_set_project_plan', 'protoflow_revise_project_page', 'protoflow_upsert_folder', 'protoflow_move_sitemap_item'].includes(op.tool)) {
      if (scope && op.tool !== 'protoflow_upsert_folder') throw new Error('菜单会话不能修改项目方案');
      if (scope?.selectedPfId) throw new Error('局部组件修改不能改变项目方案或目录');
      applyStructureOperation(s, op.tool, a, base.stateSnapshot.projectPlan ?? null, base.meta.projectMode, requestedPage);
      if (withPlanMenus && op.tool === 'protoflow_set_project_plan') {
        for (const menu of planMenuOperations(s, s.projectPlan!, undefined, base.meta.projectMode)) applyOperation(menu, true);
      }
    } else if (op.tool === "protoflow_apply_tsx_patch") {
      if (
        typeof a.pageId !== "string" ||
        typeof a.source !== "string" ||
        !a.pageId
      )
        throw new Error("页面修改缺少 pageId/source");
      if (scope?.selectedPfId && a.pageId !== scope.pageId)
        throw new Error("局部修改不能写入其他页面");
      const parsed = parsePageSource(a.source);
      if (!parsed.doc || parsed.issues.length || parsed.normalized)
        throw new Error("AI 页面源码必须完整可解析，且每个组件有唯一稳定的 pfId；不支持会被忽略的表达式/属性");
      const isNew = !Object.hasOwn(s.pageSources, a.pageId);
      const platform = checkAiPagePlatform(s, a.pageId, parsed.doc.root.type, base.meta.projectMode, requestedPage?.pageId === a.pageId ? requestedPage.platform : undefined);
      if (isNew) {
        if (
          typeof a.title !== "string" ||
          typeof a.folderId !== "string" ||
          !a.title
        )
          throw new Error("新页面缺少标题或目录");
        if (
          !folderOptions(s.designerFolders, s.sitemapOverrides, s.sitemapBase).some(
            (folder) => folder.id === a.folderId && !folder.deprecated,
          )
        )
          throw new Error("新页面目录不存在");
        s.designerPages.push({
          pageId: a.pageId,
          title: a.title,
          folderId: a.folderId,
          platform,
        });
      }
      // Validate original input before printing: canonical printing must not
      // erase unsupported statements, attributes or duplicate values.
      const materialErrors = validateMaterialSource(a.source);
      if (materialErrors.length) throw new Error(`AI 结果未通过物料契约校验：${materialErrors.join('；')}`);
      s.pageSources[a.pageId] = printPageSource(parsed.doc);
      changedPages.add(a.pageId);
      if (!internalScaffold) explicitChangedPages.add(a.pageId);
    } else if (op.tool === "protoflow_upsert_db_table") {
      const t = a.table as DBTableSchema;
      if (!t || typeof t.id !== "string") throw new Error("缺少表 ID");
      const i = s.dbTables.findIndex((t0) => t0.id === t.id);
      if (i < 0) s.dbTables.push(t);
      else s.dbTables[i] = t;
    } else if (op.tool === "protoflow_upsert_db_column") {
      const table = s.dbTables.find((t) => t.id === a.tableId);
      const column = a.column as DBTableSchema["columns"][number];
      if (!table || !column || typeof column.id !== "string")
        throw new Error("字段修改的表或字段 ID 无效");
      const i = table.columns.findIndex((c) => c.id === column.id);
      if (i < 0) table.columns.push(column);
      else table.columns[i] = column;
    } else if (op.tool === "protoflow_upsert_sticky_contract") {
      const sticky = a.sticky as (typeof s.stickyNotes)[number];
      if (!sticky?.id) throw new Error("缺少便签 ID");
      const initialOwner = base.stateSnapshot.stickyNotes.find((x) => x.id === sticky.id)?.pageId;
      const currentOwner = s.stickyNotes.find((x) => x.id === sticky.id)?.pageId;
      const previousOwner = initialOwner ?? currentOwner;
      if ((scope || requestedPage) && previousOwner !== undefined && previousOwner !== sticky.pageId)
        throw new Error(`便签 ${sticky.id} 原属于页面 ${previousOwner}，不能跨页面挪用或覆盖`);
      if (requestedPage && initialOwner !== undefined && initialOwner !== requestedPage.pageId)
        throw new Error(`便签 ${sticky.id} 原属于页面 ${initialOwner}，新建页面不能复用或覆盖已有便签`);
      if (scope && previousOwner !== undefined && previousOwner !== scope.pageId)
        throw new Error(`单页会话（${scope.pageId}）不能修改或覆盖其他页面 ${previousOwner} 的已有便签 ${sticky.id}`);
      if (typeof previousOwner === "string" && previousOwner) explicitStickyPages.add(previousOwner);
      if (typeof sticky.pageId === "string" && sticky.pageId) explicitStickyPages.add(sticky.pageId);
      const i = s.stickyNotes.findIndex((x) => x.id === sticky.id);
      if (i < 0) s.stickyNotes.push(sticky);
      else s.stickyNotes[i] = sticky;
    } else if (op.tool === "protoflow_run_closed_loop_audit") {
      if (!Array.isArray(a.issues)) throw new Error("巡检结果必须是数组");
      const returned = a.issues as typeof s.closedLoopIssues;
      if (audit?.kind === 'scan' && audit.scope === 'page' && returned.some(issue => issue.pageId !== audit.pageId))
        throw new Error('巡检返回了当前页面范围以外的问题，未覆盖任何记录');
      if (audit?.kind === 'repair' && (returned.length !== 1 || returned[0]?.id !== audit.issueId))
        throw new Error('修复结果必须保留所选问题的原始 ID，且仅更新该问题');
      returned.forEach(issue => auditedIds.add(issue.id));
      const records = returned.map(issue => ({ ...issue, auditOrigin: 'hermes' as const, auditedAt: new Date().toISOString() }));
      const preserved = audit?.kind === 'repair'
        ? base.stateSnapshot.closedLoopIssues.filter(issue => issue.id !== audit.issueId)
        : audit?.kind === 'scan' && audit.scope === 'page'
          ? base.stateSnapshot.closedLoopIssues.filter(issue => issue.pageId !== audit.pageId)
          : [];
      s.closedLoopIssues = [...preserved, ...records];
    } else throw new Error(`不支持的项目工具：${op.tool}`);
  };
  operations.forEach(op => applyOperation(op));
  if (requestedPage && !changedPages.has(requestedPage.pageId) && !s.projectPlan?.pages.some(page => page.pageId === requestedPage.pageId))
    throw new Error(`AI 未提交请求的新页面 ${requestedPage.pageId}`);
  if (requestedPage) {
    if (Object.hasOwn(base.stateSnapshot.pageSources, requestedPage.pageId))
      throw new Error(`目标页面 ${requestedPage.pageId} 已存在，新建页面请求不能覆盖已有页面`);
    for (const id of explicitChangedPages) {
      if (id !== requestedPage.pageId)
        throw new Error(`新建页面请求只允许写入目标新页面 ${requestedPage.pageId}，禁止修改或覆盖其他页面 ${id}`);
    }
    for (const id of explicitStickyPages) {
      if (id !== requestedPage.pageId)
        throw new Error(`新建页面请求只允许添加目标新页面 ${requestedPage.pageId} 的需求便签，禁止写入页面 ${id}`);
    }
  } else if (scope) {
    for (const id of explicitChangedPages) {
      if (id !== scope.pageId && Object.hasOwn(base.stateSnapshot.pageSources, id))
        throw new Error(`单页会话（${scope.pageId}）不能修改或覆盖其他已有页面 ${id}`);
    }
    for (const id of explicitStickyPages) {
      if (id !== scope.pageId && Object.hasOwn(base.stateSnapshot.pageSources, id))
        throw new Error(`单页会话（${scope.pageId}）不能修改其他已有页面 ${id} 的需求便签`);
    }
    const allTouched = new Set([...explicitChangedPages, ...explicitStickyPages]);
    if ([...allTouched].some(id => !Object.hasOwn(base.stateSnapshot.pageSources, id)) && allTouched.size > 1)
      throw new Error('新建页面时禁止同时修改或覆盖原有页面');
  }
  // Empty projects explicitly have no selected page. On the first creation,
  // select the first page in this transaction while preserving the current view.
  if (s.activePageId === '' && changedPages.size) s.activePageId = [...changedPages][0];
  // The agent may supply the revised requirements AND their implementation
  // together. Preview them as one transaction; only explicit acceptance commits.
  const inlineTarget = reviewConversationEdits && operations.some(op => op.tool === 'protoflow_revise_project_page')
    ? s.projectPlan?.revision?.pageId : undefined;
  if (inlineTarget !== undefined && changedPages.has(inlineTarget) && s.projectPlan) {
    const source = s.pageSources[inlineTarget];
    if (pagePrototypeIssue(source))
      throw new Error('单页调整未提供有效页面内容');
    s.projectPlan.approved = true;
    s.projectPlan.generatedPageIds = [...new Set([...s.projectPlan.generatedPageIds, inlineTarget])];
    if (s.projectPlan.revision?.merge) mergeTargetId = inlineTarget;
  }
  const mergedSourceId = mergeTargetId === undefined ? undefined : s.projectPlan?.revision?.merge?.sourcePageId;
  if (mergeTargetId !== undefined) finishMenuMerge(base.stateSnapshot, s, mergeTargetId, changedPages);
  if (mergeTargetId !== undefined && mergedSourceId !== undefined && s.projectAgreements)
    s.projectAgreements = s.projectAgreements.map(record => ({...record, pageIds:[...new Set(record.pageIds.map(id => id === mergedSourceId ? mergeTargetId : id))]}));
  const reviewedPages = inlineTarget && changedPages.has(inlineTarget) ? [inlineTarget] : withPlanMenus
    ? [...new Set(operations.filter(op => op.tool === 'protoflow_apply_tsx_patch').map(op => op.args.pageId as string))].filter(id => !pagePrototypeIssue(s.pageSources[id])) : [];
  const evidenceIssues = generationEvidenceIssues(s, reviewedPages);
  if (evidenceIssues.length) throw new Error('方案与候选页面不一致：' + evidenceIssues.join('；'));
  if (requirementRecords.length) s.databaseRequirements = mergeRequirementRecords(s.databaseRequirements ?? [], requirementRecords);
  // Later operations in the same turn may have changed a required parent or column.
  if (scenarioTableIds.size) {
    const preserved = Object.fromEntries(Object.entries(s.tableRows).filter(([id]) => !scenarioTableIds.has(id)));
    preparePreviewScenario(s.dbTables, preserved, [...scenarioTableIds].map(tableId => ({tableId, rows:s.tableRows[tableId]})));
  }
  validateProjectPayload(next);
  // Resolve new bindings against the final transaction: a table can be staged
  // before its new page. Historical, unchanged tables are not rewritten here.
  const pageIds = menuPageIds(s);
  const changedTableIds = new Set(operations
    .filter(op => op.tool === "protoflow_upsert_db_table")
    .map(op => (op.args.table as DBTableSchema).id));
  for (const table of s.dbTables) {
    if (!changedTableIds.has(table.id)) continue;
    for (const menu of table.sharedByMenus) {
      if (!pageIds.has(menu.pageId))
        throw new Error(`数据表 ${table.id} 的 sharedByMenus 引用未知页面 ${menu.pageId}；必须使用菜单页面 pageId，不能使用弹框 ID 或目录 ID`);
    }
  }
  const changesSchema = operations.some(op => op.tool === 'protoflow_upsert_db_table' || op.tool === 'protoflow_upsert_db_column');
  const design = changesSchema ? reviewDatabaseChanges(base.stateSnapshot.dbTables, s.dbTables) : undefined;
  if (design && (design.tableErrors.length || design.relationErrors.length))
    throw new Error('数据库设计未通过审查：' + [...design.tableErrors, ...design.relationErrors].join('；'));
  if ((changesSchema || changedPages.size) && base.stateSnapshot.projectPlan?.pages.some(p => p.dependencies?.length)) {
    const regressions = regressedPageDependencies(base.stateSnapshot, s);
    if (regressions.length) throw new Error('现有页面的已确认来源被破坏：' + regressions.map(r => `${r.pageId} ← ${r.sourcePageId} · ${r.requirement}（${r.status}）`).join('；'));
  }
  for (const [id, source] of Object.entries(s.pageSources)) {
    const oldErrors = new Set(
      base.stateSnapshot.pageSources[id]
        ? pageContractErrors(
            base.stateSnapshot.pageSources[id],
            base.stateSnapshot.dbTables,
            { tableRows: base.stateSnapshot.tableRows },
          )
        : [],
    );
    const introduced = pageContractErrors(source, s.dbTables, { tableRows: s.tableRows }).filter(
      (e) => !oldErrors.has(e),
    );
    if (introduced.length)
      throw new Error(
        `AI 结果未通过契约校验：${introduced.slice(0, 4).join("；")}`,
      );
  }
  const latestRpCoverageByCopy = new Map<string, unknown>();
  for (const op of operations) {
    if (op.tool === 'protoflow_apply_tsx_patch' && typeof op.args.pageId === 'string') {
      if (op.args.rpCoverage !== undefined) latestRpCoverageByCopy.set(op.args.pageId, op.args.rpCoverage);
      else latestRpCoverageByCopy.delete(op.args.pageId);
    }
  }
  for (const [copyId, rpCoverage] of latestRpCoverageByCopy) {
    const match = /^rp-optimized-([0-9a-f]{32})$/.exec(copyId);
    if (!match) continue;
    const srcPageId = 'rp-page-' + match[1];
    if (Object.hasOwn(s.pageSources, srcPageId) && Object.hasOwn(s.pageSources, copyId)) {
      reshapeAxurePage(s, srcPageId, s.pageSources[copyId], rpCoverage);
    }
  }
  for (const op of operations)
    if (op.tool === "protoflow_run_closed_loop_audit") {
      for (const issue of s.closedLoopIssues.filter(issue => auditedIds.has(issue.id))) {
        const root = parsePageSource(s.pageSources[issue.pageId] ?? "").doc
          ?.root;
        if (
          !root ||
          !findNode(root, issue.targetWidgetId) ||
          (issue.targetTableId !== "" && !s.dbTables.some((t) => t.id === issue.targetTableId))
        )
          throw new Error("巡检引用的页面、组件或表不存在");
        if (issue.status === "open" && !issue.options.length)
          throw new Error("未解决巡检问题必须包含修复选项");
      }
    }
  const touchedStickyIds = new Set(
    operations
      .filter((op) => op.tool === "protoflow_upsert_sticky_contract")
      .map((op) => (op.args.sticky as { id: string }).id),
  );
  for (const stickyId of touchedStickyIds) {
    const sticky = s.stickyNotes.find((x) => x.id === stickyId);
    if (!sticky) continue;
    const root = parsePageSource(s.pageSources[sticky.pageId] ?? "").doc?.root;
    if (!root || !findNode(root, sticky.targetWidgetId))
      throw new Error("便签目标页面或组件不存在");
  }
  if (scope?.selectedPfId && changedPages.has(scope.pageId))
    enforceScope(
      base.stateSnapshot.pageSources[scope.pageId],
      s.pageSources[scope.pageId],
      scope.selectedPfId,
    );
  if (audit?.kind === 'repair') {
    const before = base.stateSnapshot;
    const original = before.closedLoopIssues.find(issue => issue.id === audit.issueId)!;
    const result = s.closedLoopIssues.find(issue => issue.id === audit.issueId)!;
    if (result.pageId !== original.pageId || result.targetWidgetId !== original.targetWidgetId || result.targetTableId !== original.targetTableId)
      throw new Error('修复结果不能更换所选问题关联的页面、组件或表');
    if (result.status === 'resolved' && original.status !== 'resolved') {
      const notesForTarget = (snapshot: typeof s) => snapshot.stickyNotes.filter(note =>
        note.pageId === original.pageId && note.targetWidgetId === original.targetWidgetId);
      // Canonical printing alone must not count as repairing the page.
      const sourceChanged = JSON.stringify(parsePageSource(before.pageSources[original.pageId]).doc?.root) !==
        JSON.stringify(parsePageSource(s.pageSources[original.pageId]).doc?.root);
      const schemaChanged = Boolean(original.targetTableId) && (
        JSON.stringify(before.dbTables.find(table => table.id === original.targetTableId)) !==
        JSON.stringify(s.dbTables.find(table => table.id === original.targetTableId))
      );
      const notesChanged = JSON.stringify(notesForTarget(before)) !== JSON.stringify(notesForTarget(s));
      if (!sourceChanged && !schemaChanged && !notesChanged)
        throw new Error('未包含关联源码、表结构或需求记录的实际修复，不能标记已解决');
    }
  }
  const before = base.stateSnapshot;
  const requirementAudit = reviewRequirementRecords(requirementRecords, s.dbTables);
  // Surface stale evidence from earlier menus when this draft changes shared tables.
  const touchedSources = new Set(requirementRecords.map(r => r.id));
  if (changesSchema) for (const record of before.databaseRequirements ?? []) {
    if (touchedSources.has(record.id)) continue;
    const old = reviewRequirementRecords([record], before.dbTables);
    const current = reviewRequirementRecords([record], s.dbTables);
    if (JSON.stringify(current) !== JSON.stringify(old)) {
      requirementAudit.lines.push(...current.lines);
      requirementAudit.uncovered += current.uncovered;
      requirementAudit.conflicts.push(...current.conflicts.filter(issue => !old.conflicts.includes(issue)));
    }
  }
  return { next, scenarioTableIds, requirementAudit, databaseRisks: design?.risks ?? [], changedPages: [...changedPages], mergeTargetId, mergedSourceId };
}

/**
 * Materializes a private candidate `PflowBinaryPayload` from staged generating-phase
 * operations and requirement records on top of `base` WITHOUT mutating live stores
 * or failing on incomplete end-of-turn acceptance checks, so continuation retries
 * can inspect and incrementally patch the full candidate state before final atomic commit.
 */
export function stageGeneratingCandidate(
  base: PflowBinaryPayload,
  operations: HermesOperation[],
  requirementRecords: RequirementRecord[] = [],
  targetPageId?: string,
  requestedPage?: RequestedPage,
): PflowBinaryPayload {
  const next = structuredClone(base);
  const s = next.stateSnapshot;
  const scenarioTableIds = new Set<string>();
  for (const op of operations) {
    const a = structuredClone(op.args);
    if (!a || typeof a !== 'object') throw new Error('无效项目工具参数');
    if (op.tool === 'protoflow_add_preview_scenario') {
      const added = preparePreviewScenario(s.dbTables, s.tableRows, a.datasets);
      Object.keys(added).forEach(id => scenarioTableIds.add(id));
      s.tableRows = { ...s.tableRows, ...added };
    } else if (op.tool === 'protoflow_apply_tsx_patch') {
      if (typeof a.pageId !== 'string' || typeof a.source !== 'string' || !a.pageId) {
        throw new Error('页面修改缺少 pageId/source');
      }
      if (targetPageId !== undefined && a.pageId !== targetPageId) {
        throw new Error('返回操作超出当前页面生成范围');
      }
      const parsed = parsePageSource(a.source);
      if (!parsed.doc || parsed.issues.length || parsed.normalized) {
        throw new Error('AI 页面源码必须完整可解析，且每个组件有唯一稳定的 pfId；不支持会被忽略的表达式/属性');
      }
      const isNew = !Object.hasOwn(s.pageSources, a.pageId);
      const platform = checkAiPagePlatform(
        s,
        a.pageId,
        parsed.doc.root.type,
        base.meta.projectMode,
        requestedPage?.pageId === a.pageId ? requestedPage.platform : undefined,
      );
      if (isNew) {
        if (typeof a.title !== 'string' || typeof a.folderId !== 'string' || !a.title) {
          throw new Error('新页面缺少标题或目录');
        }
        s.designerPages.push({
          pageId: a.pageId,
          title: a.title,
          folderId: a.folderId,
          platform,
        });
      }
      const materialErrors = validateMaterialSource(a.source);
      if (materialErrors.length) {
        throw new Error(`AI 结果未通过物料契约校验：${materialErrors.join('；')}`);
      }
      s.pageSources[a.pageId] = printPageSource(parsed.doc);
    } else if (op.tool === 'protoflow_upsert_db_table') {
      const t = a.table as DBTableSchema;
      if (!t || typeof t.id !== 'string') throw new Error('缺少表 ID');
      const i = s.dbTables.findIndex(t0 => t0.id === t.id);
      if (i < 0) s.dbTables.push(t);
      else s.dbTables[i] = t;
    } else if (op.tool === 'protoflow_upsert_db_column') {
      const table = s.dbTables.find(t => t.id === a.tableId);
      const column = a.column as DBTableSchema['columns'][number];
      if (!table || !column || typeof column.id !== 'string') {
        throw new Error('字段修改的表或字段 ID 无效');
      }
      const i = table.columns.findIndex(c => c.id === column.id);
      if (i < 0) table.columns.push(column);
      else table.columns[i] = column;
    } else if (op.tool === 'protoflow_upsert_sticky_contract') {
      const sticky = a.sticky as (typeof s.stickyNotes)[number];
      if (!sticky?.id) throw new Error('缺少便签 ID');
      const initialOwner = base.stateSnapshot.stickyNotes.find(x => x.id === sticky.id)?.pageId;
      if (targetPageId !== undefined && (sticky.pageId !== targetPageId || (initialOwner !== undefined && initialOwner !== targetPageId))) {
        throw new Error('返回操作超出当前页面生成范围');
      }
      const i = s.stickyNotes.findIndex(x => x.id === sticky.id);
      if (i < 0) s.stickyNotes.push(sticky);
      else s.stickyNotes[i] = sticky;
    } else {
      throw new Error(`不支持的候选生成操作：${op.tool}`);
    }
  }
  if (requirementRecords.length) {
    s.databaseRequirements = mergeRequirementRecords(s.databaseRequirements ?? [], requirementRecords);
  }
  return next;
}
const undoChanges = new Map<
  string,
  {
    projectId: string;
    before: PflowBinaryPayload;
    scenarioTableIds: Set<string>;
    afterRevision: string;
    history: ReturnType<typeof usePageStore.getState>["history"];
  }
>();
export function canUndoProjectChange(id: string) {
  const item = undoChanges.get(id);
  return Boolean(
    item &&
      useProtoStore.getState().currentProjectMeta.projectId ===
        item.projectId &&
      projectRevision() === item.afterRevision,
  );
}
export function undoProjectChange(id: string) {
  const item = undoChanges.get(id);
  if (!item || !canUndoProjectChange(id))
    throw new Error("工程已变更，不能再整体撤销这次 AI 修改");
  const s = item.before.stateSnapshot;
  usePageStore.setState({
    pageSources: s.pageSources,
    designerPages: s.designerPages,
    designerFolders: s.designerFolders,
    sitemapOverrides: s.sitemapOverrides,
    history: item.history,
    ...(item.scenarioTableIds.size ? {tableRows:Object.fromEntries(Object.entries(usePageStore.getState().tableRows).filter(([id]) => !item.scenarioTableIds.has(id)))} : {}),
  });
  useProtoStore.setState({
    databaseRequirements: s.databaseRequirements ?? [],
    projectPlan: s.projectPlan === undefined ? null : s.projectPlan,
    projectAgreements: s.projectAgreements ?? [],
    mindmaps: s.mindmaps,
    dbTables: s.dbTables,
    stickyNotes: s.stickyNotes,
    closedLoopIssues: s.closedLoopIssues,
    activePageId: s.activePageId,
  });
  undoChanges.delete(id);
}
export function applyProjectChanges(
  base: PflowBinaryPayload,
  revision: string,
  operations: HermesOperation[],
  scope?: ProjectChangeScope,
  changeId?: string,
  generatedPageId?: string,
  reviewConversationEdits = false,
  requirementRecords: RequirementRecord[] = [],
  requestedPage?: RequestedPage,
  footprintCheck?: {
    dependencyFootprint?: DependencyFootprintV3;
    requirementSources?: unknown[];
  },
) {
  if (
    useProtoStore.getState().currentProjectMeta.projectId !==
    base.meta.projectId
  )
    throw new Error("项目已切换，AI 结果未应用");
  let effectiveBase = base;
  if (footprintCheck?.dependencyFootprint?.version === 3) {
    const livePayload = captureProjectPayload();
    if (livePayload.meta.projectId !== base.meta.projectId) {
      throw new Error("项目已切换，AI 结果未应用");
    }
    const liveView = {
      ...projectContext(requestedPage, livePayload),
      ...(footprintCheck.requirementSources !== undefined
        ? { requirementSources: footprintCheck.requirementSources }
        : {}),
    };
    const verified = verifyDependencyFootprint(liveView, footprintCheck.dependencyFootprint);
    if (!verified.ok) {
      const conflictError = new Error(
        "等待期间工程或关联笔记已修改，AI 结果未应用；请基于当前版本重试",
      ) as Error & { code?: string; changedSections?: string[] };
      conflictError.code = "DRAFT_RECOVERY_CONFLICT";
      conflictError.changedSections = verified.changedSections;
      throw conflictError;
    }
    effectiveBase = livePayload;
  } else if (projectRevision() !== revision) {
    throw new Error("等待期间工程已修改，AI 结果未应用；请基于当前版本重试");
  }
  const revisionPlan = effectiveBase.stateSnapshot.projectPlan?.revision;
  const generatedMergeTarget = revisionPlan?.merge && revisionPlan.pageId === generatedPageId ? generatedPageId : undefined;
  const result = prepareProjectChanges(effectiveBase, operations, scope, generatedMergeTarget, reviewConversationEdits, requirementRecords, requestedPage);
  if (result.requirementAudit.conflicts.length) throw new Error('需求正反例与表约束冲突，修改未应用。\n' + result.requirementAudit.conflicts.join('\n'));
  const { mergeTargetId, mergedSourceId } = result;
  const s = result.next.stateSnapshot;
  if (reviewConversationEdits && includesPlanAndSchema(operations) && s.projectPlan) {
    // applyProjectChanges is called for this review only after explicit consent.
    // Persist that consent with the menu and schema, even if generation stops.
    s.projectPlan.approved = true;
    const completed = new Set<unknown>(s.projectPlan.generatedPageIds);
    for (const op of operations) if (op.tool === 'protoflow_apply_tsx_patch') completed.add(op.args.pageId);
    s.projectPlan.generatedPageIds = s.projectPlan.pages.map(page => page.pageId).filter(id =>
      completed.has(id) && !pagePrototypeIssue(s.pageSources[id]));
  }
  if (generatedPageId !== undefined) {
    if (!s.projectPlan?.approved || !s.projectPlan.pages.some(page => page.pageId === generatedPageId) || !result.changedPages.includes(generatedPageId)) {
      throw new Error('无法将未生成的页面标记为完成');
    }
    const issues = generationEvidenceIssues(s, [generatedPageId]);
    if (issues.length) throw new Error('生成结果与方案不一致：' + issues.join('；'));
    s.projectPlan.generatedPageIds = [...new Set([...s.projectPlan.generatedPageIds, generatedPageId])];
    if (s.projectPlan.lastGenerationFailure?.pageId === generatedPageId) delete s.projectPlan.lastGenerationFailure;
  }
  const pageStore = usePageStore.getState();
  const history = { ...pageStore.history };
  if (mergedSourceId !== undefined) delete history[mergedSourceId];
  for (const id of result.changedPages) {
    const old = pageStore.pageSources[id];
    const h = history[id] ?? { past: [], future: [] };
    history[id] = {
      past: old ? [...h.past, old].slice(-120) : h.past,
      future: [],
    };
  }
  usePageStore.setState({
    pageSources: s.pageSources,
    designerPages: s.designerPages,
    designerFolders: s.designerFolders,
    sitemapOverrides: s.sitemapOverrides,
    history,
    ...(result.scenarioTableIds.size ? {tableRows:{...pageStore.tableRows, ...Object.fromEntries([...result.scenarioTableIds].map(id => [id,s.tableRows[id]]))}} : {}),
  });
  useProtoStore.setState({
    ...(useProtoStore.getState().activePageId === '' ? { activePageId: s.activePageId } : {}),
    ...(mergeTargetId === undefined ? {} : { mindmaps: s.mindmaps }),
    // Notes are edited live while AI runs (and are not part of the revision): migrate the
    // current notes instead of restoring the snapshot copy, so concurrent edits survive.
    ...(mergedSourceId !== undefined && mergeTargetId !== undefined
      ? { projectNotes: migrateNotePageLinks(useProtoStore.getState().projectNotes, mergedSourceId, mergeTargetId) }
      : {}),
    ...(mergedSourceId !== undefined && useProtoStore.getState().activePageId === mergedSourceId ? { activePageId: mergeTargetId! } : {}),
    databaseRequirements: s.databaseRequirements ?? [],
    projectPlan: s.projectPlan === undefined ? null : s.projectPlan,
    projectAgreements: s.projectAgreements ?? [],
    dbTables: s.dbTables,
    stickyNotes: s.stickyNotes,
    closedLoopIssues: s.closedLoopIssues,
  });
  if (changeId) {
    for (const [id, item] of undoChanges)
      if (item.projectId === base.meta.projectId) undoChanges.delete(id);
    undoChanges.set(changeId, {
      projectId: base.meta.projectId,
      before: effectiveBase,
      scenarioTableIds: result.scenarioTableIds,
      afterRevision: projectRevision(),
      history: pageStore.history,
    });
  }
  return result;
}
