import { archiveImageReader } from './archiveImages';
import { printPageSource } from '../dsl/printer';
import type { ActionChain, PropValue, ProtoNode } from '../types';
import {
  figmaFolderId,
  MAX_PUBLISHABLE_ENCODED_IMAGE_BUDGET,
  selectFigmaCandidateFrames,
  planFigmaFrameLayers,
  type FigmaCompiledImport,
  type FigmaDocumentIR,
  type FigmaImportReportItem,
  type FigmaNodeIR,
  type FigmaPageCandidateIR,
} from './ir';

function assignCleanProps(raw: Record<string, unknown>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v as PropValue;
  }
  return out;
}

function indexFrameSubtreeIds(root: FigmaNodeIR, pageId: string, targetMap: Map<string, string>) {
  const visit = (n: FigmaNodeIR) => {
    if (n.id) targetMap.set(n.id, pageId);
    n.children?.forEach(visit);
  };
  visit(root);
}

export function compileFigmaSelectionToProject(
  doc: FigmaDocumentIR,
  selectedPageIds?: ReadonlySet<string>,
  options: { maxEncodedImageBudget?: number } = {},
): FigmaCompiledImport {
  const selectedCandidates: FigmaPageCandidateIR[] = selectFigmaCandidateFrames(doc, selectedPageIds);
  if (selectedCandidates.length === 0) {
    throw new Error('请至少勾选一个要导入的 Figma 画板');
  }
  const maxEncodedImageBudget = Math.max(
    1,
    Math.floor(options.maxEncodedImageBudget ?? MAX_PUBLISHABLE_ENCODED_IMAGE_BUDGET),
  );
  let usedEncodedImageBytes = 0;
  let omittedImages = 0;

  // Map any Figma node ID inside an imported frame to its owning pageId so prototype
  // interactions targeting either the top-level frame or a nested layer resolve cleanly.
  const nodeToPageId = new Map<string, string>();
  const imageRefs = new Set<string>();
  const plans = selectedCandidates.map(cand => ({ cand, ...planFigmaFrameLayers(cand) }));
  for (const { cand, layers } of plans) {
    for (const node of layers) {
      if (node.kind === 'image' && node.imageRef) imageRefs.add(node.imageRef);
    }
    nodeToPageId.set(cand.id, cand.pageId);
    indexFrameSubtreeIds(cand.rootNode, cand.pageId, nodeToPageId);
  }

  const readArchiveImage = doc.archive ? archiveImageReader(doc.archive, imageRefs) : undefined;

  const rootFolderId = 'fig-root';
  const designerFolders: FigmaCompiledImport['designerFolders'] = [
    { id: rootFolderId, title: 'Figma 设计稿', parentFolderId: null },
  ];
  const createdFolders = new Set<string>([rootFolderId]);
  const usedFolderTitlesByParent = new Map<string, Set<string>>();

  const uniqueTitle = (parentKey: string, rawTitle: string, fallback: string) => {
    const base = rawTitle.trim() || fallback;
    let bucket = usedFolderTitlesByParent.get(parentKey);
    if (!bucket) {
      bucket = new Set();
      usedFolderTitlesByParent.set(parentKey, bucket);
    }
    if (!bucket.has(base)) {
      bucket.add(base);
      return base;
    }
    let seq = 2;
    while (bucket.has(`${base} (${seq})`)) seq++;
    const next = `${base} (${seq})`;
    bucket.add(next);
    return next;
  };

  const designerPages: FigmaCompiledImport['designerPages'] = [];
  const pageSources: Record<string, string> = {};
  const report: FigmaImportReportItem[] = [];
  const usedPageIds = new Set<string>();

  for (const { cand, layers, warnings: pageWarnings } of plans) {
    // Ensure canvas folder exists
    const canvasFolder = figmaFolderId(`canvas:${cand.canvasId}`);
    if (!createdFolders.has(canvasFolder)) {
      createdFolders.add(canvasFolder);
      designerFolders.push({
        id: canvasFolder,
        title: uniqueTitle(rootFolderId, cand.canvasName, '画布'),
        parentFolderId: rootFolderId,
      });
    }

    let targetFolderId = canvasFolder;
    if (cand.sectionId && cand.sectionName) {
      const secFolder = figmaFolderId(`section:${cand.canvasId}:${cand.sectionId}`);
      if (!createdFolders.has(secFolder)) {
        createdFolders.add(secFolder);
        designerFolders.push({
          id: secFolder,
          title: uniqueTitle(canvasFolder, cand.sectionName, '分组'),
          parentFolderId: canvasFolder,
        });
      }
      targetFolderId = secFolder;
    }

    let finalPageId = cand.pageId;
    let suffix = 2;
    while (usedPageIds.has(finalPageId)) {
      finalPageId = `${cand.pageId}-${suffix++}`;
    }
    usedPageIds.add(finalPageId);

    const pageTitle = uniqueTitle(`page:${targetFolderId}`, cand.name, '未命名画板');
    let pageOmittedImages = 0;
    let emittedNodes = 0;
    let autoLayouts = 0;
    let resolvedLinks = 0;
    const usedPfIds = new Set<string>();

    const nextPfId = (prefix: string, rawId: string) => {
      const clean = rawId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'n';
      const base = `${prefix}-${clean}`;
      if (!usedPfIds.has(base)) {
        usedPfIds.add(base);
        return base;
      }
      let idx = 2;
      while (usedPfIds.has(`${base}-${idx}`)) idx++;
      const res = `${base}-${idx}`;
      usedPfIds.add(res);
      return res;
    };

    const resolveClickAction = (n: FigmaNodeIR): ActionChain | undefined => {
      if (n.destinationNodeId) {
        const destPage = nodeToPageId.get(n.destinationNodeId);
        if (destPage && destPage !== finalPageId) {
          resolvedLinks++;
          return { $kind: 'actions', calls: [{ name: 'navigate', args: [destPage] }] };
        }
        if (!destPage) {
          pageWarnings.push(`图层「${n.name || n.id}」跳转目标画板未纳入本次导入`);
        }
      }
      return undefined;
    };

    const buildChildNode = (n: FigmaNodeIR): ProtoNode => {
      emittedNodes++;

      const onClick = resolveClickAction(n);
      const baseGeom = {
        x: Math.round(n.x),
        y: Math.round(n.y),
        width: Math.max(1, Math.round(n.width)),
        height: Math.max(1, Math.round(n.height)),
        ...(n.rotation ? { rotation: Number(n.rotation.toFixed(1)) } : {}),
        ...(n.opacity !== undefined && n.opacity < 0.999 ? { opacity: Number(n.opacity.toFixed(3)) } : {}),
        ...(n.sizingH && n.sizingH !== 'fixed' ? { sizingH: n.sizingH } : {}),
        ...(n.sizingV && n.sizingV !== 'fixed' ? { sizingV: n.sizingV } : {}),
        ...(n.positioning === 'absolute' ? { positioning: 'absolute' } : {}),
        ...(n.name ? { label: n.name.slice(0, 80) } : {}),
        ...(n.id ? { sourceNodeId: n.id } : {}),
        ...(n.hidden ? { hidden: true } : {}),
        ...(onClick ? { onClick } : {}),
      };

      const surface = {
        background: n.background,
        borderColor: n.borderColor,
        borderWidth: n.borderWidth ? Number(n.borderWidth.toFixed(2)) : undefined,
        borderStyle: n.borderStyle,
        radius: n.radius !== undefined ? Math.round(n.radius) : undefined,
        cornerRadii: n.cornerRadii,
        shadow: n.shadow,
        backdropBlur: n.backdropBlur ? Math.round(n.backdropBlur) : undefined,
        padding: n.padding,
      };

      if (n.kind === 'text') {
        return {
          kind: 'node',
          type: 'FigmaText',
          pfId: nextPfId('fg-txt', n.id),
          props: assignCleanProps({
            ...baseGeom,
            text: n.text ?? '',
            ...(n.runs && n.runs.length > 1 ? { runs: n.runs } : {}),
            color: n.color,
            fontSize: n.fontSize ? Math.round(n.fontSize) : undefined,
            fontWeight: n.fontWeight,
            fontFamily: n.fontFamily,
            lineHeight: n.lineHeight,
            letterSpacing: n.letterSpacing !== undefined && n.letterSpacing !== 0 ? Number(n.letterSpacing.toFixed(2)) : undefined,
            align: n.textAlign,
            vertical: n.textVertical,
            italic: n.italic ? true : undefined,
            decoration: n.decoration && n.decoration !== 'none' ? n.decoration : undefined,
          }),
          children: [],
        };
      }

      if (n.kind === 'image') {
        let acceptedSrc = n.imageSrc;
        let reason: string | undefined;
        const remaining = maxEncodedImageBudget - usedEncodedImageBytes;
        if (!acceptedSrc && n.imageRef) {
          if (readArchiveImage) {
            const result = readArchiveImage(n.imageRef, remaining);
            if ('src' in result) acceptedSrc = result.src;
            else reason = result.reason;
          } else {
            acceptedSrc = doc.embeddedImagesByRef?.[n.imageRef];
            if (!acceptedSrc && doc.sourceKind === 'fig-file') reason = '未找到位图数据';
          }
        }
        if (acceptedSrc && acceptedSrc.length > remaining) {
          acceptedSrc = undefined;
          reason = '超过内嵌图片额度';
        }
        if (acceptedSrc) usedEncodedImageBytes += acceptedSrc.length;
        else {
          pageOmittedImages++;
          // Online download failures already include a layer-specific warning.
          if (reason) pageWarnings.push(`图片图层「${n.name || n.id}」${reason}，已转为占位显示`);
        }
        return {
          kind: 'node',
          type: 'FigmaImage',
          pfId: nextPfId('fg-img', n.id),
          props: assignCleanProps({
            ...baseGeom,
            ...surface,
            src: acceptedSrc,
            alt: n.name || undefined,
            objectFit: n.objectFit ?? 'cover',
          }),
          children: [],
        };
      }

      if (n.kind === 'vector') {
        return {
          kind: 'node',
          type: 'FigmaVector',
          pfId: nextPfId('fg-vec', n.id),
          props: assignCleanProps({
            ...baseGeom,
            ...surface,
            svgPath: n.svgPath,
            viewBox: n.viewBox,
            fill: n.fill,
            stroke: n.stroke,
            strokeWidth: n.strokeWidth ? Number(n.strokeWidth.toFixed(2)) : undefined,
            ...(n.paths && n.paths.length > 0 ? { paths: n.paths } : {}),
          }),
          children: [],
        };
      }

      // Frame / Auto Layout container
      if (n.layoutMode === 'row' || n.layoutMode === 'column') autoLayouts++;
      const childProtoNodes = (n.children ?? []).filter(child => layers.has(child)).map(buildChildNode);

      return {
        kind: 'node',
        type: 'FigmaFrame',
        pfId: nextPfId('fg-frm', n.id),
        props: assignCleanProps({
          ...baseGeom,
          ...surface,
          layoutMode: n.layoutMode && n.layoutMode !== 'none' ? n.layoutMode : undefined,
          gap: n.gap !== undefined && n.gap !== 0 ? Math.round(n.gap) : undefined,
          counterGap: n.counterGap !== undefined && n.counterGap !== 0 ? Math.round(n.counterGap) : undefined,
          justify: n.justify && n.justify !== 'flex-start' ? n.justify : undefined,
          align: n.align && n.align !== 'flex-start' ? n.align : undefined,
          wrap: n.wrap ? true : undefined,
          clip: n.clip ? true : undefined,
          semanticRole: n.semanticRole,
        }),
        children: childProtoNodes,
      };
    };

    const topRoot = cand.rootNode;
    const isFrameRoot = topRoot.kind === 'frame';
    const canvasChildren: ProtoNode[] = [];
    if (!isFrameRoot) {
      canvasChildren.push(buildChildNode({ ...topRoot, x: 0, y: 0 }));
    } else {
      if (topRoot.layoutMode === 'row' || topRoot.layoutMode === 'column') autoLayouts++;
      for (const ch of topRoot.children ?? []) {
        if (layers.has(ch)) canvasChildren.push(buildChildNode(ch));
      }
    }

    const dedupedWarnings = [...new Set(pageWarnings)];
    const canvasHash = finalPageId.slice('fig-page-'.length);
    const minFrameWidth = isFrameRoot ? 240 : 24;
    const minFrameHeight = isFrameRoot ? 120 : 24;
    const canvasNode: ProtoNode = {
      kind: 'node',
      type: 'FigmaCanvas',
      pfId: `fig-canvas-${canvasHash}`,
      props: assignCleanProps({
        frameWidth: Math.max(minFrameWidth, Math.round(cand.width || topRoot.width)),
        frameHeight: Math.max(minFrameHeight, Math.round(cand.height || topRoot.height)),
        background: isFrameRoot ? (topRoot.background ?? '#FFFFFF') : '#FFFFFF',
        radius: isFrameRoot && topRoot.radius !== undefined ? Math.round(topRoot.radius) : undefined,
        padding: isFrameRoot ? topRoot.padding : undefined,
        layoutMode: isFrameRoot && topRoot.layoutMode && topRoot.layoutMode !== 'none' ? topRoot.layoutMode : undefined,
        gap: isFrameRoot && topRoot.gap !== undefined && topRoot.gap !== 0 ? Math.round(topRoot.gap) : undefined,
        justify: isFrameRoot && topRoot.justify && topRoot.justify !== 'flex-start' ? topRoot.justify : undefined,
        align: isFrameRoot && topRoot.align && topRoot.align !== 'flex-start' ? topRoot.align : undefined,
        wrap: isFrameRoot && topRoot.wrap ? true : undefined,
        clip: isFrameRoot ? topRoot.clip !== false : false,
        sourceNodeId: cand.id,
        ...(dedupedWarnings.length ? { importNotes: dedupedWarnings.join('；') } : {}),
      }),
      children: canvasChildren,
    };

    const rootNode: ProtoNode =
      cand.platform === 'mobile'
        ? {
            kind: 'node',
            type: 'MobilePage',
            pfId: `${finalPageId}-root`,
            props: assignCleanProps({
              title: pageTitle,
              padding: 'none',
            }),
            children: [canvasNode],
          }
        : {
            kind: 'node',
            type: 'Page',
            pfId: `${finalPageId}-root`,
            props: assignCleanProps({
              title: pageTitle,
              padding: 'compact',
              ...(dedupedWarnings.length ? { description: `导入说明：${dedupedWarnings.join('；')}` } : {}),
            }),
            children: [canvasNode],
          };

    const source = printPageSource({ header: [`// @alex-figma-origin ${cand.id}`], root: rootNode });
    designerPages.push({
      pageId: finalPageId,
      title: pageTitle,
      folderId: targetFolderId,
      platform: cand.platform,
    });
    pageSources[finalPageId] = source;
    omittedImages += pageOmittedImages;
    report.push({
      pageId: finalPageId,
      title: pageTitle,
      canvasName: cand.canvasName,
      sectionName: cand.sectionName,
      platform: cand.platform,
      width: Math.round(cand.width),
      height: Math.round(cand.height),
      widgets: emittedNodes,
      omittedImages: pageOmittedImages,
      autoLayouts,
      links: resolvedLinks,
      warnings: dedupedWarnings,
    });
  }

  const hasDesktop = designerPages.some((p) => p.platform === 'desktop');
  const hasMobile = designerPages.some((p) => p.platform === 'mobile');
  const projectMode = hasDesktop && hasMobile ? 'hybrid' : hasMobile ? 'mobile' : 'desktop';

  return {
    documentName: doc.name,
    sourceKind: doc.sourceKind,
    version: doc.version,
    projectMode,
    designerFolders,
    designerPages,
    pageSources,
    report,
    omittedImages,
    encodedImageBytes: usedEncodedImageBytes,
  };
}
