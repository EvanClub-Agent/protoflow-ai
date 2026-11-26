import { tr } from '../i18n/runtime';
import { pageContractErrors } from '../proto/ai/pageContract';
import { bindAxureTable, inspectAxureProject, type RpColumnMapping } from '../proto/axure/migration';
import {
  evaluateAxureMigrationProgress,
  redirectAxureNavigations,
  inspectAxurePage,
  optimizeAxureBlock,
  reshapeAxurePage,
  retargetOptimizedPageSource,
  type RpReshapeCoverage,
} from '../proto/axure/optimization';
import { axureCatalog, verifiedAxureSourceId, type AxureScope } from '../proto/axure/task';
import { checkAiPagePlatform } from '../services/projectPagePlatform';
import { parsePageSource } from '../proto/dsl/parser';
import { readPageHeader } from '../proto/dsl/header';
import { printPageSource } from '../proto/dsl/printer';
import {
  inspectFigmaPage,
  redirectFigmaNavigations,
  inspectFigmaProject,
  isFigmaOptimizedCopyId,
  reshapeFigmaPage,
  retargetFigmaOptimizedPageSource,
  type FigmaReshapeCoverage,
} from '../proto/figma/optimization';
import { figmaCatalog, verifiedFigmaSourceId, type FigmaScope } from '../proto/figma/task';
import type { PagePlatform, ProjectMode } from '../proto/mobile/types';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';

export const AXURE_COLUMN_MAPPING_SCHEMA = {
  type: 'object',
  properties: {
    headerPfId: { type: 'string', description: 'Exact firstRow[].pfId from inspect_page(view="axure").' },
    role: { enum: ['field', 'index', 'checkbox', 'radio', 'actions'] },
    columnId: { type: 'string', description: 'Exact columns[].id in tableId when role is "field".' },
  },
  required: ['headerPfId', 'role'],
  additionalProperties: false,
} as const;

export const AXURE_RESHAPE_COLUMN_MAPPING_SCHEMA = {
  type: 'object',
  properties: {
    headerPfId: { type: 'string', description: 'firstRow[].pfId from inspect_page(view="axure").' },
    role: { enum: ['field', 'index', 'checkbox', 'radio', 'actions', 'pending'] },
    columnId: { type: 'string', description: 'columns[].id when role="field".' },
    reason: { type: 'string', description: 'Reason when role="pending".' },
  },
  required: ['headerPfId', 'role'],
  additionalProperties: false,
} as const;

export const AXURE_RESHAPE_COVERAGE_SCHEMA = {
  type: 'object',
  description: 'RP source-widget accounting (converted/retained/pending).',
  properties: {
    converted: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourcePfIds: { type: 'array', minItems: 1, items: { type: 'string' } },
          targetPfId: {
            type: 'string',
            description: 'Target material pfId in source (Table pfId for StaticTable -> Table).',
          },
          summary: { type: 'string' },
          tableId: {
            type: 'string',
            description: 'Bound dbTables.id (required for StaticTable -> Table).',
          },
          columnMappings: {
            type: 'array',
            minItems: 1,
            description: 'Ordered first-row headerPfId mappings (required for StaticTable -> Table).',
            items: AXURE_RESHAPE_COLUMN_MAPPING_SCHEMA,
          },
        },
        required: ['sourcePfIds', 'targetPfId', 'summary'],
        additionalProperties: false,
      },
    },
    retained: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourcePfIds: { type: 'array', minItems: 1, items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['sourcePfIds', 'summary'],
        additionalProperties: false,
      },
    },
    pending: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourcePfIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['converted'],
  additionalProperties: false,
} as const;

export const FIGMA_RESHAPE_COVERAGE_SCHEMA = {
  type: 'object',
  description: 'Figma source-layer accounting (converted/pending).',
  properties: {
    converted: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          sourcePfIds: { type: 'array', minItems: 1, items: { type: 'string' } },
          targetPfId: { type: 'string' },
          summary: { type: 'string' },
          tableId: { type: 'string' },
        },
        required: ['sourcePfIds', 'targetPfId', 'summary'],
        additionalProperties: false,
      },
    },
    pending: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourcePfIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['converted'],
  additionalProperties: false,
} as const;

