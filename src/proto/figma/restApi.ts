import {
  detectFigmaPlatform,
  figmaFolderId,
  figmaPageId,
  formatPaddingCss,
  inferSemanticRole,
  isLikelyDesignSystemName,
  MAX_PUBLISHABLE_ENCODED_IMAGE_BUDGET,
  MAX_SINGLE_FIGMA_IMAGE_BYTES,
  rgbaToCss,
  selectFigmaCandidateFrames,
  planFigmaFrameLayers,
  type FigmaCanvasIR,
  type FigmaDocumentIR,
  type FigmaNodeIR,
  type FigmaPageCandidateIR,
  type FigmaTextRunIR,
  type FigmaVectorPathIR,
} from './ir';

export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId?: string;
}

export function parseFigmaUrl(input: string): ParsedFigmaUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('请输入 Figma 设计稿链接');
  }
  if (/^[A-Za-z0-9]{18,36}$/.test(trimmed)) {
    return { fileKey: trimmed };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Figma 链接格式无效，请粘贴完整的 https://www.figma.com/design/... 链接');
  }
  if (!/(\.|^)figma\.com$/i.test(parsed.hostname)) {
    throw new Error('仅支持官方 figma.com 域名链接');
  }
  const match = /^\/(?:design|file|proto|board)\/([A-Za-z0-9]+)(?:\/|$)/i.exec(parsed.pathname);
  if (!match) {
    throw new Error('无法从链接中提取 Figma File Key，请确认链接包含 /design/<fileKey>/ 或 /file/<fileKey>/');
  }
  const rawNodeId = parsed.searchParams.get('node-id');
  const nodeId = rawNodeId ? decodeURIComponent(rawNodeId).replace(/-/g, ':') : undefined;
  return { fileKey: match[1], nodeId: nodeId && nodeId.includes(':') ? nodeId : undefined };
}

interface FigmaDesktopBridge {
  isElectron?: boolean;
  figma?: {
    getToken(): Promise<string>;
    setToken(token: string): Promise<{ saved: boolean; persisted?: boolean; reason?: string; error?: string }>;
    fetchJson(input: { url: string; token: string }): Promise<{ ok: boolean; status: number; data?: any; error?: string }>;
    fetchImage?(input: { url: string; maxBytes?: number }): Promise<{ ok: boolean; dataUri?: string; byteLength?: number; encodedLength?: number; error?: string }>;
  };
}

const LEGACY_LOCAL_TOKEN_STORAGE_KEY = 'protoflow.figma.pat.v1';
const MAX_SINGLE_IMAGE_BYTES = MAX_SINGLE_FIGMA_IMAGE_BYTES;

let sessionFigmaToken = '';
let clientTokenOpGeneration = 0;

function scrubLegacyLocalStorageToken(): void {
  try {
    const ls =
      typeof localStorage !== 'undefined'
        ? localStorage
        : typeof window !== 'undefined'
        ? window.localStorage
        : undefined;
    ls?.removeItem(LEGACY_LOCAL_TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export async function loadSavedFigmaToken(): Promise<string> {
  scrubLegacyLocalStorageToken();
  const capturedGen = clientTokenOpGeneration;
  const desktop = (typeof window !== 'undefined' ? (window as unknown as { protoflowDesktop?: FigmaDesktopBridge }).protoflowDesktop : undefined);
  if (desktop?.isElectron && desktop.figma) {
    try {
      const saved = (await desktop.figma.getToken()) || '';
      if (capturedGen !== clientTokenOpGeneration) {
        return sessionFigmaToken;
      }
      if (saved) sessionFigmaToken = saved;
      return saved;
    } catch {
      return sessionFigmaToken;
    }
  }
  return sessionFigmaToken;
}

export async function saveFigmaToken(
  token: string,
): Promise<{ saved: boolean; persisted: boolean; error?: string }> {
  scrubLegacyLocalStorageToken();
  const clean = token.trim();
  const myGen = ++clientTokenOpGeneration;
  sessionFigmaToken = clean;
  const desktop = (typeof window !== 'undefined' ? (window as unknown as { protoflowDesktop?: FigmaDesktopBridge }).protoflowDesktop : undefined);
  if (desktop?.isElectron && desktop.figma) {
    const res = await desktop.figma.setToken(clean);
    if (myGen !== clientTokenOpGeneration) {
      return { saved: true, persisted: !sessionFigmaToken };
    }
    if (!res?.saved) {
      return {
        saved: false,
        persisted: false,
        error: res?.error || '无法更新本地 Figma Token 凭据文件，请检查用户目录权限',
      };
    }
    return {
      saved: true,
      persisted: res.persisted !== false,
    };
  }
  // Never persist secrets in plaintext localStorage in Web mode; keep in memory for the current session only.
  return {
    saved: true,
    persisted: !clean,
  };
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sniffRasterImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

async function requestFigmaApiJson(
  url: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<any> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('请填写 Figma Personal Access Token（可在 Figma Settings → Security 中生成）');
  }

  const desktop = !fetchImpl && typeof window !== 'undefined'
    ? (window as unknown as { protoflowDesktop?: FigmaDesktopBridge }).protoflowDesktop
    : undefined;
  if (desktop?.isElectron && desktop.figma) {
    const res = await desktop.figma.fetchJson({ url, token: cleanToken });
    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        throw new Error('Figma Token 无效或无权访问该设计稿（HTTP ' + res.status + '）');
      }
      if (res.status === 404) {
        throw new Error('未找到对应的 Figma 文件，请核对链接是否正确（HTTP 404）');
      }
      if (res.status === 429) {
        throw new Error('Figma API 请求频率受限，请稍后重试（HTTP 429）');
      }
      throw new Error(res.error || `Figma API 请求失败（HTTP ${res.status})`);
    }
    return res.data;
  }

  const headers: Record<string, string> = cleanToken.startsWith('figu_')
    ? { Authorization: `Bearer ${cleanToken}` }
    : { 'X-Figma-Token': cleanToken };

  const resp = await (fetchImpl ?? fetch)(url, { method: 'GET', headers });
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('Figma Token 无效或无权访问该设计稿（HTTP ' + resp.status + '）');
    }
    if (resp.status === 404) {
      throw new Error('未找到对应的 Figma 文件，请核对链接是否正确（HTTP 404）');
    }
    if (resp.status === 429) {
      throw new Error('Figma API 请求频率受限，请稍后重试（HTTP 429）');
    }
    throw new Error(`Figma API 请求失败（HTTP ${resp.status}）`);
  }
  return resp.json();
}

