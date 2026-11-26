import { parsePageSource } from '../dsl/parser';
import { readPageHeader } from '../dsl/header';
import { printPageSource } from '../dsl/printer';
import { findNode, walk } from '../dsl/tree';
import { validateMaterialSource } from '../registry/materialContract';
import { pageContractErrors } from '../ai/pageContract';
import { isFigmaMaterial } from './metadata';
import { isActionChain, isNode, type ProtoDoc, type ProtoNode } from '../types';
import type { DBTableSchema } from '../../store/useProtoStore';
import type { SitemapLayout } from '../sitemap';
import type { PagePlatform } from '../mobile/types';
import {
  figmaCatalog,
  figmaCopyId,
  figmaOptimizedPagePattern,
  figmaScopePages,
  figmaSourcePagePattern,
  verifiedFigmaSourceId,
  type FigmaScope,
} from './task';

type FigmaMigrationSnapshot = SitemapLayout & {
  pageSources: Record<string, string>;
  dbTables: DBTableSchema[];
  tableRows?: Record<string, unknown>;
};

export interface FigmaCoverageConvertedItem {
  sourcePfIds: string[];
  targetPfId: string;
  summary: string;
  tableId?: string;
}

export interface FigmaCoveragePendingItem {
  sourcePfIds?: string[];
  reason: string;
}

export interface FigmaReshapeCoverage {
  converted: FigmaCoverageConvertedItem[];
  pending?: FigmaCoveragePendingItem[];
}

function collectNodeTexts(node: ProtoNode, maxItems = 8): string[] {
  const out: string[] = [];
  const visit = (n: ProtoNode) => {
    if (out.length >= maxItems) return;
    if (n.type === 'FigmaText' && typeof n.props.text === 'string' && n.props.text.trim()) {
      out.push(n.props.text.trim().slice(0, 60));
    }
    for (const c of n.children) {
      if (isNode(c)) visit(c);
    }
  };
  visit(node);
  return out;
}

function childSignature(node: ProtoNode): string {
  const kids = node.children.filter(isNode);
  if (!kids.length) return node.type;
  return `${node.type}(${kids.slice(0, 6).map((k) => k.type).join(',')})`;
}

interface RepeatingCluster {
  pfId: string;
  label?: string;
  layoutMode: string;
  itemCount: number;
  sampleTexts: string[][];
}

function summarizeFigmaCanvas(root: ProtoNode) {
  const widgets: Record<string, number> = {};
  const repeatingGroups: RepeatingCluster[] = [];
  const semanticBlocks: { pfId: string; role: string; label?: string; texts: string[] }[] = [];
  const links = new Set<string>();

  const visit = (n: ProtoNode) => {
    widgets[n.type] = (widgets[n.type] ?? 0) + 1;
    const click = n.props.onClick;
    if (isActionChain(click)) {
      for (const call of click.calls) {
        if (call.name === 'navigate' && typeof call.args[0] === 'string') {
          links.add(call.args[0]);
        }
      }
    }
    if (typeof n.props.semanticRole === 'string' && semanticBlocks.length < 16) {
      semanticBlocks.push({
        pfId: n.pfId,
        role: n.props.semanticRole,
        label: typeof n.props.label === 'string' ? n.props.label : undefined,
        texts: collectNodeTexts(n, 4),
      });
    }

    const kids = n.children.filter(isNode);
    if ((n.type === 'FigmaFrame' || n.type === 'FigmaCanvas') && kids.length >= 2 && repeatingGroups.length < 8) {
      const sigCounts = new Map<string, ProtoNode[]>();
      for (const k of kids) {
        if (k.type !== 'FigmaFrame') continue;
        const sig = childSignature(k);
        const bucket = sigCounts.get(sig) ?? [];
        bucket.push(k);
        sigCounts.set(sig, bucket);
      }
      for (const [, members] of sigCounts) {
        if (members.length >= 2 && members.some((m) => collectNodeTexts(m, 2).length > 0)) {
          repeatingGroups.push({
            pfId: n.pfId,
            label: typeof n.props.label === 'string' ? n.props.label : undefined,
            layoutMode: String(n.props.layoutMode ?? 'none'),
            itemCount: members.length,
            sampleTexts: members.slice(0, 3).map((m) => collectNodeTexts(m, 6)),
          });
          break;
        }
      }
    }

    kids.forEach(visit);
  };

  visit(root);
  return {
    widgets,
    repeatingGroups,
    semanticBlocks,
    linkedPageCount: links.size,
    linkedPageIds: [...links].slice(0, 24),
  };
}