export function resolveImportInspectionScope(args: {
  pageId?: unknown;
  folderId?: unknown;
}): AxureScope & FigmaScope {
  const hasPage = args.pageId !== undefined;
  const hasFolder = args.folderId !== undefined;
  if (hasPage && hasFolder) {
    throw new Error(tr('请选择一个页面、一个目录或全工程（不要同时传 pageId 与 folderId）', 'Select either one pageId, one folderId, or omit both for the entire project'));
  }
  if (hasPage) {
    if (typeof args.pageId !== 'string' || !args.pageId.trim()) {
      throw new Error(tr('pageId 必须是非空字符串', 'pageId must be a non-empty string'));
    }
    return { kind: 'page', pageId: args.pageId.trim() };
  }
  if (hasFolder) {
    if (typeof args.folderId !== 'string' || !args.folderId.trim()) {
      throw new Error(tr('folderId 必须是非空字符串', 'folderId must be a non-empty string'));
    }
    return { kind: 'folder', folderId: args.folderId.trim() };
  }
  return { kind: 'project' };
}

export interface PriorOptimizedCopyMeta {
  title?: string;
  folderId?: string;
  platform?: PagePlatform;
  rpCoverage?: RpReshapeCoverage;
  figmaCoverage?: FigmaReshapeCoverage;
}

/**
 * Shared post-edit normalization for `rp-optimized-*` and `fig-optimized-*` copy pages:
 * retargets cross-page navigations to sibling optimized copies and re-validates prior coverage if supplied.
 */
export function retargetEditedOptimizedCopy(
  snapshot: Pick<ProjectStateSnapshot, 'designerFolders' | 'designerPages' | 'sitemapOverrides' | 'sitemapBase' | 'pageSources' | 'dbTables' | 'tableRows'>,
  pageId: string,
  nextSource: string,
  priorMeta?: PriorOptimizedCopyMeta,
): {
  isOptimizedCopy: boolean;
  source: string;
  preservedMeta: PriorOptimizedCopyMeta;
} {
  const preservedMeta: PriorOptimizedCopyMeta = {};
  let source = nextSource;

  if (/^rp-optimized-[0-9a-f]{32}$/.test(pageId)) {
    const retargeted = retargetOptimizedPageSource(source, snapshot.pageSources, pageId);
    if (retargeted) source = retargeted;
    if (priorMeta) {
      if (priorMeta.title) preservedMeta.title = priorMeta.title;
      if (priorMeta.folderId) preservedMeta.folderId = priorMeta.folderId;
      if (priorMeta.rpCoverage) {
        const srcPageId = 'rp-page-' + pageId.slice('rp-optimized-'.length);
        const rechecked = reshapeAxurePage(snapshot, srcPageId, source, priorMeta.rpCoverage);
        source = rechecked.source;
        preservedMeta.rpCoverage = rechecked.rpCoverage;
      }
    }
    return { isOptimizedCopy: true, source, preservedMeta };
  }

  if (isFigmaOptimizedCopyId(pageId)) {
    const retargeted = retargetFigmaOptimizedPageSource(source, snapshot.pageSources, pageId);
    if (retargeted) source = retargeted;
    if (priorMeta) {
      if (priorMeta.title) preservedMeta.title = priorMeta.title;
      if (priorMeta.folderId) preservedMeta.folderId = priorMeta.folderId;
      if (priorMeta.platform) preservedMeta.platform = priorMeta.platform;
      if (priorMeta.figmaCoverage) {
        const srcPageId = 'fig-page-' + pageId.slice('fig-optimized-'.length);
        const rechecked = reshapeFigmaPage(snapshot, srcPageId, source, priorMeta.figmaCoverage);
        source = rechecked.source;
        preservedMeta.figmaCoverage = rechecked.figmaCoverage;
      }
    }
    return { isOptimizedCopy: true, source, preservedMeta };
  }

  return { isOptimizedCopy: false, source, preservedMeta };
}

