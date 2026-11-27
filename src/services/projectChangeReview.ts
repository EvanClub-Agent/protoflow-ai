import { axureBindingChanges, axureReshapeReviewItems } from '../proto/axure/review';
import { tr } from '../i18n/runtime';
import { evaluateAxureMigrationProgress } from '../proto/axure/optimization';
import type { AxureScope } from '../proto/axure/task';
import type { HermesOperation } from './hermesClient';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import { folderOptions, sitemapItemLocation } from '../proto/sitemap';
import { resolveUniqueConstraints } from '../proto/database/uniqueConstraints';
import { includesPlanWithMenuBindings } from './projectPlanMenus';

export interface ProjectChangeReview {
  requestedPage?: import('./projectPagePlatform').RequestedPage;
  requirementRecords?: import('../proto/database/requirementReview').RequirementRecord[];
  baseDigest: string;
  operations: HermesOperation[];
  items: string[];
}

/** Persisted chats contain the original tool arguments, not a second copy of
 * the plan. Read display fields defensively; acceptance revalidates the draft. */
export function reviewPageRequirements(review: ProjectChangeReview) {
  const args = review.operations.find(op => op.tool === 'protoflow_set_project_plan')?.args;
  const plan = args?.plan as {pages?: unknown} | undefined;
  if (!Array.isArray(plan?.pages)) return [];
  return plan.pages.flatMap((p): {pageId:string; title:string; requirements:string}[] =>
    p && typeof p.pageId === 'string' && typeof p.title === 'string' && typeof p.requirements === 'string'
      ? [{pageId:p.pageId, title:p.title, requirements:p.requirements}] : []);
}

export async function revisionDigest(revision: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(revision));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

