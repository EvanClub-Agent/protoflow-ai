import type { McpToolDefinition } from './tools';
import type { PagePlatform } from '../proto/mobile/types';
import type { UIStateMatrix } from '../store/useProtoStore';

export const capturePreviewTool: McpToolDefinition = {
  name: 'protoflow_capture_preview',
  description: 'Capture a rendered page from the authorized desktop project. canvas includes the visible stage and device frame; viewport crops to the page surface or phone screen. Supports optional uiState lens (normal/empty/loading/edge/error) for visual boundary auditing.',
  annotations: { title: 'Capture page preview', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    pageId: { type: 'string', minLength: 1, description: 'Defaults to the active page.' },
    scope: { type: 'string', enum: ['canvas', 'viewport'], default: 'viewport' },
    fullPage: { type: 'boolean', default: false, description: 'Expand long pages up to 2160 CSS pixels. Check truncated in the result.' },
    waitMs: { type: 'integer', minimum: 0, maximum: 5000, default: 0 },
    uiState: { type: 'string', enum: ['normal', 'empty', 'loading', 'edge', 'error'], default: 'normal', description: 'Optional UI Stack state lens to verify empty states, loading skeletons, edge text overflow, or error fallbacks without mutating project data.' },
  } },
};

export interface CaptureOptions { pageId?: string; scope: 'canvas' | 'viewport'; fullPage: boolean; waitMs: number; uiState?: UIStateMatrix }
export interface CaptureResult {
  pageId: string; platform: PagePlatform; scope: CaptureOptions['scope']; revision: string;
  width: number; height: number; data: string; fullPage: boolean; truncated: boolean;
}

const VALID_CAPTURE_UI_STATES = new Set(['normal', 'empty', 'loading', 'edge', 'error']);

export function parseCaptureOptions(input: unknown): CaptureOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Capture arguments must be an object');
  const args = input as Record<string, unknown>;
  for (const key of Object.keys(args)) if (!['pageId', 'scope', 'fullPage', 'waitMs', 'uiState'].includes(key)) throw new Error('Unknown capture argument: ' + key);
  const { pageId, scope = 'viewport', fullPage = false, waitMs = 0, uiState } = args;
  if (pageId !== undefined && (typeof pageId !== 'string' || !pageId.trim())) throw new Error('Invalid pageId');
  if (scope !== 'canvas' && scope !== 'viewport') throw new Error('Invalid scope');
  if (typeof waitMs !== 'number' || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 5000) throw new Error('waitMs must be an integer from 0 to 5000');
  if (typeof fullPage !== 'boolean') throw new Error('fullPage must be boolean');
  if (uiState !== undefined && (typeof uiState !== 'string' || !VALID_CAPTURE_UI_STATES.has(uiState))) throw new Error('Invalid uiState');
  return { pageId, scope, fullPage, waitMs, ...(uiState ? { uiState: uiState as UIStateMatrix } : {}) };
}
