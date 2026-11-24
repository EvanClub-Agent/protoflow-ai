import type { PagePlatform, ProjectMode } from '../mobile/types';

export interface FigmaTextRunIR {
  text: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  italic?: boolean;
  underline?: boolean;
  lineThrough?: boolean;
}

export interface FigmaVectorPathIR {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillRule?: 'nonzero' | 'evenodd';
}

export type FigmaNodeKind = 'frame' | 'text' | 'vector' | 'image';

export interface FigmaNodeIR {
  id: string;
  name: string;
  kind: FigmaNodeKind;
  hidden?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  sizingH?: 'fixed' | 'hug' | 'fill';
  sizingV?: 'fixed' | 'hug' | 'fill';
  positioning?: 'auto' | 'absolute';
  // Frame / Auto Layout
  layoutMode?: 'none' | 'row' | 'column';
  gap?: number;
  counterGap?: number;
  padding?: string;
  justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between';
  align?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
  wrap?: boolean;
  clip?: boolean;
  semanticRole?: string;
  // Surface
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed';
  radius?: number;
  cornerRadii?: string;
  shadow?: string;
  backdropBlur?: number;
  // Text
  text?: string;
  runs?: FigmaTextRunIR[];
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: string;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textVertical?: 'top' | 'middle' | 'bottom';
  italic?: boolean;
  decoration?: 'none' | 'underline' | 'line-through';
  // Vector
  svgPath?: string;
  viewBox?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  paths?: FigmaVectorPathIR[];
  // Image
  imageSrc?: string;
  imageRef?: string;
  objectFit?: 'cover' | 'contain' | 'fill';
  // Interactions
  destinationNodeId?: string;
  navigateBack?: boolean;
  children?: FigmaNodeIR[];
}

export interface FigmaPageCandidateIR {
  id: string;
  pageId: string;
  name: string;
  canvasId: string;
  canvasName: string;
  sectionId?: string;
  sectionName?: string;
  width: number;
  height: number;
  platform: PagePlatform;
  defaultSelected: boolean;
  isComponentSheet?: boolean;
  nodeCount: number;
  autoLayoutCount: number;
  linkCount: number;
  warnings: string[];
  rootNode: FigmaNodeIR;
}

export interface FigmaCanvasIR {
  id: string;
  folderId: string;
  name: string;
  isDesignSystemCanvas: boolean;
  frames: FigmaPageCandidateIR[];
}

export interface FigmaDocumentIR {
  name: string;
  sourceKind: 'fig-file' | 'rest-api';
  version?: string;
  fileKey?: string;
  canvases: FigmaCanvasIR[];
  warnings: string[];
  archive?: FigmaImageArchive;
  /** Pre-embedded images supplied by callers with an already decoded document. */
  embeddedImagesByRef?: Record<string, string>;
  /** Remote Figma image URLs keyed by imageRef; downloaded & budgeted only for selected frames at import time. */
  remoteImagesByRef?: Record<string, string>;
  /** Non-empty when the Figma /images endpoint failed or returned an error. */
  imagesIndexError?: string;
}

export interface FigmaImageArchive {
  bytes: Uint8Array;
  entries: Record<string, { name: string; size: number }>;
}

// This budget covers image placements only. Publication checks the entire UTF-8 request body.
export const MAX_PUBLISHABLE_ENCODED_IMAGE_BUDGET = 12 * 1024 * 1024;
export const MAX_SINGLE_FIGMA_IMAGE_BYTES = 4 * 1024 * 1024;

export function selectFigmaCandidateFrames(
  doc: FigmaDocumentIR,
  selectedPageIds?: ReadonlySet<string>,
): FigmaPageCandidateIR[] {
  const selectedCandidates: FigmaPageCandidateIR[] = [];
  for (const canvas of doc.canvases) {
    for (const frame of canvas.frames) {
      const keep = selectedPageIds ? selectedPageIds.has(frame.pageId) : frame.defaultSelected;
      if (keep) selectedCandidates.push(frame);
    }
  }
  if (selectedCandidates.length === 0 && !selectedPageIds) {
    for (const canvas of doc.canvases) {
      for (const frame of canvas.frames) {
        selectedCandidates.push(frame);
      }
    }
  }
  return selectedCandidates;
}

/** Both downloads and compilation use the same page-relative depth and node budget. */
export function planFigmaFrameLayers(frame: FigmaPageCandidateIR) {
  const layers = new Set<FigmaNodeIR>();
  const warnings = new Set(frame.warnings);
  function visit(nodes: FigmaNodeIR[], depth: number) {
    for (const node of nodes) {
      if (layers.size >= 1800) {
        warnings.add('图层数量超过单页 1800 上限，超出部分已省略');
        return;
      }
      if (depth > 36) {
        warnings.add('图层嵌套超过 36 层，超出部分已省略');
        return;
      }
      layers.add(node);
      if (node.kind === 'frame' && node.children) visit(node.children, depth + 1);
    }
  }

  const root = frame.rootNode;
  if (root.kind === 'frame') visit(root.children ?? [], 1);
  else layers.add(root);
  return { layers, warnings: [...warnings] };
}