export function parseFigmaSourceDoc(pageId: string, source: string | undefined): ProtoDoc {
  if (!figmaSourcePagePattern.test(pageId) || typeof source !== 'string') {
    throw new Error(`页面 ${pageId} 不是有效的 Figma 导入源页面`);
  }
  const parsed = parsePageSource(source);
  if (!parsed.doc || !parsed.doc.root.children.some((c) => isNode(c) && c.type === 'FigmaCanvas')) {
    throw new Error(`页面 ${pageId} 不包含顶层 FigmaCanvas 画板结构`);
  }
  return parsed.doc;
}

export function inspectFigmaProject(
  snapshot: FigmaMigrationSnapshot,
  scope: FigmaScope,
  offset = 0,
  limit = 4,
) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 8) {
    throw new Error('分页参数需要非负整数 offset 与 1..8 的 limit');
  }
  const pages = figmaScopePages(figmaCatalog(snapshot), scope);
  const slice = pages.slice(offset, offset + limit);

  const records = slice.map((page) => {
    const doc = parseFigmaSourceDoc(page.pageId, snapshot.pageSources[page.pageId]);
    const canvas = doc.root.children.find((c) => isNode(c) && c.type === 'FigmaCanvas') as ProtoNode | undefined;
    const copyId = figmaCopyId(page.pageId);
    const hasCopy = Object.hasOwn(snapshot.pageSources, copyId) &&
      verifiedFigmaSourceId(copyId, readPageHeader(snapshot.pageSources[copyId])) === page.pageId;
    let bindings: { pfId: string; material: string; tableId: string }[] | undefined;
    if (hasCopy) {
      const copyDoc = parsePageSource(snapshot.pageSources[copyId]).doc;
      if (copyDoc) {
        const list: { pfId: string; material: string; tableId: string }[] = [];
        walk(copyDoc.root, (node) => {
          if (typeof node.props.table === 'string' && list.length < 16) {
            list.push({ pfId: node.pfId, material: node.type, tableId: node.props.table });
          }
        });
        bindings = list;
      }
    }

    return {
      pageId: page.pageId,
      title: page.title,
      path: page.path,
      platform: page.platform,
      frameWidth: canvas?.props.frameWidth,
      frameHeight: canvas?.props.frameHeight,
      importNotes: canvas?.props.importNotes,
      ...(hasCopy ? { optimizedPageId: copyId, bindings } : {}),
      ...summarizeFigmaCanvas(doc.root),
    };
  });

  return {
    scope,
    totalPages: pages.length,
    offset,
    nextOffset: offset + records.length < pages.length ? offset + records.length : null,
    records,
  };
}

export function inspectFigmaPage(
  pageId: string,
  source: string,
  selectedPfId?: string,
  offset = 0,
  limit = 40,
) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 80) {
    throw new Error('Figma 图层分页需要非负整数 offset 与 1..80 的 limit');
  }
  const doc = parseFigmaSourceDoc(pageId, source);
  const scopeRoot = selectedPfId ? findNode(doc.root, selectedPfId) : doc.root;
  if (!scopeRoot) {
    throw new Error(`未在页面 ${pageId} 中找到图层 pfId "${selectedPfId}"`);
  }

  const flatNodes: Record<string, unknown>[] = [];
  const visit = (n: ProtoNode, parentPfId: string | null) => {
    const entry: Record<string, unknown> = {
      pfId: n.pfId,
      type: n.type,
      ...(parentPfId ? { parentPfId } : {}),
      ...(typeof n.props.label === 'string' ? { label: n.props.label } : {}),
      ...(typeof n.props.layoutMode === 'string' ? { layoutMode: n.props.layoutMode } : {}),
      ...(typeof n.props.semanticRole === 'string' ? { semanticRole: n.props.semanticRole } : {}),
      ...(typeof n.props.text === 'string' ? { text: n.props.text.slice(0, 120) } : {}),
      ...(typeof n.props.width === 'number' ? { width: n.props.width, height: n.props.height } : {}),
    };
    if (isActionChain(n.props.onClick)) {
      entry.onClick = n.props.onClick.calls;
    }
    flatNodes.push(entry);
    n.children.filter(isNode).forEach((ch) => visit(ch, n.pfId));
  };
  visit(scopeRoot, null);

  const windowItems = flatNodes.slice(offset, offset + limit);
  return {
    pageId,
    rootType: doc.root.type,
    platform: doc.root.type === 'MobilePage' ? 'mobile' : 'desktop',
    totalNodes: flatNodes.length,
    offset,
    nextOffset: offset + windowItems.length < flatNodes.length ? offset + windowItems.length : null,
    ...summarizeFigmaCanvas(scopeRoot),
    nodes: windowItems,
  };
}

