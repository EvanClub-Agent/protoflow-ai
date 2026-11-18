import type { HermesOperation } from './hermesClient';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import { folderOptions, sitemapItemLocation } from '../proto/sitemap';
import { resolveUniqueConstraints } from '../proto/database/uniqueConstraints';
import { includesPlanAndSchema } from './projectPlanMenus';

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
export function describeChanges(before: ProjectStateSnapshot, after: ProjectStateSnapshot, operations: HermesOperation[], mergedSourceId?:string): string[] {
  const items = new Set<string>();
  const folders = folderOptions(after.designerFolders, after.sitemapOverrides, after.sitemapBase);
  const folderName = (id: unknown) => id === null ? '顶层' : folders.find(f => f.id === id)?.path ?? String(id);
  const combinedPlan = includesPlanAndSchema(operations) ? after.projectPlan : undefined;
  if (combinedPlan) {
    for (const folder of folders) {
      const pages = combinedPlan.pages.filter(page => page.folderId === folder.id);
      if (pages.length) items.add(`菜单「${folder.path}」：${pages.map(page => page.title).join('、')}`);
      else if (combinedPlan.folders.some(f => f.id === folder.id)) items.add(`目录「${folder.path}」`);
    }
  }
  for (const { tool, args } of operations) {
    switch (tool) {
      case 'protoflow_add_preview_scenario': {
        for (const data of args.datasets as {tableId:string;rows:unknown[]}[]) items.add(`为 ${data.tableId} 准备 ${data.rows.length} 条演示记录`);
        break;
      }
      case 'protoflow_remove_project_agreement': items.add(`移除项目约定「${before.projectAgreements?.find(a => a.id === args.id)?.title ?? args.id}」`); break;
      case 'protoflow_upsert_project_agreement': {
        const a = args.agreement as import('./projectKnowledge').ProjectAgreement;
        items.add(`保存项目约定「${a.title}」：${a.text}（${a.pageIds.length ? a.pageIds.join('、') : '全项目'}）`); break;
      }
      case 'protoflow_move_sitemap_item': {
        const target = args.target as Parameters<typeof sitemapItemLocation>[1];
        const item = sitemapItemLocation(after, target);
        items.add(`移动${target.kind === 'page' ? '菜单' : '目录'}「${item.title}」至「${folderName(args.parentFolderId)}」`); break;
      }
      case 'protoflow_upsert_folder': {
        const f = args.folder as {id:string; title:string};
        items.add(`${before.designerFolders.some(old => old.id === f.id) ? '更新' : '创建'}目录「${folderName(f.id)}」`); break;
      }
      case 'protoflow_apply_tsx_patch': {
        const id = args.pageId as string;
        const item = sitemapItemLocation(after, {kind:'page', id});
        items.add(`${Object.hasOwn(before.pageSources, id) ? '修改' : '创建'}页面「${item.title}」（${id}）`); break;
      }
      case 'protoflow_upsert_db_table': {
        const table = after.dbTables.find(t => t.id === (args.table as {id:string}).id)!;
        const previous = before.dbTables.find(t => t.id === table.id);
        const verb = previous ? '更新' : '创建';
        const model = table.modeling;
        items.add(`${verb}数据表「${table.cnName}」（${table.id}）` + (model ? ` · ${table.tableName} · ${model.entity} · ${model.grain}。${model.reason}` : ''));
        for (const r of previous?.modeling?.pendingRules ?? []) if (!model?.pendingRules?.some(next => next.rule === r.rule))
          items.add(`移除待实现规则 ${table.tableName}：${r.rule}`);
        const previousKeys = previous ? resolveUniqueConstraints(previous) : [];
        const nextKeys = resolveUniqueConstraints(table);
        for (const k of nextKeys) {
          const prior = previousKeys.find(p => p.name === k.name);
          if (!prior || JSON.stringify(prior.columns.map(c => c.id)) !== JSON.stringify(k.columns.map(c => c.id)))
            items.add(`${prior ? '修改' : '新增'}唯一约束 ${table.tableName}.${k.name}（${k.columns.map(c => c.name).join('、')}）`);
        }
        for (const k of previousKeys) if (!nextKeys.some(p => p.name === k.name))
          items.add(`移除唯一约束 ${table.tableName}.${k.name}（${k.columns.map(c => c.name).join('、')}）`);
        break;
      }
      case 'protoflow_upsert_db_column': items.add(`更新表 ${args.tableId} 的字段 ${(args.column as {name:string}).name}`); break;
      case 'protoflow_upsert_sticky_contract': items.add(`更新页面 ${(args.sticky as {pageId:string}).pageId} 的需求便签`); break;
      case 'protoflow_run_closed_loop_audit': items.add(`替换项目巡检清单：${before.closedLoopIssues.length} → ${after.closedLoopIssues.length} 条`); break;
      case 'protoflow_set_project_plan': case 'protoflow_revise_project_page':
        if (!combinedPlan) items.add(after.projectPlan?.approved ? '更新页面需求及生成记录' : '更新待确认的项目方案');
        break;
      default: throw new Error(`无法展示项目操作：${tool}`);
    }
  }
  if (mergedSourceId !== undefined) {
    const origin = after.projectPlan?.revision?.merge;
    items.add(`${origin?.plannedOnly ? '取消尚未创建的菜单' : '移除旧菜单并迁移关联'}「${origin?.sourceTitle ?? mergedSourceId}」`);
    for (const [id,source] of Object.entries(after.pageSources)) {
      if (id !== after.projectPlan?.revision?.pageId && source !== before.pageSources[id] && !operations.some(op => op.tool === 'protoflow_apply_tsx_patch' && op.args.pageId === id))
        items.add(`更新「${sitemapItemLocation(after,{kind:'page',id}).title}」中的旧菜单跳转`);
    }
  }
  return [...items];
}
