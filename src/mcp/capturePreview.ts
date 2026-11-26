import { getLocale, type Locale } from '../i18n/runtime';
import { parsePageSource } from '../proto/dsl/parser';
import { MOBILE_DEVICE_SPECS, type MobileDevicePreset, type PagePlatform } from '../proto/mobile/types';
import type { PreviewSnapshot } from '../capture/snapshot';
import type { PflowBinaryPayload, PflowProjectMetadata, ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import type { McpToolDefinition } from './tools';
import type { UIStateMatrix } from '../store/useProtoStore';

export const CAPTURE_PREVIEW_PROPERTIES = {
  pageId: { type: 'string', minLength: 1, description: 'Defaults to the active or target page.' },
  scope: { type: 'string', enum: ['canvas', 'viewport'], default: 'viewport' },
  fullPage: { type: 'boolean', default: false, description: 'Expand long pages up to 2160 CSS pixels. Check truncated in the result.' },
  waitMs: { type: 'integer', minimum: 0, maximum: 5000, default: 0 },
  uiState: {
    type: 'string',
    enum: ['normal', 'empty', 'loading', 'edge', 'error'],
    default: 'normal',
    description: 'Optional UI Stack state lens to verify empty states, loading skeletons, edge text overflow, or error fallbacks without mutating project data.',
  },
} as const;

export const capturePreviewTool: McpToolDefinition = {
  name: 'protoflow_capture_preview',
  description:
    'Capture a rendered page from the authorized desktop project. canvas includes the visible stage and device frame; viewport crops to the page surface or phone screen. Supports optional uiState lens (normal/empty/loading/edge/error) for visual boundary auditing.',
  annotations: { title: 'Capture page preview', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: { type: 'object', additionalProperties: false, properties: CAPTURE_PREVIEW_PROPERTIES },
};

export interface CaptureOptions {
  pageId?: string;
  scope: 'canvas' | 'viewport';
  fullPage: boolean;
  waitMs: number;
  uiState?: UIStateMatrix;
}

export interface CaptureResult {
  pageId: string;
  platform: PagePlatform;
  scope: CaptureOptions['scope'];
  revision: string;
  width: number;
  height: number;
  data: string;
  fullPage: boolean;
  truncated: boolean;
}

const VALID_CAPTURE_UI_STATES = new Set(['normal', 'empty', 'loading', 'edge', 'error']);

export function parseCaptureOptions(input: unknown): CaptureOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Capture arguments must be an object');
  const args = input as Record<string, unknown>;
  for (const key of Object.keys(args)) {
    if (!['pageId', 'scope', 'fullPage', 'waitMs', 'uiState'].includes(key)) throw new Error('Unknown capture argument: ' + key);
  }
  const { pageId, scope = 'viewport', fullPage = false, waitMs = 0, uiState } = args;
  if (pageId !== undefined && (typeof pageId !== 'string' || !pageId.trim())) throw new Error('Invalid pageId');
  if (scope !== 'canvas' && scope !== 'viewport') throw new Error('Invalid scope');
  if (typeof waitMs !== 'number' || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 5000) {
    throw new Error('waitMs must be an integer from 0 to 5000');
  }
  if (typeof fullPage !== 'boolean') throw new Error('fullPage must be boolean');
  if (uiState !== undefined && (typeof uiState !== 'string' || !VALID_CAPTURE_UI_STATES.has(uiState))) {
    throw new Error('Invalid uiState');
  }
  return { pageId: pageId?.trim(), scope, fullPage, waitMs, ...(uiState ? { uiState: uiState as UIStateMatrix } : {}) };
}

type PreviewSnapshotSource = Pick<ProjectStateSnapshot, 'pageSources' | 'activePageId'> & PreviewSnapshot['state'];

// These inputs belong to the project at turn start. Page sources, schemas and rows
// are supplied separately from the current candidate after each staged operation.
export function projectPreviewContext({ meta, stateSnapshot }: PflowBinaryPayload) {
  const { activePageId, suppliers, purchaseOrderItems, acceptanceOrders, draftAcceptanceHeader, draftAcceptanceLines, widgets } = stateSnapshot;
  return { meta, activePageId, state: { suppliers, purchaseOrderItems, acceptanceOrders, draftAcceptanceHeader, draftAcceptanceLines, widgets } };
}

export interface BuildPreviewSnapshotEnv {
  revision: string;
  locale?: Locale;
  theme?: 'light' | 'dark';
  device?: MobileDevicePreset;
  viewportBounds?: { width?: number; height?: number } | null;
  meta: PflowProjectMetadata;
}

/**
 * Builds a complete `PreviewSnapshot` from either the live desktop store or a staged Hermes `context.snapshot`.
 */
export function buildStagedPreviewSnapshot(
  source: PreviewSnapshotSource,
  options: CaptureOptions,
  env: BuildPreviewSnapshotEnv,
): PreviewSnapshot {
  const pageId = options.pageId ?? source.activePageId;
  if (!pageId || !Object.prototype.hasOwnProperty.call(source.pageSources, pageId)) {
    throw new Error('No canvas source for pageId: ' + (pageId || '(empty)'));
  }
  const parsed = parsePageSource(source.pageSources[pageId]);
  if (!parsed.doc || parsed.issues.length) {
    throw new Error('Cannot render page: ' + pageId);
  }
  const { doc } = parsed;
  if (doc.root.type !== 'Page' && doc.root.type !== 'MobilePage') {
    throw new Error('Unknown page root: ' + doc.root.type);
  }
  const platform: PagePlatform = doc.root.type === 'MobilePage' ? 'mobile' : 'desktop';
  const devicePreset: MobileDevicePreset =
    env.device && Object.prototype.hasOwnProperty.call(MOBILE_DEVICE_SPECS, env.device) ? env.device : 'iphone';
  const deviceSpec = MOBILE_DEVICE_SPECS[devicePreset];
  const width = Math.min(
    2560,
    Math.max(
      platform === 'mobile' ? deviceSpec.width + 64 : 1280 + 24,
      Math.round(env.viewportBounds?.width || 1280),
    ),
  );
  const height = Math.min(
    2160,
    Math.max(
      platform === 'mobile' ? deviceSpec.height + 64 : 1,
      Math.round(env.viewportBounds?.height || 800),
    ),
  );
  return {
    pageId,
    revision: env.revision,
    scope: options.scope,
    fullPage: options.fullPage,
    waitMs: options.waitMs,
    ...(options.uiState ? { uiState: options.uiState } : {}),
    platform,
    doc,
    width,
    height,
    theme: env.theme === 'dark' ? 'dark' : 'light',
    locale: env.locale ?? getLocale(),
    device: devicePreset,
    meta: env.meta,
    state: {
      dbTables: source.dbTables,
      tableRows: source.tableRows,
      suppliers: source.suppliers,
      purchaseOrderItems: source.purchaseOrderItems,
      acceptanceOrders: source.acceptanceOrders,
      draftAcceptanceHeader: source.draftAcceptanceHeader,
      draftAcceptanceLines: source.draftAcceptanceLines,
      widgets: source.widgets,
      ...(source.designTokens ? { designTokens: source.designTokens } : {}),
    },
  };
}
