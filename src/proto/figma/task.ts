import { buildSitemap, type SitemapLayout } from '../sitemap';
import type { PagePlatform } from '../mobile/types';

export const figmaSourcePagePattern = /^fig-page-([a-z0-9_-]{4,48})$/;
export const figmaOptimizedPagePattern = /^fig-optimized-([a-z0-9_-]{4,48})$/;

export const figmaCopyId = (sourcePageId: string): string =>
  'fig-optimized-' + sourcePageId.slice('fig-page-'.length);

export function verifiedFigmaSourceId(copyId: string, header: readonly string[] | undefined): string | undefined {
  const hash = figmaOptimizedPagePattern.exec(copyId)?.[1];
  if (!hash || !header) return undefined;
  const sourceId = 'fig-page-' + hash;
  const markers = header.filter((line) => line.startsWith('// @alex-figma-source '));
  if (markers.length === 1 && markers[0] === '// @alex-figma-source ' + sourceId) return sourceId;
  return undefined;
}

export type FigmaScope =
  | { kind: 'project' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'page'; pageId: string };

export interface FigmaCatalogPage {
  pageId: string;
  title: string;
  path: string;
  platform: PagePlatform;
  folderIds: string[];
}

export function figmaCatalog(layout: SitemapLayout & { pageSources: Record<string, string> }) {
  const pages: FigmaCatalogPage[] = [];
  const folders: { folderId: string; path: string; pageCount: number }[] = [];
  if (!Object.keys(layout.pageSources).some((id) => figmaSourcePagePattern.test(id))) {
    return { pages, folders };
  }
  const platformByPageId = new Map<string, PagePlatform>();
  for (const dp of layout.designerPages) {
    if (dp.platform) platformByPageId.set(dp.pageId, dp.platform);
  }

  function visit(items: ReturnType<typeof buildSitemap>, ids: string[], titles: string[]) {
    for (const item of items) {
      if (item.deprecated) continue;
      const path = [...titles, item.title];
      if (item.type === 'folder') {
        const start = pages.length;
        const entry = { folderId: item.id, path: path.join(' / '), pageCount: 0 };
        folders.push(entry);
        visit(item.children ?? [], [...ids, item.id], path);
        entry.pageCount = pages.length - start;
      } else if (
        item.type === 'page' &&
        item.pageId &&
        figmaSourcePagePattern.test(item.pageId) &&
        Object.hasOwn(layout.pageSources, item.pageId)
      ) {
        pages.push({
          pageId: item.pageId,
          title: item.title,
          path: path.join(' / '),
          platform: platformByPageId.get(item.pageId) ?? 'desktop',
          folderIds: ids,
        });
      }
    }
  }
  visit(buildSitemap(layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase), [], []);
  return { pages, folders: folders.filter((f) => f.pageCount > 0) };
}

export function figmaScopePages(catalog: ReturnType<typeof figmaCatalog>, scope: FigmaScope) {
  if (scope.kind === 'project') return catalog.pages;
  const pages =
    scope.kind === 'page'
      ? catalog.pages.filter((p) => p.pageId === scope.pageId)
      : scope.kind === 'folder'
      ? catalog.pages.filter((p) => p.folderIds.includes(scope.folderId))
      : [];
  if (!pages.length) throw new Error('指定范围没有可读取的 Figma 源页面，请核对目录或页面 ID');
  return pages;
}

export function figmaScopeFocus(scope: FigmaScope) {
  return scope.kind === 'page' ? { pageId: scope.pageId } : scope.kind === 'folder' ? { folderId: scope.folderId } : {};
}

export function figmaTargetPhrase(scope: FigmaScope, label: string) {
  return scope.kind === 'page'
    ? `页面「${label}」（${scope.pageId}）`
    : scope.kind === 'folder'
    ? `目录「${label}」及子目录（${scope.folderId}）`
    : '全项目';
}

export function figmaOptimizationTask(scope: FigmaScope, label: string, readOnly: boolean) {
  const target = figmaTargetPhrase(scope, label);
  if (readOnly) {
    return `请只读分析${target}范围内从 Figma 导入的设计画板。调用 protoflow_inspect_figma_project 与 protoflow_inspect_page(view="figma") 盘点各画板的端型（桌面/移动）、Auto Layout 重复行或卡片列表、导航菜单、筛选查询栏、表单控件与跨页跳转；对照已有数据表，按业务实体说明拟新增或复用的表结构、字段含义，并列出建议分批重塑的页面与待确认交互，等我确认后再执行。`;
  }
  return `请分析${target}范围内从 Figma 导入的设计画板，将其重塑为标准流式 Alex 业务页面并建立或复用 ER 数据表。先用 protoflow_get_project 读取完整表目录，再用 protoflow_inspect_figma_project 和 protoflow_inspect_page(view="figma") 核对源画板的端型、Auto Layout 重复列表/表格行、导航栏、筛选区、表单项及跨页跳转。根据明确的业务实体暂存表结构（设计稿中的示例文案不要硬编码写入业务表记录），随后逐页调用 protoflow_reshape_figma_page 在同目录生成标准流式重构版（保留原 Figma 源画板不变）：桌面端使用 <Page> 搭配 NavMenu、PageHeader、QueryForm、Table / CardGrid、Form、Modal/Drawer 等标准物料；移动端使用 <MobilePage> 搭配 MTopBar、MBannerCarousel、MSearchPill、MPillTabs、MCardGrid / MFeedList / MTaskList、MTabBar、MBottomSheet 等移动物料；并在 coverage 中明确记录已转换的源图层 pfId → 目标标准组件 pfId 及未确定或暂缓的 pending 项，切勿静默丢弃关键业务区块。`;
}