// Summarize validated operations using the candidate catalogue, never the
// assistant's prose. The same operations are replayed on confirmation.
export function describeChanges(
  before: ProjectStateSnapshot,
  after: ProjectStateSnapshot,
  operations: HermesOperation[],
  mergedSourceId?: string,
  rpMigrationScope?: AxureScope,
): string[] {
  const items = new Set<string>();
  const reviewedPages = new Set<string>();
  const folders = folderOptions(after.designerFolders, after.sitemapOverrides, after.sitemapBase);
  const folderName = (id: unknown) => id === null ? tr('顶层', 'Root') : folders.find(f => f.id === id)?.path ?? String(id);
  const combinedPlan = includesPlanWithMenuBindings(operations) ? after.projectPlan : undefined;
  if (combinedPlan) {
    for (const folder of folders) {
      const pages = combinedPlan.pages.filter(page => page.folderId === folder.id);
      if (pages.length) items.add(tr(`菜单「${folder.path}」：${pages.map(page => page.title).join('、')}`, `Menu "${folder.path}": ${pages.map(page => page.title).join(', ')}`));
      else if (combinedPlan.folders.some(f => f.id === folder.id)) items.add(tr(`目录「${folder.path}」`, `Folder "${folder.path}"`));
    }
  }
  for (const { tool, args } of operations) {
    switch (tool) {
      case 'protoflow_add_preview_scenario': {
        for (const data of args.datasets as {tableId:string;rows:unknown[]}[]) items.add(tr(`为 ${data.tableId} 准备 ${data.rows.length} 条演示记录`, `Prepare ${data.rows.length} demo record(s) for ${data.tableId}`));
        break;
      }
      case 'protoflow_remove_project_agreement': items.add(tr(`移除项目约定「${before.projectAgreements?.find(a => a.id === args.id)?.title ?? args.id}」`, `Remove project agreement "${before.projectAgreements?.find(a => a.id === args.id)?.title ?? args.id}"`)); break;
      case 'protoflow_upsert_project_agreement': {
        const a = args.agreement as import('./projectKnowledge').ProjectAgreement;
        items.add(tr(`保存项目约定「${a.title}」：${a.text}（${a.pageIds.length ? a.pageIds.join('、') : '全项目'}）`, `Save project agreement "${a.title}": ${a.text} (${a.pageIds.length ? a.pageIds.join(', ') : 'Project-wide'})`)); break;
      }
      case 'protoflow_move_sitemap_item': {
        const target = args.target as Parameters<typeof sitemapItemLocation>[1];
        const item = sitemapItemLocation(after, target);
        items.add(tr(`移动${target.kind === 'page' ? '菜单' : '目录'}「${item.title}」至「${folderName(args.parentFolderId)}」`, `Move ${target.kind === 'page' ? 'menu' : 'folder'} "${item.title}" to "${folderName(args.parentFolderId)}"`)); break;
      }
      case 'protoflow_upsert_folder': {
        const f = args.folder as {id:string; title:string};
        items.add(tr(`${before.designerFolders.some(old => old.id === f.id) ? '更新' : '创建'}目录「${folderName(f.id)}」`, `${before.designerFolders.some(old => old.id === f.id) ? 'Update' : 'Create'} folder "${folderName(f.id)}"`)); break;
      }
      case 'protoflow_apply_tsx_patch': {
        const id = args.pageId as string;
        const item = sitemapItemLocation(after, {kind:'page', id});
        items.add(tr(`${Object.hasOwn(before.pageSources, id) ? '修改' : '创建'}页面「${item.title}」（${id}）`, `${Object.hasOwn(before.pageSources, id) ? 'Update' : 'Create'} page "${item.title}" (${id})`));
        if (!reviewedPages.has(id)) {
          const latestArgs =
            [...operations].reverse().find(o => o.tool === 'protoflow_apply_tsx_patch' && o.args.pageId === id)?.args ?? args;
          if (latestArgs.rpCoverage) {
            for (const line of axureReshapeReviewItems(id, after.pageSources[id], after.pageSources, after.dbTables, latestArgs.rpCoverage)) {
              items.add(line);
            }
          } else {
            for (const binding of axureBindingChanges(id,before.pageSources[id],after.pageSources[id],after.pageSources,after.dbTables)) {
              items.add(binding);
            }
          }
          reviewedPages.add(id);
        }
        break;
      }
      case 'protoflow_upsert_db_table': {
        const table = after.dbTables.find(t => t.id === (args.table as {id:string}).id)!;
        const previous = before.dbTables.find(t => t.id === table.id);
        const verb = previous ? '更新' : '创建';
        const verbEn = previous ? 'Update' : 'Create';
        const model = table.modeling;
        items.add(tr(
          `${verb}数据表「${table.cnName}」（${table.id}）` + (model ? ` · ${table.tableName} · ${model.entity} · ${model.grain}。${model.reason}` : ''),
          `${verbEn} table "${table.cnName}" (${table.id})` + (model ? ` · ${table.tableName} · ${model.entity} · ${model.grain}. ${model.reason}` : ''),
        ));
        for (const r of previous?.modeling?.pendingRules ?? []) if (!model?.pendingRules?.some(next => next.rule === r.rule))
          items.add(tr(`移除待实现规则 ${table.tableName}：${r.rule}`, `Remove pending rule on ${table.tableName}: ${r.rule}`));
        const previousKeys = previous ? resolveUniqueConstraints(previous) : [];
        const nextKeys = resolveUniqueConstraints(table);
        for (const k of nextKeys) {
          const prior = previousKeys.find(p => p.name === k.name);
          if (!prior || JSON.stringify(prior.columns.map(c => c.id)) !== JSON.stringify(k.columns.map(c => c.id)))
            items.add(tr(`${prior ? '修改' : '新增'}唯一约束 ${table.tableName}.${k.name}（${k.columns.map(c => c.name).join('、')}）`, `${prior ? 'Update' : 'Add'} unique constraint ${table.tableName}.${k.name} (${k.columns.map(c => c.name).join(', ')})`));
        }
        for (const k of previousKeys) if (!nextKeys.some(p => p.name === k.name))
          items.add(tr(`移除唯一约束 ${table.tableName}.${k.name}（${k.columns.map(c => c.name).join('、')}）`, `Remove unique constraint ${table.tableName}.${k.name} (${k.columns.map(c => c.name).join(', ')})`));
        break;
      }
      case 'protoflow_upsert_db_column': items.add(tr(`更新表 ${args.tableId} 的字段 ${(args.column as {name:string}).name}`, `Update column ${(args.column as {name:string}).name} on table ${args.tableId}`)); break;
      case 'protoflow_upsert_sticky_contract': items.add(tr(`更新页面 ${(args.sticky as {pageId:string}).pageId} 的需求便签`, `Update sticky requirement on page ${(args.sticky as {pageId:string}).pageId}`)); break;
      case 'protoflow_manage_mindmap': {
        const act = String(args.action ?? '');
        const id = String(args.id ?? '');
        if (act === 'delete') {
          const oldTitle = before.mindmaps.nodes.find(n => n.id === id)?.title ?? id;
          items.add(tr(`删除脑图节点「${oldTitle}」`, `Delete mindmap item "${oldTitle}"`));
        } else {
          const existed = before.mindmaps.nodes.some(n => n.id === id);
          const label = act === 'upsert_folder' ? tr('脑图目录', 'mindmap folder') : tr('项目脑图', 'mindmap');
          const title = String(args.title ?? id);
          items.add(tr(`${existed ? '更新' : '创建'}${label}「${title}」`, `${existed ? 'Update' : 'Create'} ${label} "${title}"`));
        }
        break;
      }
      case 'protoflow_run_closed_loop_audit': items.add(tr(`替换项目巡检清单：${before.closedLoopIssues.length} → ${after.closedLoopIssues.length} 条`, `Replace closed-loop audit list: ${before.closedLoopIssues.length} -> ${after.closedLoopIssues.length} item(s)`)); break;
      case 'protoflow_set_project_plan': case 'protoflow_revise_project_page':
        if (!combinedPlan) items.add(after.projectPlan?.approved ? tr('更新页面需求及生成记录', 'Update page requirements and generation progress') : tr('更新待确认的项目方案', 'Update pending project plan'));
        break;
      default: throw new Error(tr(`无法展示项目操作：${tool}`, `Cannot display project operation: ${tool}`));
    }
  }
  if (mergedSourceId !== undefined) {
    const origin = after.projectPlan?.revision?.merge;
    items.add(tr(
      `${origin?.plannedOnly ? '取消尚未创建的菜单' : '移除旧菜单并迁移关联'}「${origin?.sourceTitle ?? mergedSourceId}」`,
      `${origin?.plannedOnly ? 'Cancel uncreated planned menu' : 'Remove legacy menu and migrate references'} "${origin?.sourceTitle ?? mergedSourceId}"`,
    ));
    for (const [id,source] of Object.entries(after.pageSources)) {
      if (id !== after.projectPlan?.revision?.pageId && source !== before.pageSources[id] && !operations.some(op => op.tool === 'protoflow_apply_tsx_patch' && op.args.pageId === id))
        items.add(tr(`更新「${sitemapItemLocation(after,{kind:'page',id}).title}」中的旧菜单跳转`, `Update legacy menu navigation in "${sitemapItemLocation(after,{kind:'page',id}).title}"`));
    }
  }
  if (rpMigrationScope) {
    const progress = evaluateAxureMigrationProgress(after, rpMigrationScope, operations);
    if (progress.totalScopePages > 0) {
      if (progress.stagedThisTurnCount === 0) {
        if (progress.flowReshapedPageCount === 0 && progress.partiallyOptimizedPageCount === 0) {
          items.add(tr(
            `表结构已准备，页面尚未转换（待转换页面：${progress.unconvertedPages.map(p => p.title).join('、')}）`,
            `Table schema prepared; pages not converted yet (pending: ${progress.unconvertedPages.map(p => p.title).join(', ')})`,
          ));
        } else if (progress.unconvertedPageCount > 0 || progress.partiallyOptimizedPageCount > 0) {
          const pendingTitles = [
            ...progress.unconvertedPages.map(p => p.title),
            ...progress.partiallyOptimizedPages.map(p => tr(`${p.title}（仅局部优化）`, `${p.title} (partial only)`)),
          ];
          items.add(tr(
            `表结构已准备，页面尚未在本轮转换（待完成整页流式重塑：${pendingTitles.join('、')}）`,
            `Table schema prepared; pages not converted in this turn (pending full-page reshape: ${pendingTitles.join(', ')})`,
          ));
        } else {
          items.add(tr('本轮仅更新表结构，未修改已流式重塑的页面副本', 'Updated table schema only; reshaped page copies unchanged'));
        }
      } else {
        if (progress.partiallyOptimizedPageCount > 0) {
          items.add(tr(
            `仅完成局部原位替换、尚未整页流式重塑（${progress.partiallyOptimizedPageCount} 页）：${progress.partiallyOptimizedPages.map(p => p.title).join('、')}`,
            `In-place partial replacement only; full-page reshape pending (${progress.partiallyOptimizedPageCount} page(s)): ${progress.partiallyOptimizedPages.map(p => p.title).join(', ')}`,
          ));
        }
        if (progress.unconvertedPageCount > 0) {
          items.add(tr(
            `尚未转换的 RP 页面（${progress.unconvertedPageCount} 页）：${progress.unconvertedPages.map(p => p.title).join('、')}`,
            `Unconverted RP pages (${progress.unconvertedPageCount} page(s)): ${progress.unconvertedPages.map(p => p.title).join(', ')}`,
          ));
        }
      }
    }
  }
  return [...items];
}
