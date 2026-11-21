import type { McpToolDefinition } from './tools';
import type { PagePlatform } from '../proto/mobile/types';

export const capturePreviewTool: McpToolDefinition = {
  name: 'protoflow_capture_preview',
  description: 'Capture a rendered page from the authorized desktop project. canvas includes the visible stage and device frame; viewport crops to the page surface or phone screen.',
  annotations: { title: 'Capture page preview', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    pageId: { type: 'string', minLength: 1, description: 'Defaults to the active page.' },
    scope: { type: 'string', enum: ['canvas', 'viewport'], default: 'viewport' },
    waitMs: { type: 'integer', minimum: 0, maximum: 5000, default: 0 },
  } },
};

export interface CaptureOptions { pageId?: string; scope: 'canvas' | 'viewport'; waitMs: number }
export interface CaptureResult {
  pageId: string; platform: PagePlatform; scope: CaptureOptions['scope']; revision: string;
  width: number; height: number; data: string;
}

export function parseCaptureOptions(input: unknown): CaptureOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Capture arguments must be an object');
  const args = input as Record<string, unknown>;
  for (const key of Object.keys(args)) if (!['pageId', 'scope', 'waitMs'].includes(key)) throw new Error('Unknown capture argument: ' + key);
  const { pageId, scope = 'viewport', waitMs = 0 } = args;
  if (pageId !== undefined && (typeof pageId !== 'string' || !pageId.trim())) throw new Error('Invalid pageId');
  if (scope !== 'canvas' && scope !== 'viewport') throw new Error('Invalid scope');
  if (typeof waitMs !== 'number' || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 5000) throw new Error('waitMs must be an integer from 0 to 5000');
  return { pageId, scope, waitMs };
}