export function siblingNavigationPatches(
  snapshot: Pick<ProjectStateSnapshot, 'designerPages' | 'pageSources'>,
  newCopyId: string,
  allowedCopyIds?: ReadonlySet<string>,
): { pageId: string; source: string }[] {
  const figma = isFigmaOptimizedCopyId(newCopyId);
  const verify = figma ? verifiedFigmaSourceId : verifiedAxureSourceId;
  const sourceId = verify(newCopyId, readPageHeader(snapshot.pageSources[newCopyId]));
  if (!sourceId) throw new Error(`Missing optimized copy provenance: ${newCopyId}`);
  const targets = new Map([[sourceId, newCopyId]]);
  const redirect = figma ? redirectFigmaNavigations : redirectAxureNavigations;
  const patches = [];
  for (const { pageId } of snapshot.designerPages) {
    if (pageId === newCopyId || (allowedCopyIds && !allowedCopyIds.has(pageId))) continue;
    const source = snapshot.pageSources[pageId];
    if (!source || !verify(pageId, readPageHeader(source))) continue;
    const sibling = parsePageSource(source, { strict: true });
    if (sibling.doc && !sibling.issues.length && !sibling.normalized && redirect(sibling.doc, targets)) {
      patches.push({ pageId, source: printPageSource(sibling.doc) });
    }
  }
  return patches;
}

/** Applies a validated optimized copy patch onto a draft project. */
export function commitOptimizedCopyPatch(
  stateSnapshot: ProjectStateSnapshot,
  projectMode: ProjectMode | undefined,
  patch: {
    pageId: string;
    title: string;
    folderId: string;
    platform?: PagePlatform;
    source: string;
  },
  setActive?: boolean,
): {
  optimizedPageId: string;
  title: string;
  folderId: string;
  platform: PagePlatform;
  created: boolean;
  activePageId: string;
} {
  const parsed = parsePageSource(patch.source, { strict: true });
  if (!parsed.doc || parsed.issues.length > 0) {
    throw new Error(
      tr(
        `优化副本源码解析失败：${parsed.issues.map((i) => i.message).join('；')}`,
        `Optimized copy source failed parsing: ${parsed.issues.map((i) => i.message).join('; ')}`,
      ),
    );
  }
  const contractErrors = pageContractErrors(patch.source, stateSnapshot.dbTables, {
    tableRows: stateSnapshot.tableRows,
  });
  if (contractErrors.length > 0) {
    throw new Error(
      tr(
        `优化副本未通过物料或数据契约校验（共 ${contractErrors.length} 项）：\n${contractErrors.join('\n')}`,
        `Optimized copy failed material or data contract validation (${contractErrors.length} issue(s)):\n${contractErrors.join('\n')}`,
      ),
    );
  }

  const resolvedPlatform = checkAiPagePlatform(
    stateSnapshot,
    patch.pageId,
    parsed.doc.root.type,
    projectMode,
    patch.platform,
  );

  const isNew = !Object.prototype.hasOwnProperty.call(stateSnapshot.pageSources, patch.pageId);
  const existingIdx = stateSnapshot.designerPages.findIndex((p) => p.pageId === patch.pageId);
  if (existingIdx < 0) {
    stateSnapshot.designerPages.push({
      pageId: patch.pageId,
      title: patch.title,
      folderId: patch.folderId,
      platform: resolvedPlatform,
    });
  } else {
    stateSnapshot.designerPages[existingIdx] = {
      ...stateSnapshot.designerPages[existingIdx],
      title: patch.title,
      platform: resolvedPlatform,
    };
  }
  stateSnapshot.pageSources[patch.pageId] = patch.source;
  if (isNew) {
    for (const sibling of siblingNavigationPatches(stateSnapshot, patch.pageId)) {
      stateSnapshot.pageSources[sibling.pageId] = sibling.source;
    }
  }
  if (stateSnapshot.activePageId === '' || setActive === true) {
    stateSnapshot.activePageId = patch.pageId;
  }

  return {
    optimizedPageId: patch.pageId,
    title: patch.title,
    folderId: patch.folderId,
    platform: resolvedPlatform,
    created: isNew,
    activePageId: stateSnapshot.activePageId,
  };
}

