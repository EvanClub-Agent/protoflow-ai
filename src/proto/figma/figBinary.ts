import { inflateSync, unzipSync, unzlibSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';
import { decodeBinarySchema, decodeKiwiMessage } from './kiwi';
import {
  detectFigmaPlatform,
  figmaFolderId,
  figmaPageId,
  formatPaddingCss,
  inferSemanticRole,
  isLikelyDesignSystemName,
  type FigmaImageArchive,
  rgbaToCss,
  type FigmaCanvasIR,
  type FigmaDocumentIR,
  type FigmaNodeIR,
  type FigmaPageCandidateIR,
  type FigmaTextRunIR,
  type FigmaVectorPathIR,
} from './ir';

export const MAX_FIG_BYTES = 160 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8');
const hexLut = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += hexLut[bytes[i]];
  return out;
}

function decompressFigChunk(chunk: Uint8Array): Uint8Array {
  if (chunk.length >= 4 && chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd) {
    return zstdDecompress(chunk);
  }
  // Check zlib header (CMF byte 0x78)
  if (chunk.length >= 2 && chunk[0] === 0x78 && (chunk[1] === 0x01 || chunk[1] === 0x5e || chunk[1] === 0x9c || chunk[1] === 0xda)) {
    try {
      return unzlibSync(chunk);
    } catch {
      // fall through to raw deflate
    }
  }
  return inflateSync(chunk);
}

interface UnpackedFigContainer {
  canvasBytes: Uint8Array;
  fileName?: string;
  archive?: FigmaImageArchive;
}

function unpackFigContainer(bytes: Uint8Array): UnpackedFigContainer {
  if (bytes.length > MAX_FIG_BYTES) {
    throw new Error('Figma (.fig) 文件超过 160 MiB 本地解析上限');
  }
  if (bytes.length < 16) {
    throw new Error('无效的 .fig 文件：内容过短');
  }

  // Case 1: ZIP container (PK\x03\x04)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const images: FigmaImageArchive['entries'] = {};
    const entries = unzipSync(bytes, { filter: ({ name, originalSize }) => {
      const match = /(?:^|\/)images\/([0-9a-f]{20,64})(?:\.[a-z0-9]+)?$/i.exec(name);
      if (match) images[match[1].toLowerCase()] = { name, size: originalSize };
      return /(?:^|\/)(canvas\.fig|meta\.json)$/.test(name);
    } });
    const canvasEntryKey = Object.keys(entries).find((k) => k === 'canvas.fig' || k.endsWith('/canvas.fig'));
    if (!canvasEntryKey) {
      throw new Error('压缩包中未找到 canvas.fig，请确认导入的是 Figma 设计稿文件 (.fig)');
    }
    let metaName: string | undefined;
    const metaKey = Object.keys(entries).find((k) => k === 'meta.json' || k.endsWith('/meta.json'));
    if (metaKey) {
      try {
        const meta = JSON.parse(utf8.decode(entries[metaKey]));
        if (typeof meta?.file_name === 'string' && meta.file_name.trim()) {
          metaName = meta.file_name.trim();
        }
      } catch {
        // ignore optional meta.json parse issues
      }
    }
    return {
      canvasBytes: entries[canvasEntryKey],
      fileName: metaName,
      archive: { bytes, entries: images },
    };
  }

  // Case 2: Direct fig-kiwi binary stream
  return {
    canvasBytes: bytes,
  };
}

