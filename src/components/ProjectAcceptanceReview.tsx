import React, { useMemo } from 'react';
import type { ProjectPlan } from '../services/projectPlan';
import { reviewPageDependencies } from '../services/projectDependencies';
import { previewRelationIssues } from '../proto/database/previewRelations';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';

export function ProjectAcceptanceReview({ plan }: { plan: ProjectPlan }) {
  const dbTables = useProtoStore(s => s.dbTables);
  const mindmaps = useProtoStore(s => s.mindmaps);
  const pageSources = usePageStore(s => s.pageSources);
  const tableRows = usePageStore(s => s.tableRows);
  const evidence = useMemo(() => reviewPageDependencies({projectPlan:plan, dbTables, mindmaps, pageSources}), [plan,dbTables,mindmaps,pageSources]);
  const issues = useMemo(() => previewRelationIssues(dbTables,tableRows), [dbTables,tableRows]);
  const titles = new Map(plan.pages.map(p => [p.pageId,p.title]));
  const field = (tableId: string, columnId: string) => {
    const table = dbTables.find(t => t.id === tableId);
    const column = table?.columns.find(c => c.id === columnId);
    return table && column ? `${table.tableName}.${column.name}` : `待核对表 ID ${tableId}，字段 ID ${columnId}`;
  };
  const ready = evidence.links.filter(l => l.status === '已核对结构与页面绑定').length;
  return <details className="rounded-xl border bg-white p-3 text-xs" aria-label="跨菜单数据与验收">
    <summary className="cursor-pointer font-semibold">跨菜单数据与验收 · {ready}/{evidence.links.length} 项依赖已核对</summary>
    <div className="mt-3 space-y-2">
      {plan.lastGenerationFailure && <p>上次中断在「{titles.get(plan.lastGenerationFailure.pageId)}」：{plan.lastGenerationFailure.diagnostic}</p>}
      {evidence.undeclaredPageIds.length > 0 && <p>{evidence.undeclaredPageIds.length} 个页面尚未声明数据依赖，可在项目对话中补充方案。</p>}
      {evidence.links.map((l,i) => <p key={i}><strong>{titles.get(l.pageId)} ← {titles.get(l.sourcePageId) ?? l.sourcePageId}</strong><br/>{l.requirement} · {l.status}
        {l.kind === 'foreignKey' && <code className="block break-all">{field(l.tableId,l.foreignKeyColumnId)} → {field(l.sourceTableId,l.sourceColumnId)}</code>}
        {l.kind === 'reuse' && <code className="block">复用表 ID {l.sourceTableId}</code>}</p>)}
      {evidence.cases.map((c,i) => { const ref = c.actionPfId ? (c.actionEvent ? `${c.actionPfId}.${c.actionEvent}` : c.actionPfId) : ''; return <details key={i}><summary>{titles.get(c.pageId)} · {c.scenario}</summary><p>预期：{c.expected}</p><p>{c.status}{ref && ` · ${ref}`}</p>{c.source && <p>脑图原文：{c.source.quote}</p>}</details>; })}
      {evidence.sampleCharts.length > 0 && <details><summary>{evidence.sampleCharts.length} 个图表使用内置示例数据</summary>{evidence.sampleCharts.map(c => <p key={JSON.stringify([c.pageId,c.pfId])}>{titles.get(c.pageId)} · {c.pfId}</p>)}</details>}
      {issues.length > 0 && <details><summary>{issues.length} 个预览外键需要核对</summary>{issues.map(i => <p key={JSON.stringify([i.tableId,i.field])}>{i.tableId}.{i.field} → {i.target} · {i.count} 行，首条 {i.firstRowId}</p>)}</details>}
      <button type="button" className="rounded border px-2 py-1" onClick={() => usePageStore.getState().prepareRelatedExamples()}>生成关联演示数据</button>
      <p className="text-slate-500">补充未加载的表并更新完整的默认样例。已编辑记录和显式保存的空表会保留。</p>
    </div>
  </details>;
}
