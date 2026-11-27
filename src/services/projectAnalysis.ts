import { reviewPageDependencies } from './projectDependencies';
import { tr } from '../i18n/runtime';
import { reviewRequirementRecords } from '../proto/database/requirementReview';
import { resolveUniqueConstraints } from '../proto/database/uniqueConstraints';
import type { PflowBinaryPayload, ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import type { SitemapItem } from '../store/useProtoStore';
import { buildSitemap } from '../proto/sitemap';
import { parsePageSource } from '../proto/dsl/parser';
import { walk } from '../proto/dsl/tree';
import { isActionChain, type ActionCall, type PropValue, type ProtoNode } from '../proto/types';
import { purchaseTransferContractError } from '../proto/runtime/purchaseTransfer';
import { importSelectedRowsContractErrors } from '../proto/runtime/rowTransfer';
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
    if (!page) { issues.push(tr(`源码 ${pageId} 不在当前页面目录中`, `Source ${pageId} is not in the current sitemap`)); continue; }
    const parsed = parsePageSource(source);
    if (!parsed.doc || parsed.issues.some(i=>i.level==='error')) { issues.push(tr(`${page.title}：页面源码解析失败，无法分析`, `${page.title}: failed to parse page source`)); continue; }
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
        else issues.push(tr(`${page.title} / ${node.pfId} 引用了不存在的数据表 ${tableId}`, `${page.title} / ${node.pfId} references non-existent table ${tableId}`));
      }
      const activeTableId = node.props.activeTable;
      if (typeof activeTableId==='string' && activeTableId) {
        if (s.dbTables.some(t=>t.id===activeTableId)) usages.push({pageId,tableId:activeTableId,pfId:node.pfId,description:`${node.type}.activeTable`});
        else issues.push(tr(`${page.title} / ${node.pfId} 引用了不存在的数据表 ${activeTableId}`, `${page.title} / ${node.pfId} references non-existent table ${activeTableId}`));
      }
      Object.entries(node.props).forEach(([event,value])=>collect(value,node,event));
    }
    actions.push(...pageActions);
    for (const action of pageActions) {
      if (action.call.name==='navigate') {
        const to = action.call.args[0];
        if (typeof to==='string' && pages.some(p=>p.pageId===to && p.hasSource && !p.deprecated)) navigation.push({from:pageId,to,pfId:action.pfId,event:action.event});
        else issues.push(tr(`${page.title} / ${action.pfId} 的跳转目标 ${String(to)} 不可用`, `${page.title} / ${action.pfId} navigation target ${String(to)} is unavailable`));
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
          if (error) issues.push(tr(`${page.title} / ${action.pfId}：${error}`, `${page.title} / ${action.pfId}: ${error}`));
          else transfers.push({pageId,pfId:action.pfId,fromTableId:from,toTableId:to});
        }
        else issues.push(tr(`${page.title} / ${action.pfId} 的数据转入动作缺少有效的来源或目标表`, `${page.title} / ${action.pfId} data transfer action is missing a valid source or target table`));
      }
      if (action.call.name==='importSelectedRows') {
        const resolveTableNode = (id: PropValue) => {
          const matches = nodes.filter(n=>n.pfId===id || n.props.id===id);
          return matches.length===1 && matches[0].type==='Table' ? matches[0] : undefined;
        };
        const srcNode=resolveTableNode(action.call.args[0]), dstNode=resolveTableNode(action.call.args[1]);
        const from=typeof srcNode?.props.table==='string' ? srcNode.props.table : undefined;
        const to=typeof dstNode?.props.table==='string' ? dstNode.props.table : undefined;
        const defaultFk=typeof dstNode?.props.sourceForeignKey==='string' ? dstNode.props.sourceForeignKey : undefined;
        const errs = importSelectedRowsContractErrors(s.dbTables, from, to, action.call.args[2], defaultFk);
        if (errs.length > 0) {
          issues.push(...errs.map(e => tr(`${page.title} / ${action.pfId}：${e}`, `${page.title} / ${action.pfId}: ${e}`)));
        } else if (from && to) {
          transfers.push({pageId,pfId:action.pfId,fromTableId:from,toTableId:to});
        }
      }
    }
  }
  for (const table of s.dbTables) for (const binding of table.sharedByMenus) {
    if (!pages.some(p=>p.pageId===binding.pageId)) { issues.push(tr(`${table.tableName} 的菜单关联 ${binding.pageId} 不存在`, `Menu binding ${binding.pageId} on ${table.tableName} does not exist`)); continue; }
    if (!usages.some(u=>u.pageId===binding.pageId && u.tableId===table.id)) usages.push({pageId:binding.pageId,tableId:table.id,pfId:null,description:tr(`菜单关联：${binding.accessMode}`, `Menu binding: ${binding.accessMode}`)});
  }
  for (const note of s.stickyNotes) {
    if (!pages.some(p=>p.pageId===note.pageId)) issues.push(tr(`便签 ${note.id} 引用了目录中不存在的页面 ${note.pageId}`, `Sticky note ${note.id} references page ${note.pageId} missing from sitemap`));
    else if (!components.some(c=>c.pageId===note.pageId && c.pfId===note.targetWidgetId)) issues.push(tr(`便签 ${note.id} 的目标组件 ${note.targetWidgetId} 不存在于页面 ${note.pageId}`, `Target component ${note.targetWidgetId} of sticky note ${note.id} does not exist on page ${note.pageId}`));
  }
  const foreignKeys = diagramRelations(s.dbTables);
  issues.push(...foreignKeys.issues);
  return { pages, components, usages, actions, navigation, transfers, foreignKeys:foreignKeys.relations, issues };
}