function parseFigKiwiCanvas(canvasBytes: Uint8Array): { version: number; message: Record<string, any> } {
  const magic = utf8.decode(canvasBytes.subarray(0, 8));
  if (!magic.startsWith('fig-kiwi') && !magic.startsWith('fig-jam.') && !magic.startsWith('fig-make')) {
    throw new Error('无法识别的 .fig 二进制签名，请选择从 Figma 导出的 .fig 文件');
  }
  const view = new DataView(canvasBytes.buffer, canvasBytes.byteOffset, canvasBytes.byteLength);
  const version = view.getUint32(8, true);
  let pos = 12;
  const chunks: Uint8Array[] = [];
  while (pos + 4 <= canvasBytes.length && chunks.length < 4) {
    const chunkLen = view.getUint32(pos, true);
    pos += 4;
    if (pos + chunkLen > canvasBytes.length) {
      throw new Error('Figma 数据块长度损坏或文件未下载完整');
    }
    chunks.push(canvasBytes.subarray(pos, pos + chunkLen));
    pos += chunkLen;
  }
  if (chunks.length < 2) {
    throw new Error('Figma 文件缺少必要的 Schema 或节点数据块');
  }

  const schemaBytes = decompressFigChunk(chunks[0]);
  const dataBytes = decompressFigChunk(chunks[1]);
  const schema = decodeBinarySchema(schemaBytes);
  const message = decodeKiwiMessage(schema, dataBytes, 'Message');
  return { version, message };
}