export interface FigmaImportReportItem {
  pageId: string;
  title: string;
  canvasName: string;
  sectionName?: string;
  platform: PagePlatform;
  width: number;
  height: number;
  widgets: number;
  omittedImages: number;
  autoLayouts: number;
  links: number;
  warnings: string[];
}

export interface FigmaCompiledImport {
  documentName: string;
  sourceKind: 'fig-file' | 'rest-api';
  version?: string;
  projectMode: ProjectMode;
  designerFolders: { id: string; title: string; parentFolderId: string | null }[];
  designerPages: { pageId: string; title: string; folderId: string; platform: PagePlatform }[];
  pageSources: Record<string, string>;
  report: FigmaImportReportItem[];
  omittedImages?: number;
  encodedImageBytes?: number;
}

const DESIGN_SYSTEM_NAME_RE =
  /(?:^|[\s/_\-·•【\[(])(components?|design[\s_-]*system|ui[\s_-]*kit|symbols?|icons?|tokens?|variables?|style[\s_-]*guide|assets?|playground|cover|thumbnail|组件库|组件规范|设计规范|图标库|样式库|基础组件|色彩字体|封面)(?:$|[\s/_\-·•】\])])/i;

export function isLikelyDesignSystemName(name: string): boolean {
  return DESIGN_SYSTEM_NAME_RE.test(name.trim());
}

export function detectFigmaPlatform(width: number, height: number, name = ''): PagePlatform {
  const w = Math.round(width);
  const h = Math.round(height);
  if (/(?:mobile|iphone|android|ios|mini[\s_-]*program|h5|小程序|移动端|手机)/i.test(name) && w <= 560) {
    return 'mobile';
  }
  if (/(?:desktop|web|pc|admin|dashboard|桌面|后台|管理端|大屏)/i.test(name) && w >= 600) {
    return 'desktop';
  }
  if (w >= 260 && w <= 480 && h >= Math.max(480, w * 1.15)) {
    return 'mobile';
  }
  return 'desktop';
}

export function figmaSafeHash(raw: string): string {
  // Deterministic 64-bit FNV-1a hex digest (16 hex chars) + sanitized readable tail
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export const figmaPageId = (figmaNodeId: string): string => `fig-page-${figmaSafeHash(figmaNodeId)}`;
export const figmaFolderId = (figmaNodeId: string): string => `fig-folder-${figmaSafeHash(figmaNodeId)}`;

export function rgbaToCss(color: { r?: number; g?: number; b?: number; a?: number } | undefined, opacityMul = 1): string | undefined {
  if (!color) return undefined;
  const r = Math.max(0, Math.min(255, Math.round((color.r ?? 0) * 255)));
  const g = Math.max(0, Math.min(255, Math.round((color.g ?? 0) * 255)));
  const b = Math.max(0, Math.min(255, Math.round((color.b ?? 0) * 255)));
  const a = Math.max(0, Math.min(1, Number(((color.a ?? 1) * opacityMul).toFixed(3))));
  if (a <= 0) return undefined;
  if (a >= 0.999) {
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function formatPaddingCss(top = 0, right = 0, bottom = 0, left = 0): string | undefined {
  const t = Math.round(top);
  const r = Math.round(right);
  const b = Math.round(bottom);
  const l = Math.round(left);
  if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
  if (t === r && r === b && b === l) return `${t}px`;
  if (t === b && r === l) return `${t}px ${r}px`;
  return `${t}px ${r}px ${b}px ${l}px`;
}

export function inferSemanticRole(name: string, kind: FigmaNodeKind, layoutMode?: string): string | undefined {
  const lower = name.trim().toLowerCase();
  if (/button|btn|cta|按钮|提交|确认|新建|查询/.test(lower)) return 'button';
  if (/input|search|field|select|picker|输入框|搜索|下拉|选择器/.test(lower)) return 'input';
  if (/table|grid|row|list|表格|列表|行/.test(lower) && kind === 'frame') return 'list-or-table';
  if (/nav|sidebar|menu|tabbar|header|topbar|导航|侧栏|菜单|顶栏/.test(lower) && kind === 'frame') return 'navigation';
  if (/card|卡片/.test(lower) && kind === 'frame') return 'card';
  if (layoutMode === 'row' || layoutMode === 'column') return undefined;
  return undefined;
}