export function projectSpecification(payload: PflowBinaryPayload): string {
  const s=payload.stateSnapshot, analysis=analyzeProject(s);
  const lines=[
    tr(`# ${payload.meta.projectName} · 工程规格`, `# ${payload.meta.projectName} · Project Specification`),
    '',
    tr('> 根据当前保存的页面源码、表结构、动作配置及需求便签整理。配置不代表动作已经执行；需求便签不代表功能已经实现。', '> Compiled from saved page sources, table schemas, action bindings, and requirement sticky notes. Configured actions and sticky notes describe intent rather than live backend execution.'),
    '',
    tr('## 页面与配置', '## Pages & Configuration'),
  ];
  lines.splice(2,0,tr(
    `工程快照：${payload.meta.updatedAt} · ${Object.keys(s.pageSources).length} 个画布 · ${s.dbTables.length} 张数据表。后续保存工程后，请重新导出源码目录。`,
    `Project snapshot: ${payload.meta.updatedAt} · ${Object.keys(s.pageSources).length} canvas(es) · ${s.dbTables.length} table(s). Re-export unpacked files after saving further changes.`,
  ), '');
  const evidence = reviewPageDependencies(s);
  for (const page of analysis.pages) {
    lines.push(
      '',
      `### ${page.path}`,
      tr(`- 页面 ID：${page.pageId}`, `- Page ID: ${page.pageId}`),
      tr(`- 源码：${page.hasSource?'已保存':'尚未提供'}`, `- Source: ${page.hasSource?'Saved':'Not provided yet'}`),
    );
    for (const link of evidence.links.filter(l => l.pageId === page.pageId)) lines.push(tr(`- 上游 ${link.sourcePageId} · ${link.requirement} · ${link.status}`, `- Upstream ${link.sourcePageId} · ${link.requirement} · ${link.status}`));
    for (const c of evidence.cases.filter(c => c.pageId === page.pageId)) lines.push(tr(`- 验收：${c.scenario} → ${c.expected}（${c.status}）`, `- Acceptance: ${c.scenario} → ${c.expected} (${c.status})`));
    for (const chart of evidence.sampleCharts.filter(c => c.pageId === page.pageId)) lines.push(tr(`- 图表 ${chart.pfId} 使用内置示例数据。`, `- Chart ${chart.pfId} uses built-in sample data.`));
    for (const usage of analysis.usages.filter(u=>u.pageId===page.pageId)) {
      const table=s.dbTables.find(t=>t.id===usage.tableId)!;
      lines.push(tr(`- 数据关联：${table.tableName}（${table.cnName}）；依据：${usage.description}${usage.pfId?` / ${usage.pfId}`:''}`, `- Table binding: ${table.tableName} (${table.cnName}); source: ${usage.description}${usage.pfId?` / ${usage.pfId}`:''}`));
    }
    for (const action of analysis.actions.filter(a=>a.pageId===page.pageId)) lines.push(tr(`- 已配置动作：${action.pfId} / ${action.event} → ${action.call.name}(${action.call.args.map(a=>JSON.stringify(a)).join(', ')})`, `- Action: ${action.pfId} / ${action.event} → ${action.call.name}(${action.call.args.map(a=>JSON.stringify(a)).join(', ')})`));
    for (const note of s.stickyNotes.filter(n=>n.pageId===page.pageId)) lines.push(tr(`- 需求记录 #${note.index}（${note.active?'启用':'停用'}；组件 ${note.targetWidgetId}）：${note.text}`, `- Sticky note #${note.index} (${note.active?'Active':'Inactive'}; widget ${note.targetWidgetId}): ${note.text}`));
  }
  lines.push('', tr('## 数据表', '## Database Tables'));
  for (const table of s.dbTables) {
    lines.push(
      '',
      tr(`### ${table.tableName}（${table.cnName}）`, `### ${table.tableName} (${table.cnName})`),
      tr(`- 内部表 ID：${table.id}`, `- Internal Table ID: ${table.id}`),
      tr(`- 业务域：${table.domain}`, `- Domain: ${table.domain}`),
    );
    if (table.modeling) lines.push(
      tr(`- 业务实体：${table.modeling.entity}`, `- Entity: ${table.modeling.entity}`),
      tr(`- 行粒度：${table.modeling.grain}`, `- Row Grain: ${table.modeling.grain}`),
      tr(`- 建表依据：${table.modeling.reason}`, `- Rationale: ${table.modeling.reason}`),
    );
    for (const key of resolveUniqueConstraints(table)) lines.push(tr(`- 唯一约束 ${key.name}（${key.columns.map(c => c.name).join('、')}）`, `- Unique constraint ${key.name} (${key.columns.map(c => c.name).join(', ')})`));
    table.columns.forEach(c=>lines.push(tr(
      `- ${c.name}：${c.dataType}；${c.nullable?'允许空值':'非空'}${c.isPrimaryKey?'；主键':''}${c.isUnique?'；单列唯一':''}${c.references?`；引用 ${c.references}`:''}；${c.comment}`,
      `- ${c.name}: ${c.dataType}; ${c.nullable?'NULL':'NOT NULL'}${c.isPrimaryKey?'; PK':''}${c.isUnique?'; UNIQUE':''}${c.references?`; FK -> ${c.references}`:''}; ${c.comment}`,
    )));
  }
  const trace = reviewRequirementRecords(s.databaseRequirements ?? [], s.dbTables);
  if (trace.lines.length) lines.push('', tr('## 需求原文与数据库约束核对', '## Requirement & Schema Constraint Verification'), ...trace.lines.map(line => '- '+line), ...trace.conflicts.map(line => tr('- 案例冲突 · ', '- Conflict · ')+line));
  const design = reviewDatabaseDesign(s.dbTables);
  if (design.tableErrors.length || design.relationErrors.length || design.risks.length) {
    lines.push('', tr('## 数据库设计审查', '## Database Design Review'),
      ...[...design.tableErrors, ...design.relationErrors].map(issue => tr(`- 结构问题：${issue}`, `- Schema error: ${issue}`)),
      ...design.risks.map(risk => tr(`- 待复核：${risk}`, `- Review needed: ${risk}`)));
  }
  const orphanNotes=s.stickyNotes.filter(n=>!analysis.pages.some(p=>p.pageId===n.pageId));
  if (analysis.issues.length || orphanNotes.length) lines.push('', tr('## 待修复的引用', '## Broken References'), ...analysis.issues.map(i=>`- ${i}`), ...orphanNotes.map(n=>tr(`- 便签 ${n.id} 引用了目录中不存在的页面 ${n.pageId}：${n.text}`, `- Sticky note ${n.id} references missing page ${n.pageId}: ${n.text}`)));
  if (!analysis.pages.length) lines.push('', tr('当前工程没有页面。', 'No pages in the current project.'));
  return lines.join('\n');
}