export function retargetFigmaOptimizedPageSource(
  source: string,
  pageSources: Record<string, string>,
  selfCopyId?: string,
): string | undefined {
  const parsed = parsePageSource(source, { strict: true });
  if (!parsed.doc || parsed.issues.length || parsed.normalized) return undefined;
  const targets = new Map<string, string>();
  if (selfCopyId) {
    const sourceId = verifiedFigmaSourceId(selfCopyId, parsed.doc.header);
    if (!sourceId) return undefined;
    targets.set(sourceId, selfCopyId);
  }
  for (const [copyId, copySource] of Object.entries(pageSources)) {
    if (!figmaOptimizedPagePattern.test(copyId)) continue;
    const sourceId = verifiedFigmaSourceId(copyId, readPageHeader(copySource));
    if (sourceId) targets.set(sourceId, copyId);
  }
  return redirectFigmaNavigations(parsed.doc, targets) ? printPageSource(parsed.doc) : undefined;
}

export function redirectFigmaNavigations(doc: ProtoDoc, targets: ReadonlyMap<string, string>) {
  let changed = false;
  walk(doc.root, (node) => {
    const rewriteChain = (val: unknown) => {
      if (!isActionChain(val)) return;
      for (const call of val.calls) {
        if (call.name === 'navigate' && typeof call.args[0] === 'string') {
          const candidateCopy = targets.get(call.args[0]);
          if (candidateCopy) {
            call.args[0] = candidateCopy;
            changed = true;
          }
        }
      }
    };
    for (const v of Object.values(node.props)) {
      rewriteChain(v);
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object' && 'onClick' in item) {
            rewriteChain((item as Record<string, unknown>).onClick);
          }
          if (item && typeof item === 'object' && 'page' in item && typeof (item as Record<string, unknown>).page === 'string') {
            const pId = (item as Record<string, unknown>).page as string;
            const candidateCopy = targets.get(pId);
            if (candidateCopy) {
              (item as Record<string, unknown>).page = candidateCopy;
              changed = true;
            }
          }
        }
      }
    }
  });
  return changed;
}

