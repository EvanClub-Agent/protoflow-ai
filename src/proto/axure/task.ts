import { buildSitemap, type SitemapLayout } from '../sitemap';

export const axureSourcePagePattern = /^rp-page-([0-9a-f]{32})$/;
export const axureCopyId = (sourcePageId:string) => 'rp-optimized-' + sourcePageId.slice('rp-page-'.length);
export function verifiedAxureSourceId(copyId:string, header:readonly string[] | undefined) {
  const guid = /^rp-optimized-([a-f0-9]{32})$/.exec(copyId)?.[1];
  if (!guid || !header) return;
  const sourceId = 'rp-page-' + guid;
  const markers = header.filter(line => line.startsWith('// @alex-axure-source '));
  if (markers.length === 1 && markers[0] === '// @alex-axure-source ' + sourceId) return sourceId;
}
export type AxureScope = { kind:'project' } | { kind:'folder'; folderId:string } | { kind:'page'; pageId:string };

interface SourcePage {
  pageId: string;
  title: string;
  path: string;
  folderIds: string[];
}

export function axureCatalog(layout: SitemapLayout & { pageSources:Record<string,string> }) {
  const pages: SourcePage[] = [];
  const folders: { folderId:string; path:string; pageCount:number }[] = [];
  if (!Object.keys(layout.pageSources).some(id => axureSourcePagePattern.test(id))) return {pages,folders};
  function visit(items:ReturnType<typeof buildSitemap>, ids:string[], titles:string[]) {
    for (const item of items) {
      if (item.deprecated) continue;
      const path = [...titles,item.title];
      if (item.type === 'folder') {
        const start = pages.length;
        const entry = {folderId:item.id,path:path.join(' / '),pageCount:0};
        folders.push(entry);
        visit(item.children ?? [], [...ids,item.id],path);
        entry.pageCount = pages.length - start;
      } else if (item.type === 'page' && item.pageId && axureSourcePagePattern.test(item.pageId) && Object.hasOwn(layout.pageSources,item.pageId)) {
        pages.push({pageId:item.pageId,title:item.title,path:path.join(' / '),folderIds:ids});
      }
    }
  }
  visit(buildSitemap(layout.designerFolders,layout.designerPages,layout.sitemapOverrides,layout.sitemapBase),[],[]);
  return {pages,folders:folders.filter(f => f.pageCount > 0)};
}

export function axureScopePages(catalog:ReturnType<typeof axureCatalog>, scope:AxureScope) {
  if (scope.kind === 'project') return catalog.pages;
  const pages = scope.kind === 'page' ? catalog.pages.filter(p=>p.pageId === scope.pageId)
    : scope.kind === 'folder' ? catalog.pages.filter(p=>p.folderIds.includes(scope.folderId)) : [];
  if (!pages.length) throw new Error('指定范围没有可读取的 RP 源页面，请核对目录或页面 ID');
  return pages;
}

export function axureScopeFocus(scope:AxureScope) {
  return scope.kind === 'page' ? {pageId:scope.pageId} : scope.kind === 'folder' ? {folderId:scope.folderId} : {};
}

export function axureTargetPhrase(scope:AxureScope, label:string) {
  return scope.kind === 'page' ? `页面「${label}」（${scope.pageId}）`
    : scope.kind === 'folder' ? `目录「${label}」及子目录（${scope.folderId}）` : '全项目';
}

export function axureOptimizationTask(scope:AxureScope, label:string, readOnly:boolean) {
  const target = axureTargetPhrase(scope, label);
  if (readOnly) return `请只读分析${target}范围内从 RP 导入的原型。盘点页面、表格和表单，对照项目已有物料和数据表，按业务实体说明可复用的表、拟新增或补充的字段、每一行代表什么，并给出来源页面和控件。列出不明确的关联和交互、建议分批转换的页面，等我决定后再执行。`;
  return `请分析${target}范围内从 RP 导入的原型，转换为标准流式 Alex 物料并生成或补充表结构。先盘点来源页、原表头、零散查询与录入控件、行级点击一致性、面板状态、页面跳转和导入提示。跨页核对业务实体、每行代表什么及可复用的表；按明确依据暂存表结构（原型示例行不要写入业务表），不要仅停留在建表。逐页调用 protoflow_reshape_axure_page 生成同目录流式优化版（保留原始页）：将平铺查询控件合成为绑定目标 Table 的 QueryForm；将静态表格转为标准 Table 时，在 coverage.converted 中直接指向 Table 的 pfId 并提交 tableId 与逐列表头 columnMappings（headerPfId → field/columnId、index、checkbox、radio、actions 或 pending，确保 Table.columns 与原表头一一对应且不颠倒字段）；逐行一致的行操作须核对源单元格动作链、目标页并传入当前行参数（如 navigate(targetPageId, "row")）。保留区块（retained）必须保持原物料类型、状态、内容和交互；发生语义变化的区块或单行示例动作、侧栏、隐藏面板、占位元件与导入警告须明确列为 converted 或 pending，切勿静默丢弃。`;
}

export interface RpTaskState {
  text: string;
  label?: string;
  readOnly: boolean;
  scope: AxureScope;
}

export function applyRpTaskDraft<T extends { text: string; rpTask?: RpTaskState }>(
  current: T,
  scope: AxureScope,
  label: string,
  readOnly: boolean,
): T {
  const nextPreset = axureOptimizationTask(scope, label, readOnly);
  const prev = current.rpTask;
  let nextText: string;
  if (!prev) {
    nextText = [current.text.trim(), nextPreset].filter(Boolean).join('\n\n');
  } else if (prev.text && current.text.includes(prev.text)) {
    nextText = current.text.replace(prev.text, nextPreset);
  } else if (prev.readOnly === readOnly && prev.label !== undefined) {
    const oldTarget = axureTargetPhrase(prev.scope, prev.label);
    const nextTarget = axureTargetPhrase(scope, label);
    nextText = current.text.includes(oldTarget) ? current.text.replace(oldTarget, nextTarget) : current.text;
  } else if (!current.text.trim()) {
    nextText = nextPreset;
  } else {
    // Keep the user's edited or rewritten prompt intact without appending a duplicate preset block.
    nextText = current.text;
  }
  return { ...current, text: nextText, rpTask: { text: nextPreset, label, readOnly, scope } };
}

export function clearRpTaskDraft<T extends { text: string; rpTask?: RpTaskState }>(current: T): T {
  const prev = current.rpTask;
  if (!prev) return current;
  let nextText = current.text;
  if (prev.text && current.text.includes(prev.text)) {
    nextText = current.text.replace(prev.text, '').trim();
  } else if (/^请(?:只读)?分析[\s\S]*范围内从 RP 导入的原型/.test(current.text.trim())) {
    nextText = '';
  }
  return { ...current, text: nextText, rpTask: undefined };
}

export function resolveSubmittedRpMigration(
  rpTask: RpTaskState | undefined,
  pendingQuestionScope: AxureScope | undefined,
): { scope: AxureScope; readOnly: boolean } | undefined {
  if (rpTask) return { scope: rpTask.scope, readOnly: rpTask.readOnly };
  if (pendingQuestionScope) return { scope: pendingQuestionScope, readOnly: false };
  return undefined;
}