async function readStreamBytesWithLimit(
  resp: Response,
  limit: number,
  controller: AbortController,
): Promise<{ status: 'ok'; bytes: Uint8Array } | { status: 'too_large' } | { status: 'failed' }> {
  const lenHeader = Number(resp.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(lenHeader) && lenHeader > limit) {
    try { controller.abort(); } catch { /* ignore */ }
    try { await resp.body?.cancel?.(); } catch { /* ignore */ }
    return { status: 'too_large' };
  }
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    const ab = await resp.arrayBuffer();
    if (ab.byteLength > limit) return { status: 'too_large' };
    return { status: 'ok', bytes: new Uint8Array(ab) };
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limit) {
          try { controller.abort(); } catch { /* ignore */ }
          try { await reader.cancel(); } catch { /* ignore */ }
          return { status: 'too_large' };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { status: 'failed' };
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: 'ok', bytes: merged };
}

type ImageDownloadOutcome =
  | { status: 'ok'; dataUri: string; byteLength: number }
  | { status: 'too_large' }
  | { status: 'failed' };

async function downloadImageAsDataUri(
  rawUrl: string,
  maxBytes: number,
  fetchImpl?: typeof fetch,
): Promise<ImageDownloadOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { status: 'failed' };
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return { status: 'failed' };
  }
  if (maxBytes < 1) {
    return { status: 'too_large' };
  }
  const limit = Math.max(1, Math.min(MAX_SINGLE_IMAGE_BYTES, Math.floor(maxBytes)));
  const desktop = !fetchImpl && typeof window !== 'undefined'
    ? (window as unknown as { protoflowDesktop?: FigmaDesktopBridge }).protoflowDesktop
    : undefined;
  if (desktop?.isElectron && desktop.figma?.fetchImage) {
    const res = await desktop.figma.fetchImage({ url: parsed.toString(), maxBytes: limit });
    if (res?.ok && typeof res.dataUri === 'string' && res.dataUri.startsWith('data:image/')) {
      const byteLength = typeof res.byteLength === 'number' ? res.byteLength : Math.ceil(res.dataUri.length * 0.75);
      if (byteLength > limit) return { status: 'too_large' };
      return {
        status: 'ok',
        dataUri: res.dataUri,
        byteLength,
      };
    }
    if (res?.error === 'IMAGE_TOO_LARGE') return { status: 'too_large' };
    return { status: 'failed' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await (fetchImpl ?? fetch)(parsed.toString(), {
      method: 'GET',
      signal: controller.signal,
    });
    if (!resp.ok) {
      try { await resp.body?.cancel?.(); } catch { /* ignore */ }
      return { status: 'failed' };
    }
    const streamed = await readStreamBytesWithLimit(resp, limit, controller);
    if (streamed.status !== 'ok') return streamed;
    const mime = sniffRasterImageMime(streamed.bytes);
    if (!mime) return { status: 'failed' };
    return {
      status: 'ok',
      dataUri: `data:${mime};base64,${uint8ToBase64(streamed.bytes)}`,
      byteLength: streamed.bytes.byteLength,
    };
  } catch {
    return { status: 'failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function restGradientCss(paint: any): string | undefined {
  const stops: any[] | undefined = paint?.gradientStops;
  if (!Array.isArray(stops) || stops.length < 2) return undefined;
  const op = typeof paint.opacity === 'number' ? paint.opacity : 1;
  const formatted = stops
    .map((s) => {
      const col = rgbaToCss(s.color, op);
      if (!col) return null;
      const pct = Math.round(Math.max(0, Math.min(1, Number(s.position ?? 0))) * 100);
      return `${col} ${pct}%`;
    })
    .filter(Boolean);
  if (formatted.length < 2) return undefined;
  if (paint.type === 'GRADIENT_RADIAL') {
    return `radial-gradient(circle, ${formatted.join(', ')})`;
  }
  return `linear-gradient(135deg, ${formatted.join(', ')})`;
}

export function normalizeFigmaRestFile(
  payload: Record<string, any>,
  options: {
    fileKey?: string;
    targetNodeId?: string;
    imageUrlByRef?: Record<string, string>;
  } = {},
): FigmaDocumentIR {
  const docName = String(payload.name ?? 'Figma 在线设计稿').trim() || 'Figma 在线设计稿';
  const version = typeof payload.version === 'string' ? payload.version : undefined;
  const imageMap = options.imageUrlByRef ?? {};
  const warnings: string[] = [];

  const mapSizing = (raw: unknown): FigmaNodeIR['sizingH'] => {
    if (raw === 'HUG') return 'hug';
    if (raw === 'FILL') return 'fill';
    return 'fixed';
  };

  const mapPrimary = (raw: unknown): FigmaNodeIR['justify'] => {
    if (raw === 'CENTER') return 'center';
    if (raw === 'MAX') return 'flex-end';
    if (raw === 'SPACE_BETWEEN') return 'space-between';
    return 'flex-start';
  };

  const mapCounter = (raw: unknown): FigmaNodeIR['align'] => {
    if (raw === 'CENTER') return 'center';
    if (raw === 'MAX') return 'flex-end';
    if (raw === 'STRETCH') return 'stretch';
    if (raw === 'BASELINE') return 'baseline';
    return 'flex-start';
  };

  const extractClickDest = (n: any): string | undefined => {
    if (Array.isArray(n.interactions)) {
      for (const inter of n.interactions) {
        const trig = inter?.trigger?.type;
        if (trig && trig !== 'ON_CLICK' && trig !== 'ON_DRAG') continue;
        const actions: any[] = Array.isArray(inter?.actions) ? inter.actions : [];
        for (const act of actions) {
          if (typeof act?.destinationId === 'string' && act.destinationId) {
            return act.destinationId;
          }
        }
      }
    }
    if (typeof n.transitionNodeID === 'string' && n.transitionNodeID) {
      return n.transitionNodeID;
    }
    return undefined;
  };

  const extractPaints = (fills: any): { bg?: string; imageSrc?: string; imageRef?: string; scaleMode?: string } => {
    if (!Array.isArray(fills)) return {};
    const visible = fills.filter((f) => f && f.visible !== false && (f.opacity === undefined || f.opacity > 0.001));
    if (!visible.length) return {};
    const top = visible[visible.length - 1];
    const op = typeof top.opacity === 'number' ? top.opacity : 1;
    if (top.type === 'IMAGE') {
      const ref = typeof top.imageRef === 'string' ? top.imageRef : undefined;
      return {
        imageRef: ref,
        imageSrc: ref ? imageMap[ref] : undefined,
        scaleMode: top.scaleMode,
      };
    }
    if (top.type === 'GRADIENT_LINEAR' || top.type === 'GRADIENT_RADIAL') {
      return { bg: restGradientCss(top) };
    }
    if (top.type === 'SOLID') {
      return { bg: rgbaToCss(top.color, op) };
    }
    return {};
  };

  const extractStroke = (n: any): { borderColor?: string; borderWidth?: number; borderStyle?: 'solid' | 'dashed' } => {
    const strokes: any[] = Array.isArray(n.strokes) ? n.strokes.filter((s: any) => s && s.visible !== false) : [];
    const weight = typeof n.strokeWeight === 'number' ? n.strokeWeight : 0;
    if (!strokes.length || weight <= 0) return {};
    const top = strokes[strokes.length - 1];
    const col = rgbaToCss(top.color, typeof top.opacity === 'number' ? top.opacity : 1);
    if (!col) return {};
    const dashed = Array.isArray(n.strokeDashes) && n.strokeDashes.length > 0;
    return { borderColor: col, borderWidth: weight, borderStyle: dashed ? 'dashed' : 'solid' };
  };

  const extractEffects = (n: any): { shadow?: string; backdropBlur?: number } => {
    const effects: any[] = Array.isArray(n.effects) ? n.effects.filter((e: any) => e && e.visible !== false) : [];
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
    return { shadow: shadows.length ? shadows.join(', ') : undefined, backdropBlur };
  };

  const extractRadii = (n: any): { radius?: number; cornerRadii?: string } => {
    if (Array.isArray(n.rectangleCornerRadii) && n.rectangleCornerRadii.length === 4) {
      const [a, b, c, d] = n.rectangleCornerRadii.map((v: unknown) => Math.round(Number(v ?? 0)));
      if (a === b && b === c && c === d) return a > 0 ? { radius: a } : {};
      return { cornerRadii: `${a}px ${b}px ${c}px ${d}px` };
    }
    if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
      return { radius: Math.round(n.cornerRadius) };
    }
    if (n.type === 'ELLIPSE') {
      return { radius: 9999 };
    }
    return {};
  };

  const convertNode = (
    n: any,
    parentOrigin: { x: number; y: number },
    parentLayoutMode: 'none' | 'row' | 'column',
    stats: { nodes: number; autoLayouts: number; links: number },
  ): FigmaNodeIR | null => {
    if (!n || n.visible === false) return null;
    const type = String(n.type ?? 'FRAME');
    if (type === 'SLICE' || type === 'STICKY' || type === 'CONNECTOR') return null;

    stats.nodes++;
    const bbox = n.absoluteBoundingBox ?? n.size ?? {};
    const absX = Number(bbox.x ?? parentOrigin.x);
    const absY = Number(bbox.y ?? parentOrigin.y);
    const x = absX - parentOrigin.x;
    const y = absY - parentOrigin.y;
    const width = Math.max(1, Number(bbox.width ?? n.size?.x ?? 100));
    const height = Math.max(1, Number(bbox.height ?? n.size?.y ?? 32));
    const opacity = typeof n.opacity === 'number' ? n.opacity : 1;
    const destId = extractClickDest(n);
    if (destId) stats.links++;

    let sizingH = mapSizing(n.layoutSizingHorizontal);
    let sizingV = mapSizing(n.layoutSizingVertical);
    const positioning: FigmaNodeIR['positioning'] = n.layoutPositioning === 'ABSOLUTE' ? 'absolute' : 'auto';
    if (parentLayoutMode !== 'none' && positioning !== 'absolute') {
      if (sizingH === 'fixed' && Number(n.layoutGrow ?? 0) > 0 && parentLayoutMode === 'row') sizingH = 'fill';
      if (sizingV === 'fixed' && Number(n.layoutGrow ?? 0) > 0 && parentLayoutMode === 'column') sizingV = 'fill';
      if (n.layoutAlign === 'STRETCH') {
        if (parentLayoutMode === 'row' && sizingV === 'fixed') sizingV = 'fill';
        if (parentLayoutMode === 'column' && sizingH === 'fixed') sizingH = 'fill';
      }
    }

    const paintInfo = extractPaints(n.fills);
    const strokeInfo = extractStroke(n);
    const effectInfo = extractEffects(n);
    const radiusInfo = extractRadii(n);

    if (type === 'TEXT') {
      const chars = String(n.characters ?? '');
      const st = n.style ?? {};
      const color = paintInfo.bg ?? '#0F172A';
      const fontSize = Number(st.fontSize ?? 14);
      const fontWeight = Number(st.fontWeight ?? 400);
      const lineHeight = typeof st.lineHeightPx === 'number' ? `${Math.round(st.lineHeightPx)}px` : undefined;
      const letterSpacing = typeof st.letterSpacing === 'number' ? st.letterSpacing : undefined;
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
      if (st.textAutoResize === 'WIDTH_AND_HEIGHT') {
        if (sizingH === 'fixed') sizingH = 'hug';
        if (sizingV === 'fixed') sizingV = 'hug';
      } else if (st.textAutoResize === 'HEIGHT' && sizingV === 'fixed') {
        sizingV = 'hug';
      }

      let runs: FigmaTextRunIR[] | undefined;
      const overrides: number[] | undefined = n.characterStyleOverrides;
      const table: Record<string, any> | undefined = n.styleOverrideTable;
      if (Array.isArray(overrides) && overrides.length > 0 && table && typeof table === 'object') {
        const segs: FigmaTextRunIR[] = [];
        let cur = overrides[0] ?? 0;
        let start = 0;
        const flush = (end: number, sid: number) => {
          const slice = chars.slice(start, end);
          if (!slice) return;
          const ov = sid ? table[String(sid)] : undefined;
          const ovFill = ov?.fills ? extractPaints(ov.fills).bg : undefined;
          segs.push({
            text: slice,
            color: ovFill ?? color,
            fontSize: typeof ov?.fontSize === 'number' ? Math.round(ov.fontSize) : Math.round(fontSize),
            fontWeight: typeof ov?.fontWeight === 'number' ? ov.fontWeight : fontWeight,
            fontFamily: ov?.fontFamily ?? st.fontFamily,
            italic: Boolean(ov?.italic ?? st.italic) || undefined,
            underline: (ov?.textDecoration ?? st.textDecoration) === 'UNDERLINE' || undefined,
            lineThrough: (ov?.textDecoration ?? st.textDecoration) === 'STRIKETHROUGH' || undefined,
          });
        };
        for (let i = 1; i < chars.length; i++) {
          const sid = overrides[i] ?? 0;
          if (sid !== cur) {
            flush(i, cur);
            cur = sid;
            start = i;
          }
        }
        flush(chars.length, cur);
        if (segs.length > 1) runs = segs;
      }

      return {
        id: String(n.id),
        name: String(n.name ?? 'Text'),
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
        fontFamily: st.fontFamily,
        lineHeight,
        letterSpacing,
        textAlign: alignMap[String(st.textAlignHorizontal ?? 'LEFT')] ?? 'left',
        textVertical: vertMap[String(st.textAlignVertical ?? 'TOP')] ?? 'top',
        italic: Boolean(st.italic),
        decoration:
          st.textDecoration === 'UNDERLINE'
            ? 'underline'
            : st.textDecoration === 'STRIKETHROUGH'
            ? 'line-through'
            : undefined,
        destinationNodeId: destId,
      };
    }

    const rawKids: any[] = Array.isArray(n.children) ? n.children : [];

    if ((paintInfo.imageSrc || paintInfo.imageRef) && rawKids.length === 0) {
      return {
        id: String(n.id),
        name: String(n.name ?? 'Image'),
        kind: 'image',
        x,
        y,
        width,
        height,
        opacity,
        sizingH,
        sizingV,
        positioning,
        imageSrc: paintInfo.imageSrc,
        imageRef: paintInfo.imageRef,
        objectFit: paintInfo.scaleMode === 'FIT' ? 'contain' : 'cover',
        ...strokeInfo,
        ...effectInfo,
        ...radiusInfo,
        destinationNodeId: destId,
      };
    }

    const isLeafVector =
      rawKids.length === 0 &&
      ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'LINE', 'ELLIPSE', 'RECTANGLE'].includes(type);

    if (isLeafVector) {
      const paths: FigmaVectorPathIR[] = [];
      if (Array.isArray(n.fillGeometry)) {
        for (const g of n.fillGeometry) {
          if (typeof g?.path === 'string' && g.path) {
            paths.push({
              d: g.path,
              fill: paintInfo.bg ?? '#64748B',
              fillRule: g.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero',
            });
          }
        }
      }
      if (paths.length === 0 && Array.isArray(n.strokeGeometry) && strokeInfo.borderColor) {
        for (const g of n.strokeGeometry) {
          if (typeof g?.path === 'string' && g.path) {
            paths.push({
              d: g.path,
              fill: strokeInfo.borderColor,
              fillRule: g.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero',
            });
          }
        }
      }
      const useBox = (type === 'RECTANGLE' || type === 'ELLIPSE') && paths.length <= 1;
      return {
        id: String(n.id),
        name: String(n.name ?? type),
        kind: 'vector',
        x,
        y,
        width,
        height: type === 'LINE' ? Math.max(1, strokeInfo.borderWidth ?? 1) : height,
        opacity,
        sizingH,
        sizingV,
        positioning,
        background: useBox ? paintInfo.bg : undefined,
        ...strokeInfo,
        ...effectInfo,
        ...radiusInfo,
        viewBox: !useBox && paths.length > 0 ? `0 0 ${Math.max(1, width)} ${Math.max(1, height)}` : undefined,
        paths: !useBox && paths.length > 0 ? paths : undefined,
        fill: paintInfo.bg,
        stroke: strokeInfo.borderColor,
        strokeWidth: strokeInfo.borderWidth,
        destinationNodeId: destId,
      };
    }

    const layoutMode: FigmaNodeIR['layoutMode'] =
      n.layoutMode === 'HORIZONTAL' ? 'row' : n.layoutMode === 'VERTICAL' ? 'column' : 'none';
    if (layoutMode !== 'none') stats.autoLayouts++;

    const padCss =
      layoutMode !== 'none'
        ? formatPaddingCss(n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0)
        : undefined;

    const bgColor = paintInfo.bg ?? (n.backgroundColor ? rgbaToCss(n.backgroundColor, 1) : undefined);

    const childrenIR: FigmaNodeIR[] = [];
    for (const ch of rawKids) {
      const cIr = convertNode(ch, { x: absX, y: absY }, layoutMode, stats);
      if (cIr) childrenIR.push(cIr);
    }

    const nodeName = String(n.name ?? 'Frame');
    return {
      id: String(n.id),
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
      gap: typeof n.itemSpacing === 'number' ? n.itemSpacing : undefined,
      counterGap: typeof n.counterAxisSpacing === 'number' ? n.counterAxisSpacing : undefined,
      padding: padCss,
      justify: layoutMode !== 'none' ? mapPrimary(n.primaryAxisAlignItems) : undefined,
      align: layoutMode !== 'none' ? mapCounter(n.counterAxisAlignItems) : undefined,
      wrap: n.layoutWrap === 'WRAP' ? true : undefined,
      clip: Boolean(n.clipsContent),
      semanticRole: inferSemanticRole(nodeName, 'frame', layoutMode),
      background: bgColor,
      ...strokeInfo,
      ...effectInfo,
      ...radiusInfo,
      destinationNodeId: destId,
      children: childrenIR,
    };
  };

  const canvases: FigmaCanvasIR[] = [];

  // Support both /v1/files/:key (payload.document) and /v1/files/:key/nodes (payload.nodes)
  if (payload.nodes && typeof payload.nodes === 'object') {
    const frames: FigmaPageCandidateIR[] = [];
    for (const [nid, entry] of Object.entries<any>(payload.nodes)) {
      const rootDoc = entry?.document;
      if (!rootDoc) continue;
      const collectFromScoped = (target: any, section?: { id: string; name: string }) => {
        if (target.type === 'CANVAS' || target.type === 'SECTION') {
          const sec = target.type === 'SECTION' ? { id: String(target.id), name: String(target.name ?? 'Section') } : section;
          for (const ch of target.children ?? []) collectFromScoped(ch, sec);
          return;
        }
        const bbox = target.absoluteBoundingBox ?? {};
        const isContainerTarget = ['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP', 'COMPONENT_SET'].includes(String(target.type ?? ''));
        const w = isContainerTarget
          ? Math.max(240, Number(bbox.width ?? 1280))
          : Math.max(24, Number(bbox.width ?? target.size?.x ?? 120));
        const h = isContainerTarget
          ? Math.max(160, Number(bbox.height ?? 800))
          : Math.max(24, Number(bbox.height ?? target.size?.y ?? 48));
        const stats = { nodes: 0, autoLayouts: 0, links: 0 };
        const rootIr = convertNode(target, { x: Number(bbox.x ?? 0), y: Number(bbox.y ?? 0) }, 'none', stats);
        if (!rootIr) return;
        const fName = String(target.name ?? nid);
        frames.push({
          id: String(target.id ?? nid),
          pageId: figmaPageId(String(target.id ?? nid)),
          name: fName,
          canvasId: 'scoped-canvas',
          canvasName: '指定导入节点',
          sectionId: section?.id,
          sectionName: section?.name,
          width: Math.round(w),
          height: Math.round(h),
          platform: detectFigmaPlatform(w, h, fName),
          defaultSelected: true,
          nodeCount: stats.nodes,
          autoLayoutCount: stats.autoLayouts,
          linkCount: stats.links,
          warnings: [],
          rootNode: rootIr,
        });
      };
      collectFromScoped(rootDoc);
    }
    if (frames.length > 0) {
      canvases.push({
        id: 'scoped-canvas',
        folderId: figmaFolderId('canvas:scoped-canvas'),
        name: '指定导入节点',
        isDesignSystemCanvas: false,
        frames,
      });
    }
  } else if (payload.document && Array.isArray(payload.document.children)) {
    for (const canvasNode of payload.document.children) {
      if (!canvasNode || canvasNode.type !== 'CANVAS' || canvasNode.visible === false) continue;
      const canvasId = String(canvasNode.id);
      const canvasName = String(canvasNode.name ?? 'Page');
      const isDsCanvas = isLikelyDesignSystemName(canvasName);
      const frames: FigmaPageCandidateIR[] = [];

      const collectFrames = (items: any[], section?: { id: string; name: string }) => {
        for (const item of items) {
          if (!item || item.visible === false) continue;
          if (item.type === 'SECTION') {
            collectFrames(item.children ?? [], { id: String(item.id), name: String(item.name ?? 'Section') });
            continue;
          }
          if (item.type === 'COMPONENT_SET' && Array.isArray(item.children) && isDsCanvas) {
            continue;
          }
          if (!['FRAME', 'COMPONENT', 'INSTANCE'].includes(String(item.type))) continue;
          const bbox = item.absoluteBoundingBox ?? {};
          const w = Number(bbox.width ?? 0);
          const h = Number(bbox.height ?? 0);
          if (w < 160 || h < 120) continue;

          const stats = { nodes: 0, autoLayouts: 0, links: 0 };
          const rootIr = convertNode(item, { x: Number(bbox.x ?? 0), y: Number(bbox.y ?? 0) }, 'none', stats);
          if (!rootIr) continue;

          const itemName = String(item.name ?? 'Frame');
          const isComp =
            isDsCanvas ||
            item.type === 'COMPONENT' ||
            isLikelyDesignSystemName(itemName) ||
            (section ? isLikelyDesignSystemName(section.name) : false);

          const matchesTarget = options.targetNodeId ? String(item.id) === options.targetNodeId : undefined;

          frames.push({
            id: String(item.id),
            pageId: figmaPageId(String(item.id)),
            name: itemName,
            canvasId,
            canvasName,
            sectionId: section?.id,
            sectionName: section?.name,
            width: Math.round(w),
            height: Math.round(h),
            platform: detectFigmaPlatform(w, h, `${canvasName} ${section?.name ?? ''} ${itemName}`),
            defaultSelected: matchesTarget !== undefined ? matchesTarget : !isComp,
            isComponentSheet: isComp,
            nodeCount: stats.nodes,
            autoLayoutCount: stats.autoLayouts,
            linkCount: stats.links,
            warnings: [],
            rootNode: rootIr,
          });
        }
      };

      collectFrames(canvasNode.children ?? []);
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
  }

  if (canvases.length === 0) {
    throw new Error('未在该 Figma 文件中找到可导入的顶层画板（Frame 尺寸需至少 160×120）');
  }

  const anySelected = canvases.some((c) => c.frames.some((f) => f.defaultSelected));
  if (!anySelected) {
    for (const c of canvases) {
      for (const f of c.frames) f.defaultSelected = true;
    }
  }

  return {
    name: docName,
    sourceKind: 'rest-api',
    version,
    fileKey: options.fileKey,
    canvases,
    warnings,
  };
}

function maxRawBytesForEncodedBudget(remainingEncodedBytes: number): number {
  // Shortest raster Data URI prefix ('data:image/png;base64,') is 22 ASCII chars; 1 raw byte -> 4 Base64 chars.
  if (remainingEncodedBytes < 26) return 0;
  return Math.floor((remainingEncodedBytes - 22) / 4) * 3;
}

export async function materializeFigmaSelectionImages(
  doc: FigmaDocumentIR,
  selectedPageIds?: ReadonlySet<string>,
  options: {
    fetchImpl?: typeof fetch;
    maxEncodedImageBudget?: number;
    maxEmbeddedImageBudget?: number;
  } = {},
): Promise<FigmaDocumentIR> {
  const rawImageUrlByRef = doc.remoteImagesByRef ?? {};
  const imagesIndexError = doc.imagesIndexError;
  const selectedFrames = new Set(selectFigmaCandidateFrames(doc, selectedPageIds));
  const imagePlacements: { frame: FigmaPageCandidateIR; node: FigmaNodeIR; ref: string }[] = [];

  // Copy retained image nodes and their ancestors. Keep clipped nodes available for
  // prototype navigation, which resolves a destination layer to its owning page.
  const prepareFrame = (frame: FigmaPageCandidateIR): FigmaPageCandidateIR => {
    if (!selectedFrames.has(frame)) return frame;
    const { layers, warnings } = planFigmaFrameLayers(frame);
    const prepared = { ...frame, warnings };
    const copy = (node: FigmaNodeIR): FigmaNodeIR => {
      if (node.kind === 'image' && node.imageRef && layers.has(node)) {
        const image = { ...node };
        imagePlacements.push({ frame: prepared, node: image, ref: node.imageRef });
        return image;
      }
      if (node.kind === 'frame' && node.children && (node === frame.rootNode || layers.has(node))) {
        return { ...node, children: node.children.map(copy) };
      }
      return node;
    };
    prepared.rootNode = copy(frame.rootNode);
    return prepared;
  };
  const nextDoc: FigmaDocumentIR = {
    ...doc,
    canvases: doc.canvases.map(canvas => ({ ...canvas, frames: canvas.frames.map(prepareFrame) })),
    warnings: [...doc.warnings],
  };

  if (imagePlacements.length === 0) {
    return nextDoc;
  }

  if (imagesIndexError && Object.keys(rawImageUrlByRef).length === 0) {
    nextDoc.warnings.push(
      `Figma 图片下载地址索引获取失败（${imagesIndexError}），所选画板共有 ${imagePlacements.length} 处图片已降级为安全占位`,
    );
    for (const { frame, node } of imagePlacements) {
      node.imageSrc = undefined;
      frame.warnings.push(`图片图层「${node.name || node.id}」因图片索引请求失败已使用占位显示`);
    }
    return nextDoc;
  }

  const maxEncodedBudget = Math.max(
    1,
    Math.floor(options.maxEncodedImageBudget ?? MAX_PUBLISHABLE_ENCODED_IMAGE_BUDGET),
  );
  const maxRawBudget =
    options.maxEmbeddedImageBudget !== undefined
      ? Math.max(1, Math.floor(options.maxEmbeddedImageBudget))
      : Number.POSITIVE_INFINITY;

  let usedEncodedBudget = 0;
  let usedRawBudget = 0;
  let omittedCount = 0;
  let budgetOmittedCount = 0;

  // Cache unique imageRefs as we traverse ONLY the selected frames in exact order:
  // - Rejected placements charge 0 bytes, leaving remaining budget available for subsequent smaller images.
  // - Because remaining budget is monotonically non-increasing, an image too large at step i cannot fit at step j > i.
  const cacheByRef = new Map<
    string,
    { dataUri: string; byteLength: number; encodedLength: number } | 'missing_url' | 'too_large' | 'failed'
  >();

  for (const { frame, node, ref } of imagePlacements) {
    let entry = cacheByRef.get(ref);
    if (entry === undefined) {
      const remoteUrl = rawImageUrlByRef[ref];
      if (typeof remoteUrl !== 'string' || !remoteUrl.trim()) {
        entry = 'missing_url';
        cacheByRef.set(ref, entry);
      } else {
        const remainingEncoded = maxEncodedBudget - usedEncodedBudget;
        const remainingRaw = maxRawBudget - usedRawBudget;
        const maxRawAllowed = Math.min(
          MAX_SINGLE_IMAGE_BYTES,
          maxRawBytesForEncodedBudget(remainingEncoded),
          remainingRaw,
        );
        if (maxRawAllowed < 1) {
          node.imageSrc = undefined;
          omittedCount++;
          budgetOmittedCount++;
          frame.warnings.push(
            `图片图层「${node.name || node.id}」超过图片内嵌额度，已使用占位显示`,
          );
          continue;
        }
        const downloaded = await downloadImageAsDataUri(remoteUrl, maxRawAllowed, options.fetchImpl);
        if (downloaded.status === 'too_large') {
          entry = 'too_large';
          cacheByRef.set(ref, entry);
        } else if (downloaded.status === 'failed') {
          entry = 'failed';
          cacheByRef.set(ref, entry);
        } else {
          entry = {
            dataUri: downloaded.dataUri,
            byteLength: downloaded.byteLength,
            encodedLength: downloaded.dataUri.length,
          };
          cacheByRef.set(ref, entry);
        }
      }
    }

    if (entry === 'missing_url') {
      omittedCount++;
      node.imageSrc = undefined;
      frame.warnings.push(`图片图层「${node.name || node.id}」未获取到有效下载地址，已使用占位显示`);
      continue;
    }
    if (entry === 'too_large') {
      omittedCount++;
      budgetOmittedCount++;
      node.imageSrc = undefined;
      frame.warnings.push(
        `图片图层「${node.name || node.id}」超过图片内嵌额度，已使用占位显示`,
      );
      continue;
    }
    if (entry === 'failed') {
      omittedCount++;
      node.imageSrc = undefined;
      frame.warnings.push(
        `图片图层「${node.name || node.id}」未能内嵌（下载失败或格式不支持），已使用占位显示`,
      );
      continue;
    }

    if (
      usedEncodedBudget + entry.encodedLength > maxEncodedBudget ||
      usedRawBudget + entry.byteLength > maxRawBudget
    ) {
      omittedCount++;
      budgetOmittedCount++;
      node.imageSrc = undefined;
      frame.warnings.push(
        `图片图层「${node.name || node.id}」超过图片内嵌额度，已使用占位显示`,
      );
      continue;
    }

    usedEncodedBudget += entry.encodedLength;
    usedRawBudget += entry.byteLength;
    node.imageSrc = entry.dataUri;
  }

  if (omittedCount > 0) {
    nextDoc.warnings.push(
      budgetOmittedCount > 0
        ? `共有 ${omittedCount} 处在线图片未能内嵌（其中 ${budgetOmittedCount} 处因超过图片内嵌额度而使用占位图）`
        : `共有 ${omittedCount} 处在线图片未能内嵌至本地工程，已降级为安全占位`,
    );
  }

  return nextDoc;
}

export async function fetchFigmaDocumentFromUrl(
  rawUrl: string,
  accessToken: string,
  options: {
    scopeToUrlNode?: boolean;
    fetchImpl?: typeof fetch;
    deferImageDownload?: boolean;
    selectedPageIds?: ReadonlySet<string>;
    maxEncodedImageBudget?: number;
    maxEmbeddedImageBudget?: number;
  } = {},
): Promise<FigmaDocumentIR> {
  const { fileKey, nodeId } = parseFigmaUrl(rawUrl);
  const apiBase = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`;
  const endpoint =
    options.scopeToUrlNode && nodeId
      ? `${apiBase}/nodes?ids=${encodeURIComponent(nodeId)}&geometry=paths`
      : `${apiBase}?geometry=paths`;

  let imagesIndexError: string | undefined;
  const [fileJson, imagesJson] = await Promise.all([
    requestFigmaApiJson(endpoint, accessToken, options.fetchImpl),
    requestFigmaApiJson(`${apiBase}/images`, accessToken, options.fetchImpl).catch((err: unknown) => {
      imagesIndexError = err instanceof Error ? err.message : String(err);
      return null;
    }),
  ]);
  if (!imagesIndexError && typeof imagesJson?.err === 'string' && imagesJson.err.trim()) {
    imagesIndexError = imagesJson.err.trim();
  }

  const rawImageUrlByRef: Record<string, string> =
    imagesJson?.meta?.images && typeof imagesJson.meta.images === 'object' ? imagesJson.meta.images : {};

  // Normalize without temporary expiring S3 URLs; attach remoteImagesByRef for selection-time materialization.
  const doc = normalizeFigmaRestFile(fileJson, {
    fileKey,
    targetNodeId: !options.scopeToUrlNode ? nodeId : undefined,
    imageUrlByRef: {},
  });
  doc.remoteImagesByRef = rawImageUrlByRef;
  if (imagesIndexError) {
    doc.imagesIndexError = imagesIndexError;
  }

  if (options.deferImageDownload) {
    return doc;
  }

  return materializeFigmaSelectionImages(doc, options.selectedPageIds, {
    fetchImpl: options.fetchImpl,
    maxEncodedImageBudget: options.maxEncodedImageBudget,
    maxEmbeddedImageBudget: options.maxEmbeddedImageBudget,
  });
}