export function reshapeFigmaPage(
  snapshot: FigmaMigrationSnapshot,
  pageId: string,
  source: string,
  rawCoverage: unknown,
): {
  pageId: string;
  title: string;
  folderId: string;
  platform: PagePlatform;
  source: string;
  figmaCoverage: FigmaReshapeCoverage;
} {
  if (!Object.hasOwn(snapshot.pageSources, pageId)) {
    throw new Error(`Figma 来源页面 ${pageId} 不存在`);
  }
  const srcDoc = parseFigmaSourceDoc(pageId, snapshot.pageSources[pageId]);
  const srcMeta = snapshot.designerPages.find((p) => p.pageId === pageId);
  if (!srcMeta) {
    throw new Error(`未在页面目录中找到 Figma 来源页面 ${pageId}`);
  }
  const expectedPlatform: PagePlatform =
    srcMeta.platform ?? (srcDoc.root.type === 'MobilePage' ? 'mobile' : 'desktop');
  const expectedRoot = expectedPlatform === 'mobile' ? 'MobilePage' : 'Page';

  const parsedTarget = parsePageSource(source, { strict: true });
  if (!parsedTarget.doc || parsedTarget.issues.length || parsedTarget.normalized) {
    throw new Error(
      `重塑页面源码解析失败或缺少显式唯一 pfId：${parsedTarget.issues.map((i) => i.message).join('；') || '请检查每个组件的 pfId'}`,
    );
  }
  if (parsedTarget.doc.root.type !== expectedRoot) {
    throw new Error(`Figma 来源页为 ${expectedPlatform} 端，重塑副本根组件必须使用 <${expectedRoot}>`);
  }

  let hasRawFigmaMaterial = false;
  const targetNodes = new Map<string, ProtoNode>();
  walk(parsedTarget.doc.root, (n) => {
    targetNodes.set(n.pfId, n);
    if (isFigmaMaterial(n.type)) hasRawFigmaMaterial = true;
  });
  if (hasRawFigmaMaterial) {
    throw new Error(
      'protoflow_reshape_figma_page 用于将 Figma 画板重塑为标准流式业务页面，结果中不能继续使用 FigmaCanvas/FigmaFrame/FigmaText 等还原层物料',
    );
  }

  const matErrors = validateMaterialSource(source);
  if (matErrors.length) {
    throw new Error(`重塑页面未通过物料契约校验：${matErrors.join('；')}`);
  }
  const contractErrs = pageContractErrors(source, snapshot.dbTables, { tableRows: snapshot.tableRows ?? {} });
  if (contractErrs.length) {
    throw new Error(`重塑页面未通过数据绑定契约校验：${contractErrs.join('；')}`);
  }

  if (!rawCoverage || typeof rawCoverage !== 'object' || Array.isArray(rawCoverage)) {
    throw new Error('缺少 coverage 转换核对清单');
  }
  const cov = rawCoverage as FigmaReshapeCoverage;
  if (!Array.isArray(cov.converted) || cov.converted.length === 0) {
    throw new Error('coverage.converted 至少需要登记一项从源 Figma 图层转换而来的标准业务组件');
  }

  const srcPfIds = new Set<string>();
  walk(srcDoc.root, (n) => srcPfIds.add(n.pfId));

  for (const [idx, item] of cov.converted.entries()) {
    if (!item || !Array.isArray(item.sourcePfIds) || item.sourcePfIds.length === 0) {
      throw new Error(`coverage.converted[${idx}].sourcePfIds 不能为空`);
    }
    for (const spf of item.sourcePfIds) {
      if (!srcPfIds.has(spf)) {
        throw new Error(`coverage.converted[${idx}] 引用了不存在的源 Figma 图层 pfId "${spf}"`);
      }
    }
    const targetNode = targetNodes.get(item.targetPfId);
    if (!targetNode) {
      throw new Error(`coverage.converted[${idx}] 的 targetPfId "${item.targetPfId}" 在重塑源码中不存在`);
    }
    if (item.tableId !== undefined) {
      if (!snapshot.dbTables.some((t) => t.id === item.tableId)) {
        throw new Error(`coverage.converted[${idx}] 声明的 tableId "${item.tableId}" 不在当前工程表目录中`);
      }
      if (targetNode.props.table !== item.tableId) {
        throw new Error(
          `coverage.converted[${idx}] 指向的组件 ${targetNode.pfId} (<${targetNode.type}>) 未绑定声明的 table="${item.tableId}"`,
        );
      }
    }
  }

  if (cov.pending !== undefined) {
    if (!Array.isArray(cov.pending)) throw new Error('coverage.pending 必须是数组');
    for (const [idx, pItem] of cov.pending.entries()) {
      if (!pItem || typeof pItem.reason !== 'string' || !pItem.reason.trim()) {
        throw new Error(`coverage.pending[${idx}] 必须提供非空 reason 说明`);
      }
      if (Array.isArray(pItem.sourcePfIds)) {
        for (const spf of pItem.sourcePfIds) {
          if (!srcPfIds.has(spf)) {
            throw new Error(`coverage.pending[${idx}] 引用了不存在的源 Figma 图层 pfId "${spf}"`);
          }
        }
      }
    }
  }

  const copyId = figmaCopyId(pageId);
  const existingCopy = snapshot.designerPages.find((p) => p.pageId === copyId);
  const hasCopySource = Object.hasOwn(snapshot.pageSources, copyId);
  if ((existingCopy || hasCopySource) && (!existingCopy || !hasCopySource ||
      verifiedFigmaSourceId(copyId, readPageHeader(snapshot.pageSources[copyId])) !== pageId)) {
    throw new Error(`优化版页面标识已占用或来源不一致：${copyId}`);
  }
  const cleanHeader = parsedTarget.doc.header.filter((line) => !line.startsWith('// @alex-figma-source '));
  const stampedDoc: ProtoDoc = {
    header: [`// @alex-figma-source ${pageId}`, ...cleanHeader],
    root: parsedTarget.doc.root,
  };
  let finalSource = printPageSource(stampedDoc);
  const retargeted = retargetFigmaOptimizedPageSource(finalSource, snapshot.pageSources, copyId);
  if (retargeted) finalSource = retargeted;

  return {
    pageId: copyId,
    title: existingCopy?.title ?? `${srcMeta.title}（标准版）`,
    folderId: existingCopy?.folderId ?? srcMeta.folderId,
    platform: expectedPlatform,
    source: finalSource,
    figmaCoverage: cov,
  };
}

export const isFigmaOptimizedCopyId = (id: string): boolean => figmaOptimizedPagePattern.test(id);