export interface FigmaTaskState {
  text: string;
  label?: string;
  readOnly: boolean;
  scope: FigmaScope;
}

export function applyFigmaTaskDraft<T extends { text: string; figmaTask?: FigmaTaskState }>(
  current: T,
  scope: FigmaScope,
  label: string,
  readOnly: boolean,
): T {
  const nextPreset = figmaOptimizationTask(scope, label, readOnly);
  const prev = current.figmaTask;
  let nextText: string;
  if (!prev) {
    nextText = [current.text.trim(), nextPreset].filter(Boolean).join('\n\n');
  } else if (prev.text && current.text.includes(prev.text)) {
    nextText = current.text.replace(prev.text, nextPreset);
  } else if (prev.readOnly === readOnly && prev.label !== undefined) {
    const oldTarget = figmaTargetPhrase(prev.scope, prev.label);
    const nextTarget = figmaTargetPhrase(scope, label);
    nextText = current.text.includes(oldTarget) ? current.text.replace(oldTarget, nextTarget) : current.text;
  } else if (!current.text.trim()) {
    nextText = nextPreset;
  } else {
    nextText = current.text;
  }
  return { ...current, text: nextText, figmaTask: { text: nextPreset, label, readOnly, scope } };
}

export function clearFigmaTaskDraft<T extends { text: string; figmaTask?: FigmaTaskState }>(current: T): T {
  const prev = current.figmaTask;
  if (!prev) return current;
  let nextText = current.text;
  if (prev.text && current.text.includes(prev.text)) {
    nextText = current.text.replace(prev.text, '').trim();
  } else if (/^请(?:只读)?分析[\s\S]*范围内从 Figma 导入的设计画板/.test(current.text.trim())) {
    nextText = '';
  }
  return { ...current, text: nextText, figmaTask: undefined };
}

export function resolveSubmittedFigmaMigration(
  figmaTask: FigmaTaskState | undefined,
  pendingQuestionScope: FigmaScope | undefined,
): { scope: FigmaScope; readOnly: boolean } | undefined {
  if (figmaTask) return { scope: figmaTask.scope, readOnly: figmaTask.readOnly };
  if (pendingQuestionScope) return { scope: pendingQuestionScope, readOnly: false };
  return undefined;
}

export function buildFigmaMigrationInstructions(migration: { scope: FigmaScope; readOnly: boolean }): string {
  const scopeDesc =
    migration.scope.kind === 'page'
      ? `单页范围（${migration.scope.pageId}）`
      : migration.scope.kind === 'folder'
      ? `目录范围（${migration.scope.folderId}）`
      : '全项目范围';
  if (migration.readOnly) {
    return `Figma 画板只读盘点专项规则（当前锁定：${scopeDesc}）：先用 protoflow_inspect_figma_project 盘点所选范围内的 fig-page-... 源画板（关注 platform 桌面/移动区分、repeatingGroups 重复行或卡片列表、semanticBlocks 导航/筛选/表单区块与跨页跳转），再用 protoflow_inspect_page(view="figma") 读取具体图层证据，结合 protoflow_get_project 的已有表结构输出分析报告与分批建议，严禁产生任何写入修改。`;
  }
  return `Figma 画板重构专项规则（当前锁定：${scopeDesc}）：先用 protoflow_inspect_figma_project 盘点所选范围内的 fig-page-... 源画板（关注 platform 桌面/移动区分、repeatingGroups 重复行或卡片列表、semanticBlocks 导航/筛选/表单区块与跨页跳转），再用 protoflow_inspect_page(view="figma") 读取具体图层证据。先通过 protoflow_get_project 核对表目录并按业务实体暂存表结构，随后调用 protoflow_reshape_figma_page 传入所选范围内的源画板 fig-page-... ID（宿主自动生成同目录 fig-optimized-... 副本并保留原始 Figma 画板不变）：桌面画板重塑为 <Page> 搭配 NavMenu、PageHeader、QueryForm、Table / CardGrid、Form、Modal/Drawer 等标准组件；移动画板重塑为 <MobilePage> 搭配 MTopBar、MBannerCarousel、MSearchPill、MPillTabs、MCardGrid / MFeedList / MTaskList、MTabBar、MBottomSheet 等移动物料；并在 coverage.converted 与 coverage.pending 中如实交代源图层与标准组件的对应关系，不得保留 FigmaCanvas/FigmaFrame 等还原层物料，也不得修改所选范围以外的页面。`;
}
