import { reviewPageDependencies } from './projectDependencies';
import { reviewRequirementRecords } from '../proto/database/requirementReview';
import { resolveUniqueConstraints } from '../proto/database/uniqueConstraints';
import type { PflowBinaryPayload, ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import type { SitemapItem } from '../store/useProtoStore';
import { buildSitemap } from '../proto/sitemap';
import { parsePageSource } from '../proto/dsl/parser';
import { walk } from '../proto/dsl/tree';
import { isActionChain, type ActionCall, type PropValue, type ProtoNode } from '../proto/types';
import { purchaseTransferContractError } from '../proto/runtime/purchaseTransfer';
import { diagramRelations } from '../proto/database/relations';
import { reviewDatabaseDesign } from '../proto/database/designReview';

export function projectPageCatalog(s: Pick<ProjectStateSnapshot, 'designerFolders'|'designerPages'|'sitemapOverrides'|'sitemapBase'|'pageSources'>) {
  const pages: { pageId: string; title: string; path: string; hasSource: boolean; deprecated: boolean }[] = [];
  const visit = (items: SitemapItem[], path: string[], archived = false) => {
    for (const item of items) {
      const deprecated = archived || item.deprecated === true;
      if (item.type === 'folder') visit(item.children ?? [], [...path, item.title], deprecated);
      else if (item.pageId !== undefined) pages.push({ pageId:item.pageId, title:item.title, path:[...path,item.title].join(' / '), hasSource:Object.prototype.hasOwnProperty.call(s.pageSources,item.pageId), deprecated });
    }
  };
  visit(buildSitemap(s.designerFolders,s.designerPages,s.sitemapOverrides,s.sitemapBase),[]);
  return pages;
}

export function isNavigablePage(pages: ReturnType<typeof projectPageCatalog>, pageId: string): boolean {
  return pages.some(page => page.pageId === pageId && page.hasSource && !page.deprecated);
}

export interface TableUsage { pageId: string; tableId: string; pfId: string | null; description: string }
export interface PageAction { pageId: string; pfId: string; event: string; call: ActionCall }
export function analyzeProject(s: ProjectStateSnapshot) {
  const pages = projectPageCatalog(s);
  const usages: TableUsage[] = [];
  const actions: PageAction[] = [];
  const components: {pageId:string;pfId:string;type:string}[] = [];
  const navigation: { from: string; to: string; pfId: string; event: string }[] = [];
  const transfers: { pageId: string; pfId: string; fromTableId: string; toTableId: string }[] = [];
  const issues: string[] = [];
  for (const [pageId, source] of Object.entries(s.pageSources)) {
    const page = pages.find(p=>p.pageId===pageId);
    if (!page) { issues.push(`源码 ${pageId} 不在当前页面目录中`); continue; }
    const parsed = parsePageSource(source);
    if (!parsed.doc || parsed.issues.some(i=>i.level==='error')) { issues.push(`${page.title}：页面源码解析失败，无法分析`); continue; }
    const nodes: ProtoNode[] = [];
    walk(parsed.doc.root,n=>nodes.push(n));
    nodes.forEach(node=>components.push({pageId,pfId:node.pfId,type:node.type}));
    const pageActions: PageAction[] = [];
    const collect = (value: PropValue, node: ProtoNode, event: string) => {
      if (isActionChain(value)) value.calls.forEach(call=>pageActions.push({pageId,pfId:node.pfId,event,call}));
      else if (Array.isArray(value)) value.forEach((v,i)=>collect(v,node,`${event}[${i}]`));
      else if (value && typeof value==='object') Object.entries(value).forEach(([k,v])=>collect(v,node,`${event}.${k}`));
    };
    for (const node of nodes) {
      const tableId = node.props.table;
      if (typeof tableId==='string' && tableId) {
        if (s.dbTables.some(t=>t.id===tableId)) usages.push({pageId,tableId,pfId:node.pfId,description:`${node.type}.table`});
        else issues.push(`${page.title} / ${node.pfId} 引用了不存在的数据表 ${tableId}`);
      }
      Object.entries(node.props).forEach(([event,value])=>collect(value,node,event));
    }
    actions.push(...pageActions);
    for (const action of pageActions) {
      if (action.call.name==='navigate') {
        const to = action.call.args[0];
        if (typeof to==='string' && pages.some(p=>p.pageId===to && p.hasSource && !p.deprecated)) navigation.push({from:pageId,to,pfId:action.pfId,event:action.event});
        else issues.push(`${page.title} / ${action.pfId} 的跳转目标 ${String(to)} 不可用`);
      }
      if (action.call.name==='importPurchaseOrderLines') {
        // Runtime node references explicitly accept either pfId or the component's id prop.
        const resolveTable = (id: PropValue) => {
          const matches = nodes.filter(n=>n.pfId===id || n.props.id===id);
          return matches.length===1 && matches[0].type==='Table' ? matches[0].props.table : undefined;
        };
        const from=resolveTable(action.call.args[0]), to=resolveTable(action.call.args[1]);
        if (typeof from==='string' && typeof to==='string' && [from,to].every(id=>s.dbTables.some(t=>t.id===id))) {
          const error = purchaseTransferContractError(s.dbTables, from, to);
          if (error) issues.push(`${page.title} / ${action.pfId}：${error}`);
          else transfers.push({pageId,pfId:action.pfId,fromTableId:from,toTableId:to});
        }
        else issues.push(`${page.title} / ${action.pfId} 的数据转入动作缺少有效的来源或目标表`);
      }
    }
  }
  for (const table of s.dbTables) for (const binding of table.sharedByMenus) {
    if (!pages.some(p=>p.pageId===binding.pageId)) { issues.push(`${table.tableName} 的菜单关联 ${binding.pageId} 不存在`); continue; }
    if (!usages.some(u=>u.pageId===binding.pageId && u.tableId===table.id)) usages.push({pageId:binding.pageId,tableId:table.id,pfId:null,description:`菜单关联：${binding.accessMode}`});
  }
  for (const note of s.stickyNotes) {
    if (!pages.some(p=>p.pageId===note.pageId)) issues.push(`便签 ${note.id} 引用了目录中不存在的页面 ${note.pageId}`);
    else if (!components.some(c=>c.pageId===note.pageId && c.pfId===note.targetWidgetId)) issues.push(`便签 ${note.id} 的目标组件 ${note.targetWidgetId} 不存在于页面 ${note.pageId}`);
  }
  const foreignKeys = diagramRelations(s.dbTables);
  issues.push(...foreignKeys.issues);
  return { pages, components, usages, actions, navigation, transfers, foreignKeys:foreignKeys.relations, issues };
}

export function projectSpecification(payload: PflowBinaryPayload): string {
  const s=payload.stateSnapshot, analysis=analyzeProject(s);
  const lines=[`# ${payload.meta.projectName} · 工程规格`, '', '> 根据当前保存的页面源码、表结构、动作配置及需求便签整理。配置不代表动作已经执行；需求便签不代表功能已经实现。', '', '## 页面与配置'];
  lines.splice(2,0,`工程快照：${payload.meta.updatedAt} · ${Object.keys(s.pageSources).length} 个画布 · ${s.dbTables.length} 张数据表。后续保存工程后，请重新导出源码目录。`, '');
  const evidence = reviewPageDependencies(s);
  for (const page of analysis.pages) {
    lines.push('', `### ${page.path}`, `- 页面 ID：${page.pageId}`, `- 源码：${page.hasSource?'已保存':'尚未提供'}`);
    for (const link of evidence.links.filter(l => l.pageId === page.pageId)) lines.push(`- 上游 ${link.sourcePageId} · ${link.requirement} · ${link.status}`);
    for (const c of evidence.cases.filter(c => c.pageId === page.pageId)) lines.push(`- 验收：${c.scenario} → ${c.expected}（${c.status}）`);
    for (const chart of evidence.sampleCharts.filter(c => c.pageId === page.pageId)) lines.push(`- 图表 ${chart.pfId} 使用内置示例数据。`);
    for (const usage of analysis.usages.filter(u=>u.pageId===page.pageId)) {
      const table=s.dbTables.find(t=>t.id===usage.tableId)!;
      lines.push(`- 数据关联：${table.tableName}（${table.cnName}）；依据：${usage.description}${usage.pfId?` / ${usage.pfId}`:''}`);
    }
    for (const action of analysis.actions.filter(a=>a.pageId===page.pageId)) lines.push(`- 已配置动作：${action.pfId} / ${action.event} → ${action.call.name}(${action.call.args.map(a=>JSON.stringify(a)).join(', ')})`);
    for (const note of s.stickyNotes.filter(n=>n.pageId===page.pageId)) lines.push(`- 需求记录 #${note.index}（${note.active?'启用':'停用'}；组件 ${note.targetWidgetId}）：${note.text}`);
  }
  lines.push('', '## 数据表');
  for (const table of s.dbTables) {
    lines.push('', `### ${table.tableName}（${table.cnName}）`, `- 内部表 ID：${table.id}`, `- 业务域：${table.domain}`);
    if (table.modeling) lines.push(`- 业务实体：${table.modeling.entity}`, `- 行粒度：${table.modeling.grain}`, `- 建表依据：${table.modeling.reason}`);
    for (const key of resolveUniqueConstraints(table)) lines.push(`- 唯一约束 ${key.name}（${key.columns.map(c => c.name).join('、')}）`);
    table.columns.forEach(c=>lines.push(`- ${c.name}：${c.dataType}；${c.nullable?'允许空值':'非空'}${c.isPrimaryKey?'；主键':''}${c.isUnique?'；单列唯一':''}${c.references?`；引用 ${c.references}`:''}；${c.comment}`));
  }
  const trace = reviewRequirementRecords(s.databaseRequirements ?? [], s.dbTables);
  if (trace.lines.length) lines.push('', '## 需求原文与数据库约束核对', ...trace.lines.map(line => '- '+line), ...trace.conflicts.map(line => '- 案例冲突 · '+line));
  const design = reviewDatabaseDesign(s.dbTables);
  if (design.tableErrors.length || design.relationErrors.length || design.risks.length) {
    lines.push('', '## 数据库设计审查',
      ...[...design.tableErrors, ...design.relationErrors].map(issue => `- 结构问题：${issue}`),
      ...design.risks.map(risk => `- 待复核：${risk}`));
  }
  const orphanNotes=s.stickyNotes.filter(n=>!analysis.pages.some(p=>p.pageId===n.pageId));
  if (analysis.issues.length || orphanNotes.length) lines.push('', '## 待修复的引用', ...analysis.issues.map(i=>`- ${i}`), ...orphanNotes.map(n=>`- 便签 ${n.id} 引用了目录中不存在的页面 ${n.pageId}：${n.text}`));
  if (!analysis.pages.length) lines.push('', '当前工程没有页面。');
  return lines.join('\n');
}