export function inspectImportedProjectInventory(
  stateSnapshot: ProjectStateSnapshot,
  sourceType: 'axure' | 'figma' | 'auto',
  scope: AxureScope & FigmaScope,
  offset = 0,
  limit = 4,
) {
  if (sourceType === 'axure') {
    const inventory = inspectAxureProject(stateSnapshot, scope, offset, limit);
    const progress = evaluateAxureMigrationProgress(stateSnapshot, scope, []);
    return { sourceType: 'axure' as const, ...inventory, migrationProgress: progress };
  }
  if (sourceType === 'figma') {
    const inventory = inspectFigmaProject(stateSnapshot, scope, offset, limit);
    return { sourceType: 'figma' as const, ...inventory };
  }

  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 8) {
    throw new Error(tr('页面分页需要非负整数 offset 和 1 到 8 的 limit', 'Expected offset >= 0 and limit between 1 and 8'));
  }
  const inScope = (page: { pageId: string; folderIds: string[] }) => scope.kind === 'project' ||
    (scope.kind === 'page' ? page.pageId === scope.pageId : page.folderIds.includes(scope.folderId));
  const hasAxure = axureCatalog(stateSnapshot).pages.some(inScope);
  const hasFigma = figmaCatalog(stateSnapshot).pages.some(inScope);
  if (scope.kind !== 'project' && !hasAxure && !hasFigma) {
    throw new Error(tr('指定范围没有可读取的导入源页面，请核对目录或页面 ID', 'No imported source pages in the requested scope. Check the folder or page ID.'));
  }
  return {
    sourceType: 'auto' as const,
    axure: hasAxure
      ? {
          ...inspectAxureProject(stateSnapshot, scope, offset, limit),
          migrationProgress: evaluateAxureMigrationProgress(stateSnapshot, scope, []),
        }
      : { scope, totalPages: 0, offset, nextOffset: null, records: [] },
    figma: hasFigma
      ? inspectFigmaProject(stateSnapshot, scope, offset, limit)
      : { scope, totalPages: 0, offset, nextOffset: null, records: [] },
  };
}

export function inspectImportedSourcePage(
  stateSnapshot: Pick<ProjectStateSnapshot, 'pageSources'>,
  pageId: string,
  sourceType: 'axure' | 'figma' | 'auto' = 'auto',
  selectedPfId?: string,
  offset?: number,
  limit?: number,
) {
  if (!Object.prototype.hasOwnProperty.call(stateSnapshot.pageSources, pageId)) {
    throw new Error(tr(`找不到来源页面 "${pageId}"`, `Source page "${pageId}" not found`));
  }
  const source = stateSnapshot.pageSources[pageId];
  const resolvedKind: 'axure' | 'figma' =
    sourceType !== 'auto'
      ? sourceType
      : pageId.startsWith('fig-page-')
        ? 'figma'
        : pageId.startsWith('rp-page-')
          ? 'axure'
          : (() => {
              throw new Error(
                tr(
                  `无法从页面 ID "${pageId}" 自动识别导入类型（期望 rp-page-* 或 fig-page-*），请显式传入 sourceType="axure" 或 "figma"`,
                  `Cannot infer import type from pageId "${pageId}" (expected rp-page-* or fig-page-*); pass sourceType="axure" or "figma" explicitly`,
                ),
              );
            })();

  if (resolvedKind === 'axure') {
    return {
      sourceType: 'axure' as const,
      ...inspectAxurePage(pageId, source, selectedPfId, offset ?? 0, limit ?? 30),
    };
  }
  return {
    sourceType: 'figma' as const,
    ...inspectFigmaPage(pageId, source, selectedPfId, offset ?? 0, limit ?? 40),
  };
}

export {
  bindAxureTable,
  optimizeAxureBlock,
  reshapeAxurePage,
  reshapeFigmaPage,
  type RpColumnMapping,
};