/** Decode Figma's binary vector commandsBlob into an SVG path string. */
function decodeCommandsBlob(blobBytes: Uint8Array | undefined): string | undefined {
  if (!blobBytes || blobBytes.length === 0) return undefined;
  const view = new DataView(blobBytes.buffer, blobBytes.byteOffset, blobBytes.byteLength);
  let pos = 0;
  const parts: string[] = [];
  const f = () => {
    if (pos + 4 > blobBytes.length) return 0;
    const v = view.getFloat32(pos, true);
    pos += 4;
    return Number(v.toFixed(2));
  };
  while (pos < blobBytes.length) {
    const cmd = blobBytes[pos++];
    if (cmd === 0) {
      parts.push('Z');
    } else if (cmd === 1) {
      if (pos + 8 > blobBytes.length) break;
      parts.push(`M${f()} ${f()}`);
    } else if (cmd === 2) {
      if (pos + 8 > blobBytes.length) break;
      parts.push(`L${f()} ${f()}`);
    } else if (cmd === 3) {
      if (pos + 16 > blobBytes.length) break;
      parts.push(`Q${f()} ${f()} ${f()} ${f()}`);
    } else if (cmd === 4) {
      if (pos + 24 > blobBytes.length) break;
      parts.push(`C${f()} ${f()} ${f()} ${f()} ${f()} ${f()}`);
    } else {
      // Unknown command opcode — abort path safely
      return parts.length > 0 ? parts.join(' ') : undefined;
    }
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

const guidStr = (guid: any): string =>
  guid && typeof guid.sessionID === 'number' && typeof guid.localID === 'number'
    ? `${guid.sessionID}:${guid.localID}`
    : '';

function linearGradientFromPaint(paint: any): string | undefined {
  const stops: any[] | undefined = paint?.stops;
  if (!Array.isArray(stops) || stops.length < 2) return undefined;
  const opacity = typeof paint.opacity === 'number' ? paint.opacity : 1;
  const cssStops = stops
    .map((s) => {
      const col = rgbaToCss(s.color, opacity);
      if (!col) return null;
      const pct = Math.round(Math.max(0, Math.min(1, Number(s.position ?? 0))) * 100);
      return `${col} ${pct}%`;
    })
    .filter(Boolean);
  if (cssStops.length < 2) return undefined;
  if (paint.type === 'GRADIENT_RADIAL') {
    return `radial-gradient(circle, ${cssStops.join(', ')})`;
  }
  return `linear-gradient(135deg, ${cssStops.join(', ')})`;
}

export function importFigmaBinary(bytes: Uint8Array, sourceFileName = 'Figma.fig'): FigmaDocumentIR {
  const container = unpackFigContainer(bytes);
  const { version, message } = parseFigKiwiCanvas(container.canvasBytes);
  const rawChanges: any[] = Array.isArray(message.nodeChanges) ? message.nodeChanges : [];
  if (rawChanges.length === 0) {
    throw new Error('Figma 文件中没有可读取的图层节点');
  }

  const blobs: Uint8Array[] = Array.isArray(message.blobs)
    ? message.blobs.map((b: any) => (b?.bytes instanceof Uint8Array ? b.bytes : new Uint8Array()))
    : [];

  // Index nodes & group children by parentIndex.guid
  const byGuid = new Map<string, any>();
  const childrenByParent = new Map<string, { pos: string; node: any }[]>();

  for (const nc of rawChanges) {
    if (nc.phase === 'REMOVED') continue;
    const id = guidStr(nc.guid);
    if (!id) continue;
    byGuid.set(id, nc);
    const parentId = guidStr(nc.parentIndex?.guid);
    if (parentId) {
      let list = childrenByParent.get(parentId);
      if (!list) {
        list = [];
        childrenByParent.set(parentId, list);
      }
      list.push({ pos: String(nc.parentIndex?.position ?? ''), node: nc });
    }
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0));
  }

  const getOrderedChildren = (id: string): any[] => (childrenByParent.get(id) ?? []).map((item) => item.node);

  const docNode = rawChanges.find((n) => n.type === 'DOCUMENT') ?? byGuid.get('0:0');
  if (!docNode) {
    throw new Error('Figma 文件缺少 DOCUMENT 根节点');
  }
  const docId = guidStr(docNode.guid);
  const docName =
    container.fileName ||
    (typeof docNode.name === 'string' && docNode.name.trim() && docNode.name !== 'Document'
      ? docNode.name.trim()
      : sourceFileName.replace(/\.fig$/i, ''));

  const extractClickTarget = (nc: any): string | undefined => {
    if (Array.isArray(nc.prototypeInteractions)) {
      for (const inter of nc.prototypeInteractions) {
        const trig = inter?.event?.interactionType ?? inter?.trigger?.type;
        if (trig && trig !== 'ON_CLICK' && trig !== 'DRAG') continue;
        const actions: any[] = Array.isArray(inter?.actions) ? inter.actions : [];
        for (const act of actions) {
          const dest = guidStr(act?.transitionNodeID ?? act?.destinationId);
          if (dest && dest !== '0:0') return dest;
        }
      }
    }
    const legacy = guidStr(nc.transitionNodeID);
    return legacy && legacy !== '0:0' ? legacy : undefined;
  };

  const extractPaints = (paintsInput: any): { bg?: string; imageRef?: string; scaleMode?: string } => {
    if (!Array.isArray(paintsInput)) return {};
    const visible = paintsInput.filter((p) => p && p.visible !== false && (p.opacity === undefined || p.opacity > 0.001));
    if (!visible.length) return {};
    const top = visible[visible.length - 1];
    const op = typeof top.opacity === 'number' ? top.opacity : 1;
    if (top.type === 'IMAGE') {
      const hash = top.image?.hash ?? top.imageThumbnail?.hash;
      return {
        imageRef: hash instanceof Uint8Array ? bytesToHex(hash) : typeof hash === 'string' ? hash.toLowerCase() : undefined,
        scaleMode: top.imageScaleMode,
      };
    }
    if (top.type === 'GRADIENT_LINEAR' || top.type === 'GRADIENT_RADIAL') {
      return { bg: linearGradientFromPaint(top) };
    }
    if (top.type === 'SOLID') {
      return { bg: rgbaToCss(top.color, op) };
    }
    return {};
  };

  const extractStroke = (nc: any): { borderColor?: string; borderWidth?: number; borderStyle?: 'solid' | 'dashed' } => {
    const strokes: any[] = Array.isArray(nc.strokePaints) ? nc.strokePaints.filter((s: any) => s && s.visible !== false) : [];
    const weight = typeof nc.strokeWeight === 'number' ? nc.strokeWeight : 0;
    if (!strokes.length || weight <= 0) return {};
    const top = strokes[strokes.length - 1];
    const color = rgbaToCss(top.color, typeof top.opacity === 'number' ? top.opacity : 1);
    if (!color) return {};
    const dashed = Array.isArray(nc.dashPattern) && nc.dashPattern.length > 0;
    return { borderColor: color, borderWidth: weight, borderStyle: dashed ? 'dashed' : 'solid' };
  };

  const extractEffects = (nc: any): { shadow?: string; backdropBlur?: number } => {
    const effects: any[] = Array.isArray(nc.effects) ? nc.effects.filter((e: any) => e && e.visible !== false) : [];
    if (!effects.length) return {};
    const shadows: string[] = [];
    let backdropBlur: number | undefined;
    for (const ef of effects) {
      if (ef.type === 'DROP_SHADOW' || ef.type === 'INNER_SHADOW') {
        const col = rgbaToCss(ef.color, 1);
        if (!col) continue;
        const ox = Math.round(Number(ef.offset?.x ?? 0));
        const oy = Math.round(Number(ef.offset?.y ?? 2));
        const r = Math.max(0, Math.round(Number(ef.radius ?? 4)));
        const sp = Math.round(Number(ef.spread ?? 0));
        shadows.push(`${ef.type === 'INNER_SHADOW' ? 'inset ' : ''}${ox}px ${oy}px ${r}px ${sp}px ${col}`);
      } else if (ef.type === 'BACKGROUND_BLUR') {
        backdropBlur = Math.max(1, Math.round(Number(ef.radius ?? 8) / 2));
      }
    }
    return {
      shadow: shadows.length ? shadows.join(', ') : undefined,
      backdropBlur,
    };
  };

  const extractRadius = (nc: any): { radius?: number; cornerRadii?: string } => {
    const tl = nc.rectangleTopLeftCornerRadius;
    const tr = nc.rectangleTopRightCornerRadius;
    const br = nc.rectangleBottomRightCornerRadius;
    const bl = nc.rectangleBottomLeftCornerRadius;
    if (
      nc.rectangleCornerRadiiIndependent &&
      (typeof tl === 'number' || typeof tr === 'number' || typeof br === 'number' || typeof bl === 'number')
    ) {
      const a = Math.round(tl ?? 0);
      const b = Math.round(tr ?? 0);
      const c = Math.round(br ?? 0);
      const d = Math.round(bl ?? 0);
      if (a === b && b === c && c === d) return a > 0 ? { radius: a } : {};
      return { cornerRadii: `${a}px ${b}px ${c}px ${d}px` };
    }
    if (typeof nc.cornerRadius === 'number' && nc.cornerRadius > 0) {
      return { radius: Math.round(nc.cornerRadius) };
    }
    if (nc.type === 'ELLIPSE') {
      return { radius: 9999 };
    }
    return {};
  };

  const mapPrimaryAlign = (raw: unknown): FigmaNodeIR['justify'] => {
    switch (raw) {
      case 'CENTER':
        return 'center';
      case 'MAX':
        return 'flex-end';
      case 'SPACE_BETWEEN':
      case 'SPACE_EVENLY':
        return 'space-between';
      default:
        return 'flex-start';
    }
  };

  const mapCounterAlign = (raw: unknown): FigmaNodeIR['align'] => {
    switch (raw) {
      case 'CENTER':
        return 'center';
      case 'MAX':
        return 'flex-end';
      case 'STRETCH':
        return 'stretch';
      case 'BASELINE':
        return 'baseline';
      default:
        return 'flex-start';
    }
  };

  const convertNode = (
    nc: any,
    parentStackMode: 'none' | 'row' | 'column',
    overridesByGuid: Map<string, any>,
    visitedSymbols: Set<string>,
    stats: { nodes: number; autoLayouts: number; links: number },
  ): FigmaNodeIR | null => {
    const rawId = guidStr(nc.guid);
    const ov = rawId ? overridesByGuid.get(rawId) : undefined;
    const merged = ov ? { ...nc, ...ov } : nc;
    if (merged.visible === false) return null;

    const type: string = String(merged.type ?? 'FRAME');
    if (type === 'SLICE' || type === 'STICKY' || type === 'CONNECTOR') return null;

    stats.nodes++;
    const x = Number(merged.transform?.m02 ?? 0);
    const y = Number(merged.transform?.m12 ?? 0);
    const width = Math.max(1, Number(merged.size?.x ?? 100));
    const height = Math.max(1, Number(merged.size?.y ?? 32));
    const opacity = typeof merged.opacity === 'number' ? merged.opacity : 1;
    const destId = extractClickTarget(merged);
    if (destId) stats.links++;

    // Determine child sizing under parent's Auto Layout
    let sizingH: FigmaNodeIR['sizingH'] = 'fixed';
    let sizingV: FigmaNodeIR['sizingV'] = 'fixed';
    const positioning: FigmaNodeIR['positioning'] =
      merged.stackPositioning === 'ABSOLUTE' ? 'absolute' : 'auto';

    if (parentStackMode !== 'none' && positioning !== 'absolute') {
      const grow = Number(merged.stackChildPrimaryGrow ?? 0) > 0;
      const stretch = merged.stackChildAlignSelf === 'STRETCH';
      if (parentStackMode === 'row') {
        if (grow) sizingH = 'fill';
        if (stretch) sizingV = 'fill';
      } else {
        if (grow) sizingV = 'fill';
        if (stretch) sizingH = 'fill';
      }
    }
    if (merged.stackPrimarySizing === 'RESIZE_TO_FIT' || merged.stackPrimarySizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE') {
      if (merged.stackMode === 'HORIZONTAL') sizingH = sizingH === 'fill' ? 'fill' : 'hug';
      if (merged.stackMode === 'VERTICAL') sizingV = sizingV === 'fill' ? 'fill' : 'hug';
    }
    if (merged.stackCounterSizing === 'RESIZE_TO_FIT' || merged.stackCounterSizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE') {
      if (merged.stackMode === 'HORIZONTAL') sizingV = sizingV === 'fill' ? 'fill' : 'hug';
      if (merged.stackMode === 'VERTICAL') sizingH = sizingH === 'fill' ? 'fill' : 'hug';
    }

    const paintInfo = extractPaints(merged.fillPaints);
    const strokeInfo = extractStroke(merged);
    const effectInfo = extractEffects(merged);
    const radiusInfo = extractRadius(merged);

    // 1. TEXT node
    if (type === 'TEXT') {
      const chars = String(merged.textData?.characters ?? merged.characters ?? '');
      const color = paintInfo.bg ?? '#0F172A';
      const fontSize = Number(merged.fontSize ?? 14);
      const styleName = String(merged.fontName?.style ?? '');
      const fontWeight =
        typeof merged.fontWeight === 'number'
          ? merged.fontWeight
          : /bold|black|heavy/i.test(styleName)
          ? 700
          : /semi|demi|medium/i.test(styleName)
          ? 600
          : 400;
      const italic = /italic|oblique/i.test(styleName) || Boolean(merged.italic);
      const alignMap: Record<string, FigmaNodeIR['textAlign']> = {
        LEFT: 'left',
        CENTER: 'center',
        RIGHT: 'right',
        JUSTIFIED: 'justify',
      };
      const vertMap: Record<string, FigmaNodeIR['textVertical']> = {
        TOP: 'top',
        CENTER: 'middle',
        BOTTOM: 'bottom',
      };
      let lineHeight: string | undefined;
      if (merged.lineHeight?.units === 'PIXELS' && typeof merged.lineHeight.value === 'number') {
        lineHeight = `${Math.round(merged.lineHeight.value)}px`;
      } else if (merged.lineHeight?.units === 'PERCENT' && typeof merged.lineHeight.value === 'number') {
        lineHeight = `${(merged.lineHeight.value / 100).toFixed(2)}`;
      }
      if (merged.textAutoResize === 'WIDTH_AND_HEIGHT') {
        if (sizingH === 'fixed') sizingH = 'hug';
        if (sizingV === 'fixed') sizingV = 'hug';
      } else if (merged.textAutoResize === 'HEIGHT') {
        if (sizingV === 'fixed') sizingV = 'hug';
      }

      // Rich text style runs
      let runs: FigmaTextRunIR[] | undefined;
      const charIds: number[] | undefined = merged.textData?.characterStyleIDs;
      const table: any[] | undefined = merged.textData?.styleOverrideTable;
      if (Array.isArray(charIds) && Array.isArray(table) && charIds.length > 0 && table.length > 0) {
        const byStyleId = new Map<number, any>();
        for (const item of table) {
          if (typeof item?.styleID === 'number') byStyleId.set(item.styleID, item);
        }
        const segments: FigmaTextRunIR[] = [];
        let curId = charIds[0] ?? 0;
        let start = 0;
        const pushSeg = (end: number, sid: number) => {
          const textSlice = chars.slice(start, end);
          if (!textSlice) return;
          const st = byStyleId.get(sid);
          const stPaint = st ? extractPaints(st.fillPaints) : {};
          const stStyle = String(st?.fontName?.style ?? '');
          segments.push({
            text: textSlice,
            color: stPaint.bg ?? color,
            fontSize: typeof st?.fontSize === 'number' ? Math.round(st.fontSize) : Math.round(fontSize),
            fontWeight: /bold/i.test(stStyle) ? 700 : /medium|semi/i.test(stStyle) ? 600 : fontWeight,
            fontFamily: st?.fontName?.family ?? merged.fontName?.family,
            italic: /italic/i.test(stStyle) || italic || undefined,
            underline: st?.textDecoration === 'UNDERLINE' || undefined,
            lineThrough: st?.textDecoration === 'STRIKETHROUGH' || undefined,
          });
        };
        for (let i = 1; i < chars.length; i++) {
          const sid = charIds[i] ?? 0;
          if (sid !== curId) {
            pushSeg(i, curId);
            curId = sid;
            start = i;
          }
        }
        pushSeg(chars.length, curId);
        if (segments.length > 1) runs = segments;
      }

      return {
        id: rawId,
        name: String(merged.name ?? 'Text'),
        kind: 'text',
        x,
        y,
        width,
        height,
        opacity,
        sizingH,
        sizingV,
        positioning,
        text: chars,
        runs,
        color,
        fontSize,
        fontWeight,
        fontFamily: merged.fontName?.family,
        lineHeight,
        textAlign: alignMap[String(merged.textAlignHorizontal ?? 'LEFT')] ?? 'left',
        textVertical: vertMap[String(merged.textAlignVertical ?? 'TOP')] ?? 'top',
        italic,
        decoration:
          merged.textDecoration === 'UNDERLINE'
            ? 'underline'
            : merged.textDecoration === 'STRIKETHROUGH'
            ? 'line-through'
            : undefined,
        destinationNodeId: destId,
      };
    }

    // 2. Leaf Image fill without children
    let rawKids = getOrderedChildren(rawId);
    // Resolve INSTANCE -> SYMBOL children if instance has no materialized children in nodeChanges
    const nextOverrides = new Map(overridesByGuid);
    if (Array.isArray(merged.symbolData?.symbolOverrides)) {
      for (const so of merged.symbolData.symbolOverrides) {
        const targetGuids: any[] = Array.isArray(so?.guidPath?.guids) ? so.guidPath.guids : [];
        if (targetGuids.length > 0) {
          const leafGuid = guidStr(targetGuids[targetGuids.length - 1]);
          if (leafGuid) nextOverrides.set(leafGuid, { ...nextOverrides.get(leafGuid), ...so });
        }
      }
    }
    const symId = guidStr(merged.symbolData?.symbolID);
    if (type === 'INSTANCE' && rawKids.length === 0 && symId && !visitedSymbols.has(symId)) {
      const symNode = byGuid.get(symId);
      if (symNode) {
        visitedSymbols = new Set(visitedSymbols);
        visitedSymbols.add(symId);
        rawKids = getOrderedChildren(symId);
      }
    }

    if (paintInfo.imageRef && rawKids.length === 0) {
      return {
        id: rawId,
        name: String(merged.name ?? 'Image'),
        kind: 'image',
        x,
        y,
        width,
        height,
        opacity,
        sizingH,
        sizingV,
        positioning,
        imageRef: paintInfo.imageRef,
        objectFit: paintInfo.scaleMode === 'FIT' ? 'contain' : 'cover',
        ...strokeInfo,
        ...effectInfo,
        ...radiusInfo,
        destinationNodeId: destId,
      };
    }

    // 3. Leaf Shape / Vector / Boolean / Line / Star / Polygon / Rectangle / Ellipse
    const isShapeLeaf =
      rawKids.length === 0 &&
      ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'LINE', 'ELLIPSE', 'RECTANGLE', 'ROUNDED_RECTANGLE'].includes(type);

    if (isShapeLeaf) {
      const paths: FigmaVectorPathIR[] = [];
      if (Array.isArray(merged.fillGeometry)) {
        for (const g of merged.fillGeometry) {
          const blobIdx = typeof g?.commandsBlob === 'number' ? g.commandsBlob : -1;
          const d = blobIdx >= 0 ? decodeCommandsBlob(blobs[blobIdx]) : undefined;
          if (d) {
            paths.push({
              d,
              fill: paintInfo.bg ?? '#64748B',
              fillRule: g?.windingRule === 'ODD' ? 'evenodd' : 'nonzero',
            });
          }
        }
      }
      if (paths.length === 0 && Array.isArray(merged.strokeGeometry) && strokeInfo.borderColor) {
        for (const g of merged.strokeGeometry) {
          const blobIdx = typeof g?.commandsBlob === 'number' ? g.commandsBlob : -1;
          const d = blobIdx >= 0 ? decodeCommandsBlob(blobs[blobIdx]) : undefined;
          if (d) {
            paths.push({
              d,
              fill: strokeInfo.borderColor,
              fillRule: g?.windingRule === 'ODD' ? 'evenodd' : 'nonzero',
            });
          }
        }
      }

      // Simple rectangle / ellipse without custom vector blob renders crisply via CSS box model
      const usePlainBox = (type === 'RECTANGLE' || type === 'ROUNDED_RECTANGLE' || type === 'ELLIPSE') && paths.length <= 1;

      return {
        id: rawId,
        name: String(merged.name ?? type),
        kind: 'vector',
        x,
        y,
        width,
        height: type === 'LINE' ? Math.max(1, strokeInfo.borderWidth ?? 1) : height,
        opacity,
        sizingH,
        sizingV,
        positioning,
        background: usePlainBox ? paintInfo.bg : undefined,
        ...strokeInfo,
        ...effectInfo,
        ...radiusInfo,
        viewBox: !usePlainBox && paths.length > 0 ? `0 0 ${Math.max(1, width)} ${Math.max(1, height)}` : undefined,
        paths: !usePlainBox && paths.length > 0 ? paths : undefined,
        fill: paintInfo.bg,
        stroke: strokeInfo.borderColor,
        strokeWidth: strokeInfo.borderWidth,
        destinationNodeId: destId,
      };
    }

    // 4. Container Frame / Group / Component / Instance
    const layoutMode: FigmaNodeIR['layoutMode'] =
      merged.stackMode === 'HORIZONTAL'
        ? 'row'
        : merged.stackMode === 'VERTICAL'
        ? 'column'
        : 'none';

    if (layoutMode !== 'none') stats.autoLayouts++;

    const padTop = Number(merged.stackVerticalPadding ?? merged.stackPaddingTop ?? 0);
    const padRight = Number(merged.stackPaddingRight ?? merged.stackHorizontalPadding ?? 0);
    const padBottom = Number(merged.stackPaddingBottom ?? merged.stackVerticalPadding ?? 0);
    const padLeft = Number(merged.stackHorizontalPadding ?? merged.stackPaddingLeft ?? 0);

    const childrenIR: FigmaNodeIR[] = [];
    for (const childNc of rawKids) {
      const converted = convertNode(childNc, layoutMode, nextOverrides, visitedSymbols, stats);
      if (converted) {
        // GROUP children in Figma binary store coordinates relative to the group's parent in some versions,
        // whereas FRAME/SYMBOL/INSTANCE store local coordinates in transform.m02/m12.
        childrenIR.push(converted);
      }
    }

    const nodeName = String(merged.name ?? 'Frame');
    return {
      id: rawId,
      name: nodeName,
      kind: 'frame',
      x,
      y,
      width,
      height,
      opacity,
      sizingH,
      sizingV,
      positioning,
      layoutMode,
      gap: typeof merged.stackSpacing === 'number' ? merged.stackSpacing : undefined,
      counterGap: typeof merged.stackCounterSpacing === 'number' ? merged.stackCounterSpacing : undefined,
      padding: layoutMode !== 'none' ? formatPaddingCss(padTop, padRight, padBottom, padLeft) : undefined,
      justify: layoutMode !== 'none' ? mapPrimaryAlign(merged.stackPrimaryAlignItems) : undefined,
      align: layoutMode !== 'none' ? mapCounterAlign(merged.stackCounterAlignItems) : undefined,
      wrap: merged.stackWrap === 'WRAP' ? true : undefined,
      clip: merged.frameMaskDisabled === false || (type === 'FRAME' && merged.clipsContent !== false),
      semanticRole: inferSemanticRole(nodeName, 'frame', layoutMode),
      background: paintInfo.bg,
      ...strokeInfo,
      ...effectInfo,
      ...radiusInfo,
      destinationNodeId: destId,
      children: childrenIR,
    };
  };

  const canvases: FigmaCanvasIR[] = [];
  const rawCanvases = getOrderedChildren(docId).filter(
    (c) => c.type === 'CANVAS' && !c.internalOnly && c.visible !== false,
  );

  for (const canvasNc of rawCanvases) {
    const canvasId = guidStr(canvasNc.guid);
    const canvasName = String(canvasNc.name ?? 'Page');
    const isDsCanvas = isLikelyDesignSystemName(canvasName);
    const frames: FigmaPageCandidateIR[] = [];

    const collectTopFrames = (nodes: any[], section?: { id: string; name: string }) => {
      for (const item of nodes) {
        if (item.visible === false) continue;
        const itemId = guidStr(item.guid);
        const itemName = String(item.name ?? 'Frame');
        if (item.type === 'SECTION') {
          collectTopFrames(getOrderedChildren(itemId), { id: itemId, name: itemName });
          continue;
        }
        if (!['FRAME', 'SYMBOL', 'COMPONENT', 'INSTANCE'].includes(String(item.type))) {
          continue;
        }
        const w = Number(item.size?.x ?? 0);
        const h = Number(item.size?.y ?? 0);
        if (w < 160 || h < 120) continue;

        const stats = { nodes: 0, autoLayouts: 0, links: 0 };
        const rootIr = convertNode(item, 'none', new Map(), new Set(), stats);
        if (!rootIr) continue;

        const isCompSheet =
          isDsCanvas ||
          item.type === 'SYMBOL' ||
          isLikelyDesignSystemName(itemName) ||
          (section ? isLikelyDesignSystemName(section.name) : false);

        frames.push({
          id: itemId,
          pageId: figmaPageId(itemId),
          name: itemName,
          canvasId,
          canvasName,
          sectionId: section?.id,
          sectionName: section?.name,
          width: Math.round(w),
          height: Math.round(h),
          platform: detectFigmaPlatform(w, h, `${canvasName} ${section?.name ?? ''} ${itemName}`),
          defaultSelected: !isCompSheet,
          isComponentSheet: isCompSheet,
          nodeCount: stats.nodes,
          autoLayoutCount: stats.autoLayouts,
          linkCount: stats.links,
          warnings: [],
          rootNode: rootIr,
        });
      }
    };

    collectTopFrames(getOrderedChildren(canvasId));
    if (frames.length > 0) {
      canvases.push({
        id: canvasId,
        folderId: figmaFolderId(`canvas:${canvasId}`),
        name: canvasName,
        isDesignSystemCanvas: isDsCanvas,
        frames,
      });
    }
  }

  if (canvases.length === 0) {
    throw new Error('未在 .fig 文件中检测到可导入的页面画板（顶层 Frame 尺寸需至少 160×120）');
  }

  // Ensure at least one frame is selected by default if every canvas happened to be named like a component sheet
  const anyDefault = canvases.some((c) => c.frames.some((f) => f.defaultSelected));
  if (!anyDefault) {
    for (const c of canvases) {
      for (const f of c.frames) f.defaultSelected = true;
    }
  }

  return {
    name: docName,
    sourceKind: 'fig-file',
    version: `v${version}`,
    canvases,
    warnings: [],
    archive: container.archive,
  };
}
